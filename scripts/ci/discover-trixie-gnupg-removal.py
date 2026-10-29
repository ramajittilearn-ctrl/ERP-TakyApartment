#!/usr/bin/env python3
"""Collect authenticated, non-mutating Trixie GnuPG purge-plan evidence."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import urlsplit
from datetime import datetime, timezone


IMAGE = "postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe"
PLATFORM = "linux/amd64"
EVIDENCE_BASE = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "trixie-gnupg-discovery"
PROTECTED_PREFIXES = (
    "apt", "gpgv", "sqv", "debian-archive-keyring", "debian-keyring", "postgresql",
    "libpq", "libxml2", "libapt-pkg", "gosu", "ca-certificates",
)
ALLOWED_RELEASES = {
    ("trixie", "stable"),
    ("trixie-updates", "stable-updates"),
    ("trixie-security", "stable-security"),
    ("trixie-pgdg", "trixie-pgdg"),
}
EXPECTED_ORIGINS = {
    "trixie": ("deb.debian.org", "/debian"),
    "trixie-updates": ("deb.debian.org", "/debian"),
    "trixie-security": ("deb.debian.org", "/debian-security"),
    "trixie-pgdg": ("apt.postgresql.org", "/pub/repos/apt"),
}

CONTAINER_SCRIPT = r'''#!/bin/bash
set -Eeuo pipefail
evidence=/evidence
write_status() {
  rc=$?
  if (( rc == 0 )); then state=DISCOVERY_COMPLETE; else state=DISCOVERY_FAILED; fi
  printf '{"state":"%s","exitCode":%d}\n' "$state" "$rc" > "$evidence/container-status.json"
  exit "$rc"
}
trap write_status EXIT
mkdir -p "$evidence/apt-sources" "$evidence/apt-lists"
for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [[ -f "$file" ]] || continue
  relative=${file#/etc/apt/}
  mkdir -p "$evidence/apt-sources/$(dirname "$relative")"
  sed -E 's#(https?://)[^/@[:space:]]+@#\1[REDACTED]@#g' "$file" > "$evidence/apt-sources/$relative"
done
 bash -s -- "$evidence/apt-sources" "$evidence/source-trust.tsv" <<'SH'
__SOURCE_SECURITY_COLLECTOR__
SH
: > "$evidence/keyring-sha256.txt"
for keyring_dir in /usr/share/keyrings /etc/apt/trusted.gpg.d; do
  [[ -d "$keyring_dir" ]] || continue
  find "$keyring_dir" -maxdepth 1 -type f \( -name '*.gpg' -o -name '*.asc' -o -name '*.kbx' \) -print0 \
    | LC_ALL=C sort -z | xargs -0 -r sha256sum >> "$evidence/keyring-sha256.txt"
done
if [[ -f /etc/apt/trusted.gpg ]]; then sha256sum /etc/apt/trusted.gpg >> "$evidence/keyring-sha256.txt"; fi
awk -F '\t' 'NF == 5 { printf "%s  %s\n", $2, $1 }' "$evidence/source-trust.tsv" >> "$evidence/keyring-sha256.txt"
LC_ALL=C sort -u -o "$evidence/keyring-sha256.txt" "$evidence/keyring-sha256.txt"
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n' | LC_ALL=C sort > "$evidence/dpkg-before.tsv"
apt-mark showmanual | LC_ALL=C sort > "$evidence/apt-manual-before.txt"
apt-mark showauto | LC_ALL=C sort > "$evidence/apt-auto-before.txt"
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n' gnupg > "$evidence/gnupg-installed.tsv" 2>&1 || true
if ! dpkg-query -W -f='${db:Status-Status}' gnupg 2>/dev/null | grep -qx installed; then
  echo 'gnupg is not installed in the pinned image' >&2
  exit 21
fi
apt-get -o Acquire::AllowInsecureRepositories=false \
  -o Acquire::AllowDowngradeToInsecureRepositories=false \
  -o Acquire::Check-Valid-Until=true \
  -o APT::Get::AllowUnauthenticated=false --error-on=any update > /tmp/apt-update.log 2>&1 || { rc=$?; sed -E 's#(https?://)[^/@[:space:]]+@#\1[REDACTED]@#g' /tmp/apt-update.log > "$evidence/apt-update.log"; exit "$rc"; }
sed -E 's#(https?://)[^/@[:space:]]+@#\1[REDACTED]@#g' /tmp/apt-update.log > "$evidence/apt-update.log"
for verifier in sqv gpgv; do
  if command -v "$verifier" >/dev/null 2>&1; then
    printf '%s\t%s\t' "$verifier" "$(command -v "$verifier")" >> "$evidence/apt-verifiers.tsv"
    "$verifier" --version 2>&1 | head -n 1 >> "$evidence/apt-verifiers.tsv" || true
  fi
done
if [[ ! -s "$evidence/apt-verifiers.tsv" ]]; then
  echo 'No supported APT signature verifier (sqv or gpgv) is installed' >&2
  exit 25
fi
apt-config dump | grep -Ei '^(APT::Key::|Dir[[:space:]]|Dir::Etc([[:space:]]|::Trusted))' > "$evidence/apt-signature-config.txt" || true
apt-config shell TRUSTED Dir::Etc::Trusted/f TRUSTED_PARTS Dir::Etc::TrustedParts/d > "$evidence/apt-trusted-paths.shell"
apt-get --version > "$evidence/apt-version.txt"
mkdir -p "$evidence/isolated-releases"
select_suite_source() {
  local wanted=$1 destination=$2 source_file relative fragment found=0
  : > "$destination"
  for source_file in "$evidence/apt-sources/sources.list" "$evidence"/apt-sources/sources.list.d/*.list "$evidence"/apt-sources/sources.list.d/*.sources; do
    [[ -f "$source_file" ]] || continue
    relative=${source_file#"$evidence/apt-sources/"}
    fragment="$destination.fragment"
    : > "$fragment"
    if [[ "$source_file" == *.sources ]]; then
      awk -v wanted="$wanted" '
        BEGIN { RS=""; ORS="\n" }
        {
          n=split($0, lines, "\n"); types=""; suites=""; active=1
          for (i=1; i<=n; i++) {
            if (tolower(lines[i]) ~ /^[[:space:]]*enabled:[[:space:]]*no[[:space:]]*$/) active=0
            if (tolower(lines[i]) ~ /^types:[[:space:]]*/) types=tolower(lines[i])
            if (tolower(lines[i]) ~ /^suites:[[:space:]]*/) suites=tolower(lines[i])
          }
          found=0; m=split(suites, values, /[[:space:]]+/)
          for (i=1; i<=m; i++) if (values[i] == tolower(wanted)) found=1
          if (active && types ~ /(^|[[:space:]])deb([[:space:]]|$)/ && found) {
            hits++
            if (hits > 1) exit 3
            for (i=1; i<=n; i++) {
              if (tolower(lines[i]) ~ /^types:[[:space:]]*/) print "Types: deb"
              else if (tolower(lines[i]) ~ /^suites:[[:space:]]*/) print "Suites: " wanted
              else print lines[i]
            }
            print ""
          }
        }
        END { if (hits > 1) exit 3 }
      ' "$source_file" > "$fragment"
    else
      awk -v wanted="$wanted" '
        {
          raw=$0; line=$0; sub(/^[[:space:]]+/, "", line)
          if (line == "" || line ~ /^#/ || tolower(line) !~ /^deb[[:space:]]/) next
          sub(/^[Dd][Ee][Bb][[:space:]]+/, "", line)
          if (substr(line, 1, 1) == "[") {
            close_bracket=index(line, "]")
            if (!close_bracket) exit 4
            line=substr(line, close_bracket + 1)
            sub(/^[[:space:]]+/, "", line)
          }
          n=split(line, fields, /[[:space:]]+/)
          if (n < 2) exit 5
          if (fields[2] == wanted) { hits++; if (hits > 1) exit 3; print raw }
        }
        END { if (hits > 1) exit 3 }
      ' "$source_file" > "$fragment"
    fi
    if [[ -s "$fragment" ]]; then
      found=$((found + 1))
      if (( found > 1 )); then echo "multiple configured APT source stanzas match $wanted" >&2; exit 41; fi
      cat "$fragment" > "$destination"
      printf '%s\n' "$relative" > "$destination.origin"
    fi
  done
  rm -f "$destination.fragment"
  [[ $found == 1 ]] || { echo "no configured APT source stanza matches $wanted" >&2; exit 42; }
}

for codename in trixie trixie-updates trixie-security trixie-pgdg; do
  suite_dir="$evidence/isolated-releases/$codename"
  mkdir "$suite_dir"
  lists="/var/lib/apt/phase4-isolated/$codename/lists"
  if [[ -e "$lists" ]]; then
    echo "isolated APT lists path is not fresh for $codename" >&2
    exit 46
  fi
  mkdir -p "$lists/partial"
  selected_source="$suite_dir/source.selected"
  select_suite_source "$codename" "$selected_source"
  source_relative=$(cat "$selected_source.origin")
  if [[ "$source_relative" == *.sources ]]; then source_file="$suite_dir/source.sources"; else source_file="$suite_dir/source.list"; fi
  mv "$selected_source" "$source_file"
  printf '%s\n' "$source_relative" > "$suite_dir/original-source-relative.txt"
  printf '%s\n' "$codename" > "$suite_dir/configured-dist.txt"
  printf '%s\n' "$source_file" > "$suite_dir/source-path.txt"
  printf '%s\n' "$lists" > "$suite_dir/lists-path.txt"
  if ! apt-get -o Dir::Etc::sourcelist="$source_file" -o Dir::Etc::sourceparts=- \
    -o Dir::State::lists="$lists" -o Dir::Cache::pkgcache="$suite_dir/pkgcache.bin" \
    -o Dir::Cache::srcpkgcache="$suite_dir/srcpkgcache.bin" \
    -o Acquire::AllowInsecureRepositories=false -o Acquire::AllowDowngradeToInsecureRepositories=false \
    -o Acquire::Check-Valid-Until=true -o APT::Get::AllowUnauthenticated=false --error-on=any update \
    > "$suite_dir/apt-update.raw" 2>&1; then
    sed -E 's#(https?://)[^/@[:space:]]+@#\1[REDACTED]@#g' "$suite_dir/apt-update.raw" > "$suite_dir/apt-update.log"
    rm "$suite_dir/apt-update.raw"
    echo "isolated APT update failed for $codename" >&2
    exit 44
  fi
  sed -E 's#(https?://)[^/@[:space:]]+@#\1[REDACTED]@#g' "$suite_dir/apt-update.raw" > "$suite_dir/apt-update.log"
  rm "$suite_dir/apt-update.raw"
  apt-get -o Dir::Etc::sourcelist="$source_file" -o Dir::Etc::sourceparts=- \
    -o Dir::State::lists="$lists" -o Dir::Cache::pkgcache="$suite_dir/pkgcache.bin" \
    -o Dir::Cache::srcpkgcache="$suite_dir/srcpkgcache.bin" \
    indextargets --format '$(IDENTIFIER)|$(CODENAME)|$(SUITE)|$(ARCHITECTURE)|$(FILENAME)|$(URI)|$(BASE_URI)|$(METAKEY)|$(COMPONENT)' \
    > "$suite_dir/apt-index-targets.tsv"
  mapfile -t inrelease_candidates < <(find "$lists" -maxdepth 1 -type f -name '*InRelease' -print | LC_ALL=C sort)
  if [[ ${#inrelease_candidates[@]} -ne 1 ]]; then
    echo "isolated APT run for $codename produced ${#inrelease_candidates[@]} InRelease candidates" >&2
    exit 43
  fi
  printf '%s\n' "${inrelease_candidates[0]}" > "$suite_dir/exact-inrelease-path.txt"
  original_sha256=$(sha256sum "${inrelease_candidates[0]}" | awk '{print $1}')
  original_size=$(stat -c '%s' "${inrelease_candidates[0]}")
  cp "${inrelease_candidates[0]}" "$suite_dir/InRelease"
  copied_sha256=$(sha256sum "$suite_dir/InRelease" | awk '{print $1}')
  copied_size=$(stat -c '%s' "$suite_dir/InRelease")
  if [[ "$original_sha256" != "$copied_sha256" || "$original_size" != "$copied_size" ]]; then
    echo "copied isolated InRelease differs from its exact APT file for $codename" >&2
    exit 45
  fi
  printf '%s\t%s\n' "$original_sha256" "$original_size" > "$suite_dir/exact-inrelease-digest.tsv"
done
apt-get indextargets --format '$(IDENTIFIER)|$(CODENAME)|$(SUITE)|$(ARCHITECTURE)|$(FILENAME)|$(URI)|$(BASE_URI)|$(METAKEY)|$(COMPONENT)' > "$evidence/apt-index-targets.raw"
if [[ ! -s "$evidence/apt-index-targets.raw" ]]; then
  echo 'APT reported no authenticated index targets' >&2
  exit 22
fi
sed -E 's#(https?://)[^/@[:space:]]+@#\1[REDACTED]@#g' "$evidence/apt-index-targets.raw" > "$evidence/apt-index-targets.tsv"
rm "$evidence/apt-index-targets.raw"
find /var/lib/apt/lists -maxdepth 1 -type f \( -name '*InRelease' -o -name '*_Packages' -o -name '*_Packages.*' \) -print0 \
  | LC_ALL=C sort -z | while IFS= read -r -d '' file; do cp "$file" "$evidence/apt-lists/$(basename "$file")"; done
find "$evidence/apt-lists" -maxdepth 1 -type f -print | LC_ALL=C sort > "$evidence/apt-index-files.txt"
if ! grep -q 'InRelease$' "$evidence/apt-index-files.txt" || ! grep -q 'Packages' "$evidence/apt-index-files.txt"; then
  echo 'Combined update did not capture authenticated InRelease and Packages metadata' >&2
  exit 24
fi
apt-get --simulate purge --auto-remove gnupg > "$evidence/gnupg-purge-simulation.txt" 2>&1
'''

SOURCE_SECURITY_COLLECTOR = r'''set -Eeuo pipefail
root=$1
output=$2
shopt -s nocasematch
: > "$output"
hash_keyring() {
  local keyring=$1 source_file=$2 size digest captured
  [[ "$keyring" == /* ]] || { echo "APT Signed-By path is not absolute: $keyring" >&2; exit 31; }
  [[ -f "$keyring" ]] || { echo "APT Signed-By keyring is missing: $keyring" >&2; exit 32; }
  if command -v sha256sum >/dev/null 2>&1; then digest=$(sha256sum "$keyring" | awk '{print $1}'); else digest=$(shasum -a 256 "$keyring" | awk '{print $1}'); fi
  size=$(wc -c < "$keyring" | tr -d '[:space:]')
  captured="apt-keyrings/$digest"
  mkdir -p "${output%/*}/apt-keyrings"
  if [[ -e "${output%/*}/$captured" ]]; then
    [[ "$(sha256sum "${output%/*}/$captured" | awk '{print $1}')" == "$digest" ]] || { echo "Captured keyring digest collision: $captured" >&2; exit 36; }
  else
    cp "$keyring" "${output%/*}/$captured"
  fi
  if ! awk -F '\t' -v key="$keyring" -v source="$source_file" '$1 == key && $4 == source { found=1 } END { exit !found }' "$output"; then
    printf '%s\t%s\t%s\t%s\t%s\n' "$keyring" "$digest" "$size" "$source_file" "$captured" >> "$output"
  fi
}
check_bypass() {
  local source_text=$1 lower
  lower=$(printf '%s' "$source_text" | tr '[:upper:]' '[:lower:]' | tr '\n' ' ' | tr '[]' '  ')
  for pattern in \
    '(^|[[:space:],])trusted[[:space:]]*=[[:space:]]*yes([[:space:],]|$)' \
    '(^|[[:space:],])allow-insecure[[:space:]]*=[[:space:]]*yes([[:space:],]|$)' \
    '(^|[[:space:],])allow-weak[[:space:]]*=[[:space:]]*yes([[:space:],]|$)' \
    '(^|[[:space:],])allow-downgrade-to-insecure[[:space:]]*=[[:space:]]*yes([[:space:],]|$)' \
    '(^|[[:space:],])check-valid-until[[:space:]]*=[[:space:]]*no([[:space:],]|$)' \
    '(^|[[:space:]])trusted:[[:space:]]*yes([[:space:]]|$)' \
    '(^|[[:space:]])allow-insecure:[[:space:]]*yes([[:space:]]|$)' \
    '(^|[[:space:]])allow-weak:[[:space:]]*yes([[:space:]]|$)' \
    '(^|[[:space:]])allow-downgrade-to-insecure:[[:space:]]*yes([[:space:]]|$)' \
    '(^|[[:space:]])check-valid-until:[[:space:]]*no([[:space:]]|$)'; do
    if [[ "$lower" =~ $pattern ]]; then
      echo "APT source trust/freshness bypass is enabled: $pattern" >&2
      exit 33
    fi
  done
}
for source in "$root/sources.list" "$root"/sources.list.d/*.list; do
  [[ -f "$source" ]] || continue
  while IFS= read -r line; do
    [[ -n "${line//[[:space:]]/}" && ! "${line#${line%%[![:space:]]*}}" == \#* ]] || continue
    check_bypass "$line"
    lower_line=$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')
    options=${line#*\[}; options=${options%%\]*}
    lower_options=$(printf '%s' "$options" | tr '[:upper:]' '[:lower:]')
    if [[ "$lower_line" == *apt.postgresql.org* && "$lower_options" != *signed-by=* ]]; then
      echo "PGDG APT source has no explicit Signed-By keyring: $source" >&2
      exit 34
    fi
    if [[ "$lower_options" == *signed-by=* ]]; then
      signed_value=$(printf '%s\n' "$options" | sed -En 's/.*[Ss][Ii][Gg][Nn][Ee][Dd]-[Bb][Yy][[:space:]]*=[[:space:]]*([^]]*).*/\1/p' | tr ',' ' ')
      found_path=0
      for token in $signed_value; do
        token=${token%\"}; token=${token#\"}; token=${token%\'}; token=${token#\'}
        if [[ "$token" == /* ]]; then hash_keyring "$token" "${source#"$root"/}"; found_path=1; fi
      done
      [[ $found_path == 1 ]] || { echo "APT Signed-By option has no absolute keyring path: $source" >&2; exit 35; }
    fi
  done < <(sed -E 's/[[:space:]]+#.*$//' "$source")
done
for source in "$root"/sources.list.d/*.sources; do
  [[ -f "$source" ]] || continue
  while IFS= read -r -d $'\034' paragraph; do
    [[ -n "${paragraph//[[:space:]]/}" ]] || continue
    lower=$(printf '%s' "$paragraph" | tr '[:upper:]' '[:lower:]' | tr '\n' ' ')
    [[ "$lower" =~ (^|[[:space:]])enabled:[[:space:]]*no([[:space:]]|$) ]] && continue
    check_bypass "$paragraph"
    signed_value=""
    collecting=0
    while IFS= read -r line; do
      if [[ "$line" =~ ^signed-by:[[:space:]]*(.*)$ ]]; then
        signed_value=${BASH_REMATCH[1]}
        collecting=1
      elif [[ $collecting == 1 && "$line" == [[:space:]]* ]]; then
        signed_value+=" $line"
      else
        collecting=0
      fi
    done <<< "$paragraph"
    if [[ "$lower" == *apt.postgresql.org* && -z "$signed_value" ]]; then
      echo "PGDG APT source has no explicit Signed-By keyring: $source" >&2
      exit 34
    fi
    if [[ -n "$signed_value" && "$signed_value" != *"BEGIN PGP PUBLIC KEY BLOCK"* ]]; then
      found_path=0
      for token in ${signed_value//,/ }; do
        token=${token%\"}; token=${token#\"}; token=${token%\'}; token=${token#\'}
        if [[ "$token" == /* ]]; then hash_keyring "$token" "${source#"$root"/}"; found_path=1; fi
      done
      [[ $found_path == 1 ]] || { echo "APT Signed-By field has no absolute keyring path or inline key: $source" >&2; exit 35; }
    fi
  done < <(awk 'BEGIN { RS="" } { lower=tolower($0); if (lower !~ /(^|\n)[ \t]*enabled:[ \t]*no([ \t]|\n|$)/) printf "%s\034", $0 }' "$source")
done
printf 'APT source trust policy: PASS\n' >> "$output"
'''

CONTAINER_SCRIPT = CONTAINER_SCRIPT.replace("__SOURCE_SECURITY_COLLECTOR__", SOURCE_SECURITY_COLLECTOR)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=check, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def parse_inventory(path: Path) -> dict[tuple[str, str], str]:
    result: dict[tuple[str, str], str] = {}
    for line in path.read_text().splitlines():
        fields = line.split("\t")
        if len(fields) != 4 or fields[3] != "installed":
            continue
        name, version, architecture, _ = fields
        result[(name, architecture)] = version
    return result


def cleartext_release_body(raw: bytes) -> str:
    lines = raw.decode("utf-8").splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines or lines[0] != "-----BEGIN PGP SIGNED MESSAGE-----":
        raise ValueError("malformed InRelease clear-sign armor")
    try:
        separator = lines.index("")
    except ValueError as error:
        raise ValueError("InRelease clear-sign headers are not terminated") from error
    if separator < 2 or not any(line.startswith("Hash: ") for line in lines[1:separator]):
        raise ValueError("InRelease clear-sign headers are incomplete")
    signature_starts = [i for i, line in enumerate(lines) if line == "-----BEGIN PGP SIGNATURE-----"]
    signature_ends = [i for i, line in enumerate(lines) if line == "-----END PGP SIGNATURE-----"]
    if len(signature_starts) != 1 or len(signature_ends) != 1 or signature_ends[0] != len(lines) - 1:
        raise ValueError("InRelease has duplicate, incomplete, or trailing signature framing")
    signature_start = signature_starts[0]
    if signature_start <= separator or signature_ends[0] <= signature_start + 1:
        raise ValueError("InRelease signature framing is malformed")
    body = lines[separator + 1 : signature_start]
    return "\n".join(line[2:] if line.startswith("- ") else line for line in body) + "\n"


def parse_release_sha256(raw: bytes) -> dict[str, tuple[str, int]]:
    lines = cleartext_release_body(raw).splitlines()
    found = False
    in_sha256 = False
    records: dict[str, tuple[str, int]] = {}
    for line in lines:
        if line == "SHA256:":
            if found:
                raise ValueError("InRelease contains duplicate SHA256 sections")
            found = True
            in_sha256 = True
            continue
        if in_sha256 and line and not line[0].isspace():
            in_sha256 = False
        if in_sha256:
            match = re.fullmatch(r"\s+([0-9a-fA-F]{64})\s+([0-9]+)\s+([^\s]+)\s*", line)
            if not match:
                raise ValueError("InRelease SHA256 row is malformed")
            digest, size, filename = match.groups()
            if filename in records:
                raise ValueError(f"InRelease contains duplicate SHA256 path {filename}")
            records[filename] = (digest.lower(), int(size))
    if not found or not records:
        raise ValueError("InRelease has no usable SHA256 index records")
    return records


def parse_release_identity(raw: bytes) -> tuple[str, str]:
    values: dict[str, str] = {}
    for line in cleartext_release_body(raw).splitlines():
        for field in ("Codename", "Suite"):
            prefix = field + ": "
            if line.startswith(prefix):
                if field in values:
                    raise ValueError(f"InRelease contains duplicate {field} fields")
                values[field] = line[len(prefix) :]
    if "Codename" not in values or "Suite" not in values:
        raise ValueError("InRelease is missing Codename or Suite identity")
    return values["Codename"], values["Suite"]


def validate_index_targets(
    path: Path,
    metadata_directory: Path,
    acquisitions: list[dict[str, object]],
) -> list[dict[str, str]]:
    rows = [line.split("|") for line in path.read_text().splitlines() if line]
    if not rows:
        raise ValueError("APT reported no authenticated index targets")
    observed_codenames: set[str] = set()
    targets: list[dict[str, str]] = []
    for row in rows:
        if len(row) != 9:
            raise ValueError("APT index-target output has unexpected framing")
        identifier, codename, suite, architecture, filename, uri, base_uri, meta_key, component = row
        if (codename, suite) not in ALLOWED_RELEASES:
            raise ValueError(f"APT target is outside the approved Trixie suites: {suite!r}/{codename!r}")
        observed_codenames.add(codename)
        parsed_uri = urlsplit(uri)
        parsed_base = urlsplit(base_uri)
        if parsed_uri.scheme not in {"https", "http"} or not parsed_uri.hostname or parsed_uri.username or parsed_uri.password:
            raise ValueError("APT target URI is malformed or contains credentials")
        if parsed_base.username or parsed_base.password or not parsed_base.hostname:
            raise ValueError("APT base URI is malformed or contains credentials")
        if parsed_uri.port not in ({None, 80} if parsed_uri.scheme == "http" else {None, 443}):
            raise ValueError("APT target URI uses a non-default port")
        if parsed_base.port not in ({None, 80} if parsed_base.scheme == "http" else {None, 443}):
            raise ValueError("APT base URI uses a non-default port")
        validate_expected_origin(codename, base_uri)
        if parsed_uri.scheme != parsed_base.scheme or parsed_uri.netloc != parsed_base.netloc:
            raise ValueError("APT target URI authority differs from its configured base URI")
        if parsed_uri.query or parsed_uri.fragment or parsed_base.query or parsed_base.fragment:
            raise ValueError("APT target URI contains query or fragment data")
        if not filename.startswith("/var/lib/apt/lists/"):
            raise ValueError("APT target has an unexpected local path")
        if not (metadata_directory / Path(filename).name).is_file():
            raise ValueError(f"APT target index was not preserved: {filename}")
        acquisition_matches = [
            item for item in acquisitions
            if item["codename"] == codename and item["suite"] == suite and item["baseUri"] == base_uri
        ]
        if len(acquisition_matches) != 1:
            raise ValueError(f"APT target does not bind to exactly one isolated source-root acquisition: {codename}/{suite}")
        release_file = str(acquisition_matches[0]["inReleaseFile"])
        targets.append({
            "identifier": identifier, "codename": codename, "suite": suite,
            "architecture": architecture, "filename": filename, "uri": uri,
            "baseUri": base_uri, "metaKey": meta_key, "releaseFile": release_file,
            "component": component,
        })
    required_codenames = {codename for codename, _ in ALLOWED_RELEASES}
    missing_codenames = required_codenames - observed_codenames
    if missing_codenames:
        raise ValueError(f"APT did not provide all required Trixie codenames: {', '.join(sorted(missing_codenames))}")
    return targets


def validate_expected_origin(codename: str, base_uri: str) -> None:
    expected = EXPECTED_ORIGINS.get(codename)
    parsed = urlsplit(base_uri)
    expected_path = f"{expected[1]}/dists/{codename}" if expected else None
    if expected is None or parsed.scheme not in {"http", "https"} or parsed.hostname != expected[0] or parsed.path.rstrip("/") != expected_path:
        raise ValueError(f"APT base URI is not the approved suite-scoped origin for {codename}: {base_uri!r}")


def parse_configured_source_stanzas(text: str, suffix: str) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    if suffix == ".sources":
        for paragraph in re.split(r"\n\s*\n", text):
            fields: dict[str, list[str]] = {}
            current = None
            for line in paragraph.splitlines():
                if not line or line.lstrip().startswith("#"):
                    continue
                if line[0].isspace() and current:
                    fields[current][-1] += " " + line.strip()
                    continue
                if ":" not in line:
                    raise ValueError("isolated APT Deb822 source has malformed field framing")
                key, value = line.split(":", 1)
                current = key.lower()
                fields.setdefault(current, []).append(value.strip())
            if fields.get("enabled", ["yes"])[-1].lower() == "no":
                continue
            if "deb" not in " ".join(fields.get("types", [])).split():
                continue
            if len(fields.get("uris", [])) != 1 or len(fields.get("suites", [])) != 1:
                raise ValueError("isolated APT Deb822 stanza must have one URIs and Suites field")
            signed = " ".join(fields.get("signed-by", []))
            key_paths = signed.split()
            if not key_paths or any(not key.startswith("/") for key in key_paths):
                raise ValueError("isolated APT source uses unsupported Signed-By syntax")
            entries.append({
                "uri": fields["uris"][0].split(),
                "suites": fields["suites"][0].split(),
                "keyPaths": key_paths,
            })
    elif suffix == ".list":
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            match = re.fullmatch(r"deb\s+(?:\[([^]]+)\]\s+)?(\S+)\s+(\S+)\s+(.+)", stripped)
            if not match:
                if re.match(r"(?i)^deb(?:-src)?\s", stripped):
                    raise ValueError("isolated APT one-line source syntax is unsupported")
                continue
            options, uri, suite, _components = match.groups()
            signed = re.search(r"(?i)(?:^|[\s,])signed-by\s*=\s*([^\s,]+)", options or "")
            key_paths = signed.group(1).split(",") if signed else []
            if not key_paths or any(not key.startswith("/") for key in key_paths):
                raise ValueError("isolated APT source uses unsupported Signed-By syntax")
            entries.append({"uri": [uri], "suites": [suite], "keyPaths": key_paths})
    else:
        raise ValueError(f"unsupported isolated APT source suffix: {suffix}")
    return entries


def read_source_trust_bindings(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    bindings: dict[tuple[str, str], dict[str, str]] = {}
    for line in path.read_text().splitlines():
        if line == "APT source trust policy: PASS":
            continue
        fields = line.split("\t")
        if len(fields) != 5:
            raise ValueError("source-trust.tsv has malformed keyring binding rows")
        key_path, digest, _size, source_relative, captured = fields
        bindings[(source_relative, key_path)] = {"sha256": digest, "capturedFile": captured}
    return bindings


def collect_isolated_release_acquisitions(
    evidence_dir: Path,
    run_manifest: dict[str, object],
) -> list[dict[str, object]]:
    apt_version = (evidence_dir / "apt-version.txt").read_text().splitlines()[0].strip()
    source_bindings = read_source_trust_bindings(evidence_dir / "source-trust.tsv")
    acquisitions: list[dict[str, object]] = []
    expected = {
        "trixie": "stable",
        "trixie-updates": "stable-updates",
        "trixie-security": "stable-security",
        "trixie-pgdg": "trixie-pgdg",
    }
    for codename, expected_suite in expected.items():
        directory = evidence_dir / "isolated-releases" / codename
        source_relative = (directory / "original-source-relative.txt").read_text().strip()
        source_relative = Path(source_relative).as_posix()
        source_config = evidence_dir / "apt-sources" / source_relative
        isolated_source = next(path for path in (directory / "source.list", directory / "source.sources") if path.is_file())
        source_entries = parse_configured_source_stanzas(source_config.read_text(errors="replace"), source_config.suffix)
        isolated_entries = parse_configured_source_stanzas(isolated_source.read_text(errors="replace"), isolated_source.suffix)
        matching = [entry for entry in source_entries if codename in entry["suites"]]
        if len(matching) != 1 or len(isolated_entries) != 1:
            raise ValueError(f"isolated APT source does not identify exactly one original stanza for {codename}")
        original = matching[0]
        isolated = isolated_entries[0]
        if isolated["suites"] != [codename] or isolated["uri"] != original["uri"] or isolated["keyPaths"] != original["keyPaths"]:
            raise ValueError(f"isolated APT source changed URI, Dist, or Signed-By for {codename}")
        if len(isolated["uri"]) != 1:
            raise ValueError(f"isolated APT source must have one URI for {codename}")
        keyrings = []
        for key_path in isolated["keyPaths"]:
            binding = source_bindings.get((source_relative, key_path))
            if not binding:
                raise ValueError(f"isolated APT source keyring is not bound in source-trust evidence: {key_path}")
            keyrings.append({"path": key_path, **binding})

        target_path = directory / "apt-index-targets.tsv"
        target_rows = [line.split("|") for line in target_path.read_text().splitlines() if line]
        if not target_rows or any(len(row) != 9 for row in target_rows):
            raise ValueError(f"isolated APT target evidence has invalid framing for {codename}")
        base_uris = set()
        for row in target_rows:
            if row[1] != codename or row[2] != expected_suite:
                raise ValueError(f"isolated APT run returned a mismatched Dist or suite for {codename}")
            target_uri = urlsplit(row[5])
            if (
                target_uri.scheme not in {"http", "https"}
                or target_uri.hostname != EXPECTED_ORIGINS[codename][0]
                or target_uri.username or target_uri.password or target_uri.query or target_uri.fragment
                or target_uri.port not in ({None, 80} if target_uri.scheme == "http" else {None, 443})
                or not target_uri.path.startswith(EXPECTED_ORIGINS[codename][1] + f"/dists/{codename}/")
            ):
                raise ValueError(f"isolated APT target URI differs from its approved source root for {codename}")
            base_uris.add(row[6])
        if len(base_uris) != 1:
            raise ValueError(f"isolated APT run has multiple BASE_URI values for {codename}")
        base_uri = base_uris.pop()
        validate_expected_origin(codename, base_uri)
        source_uri = isolated["uri"][0].rstrip("/")
        source_parsed = urlsplit(source_uri)
        if (
            source_parsed.scheme not in {"http", "https"}
            or source_parsed.hostname != EXPECTED_ORIGINS[codename][0]
            or source_parsed.path.rstrip("/") != EXPECTED_ORIGINS[codename][1]
            or source_parsed.username or source_parsed.password or source_parsed.query or source_parsed.fragment
            or source_parsed.port not in ({None, 80} if source_parsed.scheme == "http" else {None, 443})
        ):
            raise ValueError(f"isolated source URI has an unsafe or unapproved origin for {codename}")
        base_parsed = urlsplit(base_uri)
        if (
            base_parsed.scheme != source_parsed.scheme
            or base_parsed.hostname != source_parsed.hostname
            or base_parsed.username or base_parsed.password or base_parsed.query or base_parsed.fragment
            or base_parsed.port not in ({None, 80} if base_parsed.scheme == "http" else {None, 443})
        ):
            raise ValueError(f"isolated BASE_URI authority differs from configured source for {codename}")
        expected_source_uri = base_uri.split(f"/dists/{codename}/", 1)[0]
        if source_uri != expected_source_uri:
            raise ValueError(f"isolated APT target root does not match configured source URI for {codename}")

        exact_path = (directory / "exact-inrelease-path.txt").read_text().strip()
        lists_root = (directory / "lists-path.txt").read_text().strip().rstrip("/")
        exact_pure_path = PurePosixPath(exact_path)
        if (
            exact_pure_path.parent.as_posix() != lists_root
            or ".." in exact_pure_path.parts
            or not exact_pure_path.name.endswith("InRelease")
        ):
            raise ValueError(f"isolated APT InRelease path is outside its dedicated lists directory for {codename}")
        inrelease_file = directory / "InRelease"
        digest_record = (directory / "exact-inrelease-digest.tsv").read_text().strip().split("\t")
        if digest_record != [sha256(inrelease_file), str(inrelease_file.stat().st_size)]:
            raise ValueError(f"isolated APT InRelease copy differs from exact-path digest for {codename}")
        release_codename, release_suite = parse_release_identity(inrelease_file.read_bytes())
        if (release_codename, release_suite) != (codename, expected_suite):
            raise ValueError(f"isolated APT InRelease identity differs from configured Dist for {codename}")

        acquisitions.append({
            "codename": codename,
            "configuredDist": codename,
            "suite": expected_suite,
            "signedCodename": release_codename,
            "signedSuite": release_suite,
            "sourceUri": source_uri,
            "baseUri": base_uri,
            "aptVersion": apt_version,
            "runId": run_manifest["runId"],
            "runAttempt": run_manifest["runAttempt"],
            "revision": run_manifest["revision"],
            "tree": run_manifest["tree"],
            "image": run_manifest["image"],
            "imageId": run_manifest["imageId"],
            "platform": run_manifest["platform"],
            "sourceConfigFile": f"apt-sources/{source_relative}",
            "sourceConfigSha256": sha256(source_config),
            "isolatedSourceFile": isolated_source.relative_to(evidence_dir).as_posix(),
            "isolatedSourceSha256": sha256(isolated_source),
            "aptTargetEvidenceFile": target_path.relative_to(evidence_dir).as_posix(),
            "aptTargetEvidenceSha256": sha256(target_path),
            "sourceKeyrings": keyrings,
            "exactInReleasePath": exact_path,
            "inReleaseFile": inrelease_file.relative_to(evidence_dir).as_posix(),
            "inReleaseSha256": sha256(inrelease_file),
            "inReleaseSizeBytes": inrelease_file.stat().st_size,
        })

    combined_candidates: list[tuple[Path, str, str]] = []
    for combined_file in sorted((evidence_dir / "apt-lists").glob("*InRelease")):
        candidate_codename, candidate_suite = parse_release_identity(combined_file.read_bytes())
        combined_candidates.append((combined_file, candidate_codename, candidate_suite))
    for acquisition in acquisitions:
        matches = [
            path for path, codename, suite in combined_candidates
            if (codename, suite) == (acquisition["codename"], acquisition["suite"])
        ]
        if not matches:
            raise ValueError(f"combined APT update has no InRelease for {acquisition['codename']}")
        if len(matches) != 1:
            raise ValueError(f"combined APT update has ambiguous InRelease candidates for {acquisition['codename']}")
        combined_file = matches[0]
        isolated_file = evidence_dir / str(acquisition["inReleaseFile"])
        if combined_file.read_bytes() != isolated_file.read_bytes():
            raise ValueError(f"combined and isolated InRelease snapshots differ for {acquisition['codename']}")
        acquisition["combinedInReleaseFile"] = combined_file.relative_to(evidence_dir).as_posix()
        acquisition["combinedInReleaseSha256"] = sha256(combined_file)
        acquisition["combinedInReleaseSizeBytes"] = combined_file.stat().st_size
    return acquisitions


def normalize_apt_trusted_paths(shell_path: Path, paths_path: Path) -> None:
    values: dict[str, str] = {}
    for line in shell_path.read_text().splitlines():
        match = re.fullmatch(r"([A-Z_]+)='([^']*)';?", line)
        if not match:
            raise ValueError("apt-config shell trusted-path evidence has unexpected framing")
        name, value = match.groups()
        if name in values:
            raise ValueError("apt-config shell trusted-path evidence contains duplicate variables")
        values[name] = value
    if "TRUSTED" in values:
        raise ValueError("APT 3 must leave Dir::Etc::Trusted unset; explicit values are not accepted")
    # APT 3 deliberately leaves Dir::Etc::Trusted unset; do not restore the
    # legacy /etc/apt/trusted.gpg fallback as a trusted keyring.
    trusted = "<unset>"
    trusted_parts = values.get("TRUSTED_PARTS")
    if trusted_parts is None:
        raise ValueError("apt-config did not resolve Dir::Etc::TrustedParts")
    trusted_parts = str(Path(trusted_parts))
    paths_path.write_text(f"trusted\t{trusted}\ntrustedParts\t{trusted_parts}\n")


def validate_apt_trusted_paths(paths_path: Path) -> None:
    values: dict[str, str] = {}
    for line in paths_path.read_text().splitlines():
        fields = line.split("\t")
        if len(fields) != 2:
            raise ValueError("APT effective trusted-path evidence has unexpected framing")
        value = fields[1]
        if fields[0].lower() == "trustedparts":
            value = str(Path(value))
        values[fields[0].lower()] = value
    if values != {"trusted": "<unset>", "trustedparts": "/etc/apt/trusted.gpg.d"}:
        raise ValueError("APT effective global trusted-keyring paths differ from the captured standard defaults")


def signed_package_index_evidence(
    targets: list[dict[str, str]],
    metadata_directory: Path,
    evidence_directory: Path | None = None,
) -> list[dict[str, object]]:
    releases: dict[str, tuple[str, dict[str, tuple[str, int]]]] = {}
    evidence: list[dict[str, object]] = []
    for target in targets:
        if "Packages" not in target["identifier"]:
            continue
        release_name = target["releaseFile"]
        release_path = (evidence_directory / release_name) if evidence_directory else metadata_directory / Path(release_name).name
        if release_name not in releases:
            releases[release_name] = (sha256(release_path), parse_release_sha256(release_path.read_bytes()))
        release_sha, signed_rows = releases[release_name]
        release_codename, release_suite = parse_release_identity(release_path.read_bytes())
        if (release_codename, release_suite) != (target["codename"], target["suite"]):
            raise ValueError("APT index-target identity differs from its signed InRelease identity")
        base = urlsplit(target["baseUri"])
        index_uri = urlsplit(target["uri"])
        validate_expected_origin(target["codename"], target["baseUri"])
        prefix = base.path.rstrip("/") + "/"
        if not index_uri.path.startswith(prefix):
            raise ValueError(f"APT package URI is outside its codename Release path: {target['uri']}")
        upstream_path = index_uri.path[len(prefix) :]
        package_prefix = f"{target['component']}/binary-{target['architecture']}/"
        if not upstream_path.startswith(package_prefix):
            raise ValueError("APT package URI does not match its component and architecture")
        meta_key = target["metaKey"]
        if meta_key and upstream_path != meta_key and not upstream_path.startswith(meta_key + "."):
            raise ValueError(f"APT MetaKey does not bind to package URI: {target['metaKey']!r}")
        if not re.fullmatch(r".+/Packages(?:\.(?:gz|xz|bz2|lz4|zst))?", upstream_path):
            raise ValueError(f"APT URI is not a supported Packages index: {upstream_path}")
        canonical_path = re.sub(r"\.(?:gz|xz|bz2|lz4|zst)$", "", upstream_path)
        signed_variants = []
        for candidate in (canonical_path, *(canonical_path + ext for ext in (".xz", ".bz2", ".gz", ".lz4", ".zst"))):
            if candidate in signed_rows:
                digest, size = signed_rows[candidate]
                signed_variants.append({"path": candidate, "sha256": digest, "size": size})
        if not signed_variants:
            raise ValueError(f"signed InRelease does not list a supported Packages variant for {upstream_path}")
        local_path = metadata_directory / Path(target["filename"]).name
        evidence.append({
            "identifier": target["identifier"],
            "codename": target["codename"], "suite": target["suite"],
            "component": target["component"], "architecture": target["architecture"],
            "filename": target["filename"], "uri": target["uri"],
            "baseUri": target["baseUri"], "metaKey": meta_key,
            "releaseFile": release_name, "releaseSha256": release_sha,
            "canonicalPackagesPath": canonical_path,
            "signedVariants": signed_variants, "localAptFile": local_path.name,
            "localAptSha256": sha256(local_path), "localAptSize": local_path.stat().st_size,
        })
    if not evidence:
        raise ValueError("no signed upstream Packages index records were bound to APT targets")
    return sorted(evidence, key=lambda item: (str(item["codename"]), str(item["component"]), str(item["architecture"]), str(item["canonicalPackagesPath"])))


def signed_release_index_records(
    metadata_directory: Path,
    targets: list[dict[str, str]],
    evidence_directory: Path | None = None,
) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    release_names = sorted({target["releaseFile"] for target in targets})
    for release_name in release_names:
        release_path = (evidence_directory / release_name) if evidence_directory else metadata_directory / Path(release_name).name
        release_bytes = release_path.read_bytes()
        release_sha = sha256(release_path)
        codename, suite = parse_release_identity(release_bytes)
        for path, (digest, size) in sorted(parse_release_sha256(release_bytes).items()):
            records.append({
                "releaseFile": release_name,
                "releaseSha256": release_sha,
                "codename": codename,
                "suite": suite,
                "path": path,
                "sha256": digest,
                "size": size,
            })
    if not records:
        raise ValueError("no signed SHA256 index records were recovered from InRelease files")
    return records


def is_protected(name: str) -> bool:
    return name.startswith("libapt-pkg") or any(
        name == prefix or name.startswith(prefix + "-") for prefix in PROTECTED_PREFIXES
    )


def parse_removals(simulation: str, inventory: dict[tuple[str, str], str]) -> list[dict[str, str]]:
    planned: dict[tuple[str, str], str] = {}
    for line in simulation.splitlines():
        match = re.match(r"^(?:Remv|Purg)\s+(\S+)\s+\[([^\]]+)\]", line)
        if match:
            apt_name, version = match.groups()
            if ":" in apt_name:
                name, architecture = apt_name.rsplit(":", 1)
                key = (name, architecture)
            else:
                candidates = [key for key in inventory if key[0] == apt_name]
                if len(candidates) != 1:
                    raise ValueError(f"APT plan does not uniquely identify architecture for {apt_name}")
                key = candidates[0]
            if key in planned and planned[key] != version:
                raise ValueError(f"ambiguous planned versions for {key[0]}:{key[1]}")
            planned[key] = version
    if not planned:
        raise ValueError("APT purge simulation produced an empty removal plan")
    if not any(name == "gnupg" for name, _ in planned):
        raise ValueError("APT purge simulation did not include gnupg")
    removals: list[dict[str, str]] = []
    for (name, architecture), version in planned.items():
        if (name, architecture) not in inventory:
            raise ValueError(f"planned package is absent from installed inventory: {name}:{architecture}")
        installed_version = inventory[(name, architecture)]
        if installed_version != version:
            raise ValueError(f"planned version differs from installed inventory for {name}")
        if is_protected(name):
            raise ValueError(f"purge plan includes protected package {name}")
        removals.append({"name": name, "version": version, "architecture": architecture})
    return sorted(removals, key=lambda item: (item["name"], item["architecture"], item["version"]))


def required_github_run_identity() -> tuple[int, int]:
    values = (os.environ.get("GITHUB_RUN_ID", ""), os.environ.get("GITHUB_RUN_ATTEMPT", ""))
    if any(not value.isascii() or not value.isdecimal() or int(value) < 1 for value in values):
        raise RuntimeError("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must be positive decimal integers")
    return int(values[0]), int(values[1])


def initialize_evidence_directory(base: Path) -> Path:
    base.parent.mkdir(parents=True, exist_ok=True)
    if base.exists():
        raise RuntimeError(f"refusing to overwrite existing discovery evidence: {base}")
    base.mkdir()
    return base


def main() -> int:
    run_id, run_attempt = required_github_run_identity()
    initialize_evidence_directory(EVIDENCE_BASE)
    revision = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    tree = run(["git", "rev-parse", "HEAD^{tree}"]).stdout.strip()
    manifest: dict[str, object] = {
        "schemaVersion": 1,
        "state": "DISCOVERY_RUNNING",
        "revision": revision,
        "tree": tree,
        "runId": run_id,
        "runAttempt": run_attempt,
        "image": IMAGE,
        "platform": PLATFORM,
        "runtimeClearance": "NOT_EVALUATED",
        "cveClearance": "NOT_EVALUATED",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    (EVIDENCE_BASE / "run.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    try:
        pull = run(["docker", "pull", "--platform", PLATFORM, IMAGE])
        (EVIDENCE_BASE / "docker-pull.log").write_text(pull.stdout)
        image_info = json.loads(run(["docker", "image", "inspect", IMAGE]).stdout)[0]
        if image_info.get("Os") != "linux" or image_info.get("Architecture") != "amd64":
            raise RuntimeError("pinned image did not resolve to linux/amd64")
        manifest["imageId"] = image_info["Id"]
        manifest["repoDigests"] = sorted(image_info.get("RepoDigests") or [])
        expected_digest = IMAGE.rsplit("@", 1)[1]
        if not any(digest.endswith("@" + expected_digest) for digest in manifest["repoDigests"]):
            raise RuntimeError("pulled image does not report the required pinned RepoDigest")
        (EVIDENCE_BASE / "run.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        result = run([
            "docker", "run", "--rm", "--pull=never", "--platform", PLATFORM,
            "-v", f"{EVIDENCE_BASE}:/evidence", "--entrypoint", "/bin/bash", IMAGE,
            "-euc", CONTAINER_SCRIPT,
        ], check=False)
        (EVIDENCE_BASE / "container.log").write_text(result.stdout)
        if result.returncode:
            raise RuntimeError(f"disposable image discovery failed with exit {result.returncode}")
        normalize_apt_trusted_paths(
            EVIDENCE_BASE / "apt-trusted-paths.shell",
            EVIDENCE_BASE / "apt-trusted-paths.tsv",
        )
        isolated_acquisitions = collect_isolated_release_acquisitions(EVIDENCE_BASE, manifest)
        index_targets = validate_index_targets(
            EVIDENCE_BASE / "apt-index-targets.tsv", EVIDENCE_BASE / "apt-lists", isolated_acquisitions
        )
        validate_apt_trusted_paths(EVIDENCE_BASE / "apt-trusted-paths.tsv")
        signed_indices = signed_package_index_evidence(
            index_targets, EVIDENCE_BASE / "apt-lists", EVIDENCE_BASE
        )
        signed_release_indices = signed_release_index_records(
            EVIDENCE_BASE / "apt-lists", index_targets, EVIDENCE_BASE
        )
        inventory = parse_inventory(EVIDENCE_BASE / "dpkg-before.tsv")
        removals = parse_removals((EVIDENCE_BASE / "gnupg-purge-simulation.txt").read_text(), inventory)
        metadata_files = []
        for path in sorted((EVIDENCE_BASE / "apt-lists").iterdir()):
            if path.is_file():
                metadata_files.append({"file": path.relative_to(EVIDENCE_BASE).as_posix(), "sha256": sha256(path), "sizeBytes": path.stat().st_size})
        verified_package_names = {Path(target["filename"]).name for target in index_targets if "Packages" in target["identifier"]}
        inrelease = [
            {"file": acquisition["inReleaseFile"], "sha256": acquisition["inReleaseSha256"], "sizeBytes": acquisition["inReleaseSizeBytes"]}
            for acquisition in isolated_acquisitions
        ] + [
            {"file": acquisition["combinedInReleaseFile"], "sha256": acquisition["combinedInReleaseSha256"], "sizeBytes": acquisition["combinedInReleaseSizeBytes"]}
            for acquisition in isolated_acquisitions
        ]
        local_packages = [item for item in metadata_files if Path(item["file"]).name in verified_package_names]
        if not inrelease or not local_packages:
            raise RuntimeError("missing authenticated Release or local Packages metadata hashes")
        lock = {
            "schemaVersion": 1,
            "kind": "discovery-lock-proposal",
            "revision": revision,
            "tree": tree,
            "runId": run_id,
            "runAttempt": run_attempt,
            "image": IMAGE,
            "imageId": manifest["imageId"],
            "platform": PLATFORM,
            "authenticatedInReleaseFiles": inrelease,
            "isolatedReleaseAcquisitions": isolated_acquisitions,
            "signedReleaseIndexHashes": signed_release_indices,
            "packageIndexTargetBindings": signed_indices,
            "localAptIndexFiles": local_packages,
            "aptSignatureConfigSha256": sha256(EVIDENCE_BASE / "apt-signature-config.txt"),
            "aptTrustedPathsSha256": sha256(EVIDENCE_BASE / "apt-trusted-paths.tsv"),
            "sourceTrustEvidenceSha256": sha256(EVIDENCE_BASE / "source-trust.tsv"),
            "purgeSimulationSha256": sha256(EVIDENCE_BASE / "gnupg-purge-simulation.txt"),
            "removals": removals,
            "runtimeClearance": "NOT_EVALUATED",
            "cveClearance": "NOT_EVALUATED",
            "approvalState": "REQUIRES_INDEPENDENT_REVIEW_AND_LOCK_FREEZE",
        }
        (EVIDENCE_BASE / "gnupg-removal-lock-proposal.json").write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")
        manifest["state"] = "DISCOVERY_COMPLETE"
        manifest["removalCount"] = len(removals)
    except Exception as error:  # evidence should survive failures for always-upload artifact
        manifest["state"] = "DISCOVERY_FAILED"
        manifest["error"] = str(error)
        (EVIDENCE_BASE / "failure.txt").write_text(f"{type(error).__name__}: {error}\n")
        (EVIDENCE_BASE / "run.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        raise
    manifest["evidenceSha256"] = {
        path.relative_to(EVIDENCE_BASE).as_posix(): sha256(path)
        for path in sorted(EVIDENCE_BASE.rglob("*")) if path.is_file() and path.name != "run.json"
    }
    (EVIDENCE_BASE / "run.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Trixie GnuPG discovery failed: {error}", file=sys.stderr)
        raise SystemExit(1)
