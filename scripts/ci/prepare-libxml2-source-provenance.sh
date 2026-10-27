#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

readonly DEBIAN_VERSION='2.12.7+dfsg+really2.9.14-2.1+deb13u3'
readonly UBUNTU_VERSION='2.9.13+dfsg-1ubuntu0.12'
readonly DEBIAN_SNAPSHOT='20261027T000000Z'
readonly UBUNTU_SNAPSHOT='20260622T130000Z'
readonly DEBIAN_URI="https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}"
readonly UBUNTU_URI="https://snapshot.ubuntu.com/ubuntu/${UBUNTU_SNAPSHOT}"
readonly DEBIAN_ARCHIVE_KEYRING='/usr/share/keyrings/debian-archive-keyring.gpg'
readonly UBUNTU_ARCHIVE_KEYRING='/usr/share/keyrings/ubuntu-archive-keyring.gpg'
readonly UBUNTU_UPLOAD_FINGERPRINT='71FBF17BE7E52D0C2A2C9144F0B61460B04C4B56'
readonly UBUNTU_UPLOAD_KEY_URL='https://keyserver.ubuntu.com/pks/lookup?op=get&search=0xF0B61460B04C4B56'
readonly PATCH_RELATIVE_PATH='debian/patches/CVE-2026-6653.patch'
readonly PATCH_SHA256='b4cc290c275b250c3170259386887a679857d97e760e114f6fb1f0d2c617c82c'

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 1 ]] || die 'usage: prepare-libxml2-source-provenance.sh OUTPUT_DIRECTORY'
[[ -n ${GITHUB_ACTIONS:-} && ${GITHUB_ACTIONS} == true ]] || die 'must run on a GitHub Actions runner'

output_dir=$(realpath -m -- "$1")
[[ "$output_dir" != '/' ]] || die 'refusing output directory /'
mkdir -p -- "$output_dir"
[[ -z $(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit) ]] || die 'output directory must be empty'

if [[ ! -r /etc/os-release ]]; then
  die 'cannot identify runner operating system'
fi
# shellcheck disable=SC1091
source /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == '24.04' ]] || die 'requires an Ubuntu 24.04 GitHub Actions runner'

command -v sudo >/dev/null || die 'sudo is required to install verified tooling'
sudo apt-get update
sudo apt-get install --yes --no-install-recommends \
  ca-certificates curl dpkg-dev debian-archive-keyring debian-keyring devscripts gnupg gpgv ubuntu-keyring xz-utils

for required in curl gpg gpgv dscverify apt-get sha256sum dpkg-query xzcat; do
  command -v "$required" >/dev/null || die "required command unavailable: $required"
done
[[ -r "$DEBIAN_ARCHIVE_KEYRING" ]] || die "missing official Debian archive keyring: $DEBIAN_ARCHIVE_KEYRING"
[[ -r "$UBUNTU_ARCHIVE_KEYRING" ]] || die "missing official Ubuntu archive keyring: $UBUNTU_ARCHIVE_KEYRING"

readonly work_dir="$output_dir/.work"
readonly debian_dir="$output_dir/debian-source"
readonly ubuntu_dir="$output_dir/ubuntu-source"
readonly evidence_dir="$output_dir/metadata"
mkdir -p -- "$work_dir/debian/lists/partial" "$work_dir/debian/archives/partial" \
  "$work_dir/ubuntu/lists/partial" "$work_dir/ubuntu/archives/partial" \
  "$debian_dir" "$ubuntu_dir" "$evidence_dir"

write_source_list() {
  local path=$1 uri=$2 suite=$3 keyring=$4
  printf 'deb-src [check-valid-until=no signed-by=%s] %s %s main\n' \
    "$keyring" "$uri" "$suite" >"$path"
}

write_source_list "$work_dir/debian.sources.list" "$DEBIAN_URI" trixie "$DEBIAN_ARCHIVE_KEYRING"
write_source_list "$work_dir/ubuntu.sources.list" "$UBUNTU_URI" jammy-security "$UBUNTU_ARCHIVE_KEYRING"

apt_with_state() {
  local state=$1 sources=$2
  shift 2
  sudo apt-get \
    -o "Dir::Etc::sourcelist=$sources" \
    -o 'Dir::Etc::sourceparts=-' \
    -o "Dir::State::lists=$state/lists" \
    -o "Dir::Cache::archives=$state/archives" \
    -o 'APT::Get::List-Cleanup=0' \
    -o 'Acquire::Retries=3' \
    -o 'Acquire::https::Timeout=45' \
    "$@"
}

record_release_signature() {
  local uri=$1 suite=$2 keyring=$3 name=$4
  local inrelease="$evidence_dir/$name.InRelease"
  curl --fail --show-error --silent --location --retry 3 --connect-timeout 20 \
    "$uri/dists/$suite/InRelease" --output "$inrelease"
  local status
  status=$(gpgv --status-fd 1 --keyring "$keyring" "$inrelease" 2>"$evidence_dir/$name.gpgv.log") \
    || die "$name InRelease signature failed with its official archive keyring"
  local fingerprints
  fingerprints=$(awk '$2 == "VALIDSIG" { print toupper($3); if ($12 != "") print toupper($12) }' <<<"$status" | sort -u)
  [[ -n "$fingerprints" ]] || die "$name InRelease had no machine-readable valid signer fingerprint"
  printf '%s\n' "$fingerprints" >"$evidence_dir/$name.signer-fingerprints.txt"
  printf '%s  %s\n' "$(sha256sum "$inrelease" | awk '{print $1}')" "$name.InRelease" \
    >"$evidence_dir/$name.InRelease.sha256"
}

record_release_signature "$DEBIAN_URI" trixie "$DEBIAN_ARCHIVE_KEYRING" debian-trixie
record_release_signature "$UBUNTU_URI" jammy-security "$UBUNTU_ARCHIVE_KEYRING" ubuntu-jammy-security

apt_with_state "$work_dir/debian" "$work_dir/debian.sources.list" update
apt_with_state "$work_dir/ubuntu" "$work_dir/ubuntu.sources.list" update

capture_authenticated_apt_indexes() {
  local state=$1 name=$2
  local verified_inrelease="$evidence_dir/$name.InRelease"
  local -a releases=() source_indexes=()
  mapfile -t releases < <(find "$state/lists" -maxdepth 1 -type f -name '*InRelease' -print | sort)
  [[ ${#releases[@]} -eq 1 ]] || die "$name APT update did not produce exactly one InRelease"
  cmp -s "$verified_inrelease" "${releases[0]}" || die "$name APT used an InRelease different from the separately verified snapshot metadata"
  mapfile -t source_indexes < <(find "$state/lists" -maxdepth 1 -type f -name '*source_Sources*' -print | sort)
  [[ ${#source_indexes[@]} -eq 1 ]] || die "$name APT update did not produce exactly one authenticated source index"
  cp -- "${source_indexes[0]}" "$evidence_dir/$name.Sources.apt-cache"
  printf '%s\n' "${source_indexes[0]##*/}" >"$evidence_dir/$name.Sources.apt-cache.name"
  sha256sum "$evidence_dir/$name.Sources.apt-cache" >"$evidence_dir/$name.Sources.apt-cache.sha256"
}

capture_authenticated_apt_indexes "$work_dir/debian" debian-trixie
capture_authenticated_apt_indexes "$work_dir/ubuntu" ubuntu-jammy-security

download_source() {
  local state=$1 sources=$2 version=$3 destination=$4
  (
    cd "$destination"
    apt_with_state "$state" "$sources" source --download-only --only-source "libxml2=$version"
  )
  local -a dscs=()
  mapfile -t dscs < <(find "$destination" -maxdepth 1 -type f -name 'libxml2_*.dsc' -print | sort)
  [[ ${#dscs[@]} -eq 1 ]] || die "expected one downloaded libxml2 .dsc for $version; found ${#dscs[@]}"
  grep -Fqx "Version: $version" <(sed '1,/^$/d' "${dscs[0]}" | sed '/^-----BEGIN PGP SIGNATURE-----/,$d') \
    || die "downloaded .dsc does not declare expected version $version"
  printf '%s\n' "${dscs[0]}"
}

debian_dsc=$(download_source "$work_dir/debian" "$work_dir/debian.sources.list" "$DEBIAN_VERSION" "$debian_dir")
ubuntu_dsc=$(download_source "$work_dir/ubuntu" "$work_dir/ubuntu.sources.list" "$UBUNTU_VERSION" "$ubuntu_dir")

debian_keyrings=()
while IFS= read -r keyring; do
  [[ -r "$keyring" ]] && debian_keyrings+=(--keyring "$keyring")
done < <(dpkg-query -L debian-keyring | grep -E '/(debian-keyring|debian-maintainers|debian-nonupload|debian-role-keys)\.gpg$' || true)
[[ ${#debian_keyrings[@]} -gt 0 ]] || die 'debian-keyring is installed but no official Debian maintainer keyring was found'

# Verify the Debian upload signature and the .dsc-listed source-file checksums before extraction.
(
  cd "$debian_dir"
  dscverify --no-conf --no-default-keyrings "${debian_keyrings[@]}" "$(basename "$debian_dsc")"
) >"$evidence_dir/debian-dscverify.log" 2>&1 \
  || die 'Debian .dsc signature or source-file checksum verification failed'
debian_signature=$(gpgv --status-fd 1 "${debian_keyrings[@]}" "$debian_dsc" 2>/dev/null) \
  || die 'Debian .dsc signature did not verify with Debian maintainer keyrings'

# Obtain only the public key whose complete fingerprint is published for the named Ubuntu security uploader.
# The fingerprint is sourced from https://wiki.ubuntu.com/Security/GPG_key_table (Sudhakar Verma).
readonly key_home="$work_dir/ubuntu-uploader-gnupg"
mkdir -m 0700 -- "$key_home"
curl --fail --show-error --silent --location --retry 3 --connect-timeout 20 \
  "$UBUNTU_UPLOAD_KEY_URL" --output "$work_dir/ubuntu-uploader.asc"
gpg --batch --homedir "$key_home" --import "$work_dir/ubuntu-uploader.asc" \
  >"$evidence_dir/ubuntu-uploader-import.log" 2>&1 || die 'could not import the Ubuntu uploader public key'
observed_fingerprint=$(gpg --batch --homedir "$key_home" --with-colons --fingerprint \
  | awk -F: '$1 == "fpr" { print toupper($10); exit }')
[[ "$observed_fingerprint" == "$UBUNTU_UPLOAD_FINGERPRINT" ]] \
  || die "Ubuntu uploader key fingerprint mismatch: expected $UBUNTU_UPLOAD_FINGERPRINT, got ${observed_fingerprint:-none}"
ubuntu_uploader_keyring="$work_dir/ubuntu-uploader.gpg"
gpg --batch --homedir "$key_home" --export "$UBUNTU_UPLOAD_FINGERPRINT" >"$ubuntu_uploader_keyring"
[[ -s "$ubuntu_uploader_keyring" ]] || die 'Ubuntu uploader key export is empty'

# No Ubuntu source is extracted unless its signed .dsc verifies against the independently pinned uploader key.
(
  cd "$ubuntu_dir"
  dscverify --no-conf --no-default-keyrings --keyring "$ubuntu_uploader_keyring" "$(basename "$ubuntu_dsc")"
) >"$evidence_dir/ubuntu-dscverify.log" 2>&1 \
  || die 'Ubuntu .dsc signature/source hashes failed against the pinned uploader key; refusing extraction/build'
ubuntu_signature=$(gpgv --status-fd 1 --keyring "$ubuntu_uploader_keyring" "$ubuntu_dsc" 2>/dev/null) \
  || die 'Ubuntu .dsc signature did not verify against the pinned uploader key'

extract_valid_fingerprints() {
  awk '$2 == "VALIDSIG" { print toupper($3); if ($12 != "") print toupper($12) }' <<<"$1" | sort -u
}
debian_dsc_fingerprints=$(extract_valid_fingerprints "$debian_signature")
ubuntu_dsc_fingerprints=$(extract_valid_fingerprints "$ubuntu_signature")
[[ -n "$debian_dsc_fingerprints" ]] || die 'Debian .dsc verification yielded no valid signer fingerprint'
grep -Fxq "$UBUNTU_UPLOAD_FINGERPRINT" <<<"$ubuntu_dsc_fingerprints" \
  || die 'Ubuntu .dsc signer fingerprint differs from the independently pinned Ubuntu uploader key'

(
  cd "$ubuntu_dir"
  dpkg-source -x "$(basename "$ubuntu_dsc")" "$work_dir/ubuntu-extracted"
) >"$evidence_dir/ubuntu-dpkg-source.log" 2>&1 \
  || die 'could not extract the signature-verified Ubuntu source package'
patch_source="$work_dir/ubuntu-extracted/$PATCH_RELATIVE_PATH"
[[ -f "$patch_source" ]] || die "verified Ubuntu source package lacks $PATCH_RELATIVE_PATH"
actual_patch_sha256=$(sha256sum "$patch_source" | awk '{print $1}')
[[ "$actual_patch_sha256" == "$PATCH_SHA256" ]] \
  || die "Jammy patch SHA-256 mismatch: expected $PATCH_SHA256, got $actual_patch_sha256"
install -D -m 0644 -- "$patch_source" "$output_dir/$PATCH_RELATIVE_PATH"

for source_dir in "$debian_dir" "$ubuntu_dir"; do
  (cd "$source_dir" && sha256sum libxml2_*) >"$source_dir/SHA256SUMS"
done
printf '%s\n' "$debian_dsc_fingerprints" >"$evidence_dir/debian-dsc.signer-fingerprints.txt"
printf '%s\n' "$ubuntu_dsc_fingerprints" >"$evidence_dir/ubuntu-dsc.signer-fingerprints.txt"
printf '%s  %s\n' "$actual_patch_sha256" "$PATCH_RELATIVE_PATH" >"$evidence_dir/patch.sha256"

export OUTPUT_DIR="$output_dir" DEBIAN_VERSION UBUNTU_VERSION DEBIAN_SNAPSHOT UBUNTU_SNAPSHOT
export DEBIAN_URI UBUNTU_URI PATCH_RELATIVE_PATH PATCH_SHA256
export DEBIAN_RELEASE_INRELEASE_SHA256="$(awk '{print $1}' "$evidence_dir/debian-trixie.InRelease.sha256")"
export UBUNTU_RELEASE_INRELEASE_SHA256="$(awk '{print $1}' "$evidence_dir/ubuntu-jammy-security.InRelease.sha256")"
export DEBIAN_RELEASE_SIGNERS="$(paste -sd, "$evidence_dir/debian-trixie.signer-fingerprints.txt")"
export UBUNTU_RELEASE_SIGNERS="$(paste -sd, "$evidence_dir/ubuntu-jammy-security.signer-fingerprints.txt")"
export DEBIAN_SOURCES_INDEX_SHA256="$(awk '{print $1}' "$evidence_dir/debian-trixie.Sources.apt-cache.sha256")"
export UBUNTU_SOURCES_INDEX_SHA256="$(awk '{print $1}' "$evidence_dir/ubuntu-jammy-security.Sources.apt-cache.sha256")"
export DEBIAN_DSC_SIGNER="$debian_dsc_fingerprints" UBUNTU_DSC_SIGNER="$ubuntu_dsc_fingerprints"
export DEBIAN_KEYRING_VERSION="$(dpkg-query -W -f='${Version}' debian-keyring)"
export DEBIAN_ARCHIVE_KEYRING_VERSION="$(dpkg-query -W -f='${Version}' debian-archive-keyring)"
export UBUNTU_KEYRING_VERSION="$(dpkg-query -W -f='${Version}' ubuntu-keyring)"
export GENERATED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - "$output_dir/provenance.json" <<'PY'
import hashlib
import json
import os
import pathlib
import sys

root = pathlib.Path(os.environ["OUTPUT_DIR"])

def files_for(directory: str) -> list[dict[str, str]]:
    items = []
    for path in sorted((root / directory).glob("libxml2_*")):
        if path.is_file() and path.name != "SHA256SUMS":
            items.append({"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    return items

manifest = {
    "schemaVersion": 1,
    "generatedAtUtc": os.environ["GENERATED_AT_UTC"],
    "verification": {
        "authenticatedReleaseMetadata": True,
        "dscSignaturesAndListedHashes": True,
        "ubuntuUploaderFingerprintPinned": os.environ["UBUNTU_DSC_SIGNER"],
        "keyringPackages": {
            "debian-keyring": os.environ["DEBIAN_KEYRING_VERSION"],
            "debian-archive-keyring": os.environ["DEBIAN_ARCHIVE_KEYRING_VERSION"],
            "ubuntu-keyring": os.environ["UBUNTU_KEYRING_VERSION"],
        },
    },
    "debian": {
        "source": "libxml2",
        "version": os.environ["DEBIAN_VERSION"],
        "uri": os.environ["DEBIAN_URI"],
        "snapshot": os.environ["DEBIAN_SNAPSHOT"],
        "suite": "trixie",
        "releaseInReleaseSha256": os.environ["DEBIAN_RELEASE_INRELEASE_SHA256"],
        "releaseSignerFingerprints": os.environ["DEBIAN_RELEASE_SIGNERS"].split(","),
        "aptAuthenticatedSourcesIndexSha256": os.environ["DEBIAN_SOURCES_INDEX_SHA256"],
        "dscSignerFingerprints": os.environ["DEBIAN_DSC_SIGNER"].split(","),
        "sourceArtifacts": files_for("debian-source"),
    },
    "ubuntuJammyPatchSource": {
        "source": "libxml2",
        "version": os.environ["UBUNTU_VERSION"],
        "uri": os.environ["UBUNTU_URI"],
        "snapshot": os.environ["UBUNTU_SNAPSHOT"],
        "suite": "jammy-security",
        "releaseInReleaseSha256": os.environ["UBUNTU_RELEASE_INRELEASE_SHA256"],
        "releaseSignerFingerprints": os.environ["UBUNTU_RELEASE_SIGNERS"].split(","),
        "aptAuthenticatedSourcesIndexSha256": os.environ["UBUNTU_SOURCES_INDEX_SHA256"],
        "dscSignerFingerprints": os.environ["UBUNTU_DSC_SIGNER"].split(","),
        "sourceArtifacts": files_for("ubuntu-source"),
        "patchPath": os.environ["PATCH_RELATIVE_PATH"],
        "patchSha256": os.environ["PATCH_SHA256"],
    },
}
(root / "provenance.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
PY

sudo rm -rf -- "$work_dir"
printf 'Verified source provenance written to %s\n' "$output_dir/provenance.json"
