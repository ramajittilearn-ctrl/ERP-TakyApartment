#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 1 ]] || die 'usage: build-libxml2-candidate.sh VERIFIED_INPUT_DIRECTORY'
[[ ${PROVENANCE_RESULT:-} == success ]] || die 'same-run source provenance job did not succeed'
[[ ${QUALITY_RESULT:-} == success ]] || die 'required quality job did not succeed'
command -v docker >/dev/null || die 'Docker is required for the isolated Linux candidate build'
command -v jq >/dev/null || die 'jq is required'
readonly runner_ca_bundle=/etc/ssl/certs/ca-certificates.crt
[[ -s "$runner_ca_bundle" ]] || die 'GitHub runner CA bundle is unavailable'

readonly input_dir=$(realpath -- "$1")
readonly evidence_dir="$RUNNER_TEMP/phase4-libxml2-candidate-evidence"
[[ "$input_dir" == "$RUNNER_TEMP"/* ]] || die 'verified inputs must remain inside RUNNER_TEMP'
[[ -s "$input_dir/verified-inputs.json" && -s "$input_dir/source-artifact.zip" ]] || die 'verified source inputs are incomplete'
[[ ! -e "$evidence_dir" ]] || die 'candidate evidence directory already exists'
mkdir -m 0700 -- "$evidence_dir"
cat > "$evidence_dir/candidate-status.txt" <<'STATUS'
Candidate status: isolated prototype only.
This job runs the package build, candidate-only PostgreSQL XML smoke test, pg_dump/pg_restore round-trip, and unsuppressed image scan. It does not establish full ABI compatibility, owner UAT acceptance, production approval, or authorization to replace an operational image.
STATUS

readonly source_sha=$(jq -er '.sourceArtifact.digest | sub("^sha256:"; "")' "$input_dir/verified-inputs.json")
readonly snapshot=$(jq -er '.debianSnapshot' "$input_dir/verified-inputs.json")
readonly inrelease_sha=$(jq -er '.debianInReleaseSha256' "$input_dir/verified-inputs.json")
readonly runner_ca_sha=$(sha256sum "$runner_ca_bundle" | awk '{print $1}')
[[ "$source_sha" =~ ^[a-f0-9]{64}$ && "$inrelease_sha" =~ ^[a-f0-9]{64}$ ]] || die 'verified input digest is malformed'
[[ "$snapshot" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die 'Debian snapshot is malformed'
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]] || die 'GitHub run identity is malformed'

readonly image="taky-libxml2-cve-candidate:${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
readonly base_image='postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe'
readonly dockerfile="$GITHUB_WORKSPACE/docker/postgres/libxml2-cve-candidate.Dockerfile"
readonly build_context="$RUNNER_TEMP/phase4-libxml2-candidate-context"
mkdir -m 0700 -- "$build_context"
cp -a "$input_dir/." "$build_context/"
cp "$input_dir/metadata/debian-trixie.InRelease" "$evidence_dir/"
cp "$input_dir/metadata/debian-trixie.Sources.apt-cache" "$evidence_dir/"
cp "$input_dir/metadata/debian-archive-keyring_2023.3+deb12u2_all.deb" "$evidence_dir/"
cp "$input_dir/source-artifact.zip" "$evidence_dir/"
cp "$input_dir/provenance.json" "$evidence_dir/"
cp "$input_dir/verified-inputs.json" "$evidence_dir/"
printf '%s  %s\n' "$runner_ca_sha" 'GitHub runner CA bundle (not uploaded)' > "$evidence_dir/runner-ca-bundle.sha256"

docker build --pull --network=default \
  --secret id=runner-ca,src="$runner_ca_bundle" \
  --file "$dockerfile" \
  --tag "$image" \
  --build-arg POSTGRES_BASE_IMAGE="$base_image" \
  --build-arg DEBIAN_SNAPSHOT="$snapshot" \
  --build-arg DEBIAN_INRELEASE_SHA256="$inrelease_sha" \
  --build-arg SOURCE_ARTIFACT_SHA256="$source_sha" \
  --build-arg RUNNER_CA_SHA256="$runner_ca_sha" \
  --build-arg RUN_ID="$GITHUB_RUN_ID" \
  --build-arg RUN_ATTEMPT="$GITHUB_RUN_ATTEMPT" \
  "$build_context" 2>&1 | tee "$evidence_dir/docker-build.log"

readonly image_id=$(docker image inspect --format '{{.Id}}' "$image")
readonly base_image_id=$(docker image inspect --format '{{.Id}}' "$base_image")
docker image inspect "$image" > "$evidence_dir/image-inspect.json"
docker image inspect "$base_image" > "$evidence_dir/base-image-inspect.json"
docker run --rm --network=none --entrypoint cat "$image" /usr/share/taky-libxml2-candidate/runtime-package-delta.tsv > "$evidence_dir/runtime-package-delta.tsv"
docker run --rm --network=none --entrypoint cat "$image" /usr/share/taky-libxml2-candidate/build-package-inventory.tsv > "$evidence_dir/build-package-inventory.tsv"
printf 'run_id=%s\nrun_attempt=%s\nimage=%s\nimage_id=%s\nsource_artifact_sha256=%s\n' \
  "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$image" "$image_id" "$source_sha" \
  > "$evidence_dir/candidate-identity.txt"

# No host port, named volume, shared service, or cleanup operation is used.
docker run --rm --network=none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --entrypoint postgres "$image" --version | tee "$evidence_dir/runtime-postgres-version.txt"
docker run --rm --network=none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --entrypoint dpkg-query "$image" -W -f='${binary:Package}\t${Version}\t${Architecture}\n' 'libxml2-*' \
  | tee "$evidence_dir/runtime-libxml2-inventory.tsv"
docker run --rm --network=none --read-only -i \
  --tmpfs /tmp:rw,nosuid,size=256m --tmpfs /var/lib/postgresql/data:rw,nosuid,size=256m \
  --tmpfs /var/run/postgresql:rw,nosuid,size=16m \
  --entrypoint /bin/bash "$image" -eus 2>&1 | tee "$evidence_dir/postgres-xml-restore-smoke.log" <<'CONTAINER_SCRIPT'
data=/var/lib/postgresql/data/ci-smoke
mkdir -p "$data"
chown postgres:postgres "$data"
gosu postgres initdb -D "$data" --auth=trust
gosu postgres pg_ctl -D "$data" -o "-k /tmp" -w start
trap 'gosu postgres pg_ctl -D "$data" -m immediate -w stop' EXIT
psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -c "CREATE TABLE xml_candidate_smoke (payload xml NOT NULL)" postgres
psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -c "INSERT INTO xml_candidate_smoke VALUES (XMLPARSE(DOCUMENT \$xml\$<root>candidate</root>\$xml\$))" postgres
psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -c "SELECT xpath(\$path\$/root/text()\$path\$, payload) FROM xml_candidate_smoke" postgres
xml_before=$(psql -h /tmp -U postgres -Atc "SELECT array_to_string(xpath(\$path\$/root/text()\$path\$, payload), \$empty\$\$empty\$) FROM xml_candidate_smoke" postgres)
test "$xml_before" = candidate
xml_before=$(psql -h /tmp -U postgres -Atc "SELECT array_to_string(xpath(\$path\$/root/text()\$path\$, payload), \$empty\$\$empty\$) FROM xml_candidate_smoke" postgres)
test "$xml_before" = candidate
pg_dump -h /tmp -U postgres -Fc -t xml_candidate_smoke -f /tmp/xml_candidate_smoke.dump postgres
psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -c "DROP TABLE xml_candidate_smoke" postgres
pg_restore -h /tmp -U postgres -v -d postgres /tmp/xml_candidate_smoke.dump
psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -c "SELECT xpath(\$path\$/root/text()\$path\$, payload) FROM xml_candidate_smoke" postgres
xml_after=$(psql -h /tmp -U postgres -Atc "SELECT array_to_string(xpath(\$path\$/root/text()\$path\$, payload), \$empty\$\$empty\$) FROM xml_candidate_smoke" postgres)
test "$xml_after" = candidate
xml_after=$(psql -h /tmp -U postgres -Atc "SELECT array_to_string(xpath(\$path\$/root/text()\$path\$, payload), \$empty\$\$empty\$) FROM xml_candidate_smoke" postgres)
test "$xml_after" = candidate
if [ "$(psql -h /tmp -U postgres -Atc "SELECT count(*) FROM pg_available_extensions WHERE name = \$e\$xml2\$e\$" postgres)" -eq 1 ]; then
  psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -c "CREATE EXTENSION xml2" postgres
  xml2_value=$(psql -h /tmp -U postgres -Atc "SELECT xml2.xpath_string(\$path\$/root/text()\$path\$, \$xml\$<root>candidate</root>\$xml\$)" postgres)
  test "$xml2_value" = candidate
else
  echo "xml2 extension unavailable in the pinned PostgreSQL base; core XML behavior exercised"
fi
CONTAINER_SCRIPT

readonly trivy_version=0.76.1
readonly trivy_sha256=c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0
readonly trivy_dir="$RUNNER_TEMP/phase4-libxml2-trivy"
mkdir -m 0700 -- "$trivy_dir"
curl --fail --location --silent --show-error "https://github.com/aquasecurity/trivy/releases/download/v${trivy_version}/trivy_${trivy_version}_Linux-64bit.tar.gz" --output "$trivy_dir/trivy.tar.gz"
printf '%s  %s\n' "$trivy_sha256" "$trivy_dir/trivy.tar.gz" | sha256sum --check --status
tar -xzf "$trivy_dir/trivy.tar.gz" -C "$trivy_dir" trivy
"$trivy_dir/trivy" --version | tee "$evidence_dir/trivy-version.txt"
"$trivy_dir/trivy" --cache-dir "$trivy_dir/cache" image \
  --disable-telemetry --skip-version-check --ignorefile /dev/null --scanners vuln --list-all-pkgs \
  --format json --output "$evidence_dir/trivy-base-image.json" --exit-code 0 "$base_image"
jq -e --arg imageId "$base_image_id" '.SchemaVersion == 2 and .Metadata.ImageID == $imageId and ([.Results[]?.Vulnerabilities[]? | select(.VulnerabilityID == "CVE-2026-6653")] | length > 0)' \
  "$evidence_dir/trivy-base-image.json" >/dev/null || die 'pinned PostgreSQL base scan did not bind to its image ID or detect CVE-2026-6653; the candidate comparison is inconclusive'
"$trivy_dir/trivy" --cache-dir "$trivy_dir/cache" image \
  --disable-telemetry --skip-version-check --ignorefile /dev/null --scanners vuln --list-all-pkgs \
  --format json --output "$evidence_dir/trivy-candidate-image.json" --exit-code 0 "$image"
jq -e --arg imageId "$image_id" '.SchemaVersion == 2 and .Metadata.ImageID == $imageId and ([.Results[]?.Vulnerabilities[]? | select(.VulnerabilityID == "CVE-2026-6653")] | length == 0)' \
  "$evidence_dir/trivy-candidate-image.json" >/dev/null || die 'candidate scan did not bind to the image or reports CVE-2026-6653'
jq -r '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL" or .Severity == "HIGH") | [.VulnerabilityID, .PkgName, .InstalledVersion, .Severity] | @tsv] | sort | .[]' \
  "$evidence_dir/trivy-base-image.json" > "$evidence_dir/base-high-critical.tsv"
jq -r '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL" or .Severity == "HIGH") | [.VulnerabilityID, .PkgName, .InstalledVersion, .Severity] | @tsv] | sort | .[]' \
  "$evidence_dir/trivy-candidate-image.json" > "$evidence_dir/candidate-high-critical.tsv"
comm -13 "$evidence_dir/base-high-critical.tsv" "$evidence_dir/candidate-high-critical.tsv" > "$evidence_dir/new-high-critical-findings.tsv"
[[ ! -s "$evidence_dir/new-high-critical-findings.tsv" ]] || die 'candidate introduces new Critical/High findings relative to its exact pinned base image'
printf 'Full unsuppressed candidate scan is retained. This slice gates the target CVE and no new Critical/High findings relative to the exact pinned PostgreSQL base. Inherited base findings remain open outside this candidate scope.\n' > "$evidence_dir/trivy-disposition.txt"
cp "$trivy_dir/cache/db/metadata.json" "$evidence_dir/trivy-db-metadata.json"
sha256sum "$trivy_dir/cache/db/trivy.db" > "$evidence_dir/trivy-db.sha256"
printf 'Candidate image %s (%s) built and runtime/scan checks completed.\n' "$image" "$image_id"
