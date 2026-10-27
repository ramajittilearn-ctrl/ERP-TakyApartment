#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <rclone-binary> <operations-image-reference> <operations-image-id> <source-revision> <source-tree> <report-path>" >&2
  exit 2
}
[[ $# == 6 ]] || usage

rclone_binary="$1"
operations_image="$2"
operations_image_id="$3"
source_revision="$4"
source_tree="$5"
report_path="$6"
mkdir -p "$(dirname "$report_path")"
: > "$report_path"
exec > >(tee -a "$report_path") 2>&1

[[ -s "$rclone_binary" ]] || { echo "Extracted rclone binary is missing or empty" >&2; exit 1; }
[[ "$operations_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "Operations image ID must be a SHA-256 digest" >&2
  exit 1
}
[[ "$source_revision" =~ ^[a-f0-9]{40}$ && "$source_tree" =~ ^[a-f0-9]{40}$ ]] || {
  echo "Source revision and tree must be full Git object IDs" >&2
  exit 1
}
current_image_id="$(docker image inspect --format '{{.Id}}' "$operations_image")"
[[ "$current_image_id" == "$operations_image_id" ]] || {
  echo "Operations image changed after rclone was extracted" >&2
  exit 1
}
image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$operations_image")"
image_tree="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.tree"}}' "$operations_image")"
[[ "$image_revision" == "$source_revision" && "$image_tree" == "$source_tree" ]] || {
  echo "Operations image source labels do not match this checkout (expected=$source_revision/$source_tree actual=${image_revision:-missing}/${image_tree:-missing})" >&2
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

runtime_version="$(docker run --rm --platform linux/amd64 --entrypoint /usr/local/bin/rclone "$operations_image" version)"
runtime_first_line="${runtime_version%%$'\n'*}"
[[ "$runtime_first_line" == "rclone v1.75.2" ]] || {
  echo "Operations image does not run the pinned rclone v1.75.2 build: $runtime_first_line" >&2
  exit 1
}
[[ "$(docker image inspect --format '{{.Id}}' "$operations_image")" == "$operations_image_id" ]] || {
  echo "Operations image changed while verifying the rclone version" >&2
  exit 1
}
printf 'Operations image: %s\n' "$operations_image"
printf 'Operations image ID: %s\n' "$operations_image_id"
printf 'Operations image source revision/tree: %s/%s\n' "$image_revision" "$image_tree"
printf 'Rclone runtime version: %s\n' "$runtime_first_line"
rclone_build_info="$(go version -m "$rclone_binary")"
printf 'Rclone binary module build info:\n%s\n' "$rclone_build_info"
awk '$1 == "dep" && $2 == "github.com/go-chi/chi/v5" && $3 == "v5.3.1" { found = 1 } END { exit !found }' <<<"$rclone_build_info" || {
  echo "Extracted rclone binary does not embed the Trivy-reported chi v5.3.1 dependency" >&2
  exit 1
}
awk '$1 == "dep" && $2 == "golang.org/x/crypto" && $3 == "v0.57.0" { found = 1 } END { exit !found }' <<<"$rclone_build_info" || {
  echo "Extracted rclone binary does not embed the Trivy-reported x/crypto v0.57.0 dependency" >&2
  exit 1
}
printf 'Rclone binary SHA-256: '
sha256sum "$rclone_binary"
nm_report_path="${report_path%.txt}-nm.txt"
set +e
nm_error_path="${report_path%.txt}-nm-errors.txt"
go tool nm "$rclone_binary" 2> "$nm_error_path" | \
  grep -E 'golang\.org/x/crypto/openpgp|github\.com/ProtonMail/go-crypto/openpgp|ClientIPFromXFF' > "$nm_report_path"
nm_statuses=("${PIPESTATUS[@]}")
nm_status="${nm_statuses[0]}"
grep_status="${nm_statuses[1]}"
set -e
printf 'go tool nm exit status: %s\n' "$nm_status"
if [[ "$nm_status" != 0 ]]; then
  cat "$nm_error_path"
elif [[ "$grep_status" == 0 ]]; then
  cat "$nm_report_path"
else
  echo "No OpenPGP or ClientIPFromXFF symbol names were listed by go tool nm."
fi
printf 'Command: govulncheck -mode=binary <extracted-rclone>\n'
binary_report_path="${report_path%.txt}-binary.txt"
set +e
govulncheck -mode=binary "$rclone_binary" > "$binary_report_path" 2>&1
binary_status=$?
set -e
cat "$binary_report_path"
if [[ "$binary_status" == 0 ]]; then
  echo "Exact-binary govulncheck found no vulnerabilities."
elif grep -q 'Your code is affected by' "$binary_report_path"; then
  if ! awk '/^Vulnerability #[0-9]+: / { count++; if ($NF != "GO-2026-5932") unexpected = 1 }
       END { exit !(count == 1 && !unexpected) }' "$binary_report_path"; then
    echo "Exact-binary govulncheck returned an unexpected advisory set; only GO-2026-5932 can be reconciled by the pinned source analysis." >&2
    exit 1
  fi
  echo "Exact-binary govulncheck returned only GO-2026-5932; the paired checksum-verified source/import-graph and unstripped diagnostic scans must reconcile it."
else
  echo "Exact-binary govulncheck failed without a vulnerability result (exit=$binary_status)." >&2
  exit "$binary_status"
fi
