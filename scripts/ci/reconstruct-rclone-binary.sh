#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <source-root> <extracted-binary> <operations-image-ref> <operations-image-id> <source-revision> <source-tree> <evidence-dir>" >&2
  echo "       $0 --manifest <source-root> <manifest-path>" >&2
  exit 2
}

make_manifest() {
  python3 - "$1" "$2" <<'PY'
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve(strict=True)
out = Path(sys.argv[2])
entries = [{"path": ".", "type": "directory", "mode": stat.S_IMODE(root.lstat().st_mode)}]
for base, dirs, files in os.walk(root, topdown=True, followlinks=False):
    base_path = Path(base)
    dirs.sort()
    files.sort()
    for name in list(dirs) + files:
        path = base_path / name
        rel = path.relative_to(root).as_posix()
        st = path.lstat()
        mode = stat.S_IMODE(st.st_mode)
        if stat.S_ISLNK(st.st_mode):
            item = {"path": rel, "type": "symlink", "mode": mode, "target": os.readlink(path)}
            if name in dirs:
                dirs.remove(name)
        elif stat.S_ISDIR(st.st_mode):
            item = {"path": rel, "type": "directory", "mode": mode}
        elif stat.S_ISREG(st.st_mode):
            h = hashlib.sha256()
            with path.open("rb") as f:
                for block in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(block)
            item = {"path": rel, "type": "file", "mode": mode, "sha256": h.hexdigest()}
        else:
            raise SystemExit(f"unsupported source filesystem entry: {rel}")
        entries.append(item)
entries.sort(key=lambda entry: entry["path"])
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(entries, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

if [[ ${1-} == "--manifest" ]]; then
  [[ $# == 3 ]] || usage
  make_manifest "$2" "$3"
  exit 0
fi

[[ $# == 7 ]] || usage
source_root="$1"
extracted_binary="$2"
operations_image_ref="$3"
operations_image_id="$4"
source_revision="$5"
source_tree="$6"
evidence_dir="$7"

mkdir -p "$evidence_dir"
record_path="$evidence_dir/reconstruction.json"
log_path="$evidence_dir/builder.log"
stripped_path="$evidence_dir/rclone-rebuilt-stripped"
unstripped_path="$evidence_dir/rclone-rebuilt-unstripped"
import_path="$evidence_dir/import-paths.txt"
build_info_path="$evidence_dir/build-info.txt"
symbols_path="$evidence_dir/nm-symbols.txt"
environment_path="$evidence_dir/go-environment.txt"
manifest_before_path="$evidence_dir/source-manifest-before.json"
manifest_after_path="$evidence_dir/source-manifest-after.json"
build_dir="$evidence_dir/builder-output"

status=INCONCLUSIVE
error_message=""
repo_root=""
source_root_real=""
evidence_dir_real=""
source_revision_tree=""
operations_image_id_before=""
operations_image_id_after=""
operations_image_revision=""
operations_image_tree=""
builder_image_ref="golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c"
builder_image_id=""
builder_platform=""
go_version=""
source_manifest_sha256_before=""
source_manifest_sha256_after=""
extracted_binary_sha256=""
rebuilt_binary_sha256=""
unstripped_binary_sha256=""
binary_byte_equal=false
dockerfile_sha256=""
source_verifier_sha256=""
chi_prepare_sha256=""
x_net_prepare_sha256=""
dockerfile_git_blob=""
source_verifier_git_blob=""
chi_prepare_git_blob=""
x_net_prepare_git_blob=""
production_command='go build -mod=vendor -trimpath -ldflags="-s -w -X github.com/rclone/rclone/fs.Version=v1.75.2" -o /out/rclone .'
diagnostic_command='go build -mod=vendor -trimpath -ldflags="-X github.com/rclone/rclone/fs.Version=v1.75.2" -o /out/rclone-rebuilt-unstripped .'
builder_argv='["docker","run","--pull=never","--rm","--network","none","--platform","linux/amd64","--read-only","--mount","type=bind,source=<source-root>,target=/src,readonly","--mount","type=bind,source=<evidence-dir>/builder-output,target=/out","--workdir","/src","<pinned-builder-image>","sh","-ec","build stripped+diagnostic binaries, list imports, capture build info and symbols"]'

write_record() {
  local result_status="$1" result_error="$2"
  python3 - "$record_path" "$result_status" "$result_error" \
    "$source_revision" "$source_tree" "$source_revision_tree" "$repo_root" \
    "$operations_image_ref" "$operations_image_id" "$operations_image_id_before" \
    "$operations_image_id_after" "$operations_image_revision" "$operations_image_tree" \
    "$builder_image_ref" "$builder_image_id" "$builder_platform" "$go_version" \
    "$source_manifest_sha256_before" "$source_manifest_sha256_after" \
    "$extracted_binary_sha256" "$rebuilt_binary_sha256" "$unstripped_binary_sha256" \
    "$binary_byte_equal" "$dockerfile_sha256" "$source_verifier_sha256" "$chi_prepare_sha256" \
    "$x_net_prepare_sha256" "$dockerfile_git_blob" "$source_verifier_git_blob" \
    "$chi_prepare_git_blob" "$x_net_prepare_git_blob" "$production_command" \
      "$diagnostic_command" "$builder_argv" "$manifest_before_path" "$manifest_after_path" \
    "$import_path" "$build_info_path" "$symbols_path" "$environment_path" "$log_path" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

(record, status, error, revision, tree, revision_tree, repo_root,
 operations_ref, operations_expected_id, operations_id_before,
 operations_id_after, operations_revision, operations_tree,
 builder_ref, builder_id, builder_platform, go_version,
 manifest_before_sha, manifest_after_sha, extracted_sha, rebuilt_sha,
 unstripped_sha, byte_equal, dockerfile_sha, verifier_sha,
 chi_prepare_sha, x_net_prepare_sha, dockerfile_blob, verifier_blob,
 chi_prepare_blob, x_net_prepare_blob, production_command, diagnostic_command,
 builder_argv, manifest_before, manifest_after, imports, build_info,
 symbols, environment, log_path) = sys.argv[1:]

def sha256(path):
    p = Path(path)
    if not p.is_file():
        return None
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

stable = bool(manifest_before_sha and manifest_before_sha == manifest_after_sha)
same_binary = byte_equal == "true"
result = {
    "schemaVersion": 1,
    "status": status,
    "error": error or None,
    "sourceRevision": revision,
    "sourceTree": tree,
    "sourceRevisionTree": revision_tree or None,
    "operationsImageRef": operations_ref,
    "operationsImageId": operations_expected_id,
    "extractedBinarySha256": extracted_sha or None,
    "rebuiltBinarySha256": rebuilt_sha or None,
    "binaryByteEqual": same_binary,
    "sourceManifestStable": stable,
    "sourceManifestSha256": manifest_after_sha or None,
    "source": {"repositoryRoot": repo_root or None},
    "operationsImage": {
        "idBefore": operations_id_before or None,
        "idAfter": operations_id_after or None,
        "revisionLabel": operations_revision or None,
        "treeLabel": operations_tree or None,
    },
    "builder": {
        "reference": builder_ref,
        "imageId": builder_id or None,
        "platform": builder_platform or None,
        "goVersion": go_version or None,
        "environment": {
            "GOOS": "linux", "GOARCH": "amd64", "GOAMD64": "v1",
            "CGO_ENABLED": "0", "GOTOOLCHAIN": "local", "GOWORK": "off",
            "GOENV": "off", "GOFLAGS": "", "GOPROXY": "off",
            "GOSUMDB": "off", "GOCACHE": "/out/gocache",
            "GOMODCACHE": "/out/gomodcache", "GOPATH": "/out/gopath",
        },
        "productionCommand": production_command,
        "diagnosticCommand": diagnostic_command,
        "pullCommand": ["docker", "pull", "--platform", "linux/amd64", builder_ref],
        "containerArgv": json.loads(builder_argv),
    },
    "gitBindings": {
        "operations/Dockerfile": {"blob": dockerfile_blob or None, "sha256": dockerfile_sha or None},
        "scripts/ci/check-rclone-source-vulnerabilities.sh": {"blob": verifier_blob or None, "sha256": verifier_sha or None},
        "scripts/ci/prepare-rclone-chi-dependency.sh": {"blob": chi_prepare_blob or None, "sha256": chi_prepare_sha or None},
        "scripts/ci/prepare-rclone-x-net-dependencies.sh": {"blob": x_net_prepare_blob or None, "sha256": x_net_prepare_sha or None},
    },
    "sourceManifest": {
        "before": {"path": manifest_before, "sha256": manifest_before_sha or None},
        "after": {"path": manifest_after, "sha256": manifest_after_sha or None},
        "stable": stable,
    },
    "binaries": {
        "extractedSha256": extracted_sha or None,
        "rebuiltStrippedSha256": rebuilt_sha or None,
        "unstrippedDiagnosticSha256": unstripped_sha or None,
        "byteIdentical": same_binary,
    },
    "evidence": {
        "imports": {"path": imports, "sha256": sha256(imports)},
        "buildInfo": {"path": build_info, "sha256": sha256(build_info)},
        "symbols": {"path": symbols, "sha256": sha256(symbols)},
        "environment": {"path": environment, "sha256": sha256(environment)},
        "builderLog": {"path": log_path, "sha256": sha256(log_path)},
    },
}
Path(record).write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

on_exit() {
  local rc="$1"
  trap - EXIT
  if [[ "$rc" != 0 && "$status" == "IN_PROGRESS" ]]; then
    status=FAIL
    error_message="Reconstruction failed with exit $rc; see retained evidence."
  fi
  python3 - "$build_dir" <<'CLEANUP' >/dev/null 2>&1 || true
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1])
for name in ("tmp", "gocache", "gomodcache", "gopath", "home"):
    path = root / name
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
CLEANUP
  write_record "$status" "$error_message" || true
  exit "$rc"
}
trap 'on_exit $?' EXIT

fail() {
  error_message="$1"
  status=FAIL
  echo "rclone binary reconstruction: $error_message" >&2
  exit 1
}

status=IN_PROGRESS
write_record "$status" "reconstruction is running"
touch "$log_path"
command -v docker >/dev/null 2>&1 || fail "docker is required for pinned-builder reconstruction"
command -v python3 >/dev/null 2>&1 || fail "python3 is required for source manifests and JSON evidence"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
command -v cmp >/dev/null 2>&1 || fail "cmp is required"
[[ -d "$source_root" ]] || fail "prepared source root is missing"
[[ -s "$extracted_binary" ]] || fail "extracted operations rclone binary is missing or empty"
[[ "$operations_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "operations image ID is not a SHA-256 digest"
[[ "$source_revision" =~ ^[a-f0-9]{40}$ && "$source_tree" =~ ^[a-f0-9]{40}$ ]] || fail "source revision and tree must be full Git object IDs"

source_root_real="$(cd "$source_root" && pwd -P)"
evidence_dir_real="$(cd "$evidence_dir" && pwd -P)"
case "$evidence_dir_real/" in
  "$source_root_real/"*) fail "evidence directory must not be inside the prepared source root" ;;
esac
[[ "$source_root_real" != "$evidence_dir_real" ]] || fail "evidence directory must be separate from the prepared source root"

extracted_binary_sha256="$(sha256sum "$extracted_binary" | awk '{print $1}')"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "cannot locate the Git repository root"
source_revision_tree="$(git rev-parse "${source_revision}^{tree}" 2>/dev/null)" || fail "source revision is not available in this checkout"
[[ "$source_revision_tree" == "$source_tree" ]] || fail "source tree does not match source revision"

tracked_files=(
  operations/Dockerfile
  scripts/ci/check-rclone-source-vulnerabilities.sh
  scripts/ci/prepare-rclone-chi-dependency.sh
  scripts/ci/prepare-rclone-x-net-dependencies.sh
  scripts/ci/reconstruct-rclone-binary.sh
)
for rel in "${tracked_files[@]}"; do
  [[ -f "$repo_root/$rel" ]] || fail "required tracked build file is missing: $rel"
  local_blob="$(git rev-parse "${source_revision}:${rel}" 2>/dev/null)" || fail "required file is absent from the expected Git tree: $rel"
  work_blob="$(git hash-object --path="$rel" "$repo_root/$rel" 2>/dev/null)" || fail "cannot hash build file: $rel"
  [[ "$local_blob" == "$work_blob" ]] || fail "build file differs from the expected Git tree: $rel"
  case "$rel" in
    operations/Dockerfile) dockerfile_git_blob="$local_blob"; dockerfile_sha256="$(sha256sum "$repo_root/$rel" | awk '{print $1}')" ;;
    scripts/ci/check-rclone-source-vulnerabilities.sh) source_verifier_git_blob="$local_blob"; source_verifier_sha256="$(sha256sum "$repo_root/$rel" | awk '{print $1}')" ;;
    scripts/ci/prepare-rclone-chi-dependency.sh) chi_prepare_git_blob="$local_blob"; chi_prepare_sha256="$(sha256sum "$repo_root/$rel" | awk '{print $1}')" ;;
    scripts/ci/prepare-rclone-x-net-dependencies.sh) x_net_prepare_git_blob="$local_blob"; x_net_prepare_sha256="$(sha256sum "$repo_root/$rel" | awk '{print $1}')" ;;
  esac
done

python3 - "$repo_root/operations/Dockerfile" "$builder_image_ref" <<'PY' || fail "operations Dockerfile builder or production build command drifted"
import sys
from pathlib import Path

path, pinned = sys.argv[1:]
text = Path(path).read_text(encoding="utf-8")
expected_from = f"FROM --platform=$BUILDPLATFORM {pinned} AS rclone-build"
if text.count(expected_from) != 1:
    raise SystemExit("expected exactly one pinned rclone-build FROM line")
for line in text.splitlines():
    if line.startswith("FROM --platform=$BUILDPLATFORM ") and " AS rclone-build" in line and line != expected_from:
        raise SystemExit("rclone-build uses an unexpected builder image")
expected_run = '''RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \\
    go build -mod=vendor -trimpath \\
    -ldflags="-s -w -X github.com/rclone/rclone/fs.Version=v1.75.2" \\
    -o /out/rclone .'''
if text.count(expected_run) != 1:
    raise SystemExit("expected exactly one reviewed production build command")
PY

operations_image_id_before="$(docker image inspect --format '{{.Id}}' "$operations_image_ref" 2>>"$log_path")" || fail "cannot inspect operations image"
operations_image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$operations_image_ref" 2>>"$log_path")" || fail "cannot read operations image revision label"
operations_image_tree="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.tree"}}' "$operations_image_ref" 2>>"$log_path")" || fail "cannot read operations image tree label"
[[ "$operations_image_id_before" == "$operations_image_id" ]] || fail "operations image ID changed before reconstruction"
[[ "$operations_image_revision" == "$source_revision" && "$operations_image_tree" == "$source_tree" ]] || fail "operations image revision/tree labels do not match the requested checkout"

printf 'Pulling pinned Go builder image by digest: %s\n' "$builder_image_ref" >> "$log_path"
docker pull --platform linux/amd64 "$builder_image_ref" >>"$log_path" 2>&1 || fail "cannot pull pinned Go builder image"
builder_image_id="$(docker image inspect --format '{{.Id}}' "$builder_image_ref" 2>>"$log_path")" || fail "cannot inspect pulled pinned Go builder image"
builder_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$builder_image_ref" 2>>"$log_path")" || fail "cannot inspect pinned Go builder platform"
[[ "$builder_platform" == "linux/amd64" ]] || fail "pinned Go builder platform is not linux/amd64"

make_manifest "$source_root_real" "$manifest_before_path" || fail "cannot create complete prepared-source manifest"
source_manifest_sha256_before="$(sha256sum "$manifest_before_path" | awk '{print $1}')"
mkdir -p "$build_dir/tmp" "$build_dir/gocache" "$build_dir/gomodcache" "$build_dir/gopath" "$build_dir/home"
rm -f "$stripped_path" "$unstripped_path" "$import_path" "$build_info_path" "$symbols_path"
printf 'builder image: %s (%s), platform=%s\n' "$builder_image_ref" "$builder_image_id" "$builder_platform" >> "$log_path"
printf 'operations image: %s (%s) revision=%s tree=%s\n' "$operations_image_ref" "$operations_image_id" "$operations_image_revision" "$operations_image_tree" >> "$log_path"

docker run --pull=never --rm --network none --platform linux/amd64 --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --mount "type=bind,source=$source_root_real,target=/src,readonly" \
  --mount "type=bind,source=$build_dir,target=/out" \
  --workdir /src \
  --env HOME=/out/home --env TMPDIR=/out/tmp \
  --env GOOS=linux --env GOARCH=amd64 --env GOAMD64=v1 --env CGO_ENABLED=0 \
  --env GOTOOLCHAIN=local --env GOWORK=off --env GOENV=off --env GOFLAGS= \
  --env GOPROXY=off --env GOSUMDB=off --env GOCACHE=/out/gocache \
  --env GOMODCACHE=/out/gomodcache --env GOPATH=/out/gopath \
  "$builder_image_ref" sh -ec '
    test "$(go version)" = "go version go1.27.3 linux/amd64"
    go version | tee /out/go-version.txt
    go env GOOS GOARCH GOAMD64 CGO_ENABLED GOTOOLCHAIN GOWORK GOENV GOFLAGS GOPROXY GOSUMDB GOCACHE GOMODCACHE GOPATH > /out/go-env.txt
    go build -mod=vendor -trimpath -ldflags="-s -w -X github.com/rclone/rclone/fs.Version=v1.75.2" -o /out/rclone-rebuilt-stripped .
    go build -mod=vendor -trimpath -ldflags="-X github.com/rclone/rclone/fs.Version=v1.75.2" -o /out/rclone-rebuilt-unstripped .
    go list -mod=vendor -deps -f "{{.ImportPath}}" . | sort -u > /out/import-paths.txt
    go version -m /out/rclone-rebuilt-unstripped > /out/build-info.txt
    go tool nm /out/rclone-rebuilt-unstripped > /out/nm-symbols.txt
  ' > >(tee -a "$log_path") 2> >(tee -a "$log_path" >&2) || fail "pinned-builder reconstruction command failed"

go_version="$(cat "$build_dir/go-version.txt")"
[[ "$go_version" == "go version go1.27.3 linux/amd64" ]] || fail "reconstruction used an unexpected Go toolchain"
mv "$build_dir/rclone-rebuilt-stripped" "$stripped_path"
mv "$build_dir/rclone-rebuilt-unstripped" "$unstripped_path"
mv "$build_dir/import-paths.txt" "$import_path"
mv "$build_dir/build-info.txt" "$build_info_path"
mv "$build_dir/nm-symbols.txt" "$symbols_path"
mv "$build_dir/go-env.txt" "$environment_path"
[[ -s "$stripped_path" && -s "$unstripped_path" && -s "$import_path" ]] || fail "pinned builder did not produce all expected evidence"

rebuilt_binary_sha256="$(sha256sum "$stripped_path" | awk '{print $1}')"
unstripped_binary_sha256="$(sha256sum "$unstripped_path" | awk '{print $1}')"
if ! cmp -s "$extracted_binary" "$stripped_path"; then
  binary_byte_equal=false
  fail "rebuilt stripped binary bytes do not match the executable extracted from the operations image"
fi
binary_byte_equal=true

operations_image_id_after="$(docker image inspect --format '{{.Id}}' "$operations_image_ref" 2>>"$log_path")" || fail "cannot re-inspect operations image after reconstruction"
[[ "$operations_image_id_after" == "$operations_image_id" ]] || fail "operations image ID changed during reconstruction"
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$operations_image_ref" 2>>"$log_path")" == "$source_revision" ]] || fail "operations image revision label changed during reconstruction"
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.tree"}}' "$operations_image_ref" 2>>"$log_path")" == "$source_tree" ]] || fail "operations image tree label changed during reconstruction"

make_manifest "$source_root_real" "$manifest_after_path" || fail "cannot create post-reconstruction source manifest"
source_manifest_sha256_after="$(sha256sum "$manifest_after_path" | awk '{print $1}')"
[[ "$source_manifest_sha256_before" == "$source_manifest_sha256_after" ]] || fail "prepared source changed during reconstruction"

status=PASS
error_message=""
echo "Rebuilt rclone stripped binary matches the executable extracted from the operations image: sha256:$rebuilt_binary_sha256"
echo "Reconstruction evidence: $record_path"
