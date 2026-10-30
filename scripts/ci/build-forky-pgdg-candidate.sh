#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly input_dir="${1:?verified same-run package inputs directory is required}"
readonly evidence_dir="${2:?candidate evidence output directory is required}"
readonly candidate_sha="${GITHUB_SHA:?GITHUB_SHA is required}"
readonly image="taky-erp-postgres:17.11-forky-pgdg-candidate-${candidate_sha:0:12}"
readonly tree="$(git -C "$root" rev-parse HEAD^{tree})"
readonly forky_base='debian:forky-slim@sha256:98af9d99779532814d4b51c34d50df8d8886286a2a1ab9625a62db59b9cf1b2d'
readonly postgres_entrypoint_source='postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe'
readonly gosu_builder_image='golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4'
readonly gosu_commit='6456aaa0f3c854d199d0f037f068eb97515b7513'
readonly gosu_user_module_version='v0.4.1'
readonly gosu_x_sys_module_version='v0.44.0'
readonly bookworm_restore_source='postgres:17.11-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27'
mkdir -p "$evidence_dir"
chmod 0700 "$evidence_dir"
printf '{"schemaVersion":1,"status":"IN_PROGRESS","runtimeVerification":false,"gosuBinaryProvenance":false,"gosuGovulncheckNoVulnerabilities":false,"gosuTrivyNoCriticalHigh":false,"scannerClearance":false,"cveDisposition":false,"imageSelection":false,"productionClearance":false}\n' > "$evidence_dir/status.json"
exec > >(tee "$evidence_dir/candidate-build.log") 2>&1

die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
cleanup_containers=()
cleanup_volumes=()
cleanup() {
  local status=$?
  for item in "${cleanup_containers[@]}"; do docker rm --force "$item" >/dev/null 2>&1 || true; done
  for item in "${cleanup_volumes[@]}"; do docker volume rm "$item" >/dev/null 2>&1 || true; done
  if (( status != 0 )); then
    printf '{"schemaVersion":1,"status":"FAIL","runtimeVerification":false,"gosuBinaryProvenance":false,"gosuGovulncheckNoVulnerabilities":false,"gosuTrivyNoCriticalHigh":false,"scannerClearance":false,"cveDisposition":false,"imageSelection":false,"productionClearance":false}\n' > "$evidence_dir/status.json"
  fi
  if (( status == 0 )); then printf 'cleanup=PASS\n' > "$evidence_dir/cleanup.txt"; else printf 'cleanup=attempted-after-failure\n' > "$evidence_dir/cleanup.txt"; fi
}
trap cleanup EXIT

command -v docker >/dev/null || die 'Docker CLI is unavailable'
command -v python3 >/dev/null || die 'Python 3 is unavailable'
command -v dpkg >/dev/null || die 'dpkg is required to compare Debian package versions'
[[ "$(docker info --format '{{.OSType}}/{{.Architecture}}')" == 'linux/x86_64' ]] || die 'Candidate build requires a Linux amd64 Docker engine'

python3 "$root/scripts/ci/validate_forky_candidate_inputs.py" \
  "$input_dir" "$GITHUB_SHA" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
cp -- "$input_dir/verified-inputs.json" "$evidence_dir/verified-inputs.json"

printf 'candidateImage=%s\nbaseImage=%s\nentrypointSource=%s\ngosuBuilder=%s\ngosuCommit=%s\ngosuUserModule=%s\ngosuXSysModule=%s\nrevision=%s\ntree=%s\n' \
  "$image" "$forky_base" "$postgres_entrypoint_source" "$gosu_builder_image" \
  "$gosu_commit" "$gosu_user_module_version" "$gosu_x_sys_module_version" "$GITHUB_SHA" "$tree" \
  | tee "$evidence_dir/candidate-identity.txt"

docker pull --platform linux/amd64 "$forky_base"
docker pull --platform linux/amd64 "$postgres_entrypoint_source"
docker buildx build --pull --load --platform linux/amd64 \
  --build-context "forky-packages=$input_dir" \
  --build-arg "DEBIAN_FORKY_BASE=$forky_base" \
  --build-arg "POSTGRES_ENTRYPOINT_SOURCE=$postgres_entrypoint_source" \
  --build-arg "GOSU_BUILDER_IMAGE=$gosu_builder_image" \
  --build-arg "GOSU_COMMIT=$gosu_commit" \
  --build-arg "GOSU_USER_MODULE_VERSION=$gosu_user_module_version" \
  --build-arg "GOSU_X_SYS_MODULE_VERSION=$gosu_x_sys_module_version" \
  --build-arg "CANDIDATE_REVISION=$GITHUB_SHA" \
  --build-arg "CANDIDATE_TREE=$tree" \
  --tag "$image" --file "$root/docker/postgres/forky-pgdg-candidate.Dockerfile" "$root"
docker image inspect "$image" --format '{{json .}}' > "$evidence_dir/candidate-image-inspect.json"
image_id="$(docker image inspect "$image" --format '{{.Id}}')"
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'Candidate image ID is malformed'
printf '%s\n' "$image_id" > "$evidence_dir/candidate-image-id.txt"

actual_gosu_builder="$(docker image inspect --format '{{index .Config.Labels "io.taky.postgres.gosu.builder"}}' "$image")"
actual_gosu_commit="$(docker image inspect --format '{{index .Config.Labels "io.taky.postgres.gosu.commit"}}' "$image")"
actual_gosu_user_module="$(docker image inspect --format '{{index .Config.Labels "io.taky.postgres.gosu.user-module"}}' "$image")"
actual_gosu_x_sys_module="$(docker image inspect --format '{{index .Config.Labels "io.taky.postgres.gosu.x-sys-module"}}' "$image")"
[[ "$actual_gosu_builder" == "$gosu_builder_image" \
  && "$actual_gosu_commit" == "$gosu_commit" \
  && "$actual_gosu_user_module" == "$gosu_user_module_version" \
  && "$actual_gosu_x_sys_module" == "$gosu_x_sys_module_version" ]] \
  || die 'Candidate gosu provenance labels do not match the pinned build inputs'

gosu_binary="${RUNNER_TEMP:?RUNNER_TEMP is required}/taky-forky-gosu-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
docker run --rm --platform linux/amd64 --entrypoint /bin/cat "$image" /usr/local/bin/gosu > "$gosu_binary"
[[ -s "$gosu_binary" ]] || die 'Could not extract the candidate gosu binary'
chmod 0600 "$gosu_binary"
sha256sum "$gosu_binary" | awk '{print $1}' > "$evidence_dir/gosu-candidate-binary.sha256"
jq -n \
  --arg sourceRevision "$candidate_sha" \
  --arg sourceTree "$tree" \
  --arg imageId "$image_id" \
  --arg builderImage "$gosu_builder_image" \
  --arg gosuCommit "$gosu_commit" \
  --arg userModule "$gosu_user_module_version" \
  --arg xSysModule "$gosu_x_sys_module_version" \
  --arg binarySha256 "$(cat "$evidence_dir/gosu-candidate-binary.sha256")" \
  '{schemaVersion:1,sourceRevision:$sourceRevision,sourceTree:$sourceTree,imageId:$imageId,builderImage:$builderImage,gosuCommit:$gosuCommit,userModule:$userModule,xSysModule:$xSysModule,binarySha256:$binarySha256}' \
  > "$evidence_dir/gosu-candidate-provenance.json"
bash "$root/scripts/ci/check-gosu-binary-vulnerabilities.sh" \
  "$gosu_binary" "$image" "$image_id" "$forky_base" \
  "$evidence_dir/gosu-candidate-govulncheck.txt"

volume_name="taky-forky-candidate-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
container_name="taky-forky-candidate-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
cleanup_volumes+=("$volume_name")
cleanup_containers+=("$container_name")
docker volume create --label "com.taky.candidate.run=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" "$volume_name" >/dev/null
docker run --detach --name "$container_name" --network none \
  --label "com.taky.candidate.run=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" \
  --volume "$volume_name:/var/lib/postgresql/data" \
  --env POSTGRES_DB=taky_candidate --env POSTGRES_USER=taky_candidate \
  --env POSTGRES_PASSWORD=synthetic-candidate-only-password "$image" \
  > "$evidence_dir/container-id.txt"

ready=false
for _ in $(seq 1 90); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container_name" 2>/dev/null || true)" == 'healthy' ]]; then ready=true; break; fi
  sleep 2
done
[[ "$ready" == true ]] || { docker logs "$container_name" > "$evidence_dir/container.log" 2>&1 || true; die 'PostgreSQL Forky candidate did not become healthy'; }

docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
  -h 127.0.0.1 -U taky_candidate -d taky_candidate -v ON_ERROR_STOP=1 -Atc \
  'SHOW listen_addresses' > "$evidence_dir/listen-addresses.txt"
[[ "$(cat "$evidence_dir/listen-addresses.txt")" == '*' ]] || die 'PostgreSQL Forky candidate does not listen on Docker network interfaces'

docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
  -h 127.0.0.1 -U taky_candidate -d taky_candidate -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE candidate_xml(value xml); INSERT INTO candidate_xml VALUES (XMLPARSE(DOCUMENT '<root><item>xml-ok</item></root>'));" \
  -c "SELECT xpath('/root/item/text()', value)::text FROM candidate_xml;" > "$evidence_dir/xml-smoke.txt"
grep -Fq 'xml-ok' "$evidence_dir/xml-smoke.txt" || die 'PostgreSQL XML/XPath smoke result is missing'

docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password sh -ec \
  'pg_dump -h 127.0.0.1 -U taky_candidate -Fc -t candidate_xml -f /tmp/forky-candidate.dump taky_candidate && createdb -h 127.0.0.1 -U taky_candidate taky_candidate_restore && pg_restore -h 127.0.0.1 -U taky_candidate -d taky_candidate_restore /tmp/forky-candidate.dump && psql -h 127.0.0.1 -U taky_candidate -d taky_candidate_restore -v ON_ERROR_STOP=1 -Atc "SELECT xpath('\''/root/item/text()'\'', value)::text FROM candidate_xml"' \
  > "$evidence_dir/dump-restore-smoke.txt"
grep -Fq 'xml-ok' "$evidence_dir/dump-restore-smoke.txt" || die 'PostgreSQL dump/restore result is missing'

docker restart "$container_name" > "$evidence_dir/restart.txt"
restarted_ready=false
for _ in $(seq 1 90); do
  if docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password pg_isready \
    -h 127.0.0.1 -U taky_candidate -d taky_candidate >/dev/null 2>&1; then
    restarted_ready=true
    break
  fi
  sleep 2
done
[[ "$restarted_ready" == true ]] || { docker logs "$container_name" > "$evidence_dir/container.log" 2>&1 || true; die 'PostgreSQL Forky candidate did not become healthy after restart'; }
docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
  -h 127.0.0.1 -U taky_candidate -d taky_candidate -v ON_ERROR_STOP=1 -Atc \
  "SELECT xpath('/root/item/text()', value)::text FROM candidate_xml" > "$evidence_dir/restart-persistence.txt"
grep -Fq 'xml-ok' "$evidence_dir/restart-persistence.txt" || die 'Candidate data did not persist across restart'
docker logs "$container_name" > "$evidence_dir/container.log" 2>&1

docker pull --platform linux/amd64 "$bookworm_restore_source"
for suite in trixie bookworm; do
  if [[ "$suite" == trixie ]]; then source_image="$postgres_entrypoint_source"; else source_image="$bookworm_restore_source"; fi
  source_container="taky-forky-restore-${suite}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  source_volume="taky-forky-restore-${suite}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  source_db='restore_seed'
  target_db="restored_${suite}"
  cleanup_containers+=("$source_container")
  cleanup_volumes+=("$source_volume")
  docker volume create --label "com.taky.candidate.run=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" "$source_volume" >/dev/null
  docker run --detach --name "$source_container" --network none \
    --label "com.taky.candidate.run=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" \
    --health-cmd 'pg_isready -h 127.0.0.1 -U taky_restore -d restore_seed' --health-interval 2s \
    --health-timeout 3s --health-retries 45 --health-start-period 10s \
    --volume "$source_volume:/var/lib/postgresql/data" \
    --env POSTGRES_DB="$source_db" --env POSTGRES_USER=taky_restore \
    --env POSTGRES_PASSWORD=synthetic-restore-only-password "$source_image" \
    > "$evidence_dir/${suite}-source-container-id.txt"
  source_ready=false
  for _ in $(seq 1 90); do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$source_container" 2>/dev/null || true)" == 'healthy' ]]; then source_ready=true; break; fi
    sleep 2
  done
  [[ "$source_ready" == true ]] || { docker logs "$source_container" > "$evidence_dir/${suite}-source-container.log" 2>&1 || true; die "$suite PostgreSQL logical-restore source did not become healthy"; }
  docker exec "$source_container" env PGPASSWORD=synthetic-restore-only-password psql \
    -h 127.0.0.1 -U taky_restore -d "$source_db" -v ON_ERROR_STOP=1 \
    -c 'CREATE TABLE restore_probe(label text, amount numeric(12,2), observed_at timestamptz);' \
    -c "INSERT INTO restore_probe VALUES ('Åke', 12.50, '2026-10-01T12:00:00Z'), ('Zoë', 99.99, '2026-10-02T12:00:00Z'), ('Ana', 0.01, '2026-10-03T12:00:00Z');" \
    -c "CREATE COLLATION restore_probe_accent_insensitive (provider = icu, locale = 'und-u-ks-level1', deterministic = false);" \
    -c 'CREATE TABLE restore_probe_icu(label text COLLATE restore_probe_accent_insensitive);' \
    -c "INSERT INTO restore_probe_icu VALUES ('resume'), ('résumé');" \
    -c 'CREATE INDEX restore_probe_label_idx ON restore_probe(label);'
  docker exec "$source_container" env PGPASSWORD=synthetic-restore-only-password psql \
    -h 127.0.0.1 -U taky_restore -d "$source_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT datcollate, datcollversion, pg_database_collation_actual_version(oid) FROM pg_database WHERE datname = current_database();" \
    > "$evidence_dir/${suite}-source-collation-version.txt"
  docker exec "$source_container" env PGPASSWORD=synthetic-restore-only-password psql \
    -h 127.0.0.1 -U taky_restore -d "$source_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT string_agg(label, ',' ORDER BY label), count(*) FILTER (WHERE label = 'Åke') FROM restore_probe;" \
    > "$evidence_dir/${suite}-source-sort-equality.txt"
  docker exec "$source_container" env PGPASSWORD=synthetic-restore-only-password psql \
    -h 127.0.0.1 -U taky_restore -d "$source_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM restore_probe_icu WHERE label = 'resume';" \
    > "$evidence_dir/${suite}-source-icu-equality.txt"
  docker exec "$source_container" env PGPASSWORD=synthetic-restore-only-password psql \
    -h 127.0.0.1 -U taky_restore -d "$source_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT collversion, pg_collation_actual_version(oid) FROM pg_collation WHERE collname = 'restore_probe_accent_insensitive';" \
    > "$evidence_dir/${suite}-source-icu-version.txt"
  docker exec "$source_container" env PGPASSWORD=synthetic-restore-only-password \
    pg_dump -h 127.0.0.1 -U taky_restore -Fc -d "$source_db" \
    > "$evidence_dir/${suite}-logical.dump"
  sha256sum "$evidence_dir/${suite}-logical.dump" > "$evidence_dir/${suite}-logical.dump.sha256"
  docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password \
    createdb -h 127.0.0.1 -U taky_candidate "$target_db"
  docker exec --interactive "$container_name" env PGPASSWORD=synthetic-candidate-only-password \
    pg_restore -h 127.0.0.1 -U taky_candidate -d "$target_db" --no-owner --no-privileges --exit-on-error \
    < "$evidence_dir/${suite}-logical.dump"
  docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
    -h 127.0.0.1 -U taky_candidate -d "$target_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT count(*)::text || '|' || sum(amount)::text FROM restore_probe;" \
    > "$evidence_dir/${suite}-restore-data-integrity.txt"
  docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
    -h 127.0.0.1 -U taky_candidate -d "$target_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT datcollate, datcollversion, pg_database_collation_actual_version(oid) FROM pg_database WHERE datname = current_database();" \
    > "$evidence_dir/${suite}-candidate-collation-version.txt"
  docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
    -h 127.0.0.1 -U taky_candidate -d "$target_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT string_agg(label, ',' ORDER BY label), count(*) FILTER (WHERE label = 'Åke') FROM restore_probe;" \
    > "$evidence_dir/${suite}-candidate-sort-equality.txt"
  docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
    -h 127.0.0.1 -U taky_candidate -d "$target_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM restore_probe_icu WHERE label = 'resume';" \
    > "$evidence_dir/${suite}-candidate-icu-equality.txt"
  docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
    -h 127.0.0.1 -U taky_candidate -d "$target_db" -AtF '|' -v ON_ERROR_STOP=1 \
    -c "SELECT collversion, pg_collation_actual_version(oid) FROM pg_collation WHERE collname = 'restore_probe_accent_insensitive';" \
    > "$evidence_dir/${suite}-candidate-icu-version.txt"
  docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
    -h 127.0.0.1 -U taky_candidate -d "$target_db" -v ON_ERROR_STOP=1 \
    -c 'REINDEX INDEX restore_probe_label_idx;' > "$evidence_dir/${suite}-reindex.log"
  docker exec "$container_name" env PGPASSWORD=synthetic-candidate-only-password psql \
    -h 127.0.0.1 -U taky_candidate -d "$target_db" -At \
    -c "SELECT indisvalid FROM pg_index WHERE indexrelid = 'restore_probe_label_idx'::regclass;" \
    > "$evidence_dir/${suite}-reindexed-validity.txt"
  source_collation_version="$(cat "$evidence_dir/${suite}-source-collation-version.txt")"
  target_collation_version="$(cat "$evidence_dir/${suite}-candidate-collation-version.txt")"
  source_sort_equality="$(cat "$evidence_dir/${suite}-source-sort-equality.txt")"
  target_sort_equality="$(cat "$evidence_dir/${suite}-candidate-sort-equality.txt")"
  source_icu_equality="$(cat "$evidence_dir/${suite}-source-icu-equality.txt")"
  target_icu_equality="$(cat "$evidence_dir/${suite}-candidate-icu-equality.txt")"
  source_icu_version="$(cat "$evidence_dir/${suite}-source-icu-version.txt")"
  target_icu_version="$(cat "$evidence_dir/${suite}-candidate-icu-version.txt")"
  printf 'sourceDefaultCollation=%s\ncandidateDefaultCollation=%s\nsourceOrderEquality=%s\ncandidateOrderEquality=%s\nsourceICUEquality=%s\ncandidateICUEquality=%s\nsourceICUCollationVersion=%s\ncandidateICUCollationVersion=%s\n' \
    "$source_collation_version" "$target_collation_version" "$source_sort_equality" "$target_sort_equality" "$source_icu_equality" "$target_icu_equality" "$source_icu_version" "$target_icu_version" \
    > "$evidence_dir/${suite}-collation-observation.txt"
  [[ "$source_sort_equality" == "$target_sort_equality" ]] || die "$suite default collation order/equality changed across restore"
  [[ "$source_icu_equality" == "$target_icu_equality" && "$target_icu_equality" == '2' ]] || die "$suite ICU collation equivalence changed across restore"
  grep -Fq '3|112.50' "$evidence_dir/${suite}-restore-data-integrity.txt" || die "$suite restore did not preserve fixture rows and exact numeric total"
  for value in 'Ana' 'Åke' 'Zoë'; do grep -Fq "$value" "$evidence_dir/${suite}-candidate-sort-equality.txt" || die "$suite candidate collation sort omitted a fixture label"; done
  grep -Fxq 't' "$evidence_dir/${suite}-reindexed-validity.txt" || die "$suite restored index did not validate after REINDEX"
done

readonly trivy_version='0.76.1'
readonly trivy_sha256='c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0'
readonly trivy_dir="$RUNNER_TEMP/phase4-forky-trivy"
mkdir -m 0700 -p "$trivy_dir"
curl --fail --location --silent --show-error \
  "https://github.com/aquasecurity/trivy/releases/download/v${trivy_version}/trivy_${trivy_version}_Linux-64bit.tar.gz" \
  --output "$trivy_dir/trivy.tar.gz"
printf '%s  %s\n' "$trivy_sha256" "$trivy_dir/trivy.tar.gz" | sha256sum --check --status
tar -xzf "$trivy_dir/trivy.tar.gz" -C "$trivy_dir" trivy
"$trivy_dir/trivy" --version | tee "$evidence_dir/trivy-version.txt"
base_image_id="$(docker image inspect "$forky_base" --format '{{.Id}}')"
"$trivy_dir/trivy" --cache-dir "$trivy_dir/cache" image \
  --disable-telemetry --skip-version-check --ignorefile /dev/null --scanners vuln --list-all-pkgs \
  --format json --output "$evidence_dir/trivy-base-image.json" --exit-code 0 "$forky_base"
"$trivy_dir/trivy" --cache-dir "$trivy_dir/cache" image \
  --disable-telemetry --skip-version-check --ignorefile /dev/null --scanners vuln --list-all-pkgs \
  --format json --output "$evidence_dir/trivy-candidate-image.json" --exit-code 0 "$image"
jq -e --arg imageId "$base_image_id" '.SchemaVersion == 2 and .Metadata.ImageID == $imageId' \
  "$evidence_dir/trivy-base-image.json" >/dev/null || die 'base scan does not bind to the exact pinned Forky image ID'
jq -e --arg imageId "$image_id" '.SchemaVersion == 2 and .Metadata.ImageID == $imageId' \
  "$evidence_dir/trivy-candidate-image.json" >/dev/null || die 'candidate scan does not bind to the built candidate image ID'
jq -e '
  [.Results[] | select(.Target == "usr/local/bin/gosu")] as $gosu |
  ($gosu | length) == 1 and
  ([ $gosu[0].Vulnerabilities[]? | select(.Severity == "CRITICAL" or .Severity == "HIGH") ] | length) == 0
' "$evidence_dir/trivy-candidate-image.json" >/dev/null \
  || die 'raw Trivy candidate report does not prove zero Critical/High findings for usr/local/bin/gosu'
jq -r '[.Results[] as $result | $result.Vulnerabilities[]? | select(.VulnerabilityID == "CVE-2026-6653") | [$result.Type, .PkgName, .InstalledVersion, .FixedVersion, .Severity] | @tsv] | sort | .[]' \
  "$evidence_dir/trivy-candidate-image.json" > "$evidence_dir/candidate-target-cve.tsv"
printf '%s\n' 'Raw Trivy scan retained for the exact Forky base and candidate image IDs. Trivy 0.76.1 misses CVE-2026-6653 on the documented Debian 14 vulnerable positive control; an absent candidate result is not clearance. Scanner clearance and CVE disposition remain false.' \
  > "$evidence_dir/trivy-disposition.txt"
cp "$trivy_dir/cache/db/metadata.json" "$evidence_dir/trivy-db-metadata.json"
sha256sum "$trivy_dir/cache/db/trivy.db" > "$evidence_dir/trivy-db.sha256"

cat > "$evidence_dir/status.json" <<EOF
{
  "schemaVersion": 1,
  "status": "PASS",
  "scope": "isolated Forky PostgreSQL runtime candidate",
  "runtimeVerification": true,
  "xmlXPath": true,
  "dumpRestore": true,
  "restartPersistence": true,
  "networkListenAddresses": true,
  "gosuBinaryProvenance": true,
  "gosuGovulncheckNoVulnerabilities": true,
  "gosuTrivyNoCriticalHigh": true,
  "logicalRestoreFromTrixie": true,
  "logicalRestoreFromBookworm": true,
  "collationIndexRebuilt": true,
  "erpStage5Verification": "PENDING",
  "scannerClearance": false,
  "cveDisposition": false,
  "imageSelection": false,
  "productionClearance": false,
  "imageId": "$image_id",
  "revision": "$GITHUB_SHA",
  "tree": "$tree"
}
EOF
printf 'Candidate runtime verification PASS (candidate-only; no security or production clearance).\n'
