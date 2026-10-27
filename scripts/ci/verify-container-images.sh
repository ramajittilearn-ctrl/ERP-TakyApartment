#!/usr/bin/env bash
set -Eeuo pipefail

revision="$(git rev-parse HEAD)"
tree="$(git rev-parse 'HEAD^{tree}')"
project="taky-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${RANDOM}"
ownership_label="com.taky.ci.run"
network="${project}-private"
database="${project}-db"
app="${project}-app"
validator="${project}-validator"
probe="${project}-probe"
db_volume="${project}-database"
attachments_volume="${project}-attachments"
app_image="taky-ci-app:${project}"
validator_image="taky-ci-validator:${project}"
operations_image="taky-ci-operations:${project}"
gosu_operational_binary="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/${project}-operational-gosu"
gosu_alpine_binary="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/${project}-alpine-gosu"
gosu_builder_image="golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4"
gosu_commit="6456aaa0f3c854d199d0f037f068eb97515b7513"
gosu_user_module_version="v0.4.1"
gosu_x_sys_module_version="v0.44.0"
validator_token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
database_password="ci_synthetic_password_only"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Container verification requires a clean source checkout" >&2
  exit 1
fi

main_compose_config="$(POSTGRES_DB=ci POSTGRES_USER=ci POSTGRES_PASSWORD=synthetic SESSION_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa DATABASE_URL=postgresql://ci:synthetic@db:5432/ci APP_ORIGIN=http://127.0.0.1:3000 docker compose -f docker-compose.yml config --format json)"
candidate_compose_config="$(POSTGRES_DB=ci POSTGRES_USER=ci POSTGRES_PASSWORD=synthetic docker compose -f docker-compose.alpine-candidate.yml config --format json)"
db_image="$(MAIN_COMPOSE_CONFIG="$main_compose_config" node -e 'process.stdout.write(JSON.parse(process.env.MAIN_COMPOSE_CONFIG).services.db.image)')"
candidate_db_image="$(CANDIDATE_COMPOSE_CONFIG="$candidate_compose_config" node -e 'process.stdout.write(JSON.parse(process.env.CANDIDATE_COMPOSE_CONFIG).services.db.image)')"
db_base_image="$(MAIN_COMPOSE_CONFIG="$main_compose_config" node -e 'process.stdout.write(JSON.parse(process.env.MAIN_COMPOSE_CONFIG).services.db.build.args.POSTGRES_BASE_IMAGE)')"
candidate_db_base_image="$(CANDIDATE_COMPOSE_CONFIG="$candidate_compose_config" node -e 'process.stdout.write(JSON.parse(process.env.CANDIDATE_COMPOSE_CONFIG).services.db.build.args.POSTGRES_BASE_IMAGE)')"
if [[ ! "$db_base_image" =~ @sha256:[a-f0-9]{64}$ || ! "$candidate_db_base_image" =~ @sha256:[a-f0-9]{64}$ ]]; then
  echo "Both PostgreSQL base images must be pinned by digest" >&2
  exit 1
fi
MAIN_COMPOSE_CONFIG="$main_compose_config" CANDIDATE_COMPOSE_CONFIG="$candidate_compose_config" \
  MAIN_DB_IMAGE="$db_image" CANDIDATE_DB_IMAGE="$candidate_db_image" \
  MAIN_DB_BASE_IMAGE="$db_base_image" CANDIDATE_DB_BASE_IMAGE="$candidate_db_base_image" \
  node -e '
    const main = JSON.parse(process.env.MAIN_COMPOSE_CONFIG);
    const candidate = JSON.parse(process.env.CANDIDATE_COMPOSE_CONFIG);
    const expected = {
      mainProject: "taky-erp",
      mainVolume: "taky-erp_database",
      candidateProject: "taky-erp-alpine-candidate",
      candidateVolume: "taky-erp-alpine-candidate-database",
    };
    if (main.name !== expected.mainProject || main.services.db.image !== process.env.MAIN_DB_IMAGE || main.services.db.build.args.POSTGRES_BASE_IMAGE !== process.env.MAIN_DB_BASE_IMAGE || main.volumes.database.name !== expected.mainVolume) {
      throw new Error(`Operational Compose identity changed: ${JSON.stringify({name: main.name, image: main.services.db.image, baseImage: main.services.db.build.args.POSTGRES_BASE_IMAGE, volume: main.volumes.database.name})}`);
    }
    if (candidate.name !== expected.candidateProject || candidate.services.db.image !== process.env.CANDIDATE_DB_IMAGE || candidate.services.db.build.args.POSTGRES_BASE_IMAGE !== process.env.CANDIDATE_DB_BASE_IMAGE || candidate.volumes.database.name !== expected.candidateVolume || candidate.volumes.database.name === main.volumes.database.name) {
      throw new Error(`Alpine candidate Compose isolation changed: ${JSON.stringify({name: candidate.name, image: candidate.services.db.image, baseImage: candidate.services.db.build.args.POSTGRES_BASE_IMAGE, volume: candidate.volumes.database.name})}`);
    }
    console.log("Operational and Alpine candidate Compose projects and database volumes are isolated.");
  '

resource_label() {
  local kind="$1" name="$2" output
  case "$kind" in
    container) output="$(docker inspect --format "{{index .Config.Labels \"$ownership_label\"}}" "$name" 2>&1)" ;;
    volume) output="$(docker volume inspect --format "{{index .Labels \"$ownership_label\"}}" "$name" 2>&1)" ;;
    network) output="$(docker network inspect --format "{{index .Labels \"$ownership_label\"}}" "$name" 2>&1)" ;;
    *) echo "Unknown Docker resource kind: $kind" >&2; return 1 ;;
  esac
  local status=$?
  if [[ "$status" != 0 ]]; then
    if [[ "$output" == *"No such"* || "$output" == *"no such"* || "$output" == *"not found"* ]]; then return 0; fi
    echo "Could not inspect $kind during cleanup ($name): $output" >&2
    return 1
  fi
  printf '%s' "$output"
}

remove_owned_resource() {
  local kind="$1" name="$2" label
  if ! label="$(resource_label "$kind" "$name")"; then return 1; fi
  if [[ -z "$label" ]]; then return 0; fi
  if [[ "$label" != "$project" ]]; then
    echo "Refusing to remove $kind without this run's ownership label: $name" >&2
    return 1
  fi
  case "$kind" in
    container) docker rm -f "$name" >/dev/null ;;
    volume) docker volume rm "$name" >/dev/null ;;
    network) docker network rm "$name" >/dev/null ;;
  esac
}

cleanup() {
  local exit_status=$? cleanup_failed=0 name
  trap - EXIT
  set +e
  rm -f -- "$gosu_operational_binary" "$gosu_alpine_binary"
  for name in "$app" "$validator" "$database" "$probe"; do
    remove_owned_resource container "$name" || cleanup_failed=1
  done
  for name in "$db_volume" "$attachments_volume"; do
    remove_owned_resource volume "$name" || cleanup_failed=1
  done
  remove_owned_resource network "$network" || cleanup_failed=1
  if [[ "$cleanup_failed" == 1 ]]; then
    echo "One or more run-owned container resources could not be cleaned up" >&2
    if [[ "$exit_status" == 0 ]]; then exit_status=1; fi
  fi
  exit "$exit_status"
}
trap cleanup EXIT

build_image() {
  local image="$1" dockerfile="$2" context="$3" actual_revision actual_tree
  docker build --pull --platform linux/amd64 \
    --label "org.opencontainers.image.revision=$revision" \
    --label "org.opencontainers.image.tree=$tree" \
    --tag "$image" --file "$dockerfile" "$context"
  actual_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
  actual_tree="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.tree"}}' "$image")"
  [[ "$actual_revision" == "$revision" && "$actual_tree" == "$tree" ]]
}

echo "Building app image for $revision ($tree)"
build_image "$app_image" Dockerfile .
echo "Building evidence validator image"
build_image "$validator_image" operations/evidence-validator/Dockerfile operations/evidence-validator
echo "Building operations image"
build_image "$operations_image" operations/Dockerfile .
build_postgres_image() {
  local image="$1" base_image="$2" actual_revision actual_tree actual_builder actual_gosu_commit actual_user_module actual_x_sys_module
  docker build --pull --platform linux/amd64 \
    --build-arg "GOSU_BUILDER_IMAGE=$gosu_builder_image" \
    --build-arg "GOSU_COMMIT=$gosu_commit" \
    --build-arg "GOSU_USER_MODULE_VERSION=$gosu_user_module_version" \
    --build-arg "GOSU_X_SYS_MODULE_VERSION=$gosu_x_sys_module_version" \
    --build-arg "POSTGRES_BASE_IMAGE=$base_image" \
    --label "org.opencontainers.image.revision=$revision" \
    --label "org.opencontainers.image.tree=$tree" \
    --tag "$image" --file docker/postgres/Dockerfile .
  actual_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
  actual_tree="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.tree"}}' "$image")"
  actual_builder="$(docker image inspect --format '{{index .Config.Labels "io.taky.postgres.gosu.builder"}}' "$image")"
  actual_gosu_commit="$(docker image inspect --format '{{index .Config.Labels "io.taky.postgres.gosu.commit"}}' "$image")"
  actual_user_module="$(docker image inspect --format '{{index .Config.Labels "io.taky.postgres.gosu.user-module"}}' "$image")"
  actual_x_sys_module="$(docker image inspect --format '{{index .Config.Labels "io.taky.postgres.gosu.x-sys-module"}}' "$image")"
  [[ "$actual_revision" == "$revision" && "$actual_tree" == "$tree" \
    && "$actual_builder" == "$gosu_builder_image" \
    && "$actual_gosu_commit" == "$gosu_commit" \
    && "$actual_user_module" == "$gosu_user_module_version" \
    && "$actual_x_sys_module" == "$gosu_x_sys_module_version" ]]
}
echo "Building pinned operational PostgreSQL derivative"
build_postgres_image "$db_image" "$db_base_image"
echo "Building isolated Alpine PostgreSQL candidate derivative"
build_postgres_image "$candidate_db_image" "$candidate_db_base_image"
legacy_trixie_db_image="postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe"
legacy_bookworm_db_image="postgres:17.11-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27"
bash scripts/ci/verify-operations-backup-restore.sh "$operations_image" "$app_image" "$candidate_db_image" "$legacy_trixie_db_image"
bash scripts/ci/verify-operations-backup-restore.sh "$operations_image" "$app_image" "$candidate_db_image" "$legacy_bookworm_db_image"

docker run --rm --platform linux/amd64 --entrypoint sh "$app_image" -ec '
  ! command -v npm >/dev/null
  ! command -v npx >/dev/null
  test ! -e /usr/local/lib/node_modules/npm
  test ! -e /usr/local/bin/npm
  test ! -e /usr/local/bin/npx
  test -f server.js
  node node_modules/prisma/build/index.js --version
  node node_modules/tsx/dist/cli.mjs --version
'
docker run --rm --platform linux/amd64 --entrypoint sh "$validator_image" -ec '
  ! command -v npm >/dev/null
  ! command -v npx >/dev/null
  test ! -e /usr/local/lib/node_modules/npm
  test ! -e /usr/local/bin/npm
  test ! -e /usr/local/bin/npx
  command -v qpdf >/dev/null
  node --version
  qpdf --version
'
docker run --rm --platform linux/amd64 --read-only \
  --tmpfs /backups:size=16m,mode=1777 \
  --env BACKUP_DIR=/backups \
  --env BACKUP_KEY_FILE=/dev/null \
  --entrypoint sh "$operations_image" -ec '
    command -v node >/dev/null
    command -v pg_dump >/dev/null
    command -v pg_restore >/dev/null
    command -v rclone >/dev/null
    command -v flock >/dev/null
    command -v timeout >/dev/null
    ! command -v gosu >/dev/null
    rclone_version="$(rclone version)"
    printf "%s\n" "$rclone_version" | grep -F "rclone v1.75.2" >/dev/null
    printf "%s\n" "$rclone_version" | grep -F "go1.27.3" >/dev/null
    node operations/cli.mjs status
  '

create_owned_network() {
  local label
  docker network create --internal --label "$ownership_label=$project" "$network" >/dev/null
  label="$(docker network inspect --format "{{index .Labels \"$ownership_label\"}}" "$network")"
  [[ "$label" == "$project" ]]
}
create_owned_volume() {
  local name="$1" label
  if docker volume inspect "$name" >/dev/null 2>&1; then
    echo "Refusing pre-existing CI volume: $name" >&2
    return 1
  fi
  docker volume create --label "$ownership_label=$project" "$name" >/dev/null
  label="$(docker volume inspect --format "{{index .Labels \"$ownership_label\"}}" "$name")"
  if [[ "$label" != "$project" ]]; then
    echo "CI volume ownership label did not match: $name" >&2
    return 1
  fi
}
create_owned_network
create_owned_volume "$db_volume"
create_owned_volume "$attachments_volume"
docker run --detach --platform linux/amd64 \
  --name "$database" --label "$ownership_label=$project" --network "$network" --network-alias db \
  --mount "type=volume,source=$db_volume,target=/var/lib/postgresql/data" \
  --env POSTGRES_DB=taky_ci --env POSTGRES_USER=taky_ci \
  --env "POSTGRES_PASSWORD=$database_password" \
  --health-cmd "pg_isready -U taky_ci -d taky_ci" \
  --health-interval 2s --health-timeout 3s --health-retries 30 \
  "$db_image" >/dev/null

database_healthy=false
for _ in $(seq 1 60); do
  state="$(docker inspect --format '{{.State.Health.Status}}' "$database" 2>/dev/null || true)"
  if [[ "$state" == healthy ]]; then
    database_healthy=true
    break
  fi
  if [[ "$state" == unhealthy ]]; then docker logs "$database"; exit 1; fi
  sleep 2
done
if [[ "$database_healthy" != true ]]; then
  docker logs "$database"
  exit 1
fi

docker run --detach --platform linux/amd64 \
  --name "$validator" --label "$ownership_label=$project" --network "$network" --network-alias evidence-validator \
  --read-only --tmpfs /tmp:size=32m,mode=1777,noexec,nosuid,nodev \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 512m --memory-swap 512m --cpus 1 --pids-limit 64 \
  --env "EVIDENCE_VALIDATOR_TOKEN=$validator_token" \
  "$validator_image" >/dev/null

docker run --detach --platform linux/amd64 \
  --name "$app" --label "$ownership_label=$project" --network "$network" --network-alias app \
  --mount "type=volume,source=$attachments_volume,target=/app/storage/attachments" \
  --env DATABASE_URL="postgresql://taky_ci:${database_password}@db:5432/taky_ci?schema=public" \
  --env SESSION_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --env APP_ORIGIN=http://app:3000 --env COOKIE_SECURE=false \
  --env ATTACHMENT_DIR=/app/storage/attachments \
  --env EVIDENCE_VALIDATOR_ORIGIN=http://evidence-validator:3835 \
  --env "EVIDENCE_VALIDATOR_TOKEN=$validator_token" \
  --security-opt no-new-privileges:true \
  "$app_image" >/dev/null

docker run --detach --platform linux/amd64 \
  --name "$probe" --label "$ownership_label=$project" --network "$network" --entrypoint sh "$validator_image" \
  -c 'sleep 300' >/dev/null

wait_http() {
  local url="$1" service="$2" last_probe_result=""
  diagnose_app_network() {
    [[ "$service" == "$app" ]] || return 0
    docker network inspect --format 'network containers={{json .Containers}}' "$network" >&2 || true
    docker exec "$probe" node -e \
      "require('node:dns').lookup('app',{all:true},(error,addresses)=>console.error('app DNS:',error?.code ?? addresses))" >&2 || true
    docker exec "$app" node -e \
      "fetch('http://127.0.0.1:3000/api/health/',{signal:AbortSignal.timeout(5000)}).then(r=>console.error('app loopback HTTP:',r.status)).catch(e=>console.error('app loopback fetch:',e.message,e.cause?.code,e.cause?.syscall))" >&2 || true
  }
  for _ in $(seq 1 90); do
    if last_probe_result="$(docker exec "$probe" node -e \
      "fetch('$url').then(async r=>{if(!r.ok){console.error('HTTP '+r.status+' '+(await r.text()).slice(0,500));process.exit(1)}}).catch(e=>{console.error(e.message,e.cause?.code,e.cause?.syscall,e.cause?.hostname);process.exit(1)})" 2>&1)"; then
      return 0
    fi
    if [[ "$(docker inspect --format '{{.State.Running}}' "$service" 2>/dev/null || true)" != true ]]; then
      echo "Container $service stopped while probing $url; last probe: $last_probe_result" >&2
      docker inspect --format 'state={{json .State}}' "$service" >&2 || true
      docker logs --tail 100 "$service" >&2 || true
      diagnose_app_network
      return 1
    fi
    sleep 2
  done
  echo "Timed out probing $url; last probe: $last_probe_result" >&2
  docker inspect --format 'state={{json .State}}' "$service" >&2 || true
  docker logs --tail 100 "$service" >&2 || true
  diagnose_app_network
  return 1
}

wait_http http://evidence-validator:3835/health "$validator"
wait_http http://app:3000/api/health/ "$app"
room_count="$(docker exec "$database" psql -U taky_ci -d taky_ci -Atc 'SELECT count(*) FROM "Room";')"
[[ "$room_count" == 15 ]]
echo "App health passed; fresh database migrated and seeded $room_count rooms."

docker exec "$probe" node -e \
  "fetch('http://evidence-validator:3835/validate',{method:'POST',headers:{'X-Taky-Validator-Token':'${validator_token:0:63}b'},body:'x'}).then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(2))"
echo "Validator rejects an invalid token with HTTP 401."

docker exec "$app" node --input-type=module -e '
  import argon2 from "argon2";
  const hash = await argon2.hash("ci-only-native-module-smoke");
  if (!(await argon2.verify(hash, "ci-only-native-module-smoke"))) process.exit(1);
'
echo "App image loads and exercises the native Argon2 module."

validator_pdf="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/${project}-valid.pdf"
python3 - "$validator_pdf" <<'PY'
import sys
from pathlib import Path

output = Path(sys.argv[1])
parts = [b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"]
objects = [
    b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    b"4 0 obj\n<< /Length 4 >>\nstream\nq Q\n\nendstream\nendobj\n",
]
offsets = [0]
for obj in objects:
    offsets.append(sum(map(len, parts)))
    parts.append(obj)
xref_offset = sum(map(len, parts))
parts.append(f"xref\n0 {len(offsets)}\n".encode())
parts.append(b"0000000000 65535 f \n")
for offset in offsets[1:]:
    parts.append(f"{offset:010d} 00000 n \n".encode())
parts.append(
    f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode()
)
output.write_bytes(b"".join(parts))
PY
docker exec -i "$validator" sh -ec 'cat > /tmp/phase4-ci-valid.pdf' < "$validator_pdf"
docker exec "$validator" node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  import sharp from "sharp";
  const token = process.env.EVIDENCE_VALIDATOR_TOKEN;
  const post = async (bytes) => fetch("http://127.0.0.1:3835/validate", {
    method: "POST",
    headers: { "x-taky-validator-token": token },
    body: bytes,
  });
  const pdf = await post(await readFile("/tmp/phase4-ci-valid.pdf"));
  const pdfResult = await pdf.json();
  if (pdf.status !== 200 || pdfResult.mimeType !== "application/pdf" || pdfResult.valid !== true) {
    throw new Error(`Alpine qpdf validation failed: ${pdf.status} ${JSON.stringify(pdfResult)}`);
  }
  const pngBytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer();
  const png = await post(pngBytes);
  const pngResult = await png.json();
  if (png.status !== 200 || pngResult.mimeType !== "image/png" || pngResult.valid !== true) {
    throw new Error(`Alpine Sharp validation failed: ${png.status} ${JSON.stringify(pngResult)}`);
  }
'
echo "Validator image accepted synthetic PDF via qpdf and PNG via Sharp over its bounded HTTP service."
docker exec "$validator" sh -ec \
  'test -z "$(find /tmp -mindepth 1 -maxdepth 1 -type d -name "taky-validator-*" -print -quit)"'
echo "Validator removed temporary inputs after successful parsing."

bash scripts/ci/scan-container-images.sh \
  "$app_image" "$validator_image" "$operations_image" "$db_image" "$candidate_db_image" \
  "$revision" "$tree" "${RUNNER_TEMP:?RUNNER_TEMP is required}/phase4-container-scan"

gosu_report_dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/phase4-container-scan"
check_gosu_image() {
  local image="$1" base_image="$2" binary="$3" report_name="$4" image_id
  image_id="$(docker image inspect --format '{{.Id}}' "$image")"
  docker run --rm --platform linux/amd64 --entrypoint sh "$image" -ec \
    'cat /usr/local/bin/gosu' > "$binary"
  [[ "$(docker image inspect --format '{{.Id}}' "$image")" == "$image_id" ]]
  printf 'Extracted gosu from image %s (%s)\n' "$image" "$image_id"
  bash scripts/ci/check-gosu-binary-vulnerabilities.sh \
    "$binary" "$image" "$image_id" "$base_image" "$gosu_report_dir/$report_name"
}
printf '%s\n' '- Separate exact-binary Go reachability analyses cover both operational Trixie and candidate Alpine PostgreSQL images; they do not modify or suppress the raw Trivy reports.' >> "$gosu_report_dir/README.md"
check_gosu_image "$db_image" "$db_base_image" "$gosu_operational_binary" gosu-operational-govulncheck.txt
check_gosu_image "$candidate_db_image" "$candidate_db_base_image" "$gosu_alpine_binary" gosu-alpine-govulncheck.txt
