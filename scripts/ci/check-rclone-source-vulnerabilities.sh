#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <source-revision> <source-tree> <report-path>" >&2
  exit 2
}
[[ $# == 3 ]] || usage

source_revision="$1"
source_tree="$2"
report_path="$3"
[[ "$source_revision" =~ ^[a-f0-9]{40}$ && "$source_tree" =~ ^[a-f0-9]{40}$ ]] || {
  echo "Source revision and tree must be full Git object IDs" >&2
  exit 1
}
mkdir -p "$(dirname "$report_path")"
: > "$report_path"
exec > >(tee -a "$report_path") 2>&1

rclone_version="1.75.2"
source_sha256="fa64537e7276196310dbb0bcea6330f03b40e5790197b88f14cce6a19f40eb67"
vendor_sha256="69b356c0b1800052c33ce0e0e11f18df8717a721aab346b553dc1ab44c8caae8"
source_url="https://github.com/rclone/rclone/releases/download/v${rclone_version}/rclone-v${rclone_version}.tar.gz"
vendor_url="https://github.com/rclone/rclone/releases/download/v${rclone_version}/rclone-v${rclone_version}-vendor.tar.gz"

grep -Fq "ADD --checksum=sha256:${source_sha256} ${source_url} " operations/Dockerfile || {
  echo "Rclone source archive checksum/URL differs from operations/Dockerfile" >&2
  exit 1
}
grep -Fq "ADD --checksum=sha256:${vendor_sha256} ${vendor_url} " operations/Dockerfile || {
  echo "Rclone vendor archive checksum/URL differs from operations/Dockerfile" >&2
  exit 1
}

temp_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/taky-rclone-source.XXXXXX")"
trap 'rm -rf -- "$temp_root"' EXIT
source_archive="$temp_root/rclone-source.tar.gz"
vendor_archive="$temp_root/rclone-vendor.tar.gz"
source_root="$temp_root/source"
mkdir -p "$source_root"
curl --fail --silent --show-error --location "$source_url" --output "$source_archive"
curl --fail --silent --show-error --location "$vendor_url" --output "$vendor_archive"
printf '%s  %s\n' "$source_sha256" "$source_archive" | sha256sum --check --status
printf '%s  %s\n' "$vendor_sha256" "$vendor_archive" | sha256sum --check --status
tar -xzf "$source_archive" --strip-components=1 -C "$source_root"
tar -xzf "$vendor_archive" -C "$source_root"

[[ -f "$source_root/go.mod" && -f "$source_root/vendor/modules.txt" ]] || {
  echo "Checksum-verified rclone source/vendor inputs are incomplete" >&2
  exit 1
}
awk '$1 == "github.com/go-chi/chi/v5" && $2 == "v5.3.1" { found = 1 } END { exit !found }' "$source_root/go.mod" || {
  echo "Expected chi v5.3.1 dependency was not found in pinned rclone source" >&2
  exit 1
}
awk '$1 == "golang.org/x/crypto" && $2 == "v0.57.0" { found = 1 } END { exit !found }' "$source_root/go.mod" || {
  echo "Expected x/crypto v0.57.0 dependency was not found in pinned rclone source" >&2
  exit 1
}

go_version="$(go version)"
[[ "$go_version" == "go version go1.27.3 linux/amd64" ]] || {
  echo "Unexpected Go toolchain for source vulnerability analysis: $go_version" >&2
  exit 1
}
govulncheck_path="$(command -v govulncheck || true)"
[[ -n "$govulncheck_path" ]] || { echo "Pinned govulncheck is not installed" >&2; exit 1; }
govulncheck_build="$(go version -m "$govulncheck_path")"
awk '$1 == "mod" && $2 == "golang.org/x/vuln" && $3 == "v1.1.4" { found = 1 } END { exit !found }' <<<"$govulncheck_build" || {
  echo "Unexpected govulncheck module version" >&2
  exit 1
}

imports_report="$temp_root/dependency-import-paths.txt"
imports_artifact_path="${report_path%.txt}-import-paths.txt"
(
  cd "$source_root"
  export GOFLAGS=-mod=vendor
  export GOTOOLCHAIN=local
  export GOWORK=off
  export GOOS=linux
  export GOARCH=amd64
  export CGO_ENABLED=0
  go list -deps -f '{{.ImportPath}}' . | sort -u > "$imports_report"
)
cp "$imports_report" "$imports_artifact_path"
printf 'Source revision/tree: %s/%s\n' "$source_revision" "$source_tree"
printf 'Rclone release source: %s\n' "$source_url"
printf 'Rclone source SHA-256: %s\n' "$source_sha256"
printf 'Rclone vendor source: %s\n' "$vendor_url"
printf 'Rclone vendor SHA-256: %s\n' "$vendor_sha256"
printf 'Go toolchain: %s\n' "$go_version"
printf 'govulncheck build metadata:\n%s\n' "$govulncheck_build"
printf 'Source-mode import graph artifact: %s\n' "$imports_artifact_path"
if grep -Eq '^golang\.org/x/crypto/openpgp(/|$)' "$imports_report"; then
  echo "Pinned rclone source imports an affected golang.org/x/crypto/openpgp package" >&2
  exit 1
else
  grep_status=$?
  if [[ "$grep_status" != 1 ]]; then
    echo "Could not verify affected x/crypto/openpgp import absence (grep exit=$grep_status)" >&2
    exit 1
  fi
fi
if ! grep -Fxq 'github.com/ProtonMail/go-crypto/openpgp' "$imports_report"; then
  echo "Expected maintained ProtonMail OpenPGP implementation is absent from the main rclone build graph" >&2
  exit 1
fi
echo "No golang.org/x/crypto/openpgp package is in the Linux/amd64 main-package import graph."
grep -E '^github\.com/ProtonMail/go-crypto/openpgp(/|$)' "$imports_report"
printf 'Command: govulncheck -show traces . (GOOS=linux GOARCH=amd64 CGO_ENABLED=0 GOFLAGS=-mod=vendor)\n'
(
  cd "$source_root"
  export GOFLAGS=-mod=vendor
  export GOTOOLCHAIN=local
  export GOWORK=off
  export GOOS=linux
  export GOARCH=amd64
  export CGO_ENABLED=0
  govulncheck -show traces .
)

diagnostic_binary="$temp_root/rclone-unstripped"
diagnostic_symbols="$temp_root/rclone-unstripped-symbols.txt"
diagnostic_binary_report="${report_path%.txt}-unstripped-binary.txt"
diagnostic_symbols_report="${report_path%.txt}-unstripped-symbols.txt"
(
  cd "$source_root"
  export GOFLAGS=-mod=vendor
  export GOTOOLCHAIN=local
  export GOWORK=off
  export GOOS=linux
  export GOARCH=amd64
  export CGO_ENABLED=0
  go build -trimpath \
    -ldflags='-X github.com/rclone/rclone/fs.Version=v1.75.2' \
    -o "$diagnostic_binary" .
)
go version -m "$diagnostic_binary" | tee "$temp_root/rclone-unstripped-build-info.txt"
awk '$1 == "dep" && $2 == "github.com/go-chi/chi/v5" && $3 == "v5.3.1" { chi = 1 }
     $1 == "dep" && $2 == "golang.org/x/crypto" && $3 == "v0.57.0" { crypto = 1 }
     END { exit !(chi && crypto) }' "$temp_root/rclone-unstripped-build-info.txt" || {
  echo "Unstripped diagnostic build does not embed the same Trivy-reported chi and x/crypto versions" >&2
  exit 1
}
if ! go tool nm "$diagnostic_binary" > "$diagnostic_symbols" 2> "$temp_root/rclone-unstripped-nm-errors.txt"; then
  cat "$temp_root/rclone-unstripped-nm-errors.txt" >&2
  echo "Could not inspect the same-source unstripped diagnostic binary symbols" >&2
  exit 1
fi
if ! grep -E 'golang\.org/x/crypto/openpgp|github\.com/ProtonMail/go-crypto/openpgp|ClientIPFromXFF' \
  "$diagnostic_symbols" > "$diagnostic_symbols_report"; then
  echo "Unstripped diagnostic binary has no expected OpenPGP or ClientIPFromXFF symbols" >&2
  exit 1
fi
cat "$diagnostic_symbols_report"
if grep -Eq 'golang\.org/x/crypto/openpgp' "$diagnostic_symbols"; then
  echo "Unstripped diagnostic binary contains symbols from affected x/crypto/openpgp packages" >&2
  exit 1
else
  grep_status=$?
  if [[ "$grep_status" != 1 ]]; then
    echo "Could not verify affected x/crypto/openpgp symbol absence (grep exit=$grep_status)" >&2
    exit 1
  fi
fi
if ! grep -Eq 'github\.com/ProtonMail/go-crypto/openpgp' "$diagnostic_symbols"; then
  echo "Unstripped diagnostic binary has no ProtonMail OpenPGP symbols to reconcile the stripped-binary result" >&2
  exit 1
fi
echo "Unstripped diagnostic binary contains ProtonMail OpenPGP symbols and no affected x/crypto/openpgp symbols."
if ! govulncheck -mode=binary "$diagnostic_binary" > "$diagnostic_binary_report" 2>&1; then
  cat "$diagnostic_binary_report"
  echo "Govulncheck found a vulnerability in the same-source unstripped diagnostic binary" >&2
  exit 1
fi
cat "$diagnostic_binary_report"
if ! grep -q 'No vulnerabilities found\.' "$diagnostic_binary_report"; then
  echo "Unstripped diagnostic govulncheck did not provide a clean vulnerability result" >&2
  exit 1
fi
echo "The stripped production binary's GO-2026-5932 result is reconciled only by the same-source unstripped build, import graph, and source-mode analysis."
