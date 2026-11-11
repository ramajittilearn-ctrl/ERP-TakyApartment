#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 6 ]] || die 'usage: probe-libxml2-public-layout.sh ORIG_TAR PATCH_FILE BUILD_ROOT OUTPUT_DIR EXPECTED_VERSION EXPECTED_ARCHITECTURE'
orig_tar=$(realpath -- "$1")
patch_file=$(realpath -- "$2")
build_root=$(realpath -- "$3")
output_dir=$(realpath -m -- "$4")
expected_version=$5
expected_architecture=$6
[[ -s "$orig_tar" && "$orig_tar" == *.orig.tar.xz ]] || die 'authenticated Debian orig source must be one non-empty .orig.tar.xz archive'
[[ -s "$patch_file" && -d "$build_root" ]] || die 'patch or Debian package build root is missing'
[[ "$expected_version" =~ ^[0-9][A-Za-z0-9.+:~_-]*$ && "$expected_architecture" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die 'expected candidate package version or architecture is malformed'
[[ ! -e "$output_dir" ]] || die 'ABI evidence output already exists'
command -v cc >/dev/null || die 'C compiler is required for ABI layout evidence'
command -v dpkg-deb >/dev/null || die 'dpkg-deb is required to inspect the exact candidate development package'
mkdir -m 0700 -p -- "$output_dir"

readonly work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT
readonly base_root="$work_dir/base"
readonly candidate_root="$work_dir/candidate"
mkdir -p "$base_root" "$candidate_root"

mapfile -t candidate_debs < <(find "$build_root" -maxdepth 1 -type f -name '*.deb' -print0 | while IFS= read -r -d '' deb; do
  [[ "$(dpkg-deb --field "$deb" Package)" == libxml2-dev ]] && printf '%s\n' "$deb"
done)
[[ ${#candidate_debs[@]} -eq 1 ]] || die "expected exactly one built libxml2-dev package, found ${#candidate_debs[@]}"
readonly candidate_deb=${candidate_debs[0]}
readonly candidate_version=$(dpkg-deb --field "$candidate_deb" Version)
readonly candidate_architecture=$(dpkg-deb --field "$candidate_deb" Architecture)
[[ "$candidate_version" == "$expected_version" ]] || die "candidate libxml2-dev version mismatch: expected $expected_version, found $candidate_version"
[[ "$candidate_architecture" == "$expected_architecture" ]] || die "candidate libxml2-dev architecture mismatch: expected $expected_architecture, found $candidate_architecture"

tar -xJf "$orig_tar" --strip-components=1 -C "$base_root"
dpkg-deb -x "$candidate_deb" "$candidate_root"
readonly base_include="$base_root/include"
readonly candidate_include="$candidate_root/usr/include/libxml2"
[[ -s "$base_include/libxml/entities.h" && -s "$base_include/libxml/parser.h" && -s "$base_include/libxml/xmlversion.h" ]] || die 'baseline public headers are incomplete in the authenticated orig archive'
[[ -s "$candidate_include/libxml/entities.h" && -s "$candidate_include/libxml/parser.h" && -s "$candidate_include/libxml/xmlversion.h" ]] || die 'candidate public headers are incomplete in the exact libxml2-dev package'

cat > "$work_dir/abi-probe.c" <<'PROBE'
#include <stddef.h>
#include <stdio.h>
#include <libxml/entities.h>
#include <libxml/parser.h>

#define SIZE_ROW(type_name, type) \
    printf(type_name "\tsizeof\t-\t%zu\n", sizeof(type))
#define OFFSET_ROW(type_name, type, member_name) \
    printf(type_name "\toffsetof\t" #member_name "\t%zu\n", offsetof(type, member_name))

int main(void) {
    puts("type\tmetric\tmember\tvalue");
    SIZE_ROW("xmlEntity", xmlEntity);
    OFFSET_ROW("xmlEntity", xmlEntity, owner);
    OFFSET_ROW("xmlEntity", xmlEntity, checked);
#ifdef ABI_CANDIDATE
    OFFSET_ROW("xmlEntity", xmlEntity, flags);
    OFFSET_ROW("xmlEntity", xmlEntity, expandedSize);
#endif
    SIZE_ROW("xmlParserInput", xmlParserInput);
    OFFSET_ROW("xmlParserInput", xmlParserInput, id);
#ifdef ABI_CANDIDATE
    OFFSET_ROW("xmlParserInput", xmlParserInput, parentConsumed);
    OFFSET_ROW("xmlParserInput", xmlParserInput, entity);
#endif
    return 0;
}
PROBE

readonly probe_sha=$(sha256sum "$work_dir/abi-probe.c" | awk '{print $1}')
readonly orig_sha=$(sha256sum "$orig_tar" | awk '{print $1}')
readonly patch_sha=$(sha256sum "$patch_file" | awk '{print $1}')
readonly candidate_deb_sha=$(sha256sum "$candidate_deb" | awk '{print $1}')
readonly -a flags=(-std=c11 -Wall -Wextra -Werror)
readonly flags_text='-H -std=c11 -Wall -Wextra -Werror'

compile_probe() {
  local label=$1 root=$2 candidate_define=$3
  local define_args=()
  [[ "$candidate_define" == true ]] && define_args=(-DABI_CANDIDATE=1)
  if ! cc -H "${flags[@]}" "${define_args[@]}" -I "$root" "$work_dir/abi-probe.c" -o "$work_dir/$label-probe" \
    2> "$output_dir/$label-compiler-includes.txt"; then
    cat "$output_dir/$label-compiler-includes.txt" >&2
    die "$label ABI probe failed to compile"
  fi
  awk -v root="$root" 'index($0, "/libxml/") { line=$0; sub(/^[.]+ /, "", line); if (index(line, root "/") != 1) exit 1; found++ } END { if (!found) exit 1 }' \
    "$output_dir/$label-compiler-includes.txt" || die "$label compiler included libxml headers from outside its isolated header root"
  "$work_dir/$label-probe" > "$work_dir/$label-layout.tsv"
}

compile_probe base "$base_include" false
compile_probe candidate "$candidate_include" true
{
  printf 'source\t%s\n' "$(basename "$orig_tar")"
  printf 'source_sha256\t%s\npatch_sha256\t%s\ncandidate_libxml2_dev_filename\t%s\ncandidate_libxml2_dev_version\t%s\ncandidate_libxml2_dev_architecture\t%s\ncandidate_libxml2_dev_sha256\t%s\n' \
    "$orig_sha" "$patch_sha" "$(basename "$candidate_deb")" "$candidate_version" "$candidate_architecture" "$candidate_deb_sha"
  printf 'probe_source_sha256\t%s\ncompiler_target\t%s\n' "$probe_sha" "$(cc -dumpmachine)"
  printf 'compiler_version\t%s\n' "$(cc --version | head -n 1)"
  printf 'compiler_flags\t%s\n' "$flags_text"
  printf 'baseline_header_root\tDebian orig archive include/\ncandidate_header_root\tlibxml2-dev package usr/include/libxml2/\n'
} > "$output_dir/abi-provenance.txt"
(
  cd "$base_include"
  find . -type f -name '*.h' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
) > "$output_dir/base-headers.sha256"
(
  cd "$candidate_include"
  find . -type f -name '*.h' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
) > "$output_dir/candidate-headers.sha256"
[[ -s "$output_dir/base-headers.sha256" && -s "$output_dir/candidate-headers.sha256" ]] || die 'header provenance manifests are empty'

{
  printf 'source\ttype\tmetric\tmember\tvalue\n'
  awk -v source=debian_orig 'NR > 1 { print source "\t" $0 }' "$work_dir/base-layout.tsv"
  awk -v source=candidate_dev_package 'NR > 1 { print source "\t" $0 }' "$work_dir/candidate-layout.tsv"
} > "$output_dir/abi-layout.tsv"
if diff -u "$work_dir/base-layout.tsv" "$work_dir/candidate-layout.tsv" > "$output_dir/abi-layout.diff"; then
  printf 'LAYOUT_MATCH\n' > "$output_dir/abi-disposition.txt"
else
  status=$?
  [[ $status -eq 1 ]] || die "layout comparison failed with diff status $status"
  printf 'INCOMPATIBLE_LAYOUT\n' > "$output_dir/abi-disposition.txt"
fi

printf 'Recorded baseline-versus-candidate public struct layout: %s\n' "$(cat "$output_dir/abi-disposition.txt")"
