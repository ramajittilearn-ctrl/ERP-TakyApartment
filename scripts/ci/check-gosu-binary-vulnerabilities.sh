#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <gosu-binary> <database-image-reference> <database-image-id> <database-base-image-reference> <report-path>" >&2
  exit 2
}
[[ $# == 5 ]] || usage

gosu_binary="$1"
database_image="$2"
database_image_id="$3"
database_base_image="$4"
report_path="$5"
mkdir -p "$(dirname "$report_path")"
: > "$report_path"
exec > >(tee -a "$report_path") 2>&1

[[ -s "$gosu_binary" ]] || { echo "Extracted gosu binary is missing or empty" >&2; exit 1; }
[[ "$database_base_image" =~ @sha256:[a-f0-9]{64}$ ]] || { echo "Database base image reference must be digest-pinned" >&2; exit 1; }
[[ "$database_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Database image ID must be a SHA-256 digest" >&2; exit 1; }
current_database_image_id="$(docker image inspect --format '{{.Id}}' "$database_image")"
[[ "$current_database_image_id" == "$database_image_id" ]] || {
  echo "Database image changed after the gosu binary was extracted" >&2
  exit 1
}
actual_database_base_image="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.base.name"}}' "$database_image")"
[[ "$actual_database_base_image" == "$database_base_image" ]] || {
  echo "Database image base label does not match the pinned base image (expected=$database_base_image actual=${actual_database_base_image:-missing})" >&2
  exit 1
}

go_version="$(go version)"
[[ "$go_version" == "go version go1.27.3 linux/amd64" ]] || {
  echo "Unexpected Go toolchain for binary vulnerability analysis: $go_version" >&2
  exit 1
}
govulncheck_path="$(command -v govulncheck || true)"
[[ -n "$govulncheck_path" ]] || { echo "Pinned govulncheck is not installed" >&2; exit 1; }
govulncheck_build="$(go version -m "$govulncheck_path")"
printf 'govulncheck executable: %s\n' "$govulncheck_path"
printf 'govulncheck build metadata:\n%s\n' "$govulncheck_build"
awk '$1 == "mod" && $2 == "golang.org/x/vuln" && $3 == "v1.1.4" { found = 1 } END { exit !found }' <<<"$govulncheck_build" || {
  echo "Unexpected govulncheck module version" >&2
  exit 1
}

wrapper_path="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/taky-gosu-govulncheck.XXXXXX")"
trap 'rm -f -- "$wrapper_path"' EXIT
wrapper_url="https://raw.githubusercontent.com/tianon/gosu/6456aaa/govulncheck-with-excludes.sh"
wrapper_sha256="be86c30c4a7d14a7f0c473396d5e4b9a7995a77dc9f0f9536b9085e45072681e"
curl --fail --silent --show-error --location "$wrapper_url" --output "$wrapper_path"
printf '%s  %s\n' "$wrapper_sha256" "$wrapper_path" | sha256sum --check --status || {
  echo "Pinned upstream gosu vulnerability wrapper failed SHA-256 verification" >&2
  exit 1
}

printf 'Database image: %s\n' "$database_image"
printf 'Database image ID: %s\n' "$database_image_id"
printf 'Pinned database base image: %s\n' "$database_base_image"
printf 'Go toolchain: %s\n' "$go_version"
printf 'govulncheck module build info:\n%s\n' "$govulncheck_build"
gosu_build_info="$(go version -m "$gosu_binary")"
printf 'Gosu binary module build info:\n%s\n' "$gosu_build_info"
awk '$1 == "dep" && $2 == "github.com/moby/sys/user" && $3 == "v0.4.1" { found = 1 } END { exit !found }' <<<"$gosu_build_info" || {
  echo "Extracted gosu binary does not use github.com/moby/sys/user v0.4.1" >&2
  exit 1
}
awk '$1 == "dep" && $2 == "golang.org/x/sys" && $3 == "v0.44.0" { found = 1 } END { exit !found }' <<<"$gosu_build_info" || {
  echo "Extracted gosu binary does not use golang.org/x/sys v0.44.0" >&2
  exit 1
}
printf 'Upstream wrapper: %s\n' "$wrapper_url"
printf 'Upstream wrapper SHA-256: %s\n' "$wrapper_sha256"
printf 'Extracted binary SHA-256: '
sha256sum "$gosu_binary"
printf 'Command: bash <pinned-upstream-wrapper> -mode=binary <extracted-gosu-binary>\n'
bash "$wrapper_path" -mode=binary "$gosu_binary"
