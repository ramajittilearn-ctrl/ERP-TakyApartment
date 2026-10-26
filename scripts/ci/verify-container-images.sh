#!/usr/bin/env bash
set -Eeuo pipefail

revision="$(git rev-parse HEAD)"
tree="$(git rev-parse 'HEAD^{tree}')"
db_image="$(awk '$1 == "db:" { in_db = 1; next } in_db && $1 == "app:" { exit } in_db && $1 == "image:" { print $2; exit }' docker-compose.yml)"
if [[ ! "$db_image" =~ @sha256:[a-f0-9]{64}$ ]]; then
  echo "The development database image must be pinned by digest" >&2
  exit 1
fi

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
validator_token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
database_password="ci_synthetic_password_only"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Container verification requires a clean source checkout" >&2
  exit 1
fi

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
    if [[ "$output" == *"No such"* || "$output" == *"no such"* ]]; then return 0; fi
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
bash scripts/ci/verify-operations-backup-restore.sh "$operations_image" "$app_image"

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
