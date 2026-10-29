#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
helper="$script_dir/reconstruct-rclone-binary.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() { [[ "$1" == "$2" ]] || fail "expected '$2', got '$1'"; }

# Canonical manifests must be deterministic and detect bytes, mode and symlink changes.
manifest_root="$tmp/manifest-root"
mkdir -p "$manifest_root/subdir"
printf 'content\n' > "$manifest_root/subdir/file"
chmod 640 "$manifest_root/subdir/file"
ln -s subdir/file "$manifest_root/link"
bash "$helper" --manifest "$manifest_root" "$tmp/manifest-1.json"
bash "$helper" --manifest "$manifest_root" "$tmp/manifest-2.json"
cmp -s "$tmp/manifest-1.json" "$tmp/manifest-2.json" || fail 'manifest output is not deterministic'
cp "$tmp/manifest-1.json" "$tmp/manifest-original.json"
printf 'changed\n' > "$manifest_root/subdir/file"
bash "$helper" --manifest "$manifest_root" "$tmp/manifest-content.json"
! cmp -s "$tmp/manifest-original.json" "$tmp/manifest-content.json" || fail 'manifest missed content change'
chmod 600 "$manifest_root/subdir/file"
bash "$helper" --manifest "$manifest_root" "$tmp/manifest-mode.json"
! cmp -s "$tmp/manifest-content.json" "$tmp/manifest-mode.json" || fail 'manifest missed mode change'
ln -sfn subdir "$manifest_root/link"
bash "$helper" --manifest "$manifest_root" "$tmp/manifest-link.json"
! cmp -s "$tmp/manifest-mode.json" "$tmp/manifest-link.json" || fail 'manifest missed symlink target change'

# Bind the test run to a temporary Git revision and a stub Docker implementation.
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/operations" "$tmp/bin" "$tmp/source"
cp "$helper" "$repo/scripts/ci/reconstruct-rclone-binary.sh"
cp "$script_dir/check-rclone-source-vulnerabilities.sh" "$repo/scripts/ci/"
cp "$script_dir/prepare-rclone-chi-dependency.sh" "$repo/scripts/ci/"
cp "$script_dir/prepare-rclone-x-net-dependencies.sh" "$repo/scripts/ci/"
cp "$script_dir/../../operations/Dockerfile" "$repo/operations/Dockerfile"
git -C "$repo" init -q
git -C "$repo" config user.email test@example.invalid
git -C "$repo" config user.name test
git -C "$repo" add .
git -C "$repo" commit -qm fixture
revision="$(git -C "$repo" rev-parse HEAD)"
tree="$(git -C "$repo" rev-parse HEAD^{tree})"
printf 'expected binary\n' > "$tmp/extracted-rclone"
operations_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
builder_id=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
export FIXTURE_OPERATIONS_ID="$operations_id" FIXTURE_BUILDER_ID="$builder_id"
export FIXTURE_REVISION="$revision" FIXTURE_TREE="$tree" FIXTURE_BINARY_MODE=match
mkdir -p "$tmp/runner-temp"
export RUNNER_TEMP="$tmp/runner-temp" FIXTURE_SCRATCH_CAPTURE="$tmp/scratch-paths.txt"
cat > "$tmp/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == pull ]]; then
  [[ $# == 4 && "$2" == --platform && "$3" == linux/amd64 && "$4" == 'golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c' ]] || {
    echo "unexpected builder pull command: $*" >&2
    exit 35
  }
  exit 0
fi
if [[ "$1 $2" == 'image inspect' ]]; then
  format="$4"
  image="$5"
  if [[ "$image" == 'ops:test' ]]; then
    case "$format" in
      '{{.Id}}') echo "$FIXTURE_OPERATIONS_ID" ;;
      *revision*) echo "$FIXTURE_REVISION" ;;
      *tree*) echo "$FIXTURE_TREE" ;;
      *) exit 31 ;;
    esac
  else
    case "$format" in
      '{{.Id}}') echo "$FIXTURE_BUILDER_ID" ;;
      '{{.Os}}/{{.Architecture}}') echo linux/amd64 ;;
      *) exit 32 ;;
    esac
  fi
  exit 0
fi
if [[ "$1" == run ]]; then
  out_mount=''
  while (($#)); do
    case "$1" in
      --mount)
        shift
        [[ "$1" == *target=/out* ]] && out_mount="$1"
        ;;
    esac
    shift
  done
  [[ -n "$out_mount" ]] || exit 33
  out="${out_mount#*source=}"
  out="${out%%,*}"
  printf '%s\n' "$out" >> "$FIXTURE_SCRATCH_CAPTURE"
  mkdir -p "$out/tmp" "$out/gocache" "$out/gomodcache" "$out/gopath" "$out/home"
  printf 'cache fixture\n' > "$out/gocache/cache-file"
  [[ "${FIXTURE_RUN_MODE:-success}" != fail ]] || exit 42
  printf 'go version go1.27.3 linux/amd64\n' > "$out/go-version.txt"
  printf 'linux\namd64\nv1\n0\nlocal\n\n\n\noff\n\noff\n/out/gocache\n/out/gomodcache\n/out/gopath\n' > "$out/go-env.txt"
  printf 'test stripped binary\n' > "$out/rclone-rebuilt-stripped"
  if [[ "$FIXTURE_BINARY_MODE" == match ]]; then
    printf 'expected binary\n' > "$out/rclone-rebuilt-stripped"
  fi
  printf 'unstripped binary\n' > "$out/rclone-rebuilt-unstripped"
  printf 'github.com/rclone/rclone\n' > "$out/import-paths.txt"
  printf 'build info\n' > "$out/build-info.txt"
  printf 'symbols\n' > "$out/nm-symbols.txt"
  exit 0
fi
exit 34
DOCKER
chmod +x "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH"

run_helper() {
  local evidence="$1"
  (cd "$repo" && bash "$helper" "$tmp/source" "$tmp/extracted-rclone" ops:test "$operations_id" "$revision" "$tree" "$evidence")
}
assert_no_builder_caches() {
  local evidence="$1"
  [[ ! -e "$evidence/builder-output" ]] || fail "builder scratch leaked into uploaded evidence: $evidence/builder-output"
}
assert_scratch_removed() {
  local evidence="$1" run_number="$2" scratch
  scratch="$(sed -n "${run_number}p" "$FIXTURE_SCRATCH_CAPTURE")"
  [[ -n "$scratch" ]] || fail "Docker stub did not capture scratch mount for run $run_number ($evidence)"
  [[ "$scratch" == "$RUNNER_TEMP"/taky-rclone-reconstruction.* ]] || fail "scratch path is not uniquely prefixed/outside evidence: $scratch"
  [[ ! -e "$scratch" ]] || fail "temporary builder scratch survived EXIT cleanup: $scratch"
}
run_helper "$tmp/evidence-pass"
assert_no_builder_caches "$tmp/evidence-pass"
assert_scratch_removed "$tmp/evidence-pass" 1
python3 - "$tmp/evidence-pass/reconstruction.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
assert d["status"] == "PASS", d
assert d["binaryByteEqual"] is True, d
assert d["sourceManifestStable"] is True, d
assert d["sourceManifestSha256"], d
assert d["sourceRevision"] and d["sourceTree"], d
assert d["operationsImageId"].startswith("sha256:"), d
assert "disposition" not in d, d
env = d["evidence"]["environment"]
assert env["path"].endswith("/go-environment.txt"), env
assert env["sha256"], env
assert d["builder"]["pullCommand"] == [
    "docker", "pull", "--platform", "linux/amd64",
    "golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c",
], d["builder"]
PY

export FIXTURE_BINARY_MODE=mismatch
if run_helper "$tmp/evidence-fail"; then fail 'binary mismatch unexpectedly passed'; fi
assert_no_builder_caches "$tmp/evidence-fail"
assert_scratch_removed "$tmp/evidence-fail" 2
python3 - "$tmp/evidence-fail/reconstruction.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
assert d["status"] == "FAIL", d
assert d["binaryByteEqual"] is False, d
assert d["extractedBinarySha256"], d
assert d["rebuiltBinarySha256"], d
assert "disposition" not in d, d
PY

# A valid but incorrect expected tree must fail Git revision binding before Docker use.
wrong_tree=cccccccccccccccccccccccccccccccccccccccc
if (cd "$repo" && bash "$helper" "$tmp/source" "$tmp/extracted-rclone" ops:test "$operations_id" "$revision" "$wrong_tree" "$tmp/evidence-tree-binding"); then
  fail 'source revision/tree mismatch unexpectedly passed'
fi
python3 - "$tmp/evidence-tree-binding/reconstruction.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
assert d["status"] == "FAIL", d
assert "source tree does not match source revision" in d["error"], d
PY
[[ "$(wc -l < "$FIXTURE_SCRATCH_CAPTURE")" -eq 2 ]] || fail 'source tree binding failure reached the Docker builder unexpectedly'
[[ -z "$(find "$RUNNER_TEMP" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail 'scratch leaked after pre-Docker source tree binding failure'

# Operations image labels are part of the immutable image binding.
export FIXTURE_REVISION=dddddddddddddddddddddddddddddddddddddddd
if run_helper "$tmp/evidence-label-fail"; then fail 'operations image label mismatch unexpectedly passed'; fi
python3 - "$tmp/evidence-label-fail/reconstruction.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
assert d["status"] == "FAIL", d
assert "revision/tree labels" in d["error"], d
PY
[[ "$(wc -l < "$FIXTURE_SCRATCH_CAPTURE")" -eq 2 ]] || fail 'image label failure reached the Docker builder unexpectedly'
[[ -z "$(find "$RUNNER_TEMP" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail 'scratch leaked after pre-Docker image label failure'
export FIXTURE_REVISION="$revision"

# A builder failure must leave the prewritten machine-readable failure record.
export FIXTURE_RUN_MODE=fail
if run_helper "$tmp/evidence-builder-fail"; then fail 'stub builder failure unexpectedly passed'; fi
assert_no_builder_caches "$tmp/evidence-builder-fail"
assert_scratch_removed "$tmp/evidence-builder-fail" 3
python3 - "$tmp/evidence-builder-fail/reconstruction.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
assert d["status"] == "FAIL", d
assert "builder reconstruction command failed" in d["error"], d
assert d["sourceManifest"]["before"]["sha256"], d
PY

if bash "$helper" --manifest "$manifest_root" >/dev/null 2>&1; then fail 'invalid --manifest arguments unexpectedly passed'; fi
echo 'PASS: reconstruction helper focused tests'
