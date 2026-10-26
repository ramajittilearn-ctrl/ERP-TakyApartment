#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <operations-image> <app-image>" >&2
  exit 2
}
[[ $# == 2 ]] || usage

operations_image="$1"
app_image="$2"
revision="$(git rev-parse HEAD)"
tree="$(git rev-parse 'HEAD^{tree}')"
db_image="$(awk '$1 == "db:" { in_db = 1; next } in_db && $1 == "app:" { exit } in_db && $1 == "image:" { print $2; exit }' docker-compose.yml)"
if [[ ! "$db_image" =~ @sha256:[a-f0-9]{64}$ ]]; then
  echo "The development database image must be pinned by digest" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Operations backup/restore verification requires a clean source checkout" >&2
  exit 1
fi

for image in "$operations_image" "$app_image"; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "Required already-built image is unavailable: $image" >&2
    exit 1
  fi
  image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
  image_tree="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.tree"}}' "$image")"
  if [[ "$image_revision" != "$revision" || "$image_tree" != "$tree" ]]; then
    echo "Image does not match the clean checkout: $image" >&2
    exit 1
  fi
done
operations_user="$(docker image inspect --format '{{.Config.User}}' "$operations_image")"
if [[ -n "$operations_user" && "$operations_user" != "0" && "$operations_user" != "root" ]]; then
  echo "The operations image default user cannot read the mode-0600 CI key mount: $operations_user" >&2
  exit 1
fi

project="taky-ops-restore-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${RANDOM}"
ownership_label="com.taky.ci.run"
network="${project}-private"
source_db="${project}-source-db"
restore_db="${project}-restore-db"
app="${project}-app"
source_db_volume="${project}-source-database"
restore_db_volume="${project}-restore-database"
source_attachments_volume="${project}-source-attachments"
restore_attachments_volume="${project}-restore-attachments"
backup_volume="${project}-backups"
database_password="ci_synthetic_password_only"
fixture_content="Synthetic CI attachment for isolated restore verification."
fixture_sha="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$fixture_content")"
tmp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
key_dir="${tmp_root%/}/${project}"
key_file="${key_dir}/backup.key"
rclone_config_file="${key_dir}/rclone.conf"
remote_dir="${key_dir}/remote"
containers=("$source_db" "$restore_db" "$app" "${project}-backup" "${project}-restore" "${project}-source-volume-owner" "${project}-fixture" "${project}-restore-check")
volumes=("$source_db_volume" "$restore_db_volume" "$source_attachments_volume" "$restore_attachments_volume" "$backup_volume")
owned_containers=()
owned_volumes=()
owned_network=0

refuse_existing() {
  local kind="$1" name="$2"
  case "$kind" in
    container)
      if docker container inspect "$name" >/dev/null 2>&1; then
        echo "Refusing pre-existing container: $name" >&2
        return 1
      fi
      ;;
    volume)
      if docker volume inspect "$name" >/dev/null 2>&1; then
        echo "Refusing pre-existing volume: $name" >&2
        return 1
      fi
      ;;
    network)
      if docker network inspect "$name" >/dev/null 2>&1; then
        echo "Refusing pre-existing network: $name" >&2
        return 1
      fi
      ;;
    *) echo "Unknown Docker resource kind: $kind" >&2; return 1 ;;
  esac
}

cleanup() {
  local original_status=$? cleanup_failed=0 name label
  trap - EXIT
  set +e
  for name in "${owned_containers[@]}"; do
    if ! label="$(docker inspect --format "{{index .Config.Labels \"$ownership_label\"}}" "$name" 2>/dev/null)"; then
      echo "Cleanup failed: could not inspect owned container $name" >&2
      cleanup_failed=1
      continue
    fi
    if [[ "$label" != "$project" ]]; then
      echo "Cleanup refused container with unexpected ownership label: $name" >&2
      cleanup_failed=1
      continue
    fi
    if ! docker rm -f "$name" >/dev/null; then
      echo "Cleanup failed: could not remove owned container $name" >&2
      cleanup_failed=1
    fi
  done
  for name in "${owned_volumes[@]}"; do
    if ! label="$(docker volume inspect --format "{{index .Labels \"$ownership_label\"}}" "$name" 2>/dev/null)"; then
      echo "Cleanup failed: could not inspect owned volume $name" >&2
      cleanup_failed=1
      continue
    fi
    if [[ "$label" != "$project" ]]; then
      echo "Cleanup refused volume with unexpected ownership label: $name" >&2
      cleanup_failed=1
      continue
    fi
    if ! docker volume rm "$name" >/dev/null; then
      echo "Cleanup failed: could not remove owned volume $name" >&2
      cleanup_failed=1
    fi
  done
  if [[ "$owned_network" == 1 ]]; then
    if ! label="$(docker network inspect --format "{{index .Labels \"$ownership_label\"}}" "$network" 2>/dev/null)"; then
      echo "Cleanup failed: could not inspect owned network $network" >&2
      cleanup_failed=1
    elif [[ "$label" != "$project" ]]; then
      echo "Cleanup refused network with unexpected ownership label: $network" >&2
      cleanup_failed=1
    elif ! docker network rm "$network" >/dev/null; then
      echo "Cleanup failed: could not remove owned network $network" >&2
      cleanup_failed=1
    fi
  fi
  if [[ -f "$key_file" ]] && ! rm -f -- "$key_file"; then
    echo "Cleanup failed: could not remove generated key file $key_file" >&2
    cleanup_failed=1
  fi
  if [[ -f "$rclone_config_file" ]] && ! rm -f -- "$rclone_config_file"; then
    echo "Cleanup failed: could not remove generated rclone config $rclone_config_file" >&2
    cleanup_failed=1
  fi
  if [[ -d "$remote_dir" ]]; then
    if ! find "$remote_dir" -mindepth 1 -maxdepth 1 -type f -delete; then
      echo "Cleanup failed: could not remove files from the run-owned synthetic remote" >&2
      cleanup_failed=1
    fi
    if ! rmdir -- "$remote_dir"; then
      echo "Cleanup failed: synthetic remote directory is not empty or could not be removed" >&2
      cleanup_failed=1
    fi
  fi
  if [[ -d "$key_dir" ]] && ! rmdir -- "$key_dir"; then
    echo "Cleanup failed: temporary key directory is not empty or could not be removed: $key_dir" >&2
    cleanup_failed=1
  fi
  if [[ "$original_status" != 0 ]]; then exit "$original_status"; fi
  if [[ "$cleanup_failed" == 1 ]]; then exit 1; fi
  return 0
}

for name in "${containers[@]}"; do refuse_existing container "$name"; done
for name in "${volumes[@]}"; do refuse_existing volume "$name"; done
refuse_existing network "$network"
if [[ -e "$key_dir" ]]; then
  echo "Refusing pre-existing temporary key directory: $key_dir" >&2
  exit 1
fi
trap cleanup EXIT

owned_network=1
docker network create --internal --label "$ownership_label=$project" "$network" >/dev/null
label="$(docker network inspect --format "{{index .Labels \"$ownership_label\"}}" "$network")"
[[ "$label" == "$project" ]]

create_owned_volume() {
  local name="$1" label
  owned_volumes+=("$name")
  docker volume create --label "$ownership_label=$project" "$name" >/dev/null
  label="$(docker volume inspect --format "{{index .Labels \"$ownership_label\"}}" "$name")"
  if [[ "$label" != "$project" ]]; then
    echo "CI volume ownership label did not match: $name" >&2
    return 1
  fi
}
for name in "${volumes[@]}"; do create_owned_volume "$name"; done

owned_containers+=("$source_db")
docker run --detach --platform linux/amd64 \
  --name "$source_db" --label "$ownership_label=$project" --network "$network" --network-alias db \
  --mount "type=volume,source=$source_db_volume,target=/var/lib/postgresql/data" \
  --env POSTGRES_DB=taky_ci --env POSTGRES_USER=taky_ci \
  --env "POSTGRES_PASSWORD=$database_password" \
  --health-cmd "pg_isready -U taky_ci -d taky_ci" \
  --health-interval 2s --health-timeout 3s --health-retries 30 \
  "$db_image" >/dev/null

owned_containers+=("$restore_db")
docker run --detach --platform linux/amd64 \
  --name "$restore_db" --label "$ownership_label=$project" --network "$network" --network-alias restore-db \
  --mount "type=volume,source=$restore_db_volume,target=/var/lib/postgresql/data" \
  --env POSTGRES_DB=taky_restore_test --env POSTGRES_USER=taky_ci \
  --env "POSTGRES_PASSWORD=$database_password" \
  --health-cmd "pg_isready -U taky_ci -d taky_restore_test" \
  --health-interval 2s --health-timeout 3s --health-retries 30 \
  "$db_image" >/dev/null

wait_healthy() {
  local name="$1" state
  for _ in $(seq 1 60); do
    state="$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || true)"
    if [[ "$state" == healthy ]]; then return 0; fi
    if [[ "$state" == unhealthy ]]; then
      echo "Container became unhealthy: $name" >&2
      docker logs --tail 100 "$name" >&2 || true
      return 1
    fi
    sleep 2
  done
  echo "Timed out waiting for healthy container: $name" >&2
  docker inspect --format 'state={{json .State}}' "$name" >&2 || true
  docker logs --tail 100 "$name" >&2 || true
  return 1
}
wait_healthy "$source_db"
wait_healthy "$restore_db"

# The app image performs the same migrations and seed used by the runtime image.
owned_containers+=("$app")
docker run --detach --platform linux/amd64 \
  --name "$app" --label "$ownership_label=$project" --network "$network" --network-alias app-ci \
  --mount "type=volume,source=$source_attachments_volume,target=/app/storage/attachments" \
  --env "DATABASE_URL=postgresql://taky_ci:${database_password}@db:5432/taky_ci?schema=public" \
  --env SESSION_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --env APP_ORIGIN=http://app-ci:3000 --env COOKIE_SECURE=false \
  --env ATTACHMENT_DIR=/app/storage/attachments \
  --env EVIDENCE_VALIDATOR_ORIGIN=http://evidence-validator:3835 \
  --env EVIDENCE_VALIDATOR_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --security-opt no-new-privileges:true \
  "$app_image" >/dev/null

rooms_ready=false
room_count="unavailable"
for _ in $(seq 1 120); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$app" 2>/dev/null || true)" != true ]]; then
    echo "App image stopped during database migration/seed" >&2
    docker logs --tail 150 "$app" >&2 || true
    exit 1
  fi
  room_count="$(docker exec "$source_db" psql -U taky_ci -d taky_ci -Atc 'SELECT count(*) FROM "Room"' 2>/dev/null || true)"
  if [[ "$room_count" == 15 ]]; then rooms_ready=true; break; fi
  sleep 2
done
if [[ "$rooms_ready" != true ]]; then
  echo "Synthetic source did not reach 15 seeded rooms; observed count=$room_count" >&2
  docker logs --tail 150 "$app" >&2 || true
  docker exec "$source_db" psql -U taky_ci -d taky_ci -c '\dt' >&2 || true
  exit 1
fi

# A file-only fixture checks hash-preserving recovery without inventing
# application-owned Attachment metadata.
docker run --rm --platform linux/amd64 --label "$ownership_label=$project" \
  --name "${project}-source-volume-owner" --network none --user 0 \
  --mount "type=volume,source=$source_attachments_volume,target=/app/storage/attachments" \
  --entrypoint sh "$app_image" -ec 'chown -R 1000:1000 /app/storage/attachments && chmod 0700 /app/storage/attachments'
docker run --rm --platform linux/amd64 --label "$ownership_label=$project" \
  --name "${project}-fixture" --network none --mount "type=volume,source=$source_attachments_volume,target=/app/storage/attachments" \
  --entrypoint node "$app_image" -e \
  'const fs=require("node:fs");const path=require("node:path");const file=path.join("/app/storage/attachments","ci-fixtures","retained.txt");fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,process.argv[1],{flag:"wx",mode:0o600});' \
  "$fixture_content"

mkdir -m 0700 "$key_dir"
mkdir -m 0700 "$remote_dir"
umask 077
cat > "$rclone_config_file" <<'RCLONE_CONFIG'
[ci-local]
type = local
RCLONE_CONFIG
chmod 0600 "$rclone_config_file"
umask 077
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))' > "$key_file"
chmod 0600 "$key_file"
if [[ "$(stat -c '%a' "$key_file")" != 600 ]]; then
  echo "Temporary backup key file is not mode 0600" >&2
  exit 1
fi

run_operations() {
  local name="$1" restore_mode="$2"
  shift 2
  local args=(docker run --rm --platform linux/amd64 --name "$name"
    --label "$ownership_label=$project" --network "$network"
    --tmpfs /tmp:size=512m,mode=1777
    --mount "type=volume,source=$backup_volume,target=/backups"
    --mount "type=volume,source=$source_attachments_volume,target=/attachments,readonly"
    --mount "type=volume,source=$restore_attachments_volume,target=/restore-attachments"
    --mount "type=bind,source=$key_file,target=/run/secrets/backup.key,readonly"
    --mount "type=bind,source=$rclone_config_file,target=/run/rclone/rclone.conf,readonly"
    --mount "type=bind,source=$remote_dir,target=/ci-remote"
    --env BACKUP_DIR=/backups --env BACKUP_KEY_FILE=/run/secrets/backup.key
    --env ATTACHMENT_DIR=/attachments
    --env PGUSER=taky_ci
    --env "PGPASSWORD=$database_password")
  if [[ -n "${BACKUP_REMOTE:-}" ]]; then args+=(--env "BACKUP_REMOTE=$BACKUP_REMOTE"); fi
  if [[ -n "${CI_BACKUP_RECORD:-}" ]]; then args+=(--env "CI_BACKUP_RECORD=$CI_BACKUP_RECORD"); fi
  if [[ -n "$restore_mode" ]]; then
    args+=(--env "RESTORE_MODE=$restore_mode" --env PGHOST=restore-db --env PGDATABASE=taky_restore_test)
  else
    args+=(--env PGHOST=db --env PGDATABASE=taky_ci)
  fi
  "${args[@]}" "$operations_image" "$@"
}

backup_json="$(run_operations "${project}-backup" "" node operations/cli.mjs backup)"
backup_file="$(node -e 'const x=JSON.parse(process.argv[1]);if(x.status!=="SUCCEEDED"||!/^taky-\d{8}T\d{6}Z-[a-f0-9-]{36}\.taky\.enc$/.test(x.file)||!/^[a-f0-9]{64}$/.test(x.checksum)||!x.verifiedAt)process.exit(1);process.stdout.write(x.file)' "$backup_json")"
echo "Exact operations image created and locally verified synthetic backup: $backup_file"

restore_json="$(
  BACKUP_REMOTE=ci-local:/ci-remote CI_BACKUP_RECORD="$backup_json" \
    run_operations "${project}-restore" isolated node --input-type=module -e '
import { uploadRecord } from "./operations/backup.mjs";
import { readKey, run, sha256 } from "./operations/archive.mjs";
import { restoreIsolated } from "./operations/database.mjs";

const record = JSON.parse(process.env.CI_BACKUP_RECORD);
const remote = process.env.BACKUP_REMOTE;
await uploadRecord(record, remote);
const remoteFile = `${remote.replace(/\/$/, "")}/${record.file}`;
const downloaded = `/tmp/${record.file}.download`;
await run("rclone", ["copyto", remoteFile, downloaded]);
if ((await sha256(downloaded)) !== record.checksum)
  throw new Error("Fetched synthetic remote backup checksum mismatch");
const manifest = await restoreIsolated(
  downloaded,
  await readKey(process.env.BACKUP_KEY_FILE),
  "/restore-attachments",
);
process.stdout.write(JSON.stringify({
  file: record.file,
  checksum: await sha256(downloaded),
  verifiedAt: new Date().toISOString(),
  attachments: manifest.attachments.length,
}));
'
)"
node -e 'const backup=JSON.parse(process.argv[1]);const restored=JSON.parse(process.argv[2]);if(restored.file!==backup.file||restored.checksum!==backup.checksum||!Number.isSafeInteger(restored.attachments)||restored.attachments!==1)process.exit(1)' "$backup_json" "$restore_json"

restored_rooms="$(docker exec "$restore_db" psql -U taky_ci -d taky_restore_test -Atc 'SELECT count(*) FROM "Room"')"
if [[ "$restored_rooms" != 15 ]]; then
  echo "Isolated restore room count mismatch: expected 15, got ${restored_rooms:-unavailable}" >&2
  docker exec "$restore_db" psql -U taky_ci -d taky_restore_test -c '\dt' >&2 || true
  exit 1
fi
restored_fixture="$(docker run --rm --platform linux/amd64 --label "$ownership_label=$project" \
  --name "${project}-restore-check" --network none --mount "type=volume,source=$restore_attachments_volume,target=/attachments,readonly" \
  --entrypoint node "$app_image" -e \
  'const fs=require("node:fs");const c=require("node:crypto");const p="/attachments/ci-fixtures/retained.txt";const b=fs.readFileSync(p);process.stdout.write(c.createHash("sha256").update(b).digest("hex"));')"
if [[ "$restored_fixture" != "$fixture_sha" ]]; then
  echo "Isolated restore attachment hash mismatch: expected $fixture_sha, got ${restored_fixture:-unavailable}" >&2
  exit 1
fi

echo "Synthetic remote upload, read-back, and isolated restore passed: 15 rooms and attachment SHA-256 $restored_fixture."
