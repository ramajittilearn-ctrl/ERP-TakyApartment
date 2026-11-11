#!/usr/bin/env bash
set -Eeuo pipefail

[[ $# == 2 ]] || { echo "Usage: $0 <binary-path> <expected-go-version>" >&2; exit 2; }
binary="$1"
expected_version="$2"
actual="$(go version "$binary")"
[[ "$actual" == "$binary: $expected_version" ]] || {
  echo "Unexpected embedded Go compiler version (expected=$expected_version actual=$actual)" >&2
  exit 1
}
