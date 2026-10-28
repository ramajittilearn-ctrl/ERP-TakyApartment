#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <source-revision> <source-tree> <operations-image-ref> <operations-image-id> <rclone-binary> <report-path>" >&2
  exit 2
}
[[ $# == 6 ]] || usage

source_revision="$1"
source_tree="$2"
operations_image="$3"
operations_image_id="$4"
rclone_binary="$5"
report_path="$6"
[[ "$source_revision" =~ ^[a-f0-9]{40}$ && "$source_tree" =~ ^[a-f0-9]{40}$ ]] || {
  echo "Source revision and tree must be full Git object IDs" >&2
  exit 1
}
[[ "$operations_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "Operations image ID must be a SHA-256 digest" >&2
  exit 1
}
[[ -s "$rclone_binary" ]] || { echo "Extracted rclone binary is missing or empty" >&2; exit 1; }
mkdir -p "$(dirname "$report_path")"
: > "$report_path"
exec > >(tee -a "$report_path") 2>&1

rclone_version="1.75.2"
chi_version="5.4.0"
source_sha256="fa64537e7276196310dbb0bcea6330f03b40e5790197b88f14cce6a19f40eb67"
vendor_sha256="69b356c0b1800052c33ce0e0e11f18df8717a721aab346b553dc1ab44c8caae8"
source_url="https://github.com/rclone/rclone/releases/download/v${rclone_version}/rclone-v${rclone_version}.tar.gz"
vendor_url="https://github.com/rclone/rclone/releases/download/v${rclone_version}/rclone-v${rclone_version}-vendor.tar.gz"
chi_sha256="9ad4c02fc179b71081c86a7166bc871e0a816d5a803da5053ea9ed4cfd97422f"
chi_url="https://proxy.golang.org/github.com/go-chi/chi/v5/@v/v${chi_version}.zip"

grep -Fq "ADD --checksum=sha256:${source_sha256} ${source_url} " operations/Dockerfile || {
  echo "Rclone source archive checksum/URL differs from operations/Dockerfile" >&2
  exit 1
}
grep -Fq "ADD --checksum=sha256:${vendor_sha256} ${vendor_url} " operations/Dockerfile || {
  echo "Rclone vendor archive checksum/URL differs from operations/Dockerfile" >&2
  exit 1
}
grep -Fq "ADD --checksum=sha256:${chi_sha256} ${chi_url} " operations/Dockerfile || {
  echo "Pinned chi module archive checksum/URL differs from operations/Dockerfile" >&2
  exit 1
}

temp_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/taky-rclone-source.XXXXXX")"
trap 'rm -rf -- "$temp_root"' EXIT
source_archive="$temp_root/rclone-source.tar.gz"
vendor_archive="$temp_root/rclone-vendor.tar.gz"
chi_archive="$temp_root/chi-v${chi_version}.zip"
source_root="$temp_root/source"
mkdir -p "$source_root"
curl --fail --silent --show-error --location "$source_url" --output "$source_archive"
curl --fail --silent --show-error --location "$vendor_url" --output "$vendor_archive"
curl --fail --silent --show-error --location "$chi_url" --output "$chi_archive"
printf '%s  %s\n' "$source_sha256" "$source_archive" | sha256sum --check --status
printf '%s  %s\n' "$vendor_sha256" "$vendor_archive" | sha256sum --check --status
printf '%s  %s\n' "$chi_sha256" "$chi_archive" | sha256sum --check --status
tar -xzf "$source_archive" --strip-components=1 -C "$source_root"
tar -xzf "$vendor_archive" -C "$source_root"

[[ -f "$source_root/go.mod" && -f "$source_root/vendor/modules.txt" ]] || {
  echo "Checksum-verified rclone source/vendor inputs are incomplete" >&2
  exit 1
}
awk '$1 == "github.com/go-chi/chi/v5" && $2 == "v5.3.1" { found = 1 } END { exit !found }' "$source_root/go.mod" || {
  echo "Expected upstream chi v5.3.1 dependency was not found in pinned rclone source" >&2
  exit 1
}
awk '$1 == "golang.org/x/crypto" && $2 == "v0.57.0" { found = 1 } END { exit !found }' "$source_root/go.mod" || {
  echo "Expected x/crypto v0.57.0 dependency was not found in pinned rclone source" >&2
  exit 1
}
sh scripts/ci/prepare-rclone-chi-dependency.sh "$source_root" "$chi_archive"
awk '$1 == "github.com/go-chi/chi/v5" && $2 == "v5.4.0" { found = 1 } END { exit !found }' "$source_root/go.mod" || {
  echo "Patched rclone source does not require fixed chi v5.4.0" >&2
  exit 1
}
baseline_root="$temp_root/baseline-source"
cp -a "$source_root" "$baseline_root"

go_version="$(go version)"
[[ "$go_version" == "go version go1.27.3 linux/amd64" ]] || {
  echo "Unexpected Go toolchain for source vulnerability analysis: $go_version" >&2
  exit 1
}
govulncheck_path="$(command -v govulncheck || true)"
[[ -n "$govulncheck_path" ]] || { echo "Pinned govulncheck is not installed" >&2; exit 1; }
govulncheck_build="$(go version -m "$govulncheck_path")"
awk '$1 == "mod" && $2 == "golang.org/x/vuln" && $3 == "v1.9.0" { vuln = 1 }
     $1 == "dep" && $2 == "golang.org/x/tools" && $3 == "v0.52.0" { tools = 1 }
     END { exit !(vuln && tools) }' <<<"$govulncheck_build" || {
  echo "Unexpected govulncheck module version" >&2
  exit 1
}

go5932_advisory_url="https://vuln.go.dev/ID/GO-2026-5932.json"
go5932_advisory_sha256="f277b0400996200a7d5034c676661cd8cf18adeab1fdc5d0dc369e456ddf1fad"
go5932_advisory_path="${report_path%.txt}-GO-2026-5932.json"
go5932_advisory_headers="${report_path%.txt}-GO-2026-5932-headers.txt"
go5932_advisory_metadata="${report_path%.txt}-GO-2026-5932-retrieval.txt"
curl --fail --silent --show-error --location --dump-header "$go5932_advisory_headers" \
  "$go5932_advisory_url" --output "$go5932_advisory_path"
printf '%s  %s\n' "$go5932_advisory_sha256" "$go5932_advisory_path" | sha256sum --check --status || {
  echo "Official GO-2026-5932 record changed; require a reviewed advisory-scope update" >&2
  exit 1
}
cat > "$go5932_advisory_metadata" <<EOF
URL: $go5932_advisory_url
Retrieved at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
SHA-256: $go5932_advisory_sha256
EOF
python3 - "$go5932_advisory_path" <<'PY'
import json
import sys

path = sys.argv[1]
expected = {
    "golang.org/x/crypto/openpgp",
    "golang.org/x/crypto/openpgp/packet",
    "golang.org/x/crypto/openpgp/armor",
    "golang.org/x/crypto/openpgp/clearsign",
    "golang.org/x/crypto/openpgp/errors",
    "golang.org/x/crypto/openpgp/elgamal",
    "golang.org/x/crypto/openpgp/s2k",
}
record = json.load(open(path, encoding="utf-8"))
if record.get("id") != "GO-2026-5932":
    raise SystemExit("Official advisory ID did not match GO-2026-5932")
affected = record.get("affected", [])
if len(affected) != 1 or affected[0].get("package") != {"name": "golang.org/x/crypto", "ecosystem": "Go"}:
    raise SystemExit("Official GO-2026-5932 module scope changed; review required")
ranges = affected[0].get("ranges", [])
if len(ranges) != 1 or ranges[0].get("events") != [{"introduced": "0"}]:
    raise SystemExit("Official GO-2026-5932 version scope changed; review required")
imports = affected[0].get("ecosystem_specific", {}).get("imports", [])
paths = [item.get("path") for item in imports]
if len(paths) != len(set(paths)) or set(paths) != expected:
    raise SystemExit("Official GO-2026-5932 affected package paths changed; review required")
PY

# The public vuln.go.dev index can lag a newly published advisory. Preserve its
# normal full-database scan below, and separately exercise these exact official
# OSV records against the vulnerable baseline and the upgraded source tree.
supplemental_db="$temp_root/x-net-advisory-overlay"
supplemental_baseline_report="${report_path%.txt}-x-net-supplemental-baseline.txt"
supplemental_source_report="${report_path%.txt}-x-net-supplemental-upgraded-source.txt"
supplemental_binary_report="${report_path%.txt}-x-net-supplemental-unstripped-binary.txt"
supplemental_overlay_artifact="${report_path%.txt}-x-net-overlay"
sh scripts/ci/prepare-rclone-x-net-dependencies.sh advisory-db "$supplemental_db"
mkdir -p "$supplemental_overlay_artifact"
cp -R "$supplemental_db/." "$supplemental_overlay_artifact/"
cp "$supplemental_db/retrieval-metadata.txt" "${report_path%.txt}-x-net-advisory-retrieval.txt"
set +e
(
  cd "$baseline_root"
  export GOFLAGS=-mod=vendor GOTOOLCHAIN=local GOWORK=off GOOS=linux GOARCH=amd64 CGO_ENABLED=0
  govulncheck -db "file://$supplemental_db" -show traces .
) > "$supplemental_baseline_report" 2>&1
baseline_supplemental_status=$?
set -e
cat "$supplemental_baseline_report"
[[ "$baseline_supplemental_status" == 3 ]] || {
  echo "Baseline supplemental source scan must find the pinned advisory (exit=$baseline_supplemental_status)" >&2
  exit 1
}
awk '/^Vulnerability #[0-9]+: / { count++; if ($NF != "GO-2026-6860") unexpected = 1 }
     END { exit !(count == 1 && !unexpected) }' "$supplemental_baseline_report" || {
  echo "Baseline supplemental scan did not find exactly GO-2026-6860" >&2
  exit 1
}
grep -Fq 'Fixed in: golang.org/x/net@v0.62.0' "$supplemental_baseline_report" || {
  echo "Baseline supplemental scan did not report the pinned x/net fixed version" >&2
  exit 1
}
grep -Fq 'golang.org/x/net/html.Parse' "$supplemental_baseline_report" &&
  grep -Fq 'github.com/rclone/rclone/backend/http/http.go' "$supplemental_baseline_report" || {
  echo "Baseline supplemental source trace does not reach x/net/html.Parse through rclone backend/http" >&2
  exit 1
}

sh scripts/ci/prepare-rclone-x-net-dependencies.sh prepare "$source_root"
set +e
(
  cd "$source_root"
  export GOFLAGS=-mod=vendor GOTOOLCHAIN=local GOWORK=off GOOS=linux GOARCH=amd64 CGO_ENABLED=0
  govulncheck -db "file://$supplemental_db" -show traces .
) > "$supplemental_source_report" 2>&1
upgraded_supplemental_status=$?
set -e
cat "$supplemental_source_report"
[[ "$upgraded_supplemental_status" == 0 ]] && grep -q 'No vulnerabilities found\.' "$supplemental_source_report" || {
  echo "Upgraded supplemental source scan did not pass cleanly" >&2
  exit 1
}

reconstruction_dir="${report_path%.txt}-reconstruction"
reconstruction_json="$reconstruction_dir/reconstruction.json"
imports_report="$reconstruction_dir/import-paths.txt"
diagnostic_binary="$reconstruction_dir/rclone-rebuilt-unstripped"
rebuilt_stripped_binary="$reconstruction_dir/rclone-rebuilt-stripped"
diagnostic_build_info="$reconstruction_dir/build-info.txt"
diagnostic_symbols="$reconstruction_dir/nm-symbols.txt"
diagnostic_symbols_report="${report_path%.txt}-unstripped-symbols.txt"
bash scripts/ci/reconstruct-rclone-binary.sh \
  "$source_root" "$rclone_binary" "$operations_image" "$operations_image_id" \
  "$source_revision" "$source_tree" "$reconstruction_dir"
[[ -s "$reconstruction_json" && -s "$rebuilt_stripped_binary" && -s "$diagnostic_binary" && -s "$imports_report" && -s "$diagnostic_build_info" && -s "$diagnostic_symbols" ]] || {
  echo "Exact-builder rclone reconstruction evidence is incomplete" >&2
  exit 1
}
imports_artifact_path="$imports_report"
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

diagnostic_binary_report="${report_path%.txt}-unstripped-binary.txt"
cp "$diagnostic_symbols" "$diagnostic_symbols_report"
cat "$diagnostic_build_info"
awk '$1 == "dep" && $2 == "github.com/go-chi/chi/v5" && $3 == "v5.4.0" { chi = 1 }
     $1 == "dep" && $2 == "golang.org/x/crypto" && $3 == "v0.58.0" { crypto = 1 }
     $1 == "dep" && $2 == "golang.org/x/net" && $3 == "v0.62.0" { net = 1 }
     END { exit !(chi && crypto && net) }' "$diagnostic_build_info" || {
  echo "Unstripped diagnostic build does not embed the fixed chi, x/crypto, and x/net versions" >&2
  exit 1
}
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
set +e
govulncheck -db "file://$supplemental_db" -mode=binary "$diagnostic_binary" > "$supplemental_binary_report" 2>&1
supplemental_binary_status=$?
set -e
cat "$supplemental_binary_report"
[[ "$supplemental_binary_status" == 0 ]] && grep -q 'No vulnerabilities found\.' "$supplemental_binary_report" || {
  echo "Upgraded supplemental exact-binary scan did not pass cleanly" >&2
  exit 1
}
echo "Supplemental source baseline and upgraded-source/unstripped-binary traces retained beside the CI report."

go5932_raw_binary_report="$(dirname "$report_path")/rclone-operations-govulncheck.txt"
[[ -s "$go5932_raw_binary_report" ]] || {
  echo "Raw stripped-binary govulncheck report is missing" >&2
  exit 1
}
grep -Fq 'GO-2026-5932' "$go5932_raw_binary_report" || {
  echo "Expected raw GO-2026-5932 result is absent from the retained stripped-binary report" >&2
  exit 1
}
final_manifest="$reconstruction_dir/source-manifest-final.json"
bash scripts/ci/reconstruct-rclone-binary.sh --manifest "$source_root" "$final_manifest"
cmp -s "$reconstruction_dir/source-manifest-after.json" "$final_manifest" || {
  echo "Checksum-verified source tree changed after reconstruction/scanner checks" >&2
  exit 1
}
[[ "$(docker image inspect --format '{{.Id}}' "$operations_image")" == "$operations_image_id" ]] || {
  echo "Operations image changed before GO-2026-5932 disposition" >&2
  exit 1
}
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$operations_image")" == "$source_revision" && \
   "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.tree"}}' "$operations_image")" == "$source_tree" ]] || {
  echo "Operations image source labels changed before GO-2026-5932 disposition" >&2
  exit 1
}
python3 - "$reconstruction_json" "$go5932_advisory_path" "$go5932_raw_binary_report" \
  "$source_revision" "$source_tree" "$operations_image" "$operations_image_id" \
  "$report_path" "$diagnostic_binary_report" "$supplemental_binary_report" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

(reconstruction_path, advisory_path, raw_binary_report, revision, tree, image_ref,
 image_id, source_report, diagnostic_report, supplemental_report) = sys.argv[1:]
reconstruction = json.load(open(reconstruction_path, encoding="utf-8"))
if (
    reconstruction.get("status") != "PASS"
    or reconstruction.get("binaryByteEqual") is not True
    or reconstruction.get("sourceManifestStable") is not True
    or reconstruction.get("sourceRevision") != revision
    or reconstruction.get("sourceTree") != tree
    or reconstruction.get("operationsImageRef") != image_ref
    or reconstruction.get("operationsImageId") != image_id
    or not reconstruction.get("extractedBinarySha256")
    or reconstruction.get("extractedBinarySha256") != reconstruction.get("rebuiltBinarySha256")
    or not reconstruction.get("sourceManifestSha256")
):
    raise SystemExit("Reconstruction proof did not establish exact stripped-binary equality")
def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()
disposition = {
    "schemaVersion": 1,
    "status": "verified_scoped_non_applicability",
    "vulnerability": "GO-2026-5932",
    "conclusion": "affected legacy OpenPGP package paths absent in this exact binary",
    "notAClaimOf": ["raw scanner clearance", "overall image security clearance", "production acceptance"],
    "advisoryUrl": "https://vuln.go.dev/ID/GO-2026-5932.json",
    "advisorySha256": digest(advisory_path),
    "checkoutRevision": revision,
    "checkoutTree": tree,
    "operationsImageReference": image_ref,
    "operationsImageId": image_id,
    "extractedBinarySha256": reconstruction["extractedBinarySha256"],
    "rebuiltBinarySha256": reconstruction["rebuiltBinarySha256"],
    "binaryByteEqual": reconstruction["binaryByteEqual"],
    "sourceManifestStable": reconstruction["sourceManifestStable"],
    "sourceManifestSha256": reconstruction["sourceManifestSha256"],
    "evidence": {
        "reconstruction": reconstruction_path,
        "rawStrippedGovulncheck": raw_binary_report,
        "canonicalSourceGovulncheck": source_report,
        "canonicalUnstrippedBinaryGovulncheck": diagnostic_report,
        "supplementalUnstrippedBinaryGovulncheck": supplemental_report,
    },
    "rawScannerFindingRetained": True,
}
output = Path(reconstruction_path).parent / "go5932-disposition.json"
output.write_text(json.dumps(disposition, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(f"Wrote scoped GO-2026-5932 disposition: {output}")
PY
echo "The stripped production binary's raw GO-2026-5932 report remains retained; this disposition only records that affected legacy package code is absent from the exact byte-reconstructed binary."
