#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

readonly DEBIAN_VERSION='2.12.7+dfsg+really2.9.14-2.1+deb13u3'
readonly UBUNTU_VERSION='2.9.13+dfsg-1ubuntu0.12'
readonly DEBIAN_SNAPSHOT='20261027T000000Z'
readonly DEBIAN_SECURITY_SNAPSHOT='20261027T000000Z'
readonly BOOKWORM_BOOTSTRAP_SNAPSHOT='20261026T202550Z'
readonly UBUNTU_SNAPSHOT='20260622T130000Z'
readonly DEBIAN_URI="https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}"
readonly DEBIAN_SECURITY_URI="https://snapshot.debian.org/archive/debian-security/${DEBIAN_SECURITY_SNAPSHOT}"
readonly BOOKWORM_BOOTSTRAP_URI="https://snapshot.debian.org/archive/debian/${BOOKWORM_BOOTSTRAP_SNAPSHOT}"
readonly UBUNTU_URI="https://snapshot.ubuntu.com/ubuntu/${UBUNTU_SNAPSHOT}"
readonly DEBIAN_ARCHIVE_KEYRING='/usr/share/keyrings/debian-archive-keyring.gpg'
readonly UBUNTU_ARCHIVE_KEYRING='/usr/share/keyrings/ubuntu-archive-keyring.gpg'
readonly BOOKWORM_INRELEASE_SHA256='77737fa4b34f2693e982cc9ee35736816c35a7778fc2d326cc1bbf5b301fe1aa'
readonly BOOKWORM_KEYRING_PACKAGE_VERSION='2023.3+deb12u2'
readonly BOOKWORM_KEYRING_PACKAGE_SHA256='f699e2f88dca05212f2a452b58475f2993cb6993dfbafb1d0205a3291eb8b4b8'
readonly BOOKWORM_ARCHIVE_SIGNER_PRIMARY='B8B80B5B623EAB6AD8775C45B7C5D7D6350947F8'
readonly BOOKWORM_ARCHIVE_SIGNER_SUBKEY='4CB50190207B4758A3F73A796ED0E7B82643E131'
readonly BOOKWORM_STABLE_SIGNER='4D64FEC119C2029067D6E791F8D2585B8783D481'
readonly TRIXIE_ARCHIVE_SIGNER_A='B8E5F13176D2A7A75220028078DBA3BC47EF2265'
readonly TRIXIE_ARCHIVE_SIGNER_B='41587F7DB8C774BCCF131416762F67A0B2C39DE4'
readonly TRIXIE_SECURITY_ARCHIVE_SIGNER_PRIMARY='5E04A1E3223A19A20706E20F9904613D4CCE68C6'
readonly TRIXIE_SECURITY_ARCHIVE_SIGNER_SUBKEY='89C87ACEA5DD6B8E6A7068808E9F831205B4BA95'
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

for required in curl gpg gpgv dscverify apt-get sha256sum dpkg-deb dpkg-query xzcat; do
  command -v "$required" >/dev/null || die "required command unavailable: $required"
done
[[ -r "$DEBIAN_ARCHIVE_KEYRING" ]] || die "missing official Debian archive keyring: $DEBIAN_ARCHIVE_KEYRING"
[[ -r "$UBUNTU_ARCHIVE_KEYRING" ]] || die "missing official Ubuntu archive keyring: $UBUNTU_ARCHIVE_KEYRING"

readonly work_dir="$output_dir/.work"
readonly debian_dir="$output_dir/debian-source"
readonly ubuntu_dir="$output_dir/ubuntu-source"
readonly evidence_dir="$output_dir/metadata"
mkdir -p -- "$work_dir/debian/lists/partial" "$work_dir/debian/archives/partial" \
  "$work_dir/bookworm-bootstrap/lists/partial" "$work_dir/bookworm-bootstrap/archives/partial" \
  "$work_dir/ubuntu/lists/partial" "$work_dir/ubuntu/archives/partial" \
  "$debian_dir" "$ubuntu_dir" "$evidence_dir"

write_source_list() {
  local path=$1 uri=$2 suite=$3 keyring=$4
  printf 'deb-src [check-valid-until=no signed-by=%s] %s %s main\n' \
    "$keyring" "$uri" "$suite" >"$path"
}

write_binary_source_list() {
  local path=$1 uri=$2 suite=$3 keyring=$4
  printf 'deb [check-valid-until=no signed-by=%s] %s %s main\n' \
    "$keyring" "$uri" "$suite" >"$path"
}

write_source_list "$work_dir/debian.sources.list" "$DEBIAN_URI" trixie "$DEBIAN_ARCHIVE_KEYRING"
write_binary_source_list "$work_dir/bookworm-bootstrap.sources.list" "$BOOKWORM_BOOTSTRAP_URI" bookworm "$DEBIAN_ARCHIVE_KEYRING"
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

record_bookworm_bootstrap_release() {
  local uri=$1 suite=$2 name=$3
  local inrelease="$evidence_dir/$name.InRelease"
  curl --fail --show-error --silent --location --retry 3 --connect-timeout 20 \
    "$uri/dists/$suite/InRelease" --output "$inrelease"
  printf '%s  %s\n' "$(sha256sum "$inrelease" | awk '{print $1}')" "$name.InRelease" \
    >"$evidence_dir/$name.InRelease.sha256"
  [[ $(awk '{print $1}' "$evidence_dir/$name.InRelease.sha256") == "$BOOKWORM_INRELEASE_SHA256" ]] \
    || die 'Bookworm bootstrap InRelease SHA-256 does not match the approved exact snapshot'
}

pre_bootstrap_debian_archive_keyring_version=$(dpkg-query -W -f='${Version}' debian-archive-keyring)
pre_bootstrap_debian_archive_keyring_sha256=$(sha256sum "$DEBIAN_ARCHIVE_KEYRING" | awk '{print $1}')
record_bookworm_bootstrap_release "$BOOKWORM_BOOTSTRAP_URI" bookworm debian-bookworm-bootstrap

apt_with_state "$work_dir/bookworm-bootstrap" "$work_dir/bookworm-bootstrap.sources.list" \
  -o Debug::Acquire::gpgv=1 update >"$evidence_dir/debian-bookworm-bootstrap.apt-update.log" 2>&1
bookworm_inrelease_cache=()
mapfile -t bookworm_inrelease_cache < <(find "$work_dir/bookworm-bootstrap/lists" -maxdepth 1 -type f -name '*InRelease' -print | sort)
[[ ${#bookworm_inrelease_cache[@]} -eq 1 ]] || die 'Bookworm bootstrap APT did not produce exactly one InRelease'
cmp -s "$evidence_dir/debian-bookworm-bootstrap.InRelease" "${bookworm_inrelease_cache[0]}" \
  || die 'Bookworm bootstrap APT used InRelease bytes different from the separately verified snapshot'
BOOKWORM_SIGNER_FINGERPRINTS="$BOOKWORM_ARCHIVE_SIGNER_PRIMARY,$BOOKWORM_ARCHIVE_SIGNER_SUBKEY,$BOOKWORM_STABLE_SIGNER" \
TRIXIE_BOOTSTRAP_UNKNOWN_SIGNER="$TRIXIE_ARCHIVE_SIGNER_A" \
python3 - "$evidence_dir/debian-bookworm-bootstrap.apt-update.log" \
  "$evidence_dir/debian-bookworm-bootstrap.signer-fingerprints.txt" \
  "$evidence_dir/debian-bookworm-bootstrap.unverified-additional-signer-fingerprints.txt" <<'PY'
import pathlib
import os
import sys

log_path, signer_path, unknown_path = map(pathlib.Path, sys.argv[1:])
allowed_bookworm = set(os.environ["BOOKWORM_SIGNER_FINGERPRINTS"].split(","))
expected_unknown = os.environ["TRIXIE_BOOTSTRAP_UNKNOWN_SIGNER"]
valid = set()
unknown = set()
bad_statuses = {"BADSIG", "EXPSIG", "EXPKEYSIG", "REVKEYSIG", "NODATA"}

for raw_line in log_path.read_text(errors="replace").splitlines():
    marker = "[GNUPG:] "
    if marker not in raw_line:
        continue
    fields = raw_line.split(marker, 1)[1].split()
    if not fields:
        continue
    code = fields[0]
    if code == "VALIDSIG" and len(fields) >= 2:
        valid.add(fields[1].upper())
        if len(fields) >= 11 and fields[10] != "-":
            valid.add(fields[10].upper())
    elif code == "NO_PUBKEY" and len(fields) >= 2:
        key_id = fields[1].upper()
        if not expected_unknown.endswith(key_id):
            raise SystemExit(f"unexpected unknown Bookworm bootstrap signer: {key_id}")
        unknown.add(expected_unknown)
    elif code == "ERRSIG" and len(fields) >= 7:
        key_id = fields[1].upper()
        error_code = fields[6]
        signer_fingerprint = fields[7].upper() if len(fields) >= 8 else ""
        if error_code != "9" or not (
            expected_unknown.endswith(key_id) or signer_fingerprint == expected_unknown
        ):
            raise SystemExit("Bookworm bootstrap has an unexpected unverifiable signature")
        unknown.add(expected_unknown)
    elif code in bad_statuses:
        raise SystemExit(f"Bookworm bootstrap has unacceptable signature status: {code}")

if not valid.intersection(allowed_bookworm):
    raise SystemExit("APT debug evidence has no valid signature from a pinned Bookworm signer")
signer_path.write_text("".join(f"{item}\n" for item in sorted(valid)))
unknown_path.write_text("".join(f"{item}\n" for item in sorted(unknown)))
PY
bookworm_package_indexes=()
mapfile -t bookworm_package_indexes < <(find "$work_dir/bookworm-bootstrap/lists" -maxdepth 1 -type f -name '*binary-amd64_Packages*' -print | sort)
[[ ${#bookworm_package_indexes[@]} -eq 1 ]] || die 'Bookworm bootstrap APT did not produce exactly one amd64 Packages index'
cp -- "${bookworm_package_indexes[0]}" "$evidence_dir/debian-bookworm-bootstrap.Packages.apt-cache"
printf '%s\n' "${bookworm_package_indexes[0]##*/}" >"$evidence_dir/debian-bookworm-bootstrap.Packages.apt-cache.name"
sha256sum "$evidence_dir/debian-bookworm-bootstrap.Packages.apt-cache" \
  >"$evidence_dir/debian-bookworm-bootstrap.Packages.apt-cache.sha256"

(
  cd "$evidence_dir"
  apt_with_state "$work_dir/bookworm-bootstrap" "$work_dir/bookworm-bootstrap.sources.list" \
    download "debian-archive-keyring=$BOOKWORM_KEYRING_PACKAGE_VERSION"
)
bookworm_keyring_packages=()
mapfile -t bookworm_keyring_packages < <(find "$evidence_dir" -maxdepth 1 -type f -name 'debian-archive-keyring_*.deb' -print | sort)
[[ ${#bookworm_keyring_packages[@]} -eq 1 ]] || die 'expected exactly one downloaded Debian archive keyring package'
bookworm_keyring_package=${bookworm_keyring_packages[0]}
[[ $(sha256sum "$bookworm_keyring_package" | awk '{print $1}') == "$BOOKWORM_KEYRING_PACKAGE_SHA256" ]] \
  || die 'downloaded Debian archive keyring package SHA-256 differs from its pinned signed-index package'
bookworm_keyring_package_sha256=$(sha256sum "$bookworm_keyring_package" | awk '{print $1}')
[[ $(dpkg-deb --field "$bookworm_keyring_package" Version) == "$BOOKWORM_KEYRING_PACKAGE_VERSION" ]] \
  || die 'downloaded Debian archive keyring package version differs from the pin'
[[ $(dpkg-deb --field "$bookworm_keyring_package" Architecture) == all ]] \
  || die 'Debian archive keyring package is not architecture independent'
readonly TRIXIE_KEYRING_ROOT="$work_dir/bookworm-keyring-package"
dpkg-deb -x "$bookworm_keyring_package" "$TRIXIE_KEYRING_ROOT"
readonly TRIXIE_ARCHIVE_KEYRING="$TRIXIE_KEYRING_ROOT/usr/share/keyrings/debian-archive-keyring.gpg"
[[ -r "$TRIXIE_ARCHIVE_KEYRING" ]] || die 'authenticated Bookworm package lacks the combined Debian archive keyring'
debian_archive_fingerprints=$(gpg --batch --show-keys --with-colons "$TRIXIE_ARCHIVE_KEYRING" \
  | awk -F: '$1 == "fpr" { print toupper($10) }' | sort -u)
grep -Fxq "$TRIXIE_ARCHIVE_SIGNER_A" <<<"$debian_archive_fingerprints" \
  || die 'pinned Debian archive keyring lacks the required Trixie signer fingerprint A'
grep -Fxq "$TRIXIE_ARCHIVE_SIGNER_B" <<<"$debian_archive_fingerprints" \
  || die 'pinned Debian archive keyring lacks the required Trixie signer fingerprint B'
printf '%s\n' "$debian_archive_fingerprints" >"$evidence_dir/debian-trixie-archive-keyring.fingerprints.txt"
trixie_archive_keyring_sha256=$(sha256sum "$TRIXIE_ARCHIVE_KEYRING" | awk '{print $1}')
printf '%s  %s\n' "$(sha256sum "$bookworm_keyring_package" | awk '{print $1}')" "${bookworm_keyring_package##*/}" \
  >"$evidence_dir/debian-archive-keyring.package.sha256"

write_source_list "$work_dir/debian.sources.list" "$DEBIAN_URI" trixie "$TRIXIE_ARCHIVE_KEYRING"
record_release_signature "$DEBIAN_URI" trixie "$TRIXIE_ARCHIVE_KEYRING" debian-trixie
trixie_release_signers=$(cat "$evidence_dir/debian-trixie.signer-fingerprints.txt")
grep -Fxq "$TRIXIE_ARCHIVE_SIGNER_A" <<<"$trixie_release_signers" \
  || grep -Fxq "$TRIXIE_ARCHIVE_SIGNER_B" <<<"$trixie_release_signers" \
  || die 'Trixie InRelease signature is not by either required pinned archive signer'
record_release_signature "$DEBIAN_SECURITY_URI" trixie-security "$TRIXIE_ARCHIVE_KEYRING" debian-security-trixie
security_release_signers=$(cat "$evidence_dir/debian-security-trixie.signer-fingerprints.txt")
grep -Fxq "$TRIXIE_SECURITY_ARCHIVE_SIGNER_PRIMARY" <<<"$security_release_signers" \
  || grep -Fxq "$TRIXIE_SECURITY_ARCHIVE_SIGNER_SUBKEY" <<<"$security_release_signers" \
  || die 'Trixie security InRelease signature is not by a required pinned archive signer'
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
  local state=$1 sources=$2 version=$3 destination=$4 name=$5
  (
    cd "$destination"
    apt_with_state "$state" "$sources" source --download-only --only-source "libxml2=$version"
  ) >"$evidence_dir/$name.apt-source.log" 2>&1
  local -a dscs=()
  mapfile -t dscs < <(find "$destination" -maxdepth 1 -type f -name 'libxml2_*.dsc' -print | sort)
  [[ ${#dscs[@]} -eq 1 ]] || die "expected one downloaded libxml2 .dsc for $version; found ${#dscs[@]}"
  grep -Fqx "Version: $version" <(sed '1,/^$/d' "${dscs[0]}" | sed '/^-----BEGIN PGP SIGNATURE-----/,$d') \
    || die "downloaded .dsc does not declare expected version $version"
  printf '%s\n' "${dscs[0]}"
}

debian_dsc=$(download_source "$work_dir/debian" "$work_dir/debian.sources.list" "$DEBIAN_VERSION" "$debian_dir" debian-trixie)
ubuntu_dsc=$(download_source "$work_dir/ubuntu" "$work_dir/ubuntu.sources.list" "$UBUNTU_VERSION" "$ubuntu_dir" ubuntu-jammy-security)

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
export DEBIAN_URI DEBIAN_SECURITY_SNAPSHOT DEBIAN_SECURITY_URI UBUNTU_URI PATCH_RELATIVE_PATH PATCH_SHA256
export DEBIAN_RELEASE_INRELEASE_SHA256="$(awk '{print $1}' "$evidence_dir/debian-trixie.InRelease.sha256")"
export DEBIAN_SECURITY_RELEASE_INRELEASE_SHA256="$(awk '{print $1}' "$evidence_dir/debian-security-trixie.InRelease.sha256")"
export DEBIAN_SECURITY_RELEASE_SIGNERS="$(paste -sd, "$evidence_dir/debian-security-trixie.signer-fingerprints.txt")"
export UBUNTU_RELEASE_INRELEASE_SHA256="$(awk '{print $1}' "$evidence_dir/ubuntu-jammy-security.InRelease.sha256")"
export DEBIAN_RELEASE_SIGNERS="$(paste -sd, "$evidence_dir/debian-trixie.signer-fingerprints.txt")"
export UBUNTU_RELEASE_SIGNERS="$(paste -sd, "$evidence_dir/ubuntu-jammy-security.signer-fingerprints.txt")"
export DEBIAN_SOURCES_INDEX_SHA256="$(awk '{print $1}' "$evidence_dir/debian-trixie.Sources.apt-cache.sha256")"
export UBUNTU_SOURCES_INDEX_SHA256="$(awk '{print $1}' "$evidence_dir/ubuntu-jammy-security.Sources.apt-cache.sha256")"
export DEBIAN_DSC_SIGNER="$debian_dsc_fingerprints" UBUNTU_DSC_SIGNER="$ubuntu_dsc_fingerprints"
export DEBIAN_KEYRING_VERSION="$(dpkg-query -W -f='${Version}' debian-keyring)"
export DEBIAN_ARCHIVE_KEYRING_VERSION="$(dpkg-query -W -f='${Version}' debian-archive-keyring)"
export UBUNTU_KEYRING_VERSION="$(dpkg-query -W -f='${Version}' ubuntu-keyring)"
checked_out_revision=$(git rev-parse HEAD)
[[ "$checked_out_revision" == "$GITHUB_SHA" ]] || die 'checked-out revision differs from the GitHub event SHA'
pull_request_head_sha=${PULL_REQUEST_HEAD_SHA:-}
if [[ "$GITHUB_EVENT_NAME" == pull_request ]]; then
  [[ "$pull_request_head_sha" =~ ^[[:xdigit:]]{40}$ ]] || die 'pull request head SHA is missing or malformed'
else
  [[ -z "$pull_request_head_sha" ]] || die 'pull request head SHA is unexpectedly set for a non-PR event'
fi
export CHECKED_OUT_REVISION="$checked_out_revision" PULL_REQUEST_HEAD_SHA="$pull_request_head_sha"
export BOOKWORM_BOOTSTRAP_SNAPSHOT BOOKWORM_BOOTSTRAP_URI BOOKWORM_INRELEASE_SHA256
export BOOKWORM_KEYRING_PACKAGE_VERSION BOOKWORM_KEYRING_PACKAGE_SHA256
export BOOKWORM_KEYRING_FILE_SHA256="$trixie_archive_keyring_sha256"
export BOOKWORM_RELEASE_SIGNERS="$(paste -sd, "$evidence_dir/debian-bookworm-bootstrap.signer-fingerprints.txt")"
export BOOKWORM_UNVERIFIED_SIGNERS="$(cat "$evidence_dir/debian-bookworm-bootstrap.unverified-additional-signer-fingerprints.txt")"
export BOOKWORM_PACKAGE_SHA256="$bookworm_keyring_package_sha256"
export BOOKWORM_PACKAGES_INDEX_SHA256="$(awk '{print $1}' "$evidence_dir/debian-bookworm-bootstrap.Packages.apt-cache.sha256")"
export BOOKWORM_PACKAGES_INDEX_NAME="$(cat "$evidence_dir/debian-bookworm-bootstrap.Packages.apt-cache.name")"
export PRE_BOOTSTRAP_DEBIAN_ARCHIVE_KEYRING_VERSION="$pre_bootstrap_debian_archive_keyring_version"
export PRE_BOOTSTRAP_DEBIAN_ARCHIVE_KEYRING_SHA256="$pre_bootstrap_debian_archive_keyring_sha256"
export TRIXIE_ARCHIVE_SIGNER_FINGERPRINTS="$TRIXIE_ARCHIVE_SIGNER_A,$TRIXIE_ARCHIVE_SIGNER_B"
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
    "workflow": {
        "runId": os.environ["GITHUB_RUN_ID"],
        "runAttempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
        "eventName": os.environ["GITHUB_EVENT_NAME"],
        "eventSha": os.environ["GITHUB_SHA"],
        "checkedOutRevision": os.environ["CHECKED_OUT_REVISION"],
        "pullRequestHeadSha": os.environ["PULL_REQUEST_HEAD_SHA"] or None,
    },
    "verification": {
        "authenticatedReleaseMetadata": True,
        "dscSignaturesAndListedHashes": True,
        "ubuntuUploaderFingerprintPinned": os.environ["UBUNTU_DSC_SIGNER"],
        "runnerInstalledKeyringPackages": {
            "debian-keyring": os.environ["DEBIAN_KEYRING_VERSION"],
            "debian-archive-keyring": os.environ["DEBIAN_ARCHIVE_KEYRING_VERSION"],
            "ubuntu-keyring": os.environ["UBUNTU_KEYRING_VERSION"],
        },
    },
    "debianArchiveKeyringBootstrap": {
        "snapshot": os.environ["BOOKWORM_BOOTSTRAP_SNAPSHOT"],
        "uri": os.environ["BOOKWORM_BOOTSTRAP_URI"],
        "suite": "bookworm",
        "inReleaseSha256": os.environ["BOOKWORM_INRELEASE_SHA256"],
        "inReleaseSignerFingerprints": os.environ["BOOKWORM_RELEASE_SIGNERS"].split(","),
        "unverifiedAdditionalSignerFingerprints": os.environ["BOOKWORM_UNVERIFIED_SIGNERS"].splitlines(),
        "authenticatedPackagesIndex": {
            "name": os.environ["BOOKWORM_PACKAGES_INDEX_NAME"],
            "sha256": os.environ["BOOKWORM_PACKAGES_INDEX_SHA256"],
        },
        "keyringPackageVersion": os.environ["BOOKWORM_KEYRING_PACKAGE_VERSION"],
        "keyringPackageSha256": os.environ["BOOKWORM_PACKAGE_SHA256"],
        "extractedKeyringSha256": os.environ["BOOKWORM_KEYRING_FILE_SHA256"],
        "preBootstrapRunnerKeyringPackageVersion": os.environ["PRE_BOOTSTRAP_DEBIAN_ARCHIVE_KEYRING_VERSION"],
        "preBootstrapRunnerKeyringFileSha256": os.environ["PRE_BOOTSTRAP_DEBIAN_ARCHIVE_KEYRING_SHA256"],
        "requiredTrixieSignerFingerprints": os.environ["TRIXIE_ARCHIVE_SIGNER_FINGERPRINTS"].split(","),
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
        "dscSignerFingerprints": os.environ["DEBIAN_DSC_SIGNER"].splitlines(),
        "sourceArtifacts": files_for("debian-source"),
    },
    "debianSecurityBinarySource": {
        "uri": os.environ["DEBIAN_SECURITY_URI"],
        "snapshot": os.environ["DEBIAN_SECURITY_SNAPSHOT"],
        "suite": "trixie-security",
        "releaseInReleaseSha256": os.environ["DEBIAN_SECURITY_RELEASE_INRELEASE_SHA256"],
        "releaseSignerFingerprints": os.environ["DEBIAN_SECURITY_RELEASE_SIGNERS"].split(","),
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
        "dscSignerFingerprints": os.environ["UBUNTU_DSC_SIGNER"].splitlines(),
        "sourceArtifacts": files_for("ubuntu-source"),
        "patchPath": os.environ["PATCH_RELATIVE_PATH"],
        "patchSha256": os.environ["PATCH_SHA256"],
    },
}
(root / "provenance.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
PY

sudo rm -rf -- "$work_dir"
printf 'Verified source provenance written to %s\n' "$output_dir/provenance.json"
