#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 6 ]]; then
  echo "Usage: scan-container-images.sh APP_IMAGE VALIDATOR_IMAGE OPERATIONS_IMAGE REVISION TREE OUTPUT_DIR" >&2
  exit 2
fi

app_image="$1"
validator_image="$2"
operations_image="$3"
revision="$4"
tree="$5"
output_dir="$6"
trivy_version="0.76.1"
trivy_sha256="c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0"
platform="linux/amd64"
archive="${RUNNER_TEMP:?RUNNER_TEMP is required}/trivy-${trivy_version}-linux-amd64.tar.gz"
tool_dir="${RUNNER_TEMP}/trivy-${trivy_version}-linux-amd64"

if [[ ! "$revision" =~ ^[a-f0-9]{40}$ || ! "$tree" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Image scan requires full source revision and tree hashes" >&2
  exit 1
fi
for image in "$app_image" "$validator_image" "$operations_image"; do
  if [[ -z "$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null)" ]]; then
    echo "Required local image is missing: $image" >&2
    exit 1
  fi
done
if [[ -e "$archive" || -e "$tool_dir" || -e "$output_dir" ]]; then
  echo "Refusing to overwrite pre-existing scanner output or tool files" >&2
  exit 1
fi
mkdir -p "$tool_dir" "$output_dir"

curl --fail --location --silent --show-error \
  "https://github.com/aquasecurity/trivy/releases/download/v${trivy_version}/trivy_${trivy_version}_Linux-64bit.tar.gz" \
  --output "$archive"
printf '%s  %s\n' "$trivy_sha256" "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$tool_dir" trivy
trivy_bin="${tool_dir}/trivy"
chmod 0755 "$trivy_bin"
version_output="$($trivy_bin --version)"
if [[ "$version_output" != *"Version: ${trivy_version}"* ]]; then
  echo "Downloaded Trivy binary reports an unexpected version: $version_output" >&2
  exit 1
fi

scan_image() {
  local name="$1" image="$2" image_id image_platform report
  image_id="$(docker image inspect --format '{{.Id}}' "$image")"
  image_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")"
  if [[ "$image_platform" != "$platform" ]]; then
    echo "Refusing to scan $image with unexpected platform $image_platform" >&2
    return 1
  fi
  report="${output_dir}/${name}.trivy.json"
  echo "Scanning local $platform image $image ($image_id)"
  "$trivy_bin" image \
    --disable-telemetry \
    --skip-version-check \
    --image-src docker \
    --platform "$platform" \
    --scanners vuln \
    --format json \
    --output "$report" \
    --exit-code 0 \
    "$image"
  jq -e '.SchemaVersion and .ArtifactName' "$report" >/dev/null
  jq -n \
    --arg name "$name" \
    --arg image "$image" \
    --arg imageId "$image_id" \
    --arg platform "$platform" \
    --arg revision "$revision" \
    --arg tree "$tree" \
    --arg scannerVersion "$trivy_version" \
    --arg scannedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg report "${name}.trivy.json" \
    '{name:$name,image:$image,imageId:$imageId,platform:$platform,sourceRevision:$revision,sourceTree:$tree,scanner:"Trivy",scannerVersion:$scannerVersion,scannedAt:$scannedAt,report:$report}' \
    > "${output_dir}/${name}.metadata.json"
}

scan_image app "$app_image"
scan_image validator "$validator_image"
scan_image operations "$operations_image"

cat > "${output_dir}/README.md" <<EOF
# Isolated container image vulnerability scan

- Source revision: \`${revision}\`
- Source tree: \`${tree}\`
- Platform: \`${platform}\`
- Scanner: Trivy \`${trivy_version}\` (official release archive SHA-256 verified by the CI script)
- Scope: local app, validator, and operations images built from the source checkout; vulnerability scanner only
- Policy: findings are reported and are not assigned a blocking severity threshold
- Image metadata sidecars record local image IDs (config digests), tags, source identity, and scan time

These reports do not represent a production deployment or a published registry image.
EOF

echo "Current-checkout vulnerability reports written to $output_dir"
