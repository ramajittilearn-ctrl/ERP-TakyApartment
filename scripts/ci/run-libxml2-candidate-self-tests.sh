#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 2 ]] || die 'usage: run-libxml2-candidate-self-tests.sh TEST_BINARY_DIRECTORY EVIDENCE_DIRECTORY'
readonly test_bin_dir=$(realpath -- "$1")
readonly evidence_dir=$2
[[ -d "$test_bin_dir" ]] || die 'test binary directory is unavailable'
[[ ! -e "$evidence_dir" ]] || die 'self-test evidence directory already exists'
mkdir -m 0750 -- "$evidence_dir"
readonly status_file="$evidence_dir/self-tests.tsv"
: > "$status_file"

run_test() {
  local name=$1
  local summary_pattern=$2
  shift 2
  local log="$evidence_dir/$name.log"
  local status=0
  [[ -x "$test_bin_dir/$1" ]] || die "required libxml2 self-test is missing: $1"
  "$test_bin_dir/$@" > "$log" 2>&1 || status=$?
  cat "$log"
  [[ $status -eq 0 ]] || die "$name exited with status $status"
  grep -Eq "$summary_pattern" "$log" || die "$name did not report its expected successful test summary"
  printf '%s\tPASS\t%s\n' "$name" "$(grep -E "$summary_pattern" "$log" | tail -n 1)" >> "$status_file"
}

run_test testapi '^Total: [0-9]+ functions, [1-9][0-9]* tests, 0 errors$' testapi -q
run_test testchar '^testing char range: 1 2 3 4 done$' testchar
if grep -q 'Failed' "$evidence_dir/testchar.log"; then
  die 'testchar reported a failed character-range or document assertion'
fi
run_test testdict '^dictionary tests succeeded 20000 strings$' testdict
run_test testlimits '^Total [1-9][0-9]* tests, no errors$' testlimits -quiet

printf 'libxml2 candidate fixture-independent self-tests: %s passed\n' "$(wc -l < "$status_file" | tr -d ' ')"
