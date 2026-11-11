#!/usr/bin/env sh
set -eu

usage() {
  echo "Usage: $0 <rclone-source-root> <chi-v5.4.0-module-zip>" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
source_root=$1
chi_archive=$2

chi_version=5.4.0
chi_archive_sha256=9ad4c02fc179b71081c86a7166bc871e0a816d5a803da5053ea9ed4cfd97422f
chi_module_h1='+ufzvFTGKyin26Or5DLrlIDq4ygIDBVcj7oVNeeaYFE='
chi_go_mod_h1='d1IG7GtKPSjPyBP365PH8sAGVHk3qfB/IhjFNRH1wWM='

actual_sha256=$(sha256sum "$chi_archive" | awk '{print $1}')
[ "$actual_sha256" = "$chi_archive_sha256" ] || {
  echo "chi v$chi_version module archive checksum mismatch: $actual_sha256" >&2
  exit 1
}

tmp_root=$(mktemp -d "${TMPDIR:-/tmp}/taky-chi-v${chi_version}.XXXXXX")
trap 'find "$tmp_root" -depth -type f -delete; find "$tmp_root" -depth -type d -empty -delete' EXIT HUP INT TERM
unzip -q "$chi_archive" -d "$tmp_root"
module_root="$tmp_root/github.com/go-chi/chi/v5@v$chi_version"
vendor_root="$source_root/vendor/github.com/go-chi/chi/v5"

[ -f "$module_root/go.mod" ] && [ -d "$vendor_root" ] || {
  echo "chi module or rclone vendor directory is missing" >&2
  exit 1
}
grep -Fxq 'module github.com/go-chi/chi/v5' "$module_root/go.mod" || {
  echo "chi module archive contains an unexpected module path" >&2
  exit 1
}
grep -Fxq 'go 1.24' "$module_root/go.mod" || {
  echo "chi v$chi_version module declares an unexpected Go version" >&2
  exit 1
}

replace_exactly_one() {
  file=$1
  old_line=$2
  new_line=$3
  tmp_file="$tmp_root/$(basename "$file").updated"
  awk -v old_line="$old_line" -v new_line="$new_line" '
    $0 == old_line { $0 = new_line; matches++ }
    { print }
    END { if (matches != 1) exit 1 }
  ' "$file" > "$tmp_file" || {
    echo "Expected exactly one pinned chi metadata line in $file" >&2
    exit 1
  }
  mv "$tmp_file" "$file"
}

old_go_mod_line=$(printf '\tgithub.com/go-chi/chi/v5 v5.3.1')
new_go_mod_line=$(printf '\tgithub.com/go-chi/chi/v5 v5.4.0')
replace_exactly_one "$source_root/go.mod" \
  "$old_go_mod_line" \
  "$new_go_mod_line"
replace_exactly_one "$source_root/go.sum" \
  'github.com/go-chi/chi/v5 v5.3.1 h1:3j4HZLGZQ3JpMCrPJF/Jl3mYJfWLKBfNJ6quurUGCf8=' \
  "github.com/go-chi/chi/v5 v$chi_version h1:$chi_module_h1"
replace_exactly_one "$source_root/go.sum" \
  'github.com/go-chi/chi/v5 v5.3.1/go.mod h1:R+tYY2hNuVUUjxoPtqUdgBqevM9s9njzkTLutVsOCto=' \
  "github.com/go-chi/chi/v5 v$chi_version/go.mod h1:$chi_go_mod_h1"
modules_tmp="$tmp_root/modules.txt.updated"
awk '
  $0 == "# github.com/go-chi/chi/v5 v5.3.1" {
    print "# github.com/go-chi/chi/v5 v5.4.0"
    if (getline <= 0 || $0 != "## explicit; go 1.23") exit 1
    print "## explicit; go 1.24"
    matches++
    next
  }
  { print }
  END { if (matches != 1) exit 1 }
' "$source_root/vendor/modules.txt" > "$modules_tmp" || {
  echo "Expected exactly one chi module entry in vendor/modules.txt" >&2
  exit 1
}
mv "$modules_tmp" "$source_root/vendor/modules.txt"

# Preserve rclone's vendored file set while replacing each vendored source file
# with the byte-identical path from the pinned upstream chi module archive.
find "$vendor_root" -type f | while IFS= read -r old_file; do
  relative_path=${old_file#"$vendor_root"/}
  upstream_file="$module_root/$relative_path"
  [ -f "$upstream_file" ] || {
    echo "chi v$chi_version no longer provides vendored file $relative_path" >&2
    exit 1
  }
  cat "$upstream_file" > "$old_file"
done

grep -Fq "github.com/go-chi/chi/v5 v$chi_version" "$source_root/go.mod" || {
  echo "go.mod did not retain the pinned chi v$chi_version requirement" >&2
  exit 1
}
grep -Fxq "# github.com/go-chi/chi/v5 v$chi_version" "$source_root/vendor/modules.txt" || {
  echo "vendor/modules.txt did not retain the pinned chi v$chi_version requirement" >&2
  exit 1
}
echo "Prepared rclone's vendored chi dependency at v$chi_version (archive SHA-256 $chi_archive_sha256; module h1 $chi_module_h1)."
