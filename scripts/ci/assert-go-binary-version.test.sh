#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
cat > "$temp/go" <<'GO'
#!/usr/bin/env bash
[[ $# == 2 && "$1" == version ]] || exit 2
printf '%s: %s\n' "$2" "${GO_STUB_VERSION:-go1.27.3}"
GO
chmod +x "$temp/go"

PATH="$temp:$PATH" bash "$root/scripts/ci/assert-go-binary-version.sh" /tmp/gosu go1.27.3
if PATH="$temp:$PATH" GO_STUB_VERSION=go1.27.2 bash "$root/scripts/ci/assert-go-binary-version.sh" /tmp/gosu go1.27.3; then
  echo 'Expected the mismatched embedded Go version to fail' >&2
  exit 1
fi
printf 'Go binary version header fixture passed\n'
