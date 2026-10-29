#!/usr/bin/env python3
"""Collect authenticated Debian Forky and PGDG package provenance evidence.

This job deliberately does not build an image or make a vulnerability disposition.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from typing import Any, Iterable


ROOT = pathlib.Path(__file__).resolve().parents[2]
POLICY_PATH = ROOT / "scripts/ci/forky-pgdg-provenance-policy.json"
CONSUMER_PATH = ROOT / "scripts/ci/consume-libxml2-provenance.mjs"
CONSUMER_TEST_PATH = ROOT / "scripts/ci/consume-libxml2-provenance.test.mjs"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
FINGERPRINT_RE = re.compile(r"^[0-9A-F]{40}$")
BAD_GPG_STATUSES = {
    "BADSIG", "ERRSIG", "EXPSIG", "EXPKEYSIG", "REVKEYSIG", "KEYREVOKED",
    "SIGEXPIRED", "KEYEXPIRED", "NO_PUBKEY", "NODATA", "FAILURE",
}
ALLOWED_GPG_STATUSES = {
    "NEWSIG", "GOODSIG", "VALIDSIG", "KEY_CONSIDERED", "SIG_ID",
    "TRUST_UNDEFINED", "TRUST_NEVER", "TRUST_MARGINAL", "TRUST_FULLY", "TRUST_ULTIMATE",
}


class ProvenanceError(RuntimeError):
    pass


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_deb822(text: str) -> list[dict[str, str]]:
    """Parse Debian control paragraphs, preserving folded field values."""
    paragraphs: list[dict[str, str]] = []
    record: dict[str, str] = {}
    previous: str | None = None
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line:
            if record:
                paragraphs.append(record)
                record = {}
            previous = None
            continue
        if line[0].isspace():
            if previous is None:
                raise ProvenanceError(f"orphan continuation on line {line_number}")
            record[previous] += "\n" + line[1:]
            continue
        if ":" not in line:
            raise ProvenanceError(f"malformed Debian control line {line_number}")
        name, value = line.split(":", 1)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", name) or name in record:
            raise ProvenanceError(f"invalid or duplicate Debian control field on line {line_number}")
        record[name] = value.lstrip(" ")
        previous = name
    if record:
        paragraphs.append(record)
    return paragraphs


def cleartext_release_body(inrelease: bytes) -> str:
    try:
        text = inrelease.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
    except UnicodeDecodeError as error:
        raise ProvenanceError("InRelease is not valid UTF-8") from error
    begin = "-----BEGIN PGP SIGNED MESSAGE-----"
    signature = "-----BEGIN PGP SIGNATURE-----"
    signature_end = "-----END PGP SIGNATURE-----"
    lines = text.splitlines()
    if not lines or lines[0] != begin or lines.count(begin) != 1:
        raise ProvenanceError("expected exactly one OpenPGP clear-signed InRelease frame")
    if lines.count(signature) != 1 or lines.count(signature_end) != 1:
        raise ProvenanceError("clear-signed InRelease has malformed or duplicate signature framing")
    header_end = next((index for index, line in enumerate(lines[1:], start=1) if line == ""), -1)
    signature_start = lines.index(signature)
    signature_finish = lines.index(signature_end)
    if header_end < 0 or header_end >= signature_start or signature_finish <= signature_start:
        raise ProvenanceError("malformed clear-signed InRelease headers or signature block")
    if any(line.strip() for line in lines[signature_finish + 1:]):
        raise ProvenanceError("clear-signed InRelease contains trailing data after its signature")
    header_names: set[str] = set()
    for line in lines[1:header_end]:
        if ":" not in line:
            raise ProvenanceError("malformed clear-signed InRelease armor header")
        name, _ = line.split(":", 1)
        if not re.fullmatch(r"[A-Za-z0-9-]+", name) or name.lower() in header_names:
            raise ProvenanceError("invalid or duplicate clear-signed InRelease armor header")
        header_names.add(name.lower())
    if "hash" not in header_names:
        raise ProvenanceError("clear-signed InRelease has no Hash armor header")
    body_lines = lines[header_end + 1:signature_start]
    for line in body_lines:
        if line.startswith("-") and not line.startswith("- "):
            raise ProvenanceError("malformed RFC 4880 dash-escaped Release body")
    # RFC 4880 dash escaping is removed before parsing the signed Release body.
    return "\n".join(line[2:] if line.startswith("- ") else line for line in body_lines).rstrip("\n") + "\n"


def release_hashes(release_body: str) -> dict[str, tuple[str, int]]:
    records = parse_deb822(release_body)
    if len(records) != 1:
        raise ProvenanceError("Release body must contain exactly one field paragraph")
    raw = records[0].get("SHA256")
    if raw is None:
        raise ProvenanceError("signed Release metadata has no SHA256 index")
    result: dict[str, tuple[str, int]] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        fields = line.split()
        if len(fields) != 3 or not SHA256_RE.fullmatch(fields[0]) or not fields[1].isdigit():
            raise ProvenanceError("malformed signed Release SHA256 row")
        path = fields[2]
        if path.startswith("/") or any(part in {".", ".."} for part in pathlib.PurePosixPath(path).parts) or path in result:
            raise ProvenanceError("unsafe or duplicate signed Release index path")
        result[path] = (fields[0], int(fields[1]))
    return result


def release_fields(release_body: str) -> dict[str, str]:
    records = parse_deb822(release_body)
    if len(records) != 1:
        raise ProvenanceError("Release body must contain exactly one field paragraph")
    return records[0]


def parse_utc(value: str, field: str) -> dt.datetime:
    try:
        parsed = dt.datetime.strptime(value, "%a, %d %b %Y %H:%M:%S %Z")
    except ValueError as error:
        raise ProvenanceError(f"invalid signed Release {field} timestamp") from error
    return parsed.replace(tzinfo=dt.timezone.utc)


def validate_release(
    body: str,
    *,
    expected_origin: str,
    expected_codename: str,
    expected_component: str,
    architecture: str,
    now: dt.datetime,
    max_age_seconds: int,
    max_future_skew_seconds: int,
    require_valid_until: bool,
    expected_suite: str | None = None,
    expected_label: str | None = None,
) -> dict[str, Any]:
    fields = release_fields(body)
    required = {"Origin", "Codename", "Date", "Architectures", "Components"}
    missing = required - fields.keys()
    if missing:
        raise ProvenanceError("signed Release missing required identity fields: " + ", ".join(sorted(missing)))
    if fields["Origin"] != expected_origin or fields["Codename"] != expected_codename:
        raise ProvenanceError("signed Release origin or codename does not match policy")
    if expected_suite and fields.get("Suite") != expected_suite:
        raise ProvenanceError("signed Release suite does not match policy")
    if expected_label and fields.get("Label") != expected_label:
        raise ProvenanceError("signed Release label does not match policy")
    if expected_component not in fields["Components"].split():
        raise ProvenanceError("signed Release does not publish the required component")
    architectures = set(fields["Architectures"].split())
    if architecture not in architectures:
        raise ProvenanceError("signed Release does not publish the required architecture")
    release_date = parse_utc(fields["Date"], "Date")
    age = (now.astimezone(dt.timezone.utc) - release_date).total_seconds()
    if age < -max_future_skew_seconds:
        raise ProvenanceError("signed Release Date is too far in the future")
    if age > max_age_seconds:
        raise ProvenanceError("signed Release Date exceeds the configured freshness window")
    valid_until = fields.get("Valid-Until")
    if require_valid_until and not valid_until:
        raise ProvenanceError("signed Release has no required Valid-Until")
    if valid_until:
        expiry = parse_utc(valid_until, "Valid-Until")
        if expiry < now.astimezone(dt.timezone.utc):
            raise ProvenanceError("signed Release has expired according to Valid-Until")
        if expiry < release_date:
            raise ProvenanceError("signed Release Valid-Until precedes Date")
    return {
        "origin": fields["Origin"],
        "label": fields.get("Label"),
        "suite": fields.get("Suite"),
        "codename": fields["Codename"],
        "date": release_date.isoformat().replace("+00:00", "Z"),
        "validUntil": parse_utc(valid_until, "Valid-Until").isoformat().replace("+00:00", "Z") if valid_until else None,
        "architectures": sorted(architectures),
        "components": fields["Components"].split(),
        "sha256IndexCount": len(release_hashes(body)),
    }


def verified_signers(status_text: str, trusted_primary_fingerprints: Iterable[str] | None = None) -> list[dict[str, str]]:
    trusted = {item.upper() for item in trusted_primary_fingerprints} if trusted_primary_fingerprints is not None else None
    signers: list[dict[str, str]] = []
    for line in status_text.splitlines():
        if "[GNUPG:] " not in line:
            continue
        fields = line.split("[GNUPG:] ", 1)[1].split()
        if not fields:
            continue
        code = fields[0]
        if code in BAD_GPG_STATUSES:
            raise ProvenanceError(f"OpenPGP verifier reported unacceptable status: {code}")
        if code not in ALLOWED_GPG_STATUSES:
            raise ProvenanceError(f"OpenPGP verifier returned an unrecognized status: {code}")
        if code != "VALIDSIG":
            continue
        if len(fields) < 11:
            raise ProvenanceError("OpenPGP verifier returned a truncated VALIDSIG record")
        signing_fingerprint = fields[1].upper()
        primary_fingerprint = fields[-1].upper() if len(fields[-1]) == 40 else signing_fingerprint
        if not FINGERPRINT_RE.fullmatch(signing_fingerprint) or not FINGERPRINT_RE.fullmatch(primary_fingerprint):
            raise ProvenanceError("OpenPGP verifier returned an invalid fingerprint")
        if trusted is not None and primary_fingerprint not in trusted:
            raise ProvenanceError("OpenPGP signature primary fingerprint is not in the explicit trust set")
        signers.append({"signingFingerprint": signing_fingerprint, "primaryFingerprint": primary_fingerprint})
    if not signers:
        raise ProvenanceError("OpenPGP verifier returned no valid signature")
    unique = {(item["signingFingerprint"], item["primaryFingerprint"]): item for item in signers}
    return [unique[key] for key in sorted(unique)]


def parse_apt_print_uris(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("'"):
            continue
        match = re.fullmatch(r"'([^']+)'\s+(\S+)\s+(\d+)\s+(\S+)", line)
        if not match:
            raise ProvenanceError("malformed APT --print-uris record")
        uri, filename, size, digest = match.groups()
        parsed = urllib.parse.urlparse(uri)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.port not in (None, 443) or parsed.query or parsed.fragment
                or "/" in filename or filename in {".", ".."}):
            raise ProvenanceError("APT selected an unsafe or non-HTTPS package URI")
        rows.append({"uri": uri, "filename": filename, "size": int(size), "aptDigest": digest})
    if not rows:
        raise ProvenanceError("APT dependency plan contains no package downloads")
    filenames = [row["filename"] for row in rows]
    if len(filenames) != len(set(filenames)):
        raise ProvenanceError("APT dependency plan contains duplicate package filenames")
    return rows


def verify_dependency_filenames(plan: list[dict[str, Any]], downloaded: Iterable[str]) -> None:
    expected = {item["filename"] for item in plan}
    actual = set(downloaded)
    if expected != actual:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ProvenanceError(f"downloaded package closure differs from APT plan; missing={missing}, extra={extra}")


def find_index_record(
    indexes: Iterable[tuple[str, Iterable[dict[str, str]]]], package: str, version: str, architecture: str, filename: str
) -> tuple[dict[str, str], list[str]]:
    matches: list[tuple[dict[str, str], str]] = []
    for origin, records in indexes:
        for record in records:
            if (
                record.get("Package") == package
                and record.get("Version") == version
                and record.get("Architecture") == architecture
                and record.get("Filename") == filename
            ):
                matches.append((record, origin))
    if not matches:
        raise ProvenanceError(f"no authenticated Packages stanza matches {package}={version}:{architecture}")
    canonical_records = {json.dumps(item, sort_keys=True, separators=(",", ":")) for item, _ in matches}
    if len(canonical_records) != 1:
        raise ProvenanceError(f"authenticated package indexes disagree about package metadata for {filename}")
    hashes = {(item.get("SHA256"), item.get("Size")) for item, _ in matches}
    if len(hashes) != 1:
        raise ProvenanceError(f"authenticated package indexes disagree about {filename}")
    return matches[0][0], sorted({origin for _, origin in matches})


def effective_source(record: dict[str, str]) -> dict[str, str]:
    package = record.get("Package", "")
    version = record.get("Version", "")
    source = record.get("Source")
    if source is None or source == "":
        return {"name": package, "version": version}
    match = re.fullmatch(r"([a-z0-9][a-z0-9+.-]*)(?: \(([^()]+)\))?", source)
    if not match:
        raise ProvenanceError("invalid Debian Source field")
    return {"name": match.group(1), "version": match.group(2) or version}


def repo_and_filename(uri: str, repositories: Iterable[tuple[str, str]]) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(uri)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.query or parsed.fragment):
        raise ProvenanceError("APT package URI must be an unambiguous HTTPS URL")
    if re.search(r"%(?:2f|5c|00)", parsed.path, re.IGNORECASE):
        raise ProvenanceError("APT package URI contains an encoded path separator or NUL")
    path = urllib.parse.unquote(parsed.path)
    for origin, base_uri in repositories:
        base = urllib.parse.urlparse(base_uri)
        prefix = base.path.rstrip("/") + "/"
        if parsed.hostname == base.hostname and path.startswith(prefix):
            filename = path[len(prefix):]
            if not filename or filename.startswith("/") or any(part in {".", ".."} for part in pathlib.PurePosixPath(filename).parts):
                raise ProvenanceError("APT package URI has an unsafe repository-relative path")
            return origin, filename
    raise ProvenanceError("APT package URI does not map to an explicitly configured repository")


def verify_package_metadata(
    record: dict[str, str], package_fields: dict[str, str], data: bytes, *, expected_size: int
) -> dict[str, Any]:
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != expected_size or record.get("Size") != str(expected_size):
        raise ProvenanceError("package payload size differs from the authenticated Packages stanza")
    if record.get("SHA256") != digest:
        raise ProvenanceError("package payload SHA-256 differs from the authenticated Packages stanza")
    for field in ("Package", "Version", "Architecture", "Depends", "Pre-Depends"):
        expected = record.get(field, "")
        actual = package_fields.get(field, "")
        if expected != actual:
            raise ProvenanceError(f"package control field differs from authenticated Packages stanza: {field}")
    source = effective_source(record)
    if source != effective_source(package_fields):
        raise ProvenanceError("package control Source identity differs from authenticated Packages stanza")
    return {"sha256": digest, "size": len(data), "package": record["Package"], "version": record["Version"], "architecture": record["Architecture"], "source": source}


def run(command: list[str], *, cwd: pathlib.Path | None = None, log: pathlib.Path | None = None,
        env: dict[str, str] | None = None) -> str:
    result = subprocess.run(command, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    output = result.stdout or ""
    if log:
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text(output, encoding="utf-8")
    if result.returncode:
        raise ProvenanceError(f"command failed ({result.returncode}): {' '.join(command[:4])}; see {log or 'job output'}")
    return output


def write_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def verify_gpgv(inrelease: pathlib.Path, keyring: pathlib.Path, log_dir: pathlib.Path,
                trusted_primaries: Iterable[str] | None = None) -> list[dict[str, str]]:
    status_path = log_dir / (inrelease.name + ".gpg-status.txt")
    stderr_path = log_dir / (inrelease.name + ".gpg-stderr.txt")
    result = subprocess.run(
        ["gpgv", "--status-fd", "1", "--keyring", str(keyring), str(inrelease)],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    status_path.write_text(result.stdout, encoding="utf-8")
    stderr_path.write_text(result.stderr, encoding="utf-8")
    if result.returncode:
        raise ProvenanceError(f"InRelease signature verification failed for {inrelease.name}")
    return verified_signers(result.stdout, trusted_primaries)


def read_json(path: pathlib.Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProvenanceError(f"cannot read JSON evidence {path.name}") from error
    if not isinstance(value, dict):
        raise ProvenanceError(f"expected JSON object in {path.name}")
    return value


def parse_dpkg_fields(text: str) -> dict[str, str]:
    records = parse_deb822(text)
    if len(records) != 1:
        raise ProvenanceError("deb control data must contain one paragraph")
    return records[0]


def check_command(name: str) -> None:
    if shutil.which(name) is None:
        raise ProvenanceError(f"required command is unavailable: {name}")


def write_apt_sources(path: pathlib.Path, sources: list[tuple[str, str, pathlib.Path]]) -> None:
    lines = [
        f"deb [arch=amd64 signed-by={keyring} check-valid-until=yes] {uri} {suite} main"
        for uri, suite, keyring in sources
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def new_apt_state(parent: pathlib.Path, name: str) -> pathlib.Path:
    state = parent / name
    (state / "lists/partial").mkdir(parents=True)
    (state / "archives/partial").mkdir(parents=True)
    (state / "status").write_text("", encoding="utf-8")
    (state / "extended_states").write_text("", encoding="utf-8")
    return state


def run_apt_update(state: pathlib.Path, source_list: pathlib.Path, log_dir: pathlib.Path) -> str:
    command = apt_command(state, source_list, "update")
    command[-1:-1] = ["-o", "Acquire::Retries=2", "-o", "Acquire::https::Timeout=45"]
    return run(command, env=apt_environment(), log=log_dir / f"{state.name}-apt-update.log")


def unique_files(directory: pathlib.Path, pattern: str, label: str) -> list[pathlib.Path]:
    values = sorted(path for path in directory.glob(pattern) if path.is_file())
    if not values:
        raise ProvenanceError(f"no {label} files found in isolated APT state")
    return values


def apt_release_from_state(state: pathlib.Path, label: str) -> pathlib.Path:
    releases = unique_files(state / "lists", "*InRelease", label)
    if len(releases) != 1:
        raise ProvenanceError(f"expected one signed InRelease for {label}; found {len(releases)}")
    return releases[0]


def decompress_apt_index(source: pathlib.Path, destination: pathlib.Path, log_dir: pathlib.Path) -> None:
    result = subprocess.run(["apt-helper", "cat-file", str(source)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        (log_dir / f"{source.name}.decompress-stderr.txt").write_bytes(result.stderr)
        raise ProvenanceError(f"cannot decompress APT index {source.name}")
    destination.write_bytes(result.stdout)


def choose_packages_index(release: str, component: str, architecture: str) -> str:
    indexes = release_hashes(release)
    prefix = f"{component}/binary-{architecture}/Packages"
    for suffix in (".xz", ".gz", ""):
        candidate = prefix + suffix
        if candidate in indexes:
            return candidate
    raise ProvenanceError(f"signed Release has no supported package index for {prefix}")


def download_signed_index(
    *, base_uri: str, suite: str, release_body: str, index_path: str, destination: pathlib.Path,
    apt_cached_index: pathlib.Path, log_dir: pathlib.Path,
) -> tuple[bytes, dict[str, Any]]:
    expected_hash, expected_size = release_hashes(release_body)[index_path]
    url = f"{base_uri.rstrip('/')}/dists/{suite}/{index_path}"
    run(["curl", "--fail", "--show-error", "--silent", "--location", "--retry", "2", "--connect-timeout", "20", url, "--output", str(destination)], log=log_dir / (destination.name + ".curl.log"))
    data = destination.read_bytes()
    if len(data) != expected_size or hashlib.sha256(data).hexdigest() != expected_hash:
        raise ProvenanceError(f"downloaded package index differs from signed Release metadata: {index_path}")
    unpacked = destination.with_suffix(destination.suffix + ".unpacked")
    if index_path.endswith(".xz"):
        import lzma
        unpacked_data = lzma.decompress(data)
    elif index_path.endswith(".gz"):
        import gzip
        unpacked_data = gzip.decompress(data)
    else:
        unpacked_data = data
    unpacked.write_bytes(unpacked_data)
    cached = destination.with_suffix(destination.suffix + ".apt-cache")
    decompress_apt_index(apt_cached_index, cached, log_dir)
    if cached.read_bytes() != unpacked_data:
        raise ProvenanceError("APT did not consume the exact package-index bytes verified against InRelease")
    return unpacked_data, {
        "uri": url,
        "path": index_path,
        "sha256": expected_hash,
        "size": expected_size,
        "uncompressedSha256": hashlib.sha256(unpacked_data).hexdigest(),
        "aptCacheFile": apt_cached_index.name,
    }


def verify_apt_package_index(
    *, state: pathlib.Path, release: pathlib.Path, base_uri: str, suite: str,
    release_body: str, evidence_dir: pathlib.Path, log_dir: pathlib.Path, label: str,
    apt_cached_index: pathlib.Path | None = None,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    candidates: list[pathlib.Path]
    if apt_cached_index is not None:
        candidates = [apt_cached_index]
    else:
        patterns = ("*binary-amd64_Packages.lz4", "*binary-amd64_Packages")
        candidates = []
        for pattern in patterns:
            candidates.extend(unique_files(state / "lists", pattern, label) if list((state / "lists").glob(pattern)) else [])
        candidates = sorted(set(candidates))
    if len(candidates) != 1:
        raise ProvenanceError(f"expected exactly one cached amd64 Packages index for {label}; found {len(candidates)}")
    relative_path = choose_packages_index(release_body, "main", "amd64")
    raw_name = f"{label}-Packages" + pathlib.PurePosixPath(relative_path).suffix
    raw_path = evidence_dir / raw_name
    index_bytes, index_metadata = download_signed_index(
        base_uri=base_uri, suite=suite, release_body=release_body, index_path=relative_path,
        destination=raw_path, apt_cached_index=candidates[0], log_dir=log_dir,
    )
    try:
        index_text = index_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ProvenanceError(f"{label} Packages index is not valid UTF-8") from error
    records = parse_deb822(index_text)
    if not records:
        raise ProvenanceError(f"{label} Packages index is empty")
    index_metadata.update({"origin": label, "recordCount": len(records), "releaseSha256": sha256_file(release)})
    return records, index_metadata


def release_evidence(
    *, inrelease: pathlib.Path, keyring: pathlib.Path, trusted_primaries: Iterable[str] | None,
    policy: dict[str, Any], expected_origin: str, expected_codename: str,
    expected_component: str, expected_label: str | None, expected_suite: str | None,
    max_age: int, max_clock_skew: int, require_valid_until: bool,
    log_dir: pathlib.Path,
) -> tuple[str, list[dict[str, str]], dict[str, Any]]:
    signers = verify_gpgv(inrelease, keyring, log_dir, trusted_primaries)
    body = cleartext_release_body(inrelease.read_bytes())
    now = dt.datetime.now(dt.timezone.utc)
    parsed = validate_release(
        body,
        expected_origin=expected_origin,
        expected_codename=expected_codename,
        expected_component=expected_component,
        architecture=policy["architecture"],
        now=now,
        max_age_seconds=max_age,
        max_future_skew_seconds=max_clock_skew,
        require_valid_until=require_valid_until,
        expected_suite=expected_suite,
        expected_label=expected_label,
    )
    return body, signers, {
        **parsed,
        "inReleaseFile": inrelease.name,
        "inReleaseSha256": sha256_file(inrelease),
        "signers": signers,
    }


def apt_candidate_version(state: pathlib.Path, source_list: pathlib.Path, package: str, log_dir: pathlib.Path) -> str:
    output = run(apt_cache_command(state, source_list, "policy", package), env=apt_environment(), log=log_dir / f"{package}-apt-policy.log")
    match = re.search(r"^\s*Candidate:\s+(\S+)\s*$", output, re.MULTILINE)
    if not match or match.group(1) == "(none)":
        raise ProvenanceError(f"APT has no candidate version for {package}")
    return match.group(1)


def dpkg_fields(deb_path: pathlib.Path, log_dir: pathlib.Path) -> dict[str, str]:
    return parse_dpkg_fields(run(["dpkg-deb", "--field", str(deb_path)], log=log_dir / (deb_path.name + ".dpkg-fields.txt")))


def keyring_fingerprints(keyring_path: pathlib.Path, log_dir: pathlib.Path) -> list[str]:
    output = run(["gpg", "--batch", "--show-keys", "--with-colons", str(keyring_path)], log=log_dir / (keyring_path.name + ".fingerprints.txt"))
    result = sorted({line.split(":")[9].upper() for line in output.splitlines() if line.startswith("fpr:") and len(line.split(":")) > 9})
    if not result or any(not FINGERPRINT_RE.fullmatch(item) for item in result):
        raise ProvenanceError("extracted Debian archive keyring has no valid primary/subkey fingerprints")
    return result


def primary_fingerprints_from_key_listing(output: str) -> list[str]:
    result: list[str] = []
    awaiting_primary = False
    for line in output.splitlines():
        fields = line.split(":")
        if fields[0] == "pub":
            awaiting_primary = True
        elif fields[0] in {"sub", "ssb"}:
            awaiting_primary = False
        elif fields[0] == "fpr" and awaiting_primary:
            if len(fields) <= 9 or not FINGERPRINT_RE.fullmatch(fields[9].upper()):
                raise ProvenanceError("OpenPGP key listing contains an invalid primary fingerprint")
            result.append(fields[9].upper())
            awaiting_primary = False
    return sorted(set(result))


def copy_evidence(source: pathlib.Path, destination: pathlib.Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def run_download_plan(state: pathlib.Path, source_list: pathlib.Path, root_package: str, root_version: str,
                      log_dir: pathlib.Path) -> tuple[list[dict[str, Any]], pathlib.Path]:
    request = f"{root_package}={root_version}"
    package_args = ["--yes", "--no-install-recommends", "--no-remove", "install", request]
    plan_output = run(apt_command(state, source_list, "--print-uris", *package_args), env=apt_environment(), log=log_dir / "apt-dependency-plan.log")
    plan = parse_apt_print_uris(plan_output)
    run(apt_command(state, source_list, "--download-only", *package_args), env=apt_environment(), log=log_dir / "apt-download-closure.log")
    archives = state / "archives"
    downloaded = sorted(path for path in archives.glob("*.deb") if path.is_file())
    verify_dependency_filenames(plan, [path.name for path in downloaded])
    return plan, archives


def init_record(output_dir: pathlib.Path, status: str, reason: str | None = None) -> dict[str, Any]:
    record = {
        "schemaVersion": 1,
        "status": status,
        "reason": reason,
        "generatedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "runtimeVerification": False,
        "imageSelection": False,
        "scannerClearance": False,
        "cveDisposition": False,
        "productionClearance": False,
    }
    write_json(output_dir / "status.json", record)
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=pathlib.Path)
    args = parser.parse_args(argv)
    output_dir = args.output_dir.resolve()
    runner_temp = pathlib.Path(os.environ.get("RUNNER_TEMP", "/tmp")).resolve()
    try:
        output_dir.relative_to(runner_temp)
    except ValueError as error:
        raise ProvenanceError("output directory must remain inside RUNNER_TEMP") from error
    if output_dir == runner_temp or output_dir == pathlib.Path("/"):
        raise ProvenanceError("output directory must be a dedicated RUNNER_TEMP child")
    output_dir.mkdir(parents=True, exist_ok=True)
    unexpected = [item.name for item in output_dir.iterdir() if item.name != "status.json"]
    if unexpected:
        raise ProvenanceError("output directory contains unexpected files: " + ", ".join(unexpected))
    status_path = output_dir / "status.json"
    status = read_json(status_path) if status_path.exists() else init_record(output_dir, "INCONCLUSIVE", "provenance collection has not completed")
    try:
        execute(output_dir, status)
        status.update({"status": "PASS", "reason": None})
        write_json(output_dir / "status.json", status)
        return 0
    except Exception as error:  # Preserve failure evidence for the always-upload step.
        status.update({"status": "FAIL", "reason": str(error)})
        write_json(output_dir / "status.json", status)
        print(f"Forky provenance failed: {error}", file=sys.stderr)
        return 1


def apt_command(state_dir: pathlib.Path, source_list: pathlib.Path, *args: str) -> list[str]:
    return [
        "apt-get",
        "-o", "Dir::Etc::main=/dev/null",
        "-o", "Dir::Etc::parts=-",
        "-o", f"Dir::Etc::sourcelist={source_list}",
        "-o", "Dir::Etc::sourceparts=-",
        "-o", "Dir::Etc::preferences=/dev/null",
        "-o", "Dir::Etc::preferencesparts=-",
        "-o", "Dir::Etc::trusted=/dev/null",
        "-o", "Dir::Etc::trustedparts=-",
        "-o", f"Dir::State::lists={state_dir / 'lists'}",
        "-o", f"Dir::State::status={state_dir / 'status'}",
        "-o", f"Dir::State::extended_states={state_dir / 'extended_states'}",
        "-o", f"Dir::Cache::archives={state_dir / 'archives'}",
        "-o", f"Dir::Cache::pkgcache={state_dir / 'pkgcache.bin'}",
        "-o", f"Dir::Cache::srcpkgcache={state_dir / 'srcpkgcache.bin'}",
        "-o", "APT::Architecture=amd64",
        "-o", "APT::Architectures=amd64",
        "-o", "APT::Get::List-Cleanup=0",
        "-o", "Acquire::Check-Valid-Until=true",
        "-o", "Acquire::AllowInsecureRepositories=false",
        *args,
    ]


def apt_cache_command(state_dir: pathlib.Path, source_list: pathlib.Path, *args: str) -> list[str]:
    return [
        "apt-cache",
        "-o", "Dir::Etc::main=/dev/null",
        "-o", "Dir::Etc::parts=-",
        "-o", f"Dir::Etc::sourcelist={source_list}",
        "-o", "Dir::Etc::sourceparts=-",
        "-o", "Dir::Etc::preferences=/dev/null",
        "-o", "Dir::Etc::preferencesparts=-",
        "-o", "Dir::Etc::trusted=/dev/null",
        "-o", "Dir::Etc::trustedparts=-",
        "-o", f"Dir::State::lists={state_dir / 'lists'}",
        "-o", f"Dir::State::status={state_dir / 'status'}",
        "-o", f"Dir::State::extended_states={state_dir / 'extended_states'}",
        "-o", f"Dir::Cache::pkgcache={state_dir / 'pkgcache.bin'}",
        "-o", f"Dir::Cache::srcpkgcache={state_dir / 'srcpkgcache.bin'}",
        "-o", "APT::Architecture=amd64",
        "-o", "APT::Architectures=amd64",
        *args,
    ]


def apt_environment() -> dict[str, str]:
    env = os.environ.copy()
    for key in ("APT_CONFIG", "http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        env.pop(key, None)
    env["APT_CONFIG"] = "/dev/null"
    return env


def execute(output_dir: pathlib.Path, status: dict[str, Any]) -> None:
    policy = read_json(POLICY_PATH)
    quality_result = os.environ.get("UPSTREAM_QUALITY_RESULT", "")
    source_result = os.environ.get("UPSTREAM_PROVENANCE_RESULT", "")
    if quality_result != "success" or source_result != "success":
        raise ProvenanceError(f"prerequisite jobs did not succeed (quality={quality_result or 'missing'}, source-provenance={source_result or 'missing'})")

    runner_temp = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve()
    log_dir = output_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    for command in ("apt-get", "apt-cache", "apt-helper", "curl", "dpkg-deb", "gpg", "gpgv", "node", "python3"):
        check_command(command)
    run(["node", "--check", str(CONSUMER_PATH)], log=log_dir / "consumer-node-check.log")
    run(["node", "--test", str(CONSUMER_TEST_PATH)], log=log_dir / "consumer-node-tests.log")

    with tempfile.TemporaryDirectory(prefix="taky-forky-provenance.", dir=runner_temp) as temp_name:
        work = pathlib.Path(temp_name)
        source_inputs = work / "source-inputs"
        consumer_env = os.environ.copy()
        consumer_env.update({"OUTPUT_DIR": str(source_inputs)})
        consumer_result = run(["node", str(CONSUMER_PATH)], env=consumer_env, log=log_dir / "consume-source-artifact.log")
        consume_result = json.loads(consumer_result)
        verified_inputs = read_json(source_inputs / "verified-inputs.json")
        source_manifest = read_json(source_inputs / "provenance.json")

        source_artifact = verified_inputs["sourceArtifact"]
        keyring_package_relative = verified_inputs["debianKeyringPackagePath"]
        keyring_package = source_inputs / keyring_package_relative
        if sha256_file(keyring_package) != verified_inputs["debianKeyringPackageSha256"]:
            raise ProvenanceError("artifact-verified Debian keyring package digest differs from its manifest")
        base_keyring_dir = work / "artifact-keyring"
        base_keyring_dir.mkdir()
        run(["dpkg-deb", "-x", str(keyring_package), str(base_keyring_dir)], log=log_dir / "extract-artifact-keyring.log")
        base_keyring = base_keyring_dir / "usr/share/keyrings/debian-archive-keyring.gpg"
        if not base_keyring.is_file():
            raise ProvenanceError("authenticated source artifact does not contain the expected Debian keyring")
        bootstrap = source_manifest.get("debianArchiveKeyringBootstrap", {})
        trixie = source_manifest.get("debian", {})
        bookworm_snapshot = bootstrap.get("snapshot")
        bookworm_uri = bootstrap.get("uri")
        if bootstrap.get("suite") != "bookworm" or not isinstance(bookworm_snapshot, str) or not re.fullmatch(r"20[0-9]{6}T[0-9]{6}Z", bookworm_snapshot):
            raise ProvenanceError("source artifact does not bind an exact Bookworm keyring bootstrap snapshot")
        if bookworm_uri != f"https://snapshot.debian.org/archive/debian/{bookworm_snapshot}":
            raise ProvenanceError("Bookworm keyring bootstrap URI differs from its artifact snapshot identity")
        if verified_inputs.get("debianKeyringPackageSha256") != bootstrap.get("keyringPackageSha256"):
            raise ProvenanceError("verified input and source manifest disagree on the Bookworm keyring package digest")
        if sha256_file(base_keyring) != bootstrap.get("extractedKeyringSha256"):
            raise ProvenanceError("artifact-derived keyring file differs from the Bookworm bootstrap manifest")
        base_keyring_package_fields = dpkg_fields(keyring_package, log_dir)
        if base_keyring_package_fields.get("Package") != "debian-archive-keyring" or base_keyring_package_fields.get("Version") != bootstrap.get("keyringPackageVersion") or base_keyring_package_fields.get("Architecture") != "all":
            raise ProvenanceError("artifact keyring package control identity differs from the Bookworm bootstrap manifest")
        bookworm_inrelease = source_inputs / "metadata/debian-bookworm-bootstrap.InRelease"
        if sha256_file(bookworm_inrelease) != bootstrap.get("inReleaseSha256"):
            raise ProvenanceError("Bookworm InRelease bytes differ from the same-run source artifact manifest")
        copy_evidence(bookworm_inrelease, output_dir / "metadata/source-bookworm.InRelease")
        recorded_bookworm_signers = set(bootstrap.get("inReleaseSignerFingerprints", []))
        bookworm_signers = verify_gpgv(bookworm_inrelease, base_keyring, log_dir, recorded_bookworm_signers)
        bookworm_body = cleartext_release_body(bookworm_inrelease.read_bytes())
        bookworm_release_info = validate_release(
            bookworm_body,
            expected_origin="Debian",
            expected_codename="bookworm",
            expected_component="main",
            architecture=policy["architecture"],
            now=dt.datetime.now(dt.timezone.utc),
            max_age_seconds=policy["debianKeyringTransition"]["maxMetadataAgeSeconds"],
            max_future_skew_seconds=policy["debianKeyringTransition"]["maxFutureClockSkewSeconds"],
            require_valid_until=False,
            expected_suite="oldstable",
        )
        bookworm_release_info.update({"inReleaseSha256": sha256_file(bookworm_inrelease), "signers": bookworm_signers, "snapshot": bookworm_snapshot})
        bookworm_index_path = source_inputs / "metadata/debian-bookworm-bootstrap.Packages.apt-cache"
        if sha256_file(bookworm_index_path) != bootstrap["authenticatedPackagesIndex"]["sha256"]:
            raise ProvenanceError("Bookworm apt package-index bytes differ from the source artifact manifest")
        bookworm_index_name = (source_inputs / "metadata/debian-bookworm-bootstrap.Packages.apt-cache.name").read_text(encoding="utf-8").strip()
        if bookworm_index_name != bootstrap["authenticatedPackagesIndex"]["name"]:
            raise ProvenanceError("Bookworm APT package-index filename differs from the source artifact manifest")
        copy_evidence(bookworm_index_path, output_dir / "metadata/source-bookworm.Packages.apt-cache")
        copy_evidence(source_inputs / "provenance.json", output_dir / "metadata/source-provenance.json")
        bookworm_index_path_in_release = choose_packages_index(bookworm_body, "main", "amd64")
        bookworm_index_bytes, bookworm_index_info = download_signed_index(
            base_uri=bookworm_uri, suite="bookworm", release_body=bookworm_body,
            index_path=bookworm_index_path_in_release,
            destination=output_dir / "metadata/source-bookworm-Packages.xz",
            apt_cached_index=bookworm_index_path, log_dir=log_dir,
        )
        bookworm_index_records = parse_deb822(bookworm_index_bytes.decode("utf-8"))
        bookworm_keyring_records = [record for record in bookworm_index_records
                                    if record.get("Package") == "debian-archive-keyring"
                                    and record.get("Version") == bootstrap.get("keyringPackageVersion")
                                    and record.get("Architecture") == "all"]
        if len(bookworm_keyring_records) != 1:
            raise ProvenanceError("Bookworm signed Packages index does not contain exactly one bootstrapped keyring package stanza")
        bookworm_keyring_record = bookworm_keyring_records[0]
        bookworm_keyring_verified = verify_package_metadata(
            bookworm_keyring_record, base_keyring_package_fields, keyring_package.read_bytes(),
            expected_size=int(bookworm_keyring_record["Size"]),
        )
        if bookworm_keyring_verified["sha256"] != bootstrap.get("keyringPackageSha256"):
            raise ProvenanceError("Bookworm keyring package hash differs from the bootstrap provenance manifest")
        bookworm_index_info.update({"origin": "debian-bookworm-bootstrap", "recordCount": len(bookworm_index_records),
                                    "aptArtifactIndexFile": bookworm_index_name})

        if trixie.get("suite") != "trixie" or trixie.get("codename", "trixie") not in ("trixie", None):
            raise ProvenanceError("source artifact does not describe the expected Trixie bootstrap")
        snapshot = trixie.get("snapshot")
        base_uri = trixie.get("uri")
        if not isinstance(snapshot, str) or not re.fullmatch(r"20[0-9]{6}T[0-9]{6}Z", snapshot):
            raise ProvenanceError("source artifact has an invalid pinned Trixie snapshot")
        expected_snapshot_uri = f"https://snapshot.debian.org/archive/debian/{snapshot}"
        if base_uri != expected_snapshot_uri:
            raise ProvenanceError("Trixie snapshot URI differs from the artifact-verified snapshot identity")
        trixie_inrelease = source_inputs / "metadata/debian-trixie.InRelease"
        if sha256_file(trixie_inrelease) != verified_inputs["debianInReleaseSha256"]:
            raise ProvenanceError("Trixie InRelease bytes differ from the same-run source artifact manifest")
        if sha256_file(trixie_inrelease) != trixie["releaseInReleaseSha256"]:
            raise ProvenanceError("Trixie InRelease bytes differ from the source provenance manifest")
        copy_evidence(trixie_inrelease, output_dir / "metadata/source-trixie.InRelease")
        copy_evidence(keyring_package, output_dir / "metadata/source-debian-archive-keyring.deb")

        required_trixie_signers = set(bootstrap.get("requiredTrixieSignerFingerprints", []))
        recorded_trixie_signers = set(trixie.get("releaseSignerFingerprints", []))
        if not required_trixie_signers or not required_trixie_signers.issubset(recorded_trixie_signers):
            raise ProvenanceError("source artifact does not bind its required Trixie archive signer set")
        base_trixie_signers = verify_gpgv(trixie_inrelease, base_keyring, log_dir, recorded_trixie_signers)
        if not any(item["primaryFingerprint"] in required_trixie_signers for item in base_trixie_signers):
            raise ProvenanceError("artifact-derived keyring did not verify Trixie InRelease with a required signer")
        trixie_body = cleartext_release_body(trixie_inrelease.read_bytes())
        transition_policy = policy["debianKeyringTransition"]
        trixie_release_info = validate_release(
            trixie_body,
            expected_origin=transition_policy["bootstrapOrigin"],
            expected_codename=transition_policy["bootstrapCodename"],
            expected_component="main",
            architecture=policy["architecture"],
            now=dt.datetime.now(dt.timezone.utc),
            max_age_seconds=transition_policy["maxMetadataAgeSeconds"],
            max_future_skew_seconds=transition_policy["maxFutureClockSkewSeconds"],
            require_valid_until=False,
        )
        trixie_release_info.update({"inReleaseSha256": sha256_file(trixie_inrelease), "signers": base_trixie_signers})

        trixie_state = new_apt_state(work, "apt-trixie")
        trixie_sources = work / "trixie.sources.list"
        write_apt_sources(trixie_sources, [(base_uri, transition_policy["bootstrapSuite"], base_keyring)])
        run_apt_update(trixie_state, trixie_sources, log_dir)
        apt_trixie_inrelease = apt_release_from_state(trixie_state, "Trixie")
        if apt_trixie_inrelease.read_bytes() != trixie_inrelease.read_bytes():
            raise ProvenanceError("isolated APT did not consume the exact artifact-verified Trixie InRelease")
        trixie_index_records, trixie_index_info = verify_apt_package_index(
            state=trixie_state, release=apt_trixie_inrelease, base_uri=base_uri, suite=transition_policy["bootstrapSuite"],
            release_body=trixie_body, evidence_dir=output_dir / "metadata", log_dir=log_dir, label="debian-trixie",
        )
        keyring_version = apt_candidate_version(trixie_state, trixie_sources, "debian-archive-keyring", log_dir)
        keyring_records = [
            record for record in trixie_index_records
            if record.get("Package") == "debian-archive-keyring"
            and record.get("Version") == keyring_version
            and record.get("Architecture") == "all"
        ]
        if len(keyring_records) != 1:
            raise ProvenanceError("Trixie signed index does not contain exactly one candidate keyring package stanza")
        keyring_record = keyring_records[0]
        keyring_filename = keyring_record.get("Filename", "")
        if not keyring_filename or keyring_filename.startswith("/") or any(part in {".", ".."} for part in pathlib.PurePosixPath(keyring_filename).parts):
            raise ProvenanceError("Trixie keyring package stanza has an unsafe Filename")
        keyring_download_dir = work / "keyring-download"
        keyring_download_dir.mkdir()
        upgraded_package = keyring_download_dir / pathlib.PurePosixPath(keyring_filename).name
        keyring_package_uri = base_uri.rstrip("/") + "/" + urllib.parse.quote(keyring_filename, safe="/+")
        run(["curl", "--fail", "--show-error", "--silent", "--location", "--retry", "2", "--connect-timeout", "20", keyring_package_uri, "--output", str(upgraded_package)], log=log_dir / "download-rotated-debian-keyring.log")
        upgraded_fields = dpkg_fields(upgraded_package, log_dir)
        matching_keyring_records = [
            record for record in trixie_index_records
            if record.get("Package") == "debian-archive-keyring"
            and record.get("Version") == keyring_version
            and record.get("Architecture") == "all"
            and record.get("Filename") == keyring_filename
        ]
        if len(matching_keyring_records) != 1:
            raise ProvenanceError("keyring package does not have exactly one matching authenticated Trixie Packages stanza")
        keyring_record = matching_keyring_records[0]
        upgraded_package_result = verify_package_metadata(
            keyring_record, upgraded_fields, upgraded_package.read_bytes(), expected_size=int(keyring_record["Size"]),
        )
        copy_evidence(upgraded_package, output_dir / "metadata" / upgraded_package.name)
        upgraded_keyring_dir = work / "upgraded-keyring"
        upgraded_keyring_dir.mkdir()
        run(["dpkg-deb", "-x", str(upgraded_package), str(upgraded_keyring_dir)], log=log_dir / "extract-rotated-debian-keyring.log")
        debian_keyring = upgraded_keyring_dir / "usr/share/keyrings/debian-archive-keyring.gpg"
        if not debian_keyring.is_file():
            raise ProvenanceError("authenticated Trixie keyring package lacks the expected combined keyring")
        debian_keyring_hash = sha256_file(debian_keyring)
        debian_fingerprints = keyring_fingerprints(debian_keyring, log_dir)

        pgdg = policy["pgdg"]
        pgdg_ascii = output_dir / "metadata/pgdg-signing-key.asc"
        run(["curl", "--fail", "--show-error", "--silent", "--location", "--retry", "2", "--connect-timeout", "20", pgdg["keyUrl"], "--output", str(pgdg_ascii)], log=log_dir / "download-pgdg-key.log")
        pgdg_keyring = work / "pgdg-signing-key.gpg"
        run(["gpg", "--batch", "--yes", "--dearmor", "--output", str(pgdg_keyring), str(pgdg_ascii)], log=log_dir / "dearmor-pgdg-key.log")
        pgdg_key_listing = run(["gpg", "--batch", "--show-keys", "--with-colons", str(pgdg_keyring)], log=log_dir / "pgdg-primary-key-fingerprints.txt")
        pgdg_primary_key_fingerprints = primary_fingerprints_from_key_listing(pgdg_key_listing)
        pgdg_key_fingerprints = sorted({line.split(":")[9].upper() for line in pgdg_key_listing.splitlines() if line.startswith("fpr:") and len(line.split(":")) > 9})
        pgdg_primary = pgdg["primaryFingerprint"]
        if pgdg_primary_key_fingerprints != [pgdg_primary]:
            raise ProvenanceError("downloaded PGDG key does not have exactly the pinned PostgreSQL primary fingerprint")
        pgdg_primary_fingerprints = [pgdg_primary]

        debian_policy = policy["debianForky"]
        core_sources = work / "forky-pgdg.sources.list"
        write_apt_sources(core_sources, [
            (debian_policy["uri"], debian_policy["suite"], debian_keyring),
            (pgdg["uri"], pgdg["suite"], pgdg_keyring),
        ])
        core_state = new_apt_state(work, "apt-forky-pgdg")
        run_apt_update(core_state, core_sources, log_dir)
        inrelease_files = unique_files(core_state / "lists", "*InRelease", "Forky and PGDG")
        if len(inrelease_files) != 2:
            raise ProvenanceError(f"expected exactly two current InRelease files; found {len(inrelease_files)}")
        debian_release_path = next((path for path in inrelease_files if "deb.debian.org_debian_dists_forky_" in path.name), None)
        pgdg_release_path = next((path for path in inrelease_files if "apt.postgresql.org_pub_repos_apt_dists_forky-pgdg_" in path.name), None)
        if debian_release_path is None or pgdg_release_path is None:
            raise ProvenanceError("isolated APT Release filenames do not match the two pinned repository URIs")
        copy_evidence(debian_release_path, output_dir / "metadata/debian-forky.InRelease")
        copy_evidence(pgdg_release_path, output_dir / "metadata/pgdg-forky.InRelease")

        max_age = transition_policy["maxMetadataAgeSeconds"]
        max_skew = transition_policy["maxFutureClockSkewSeconds"]
        debian_release = release_evidence(
            inrelease=debian_release_path, keyring=debian_keyring,
            trusted_primaries=debian_policy["primaryFingerprints"],
            policy=policy, expected_origin=debian_policy["origin"], expected_codename=debian_policy["codename"],
            expected_component=debian_policy["component"], expected_label=None, expected_suite=None,
            max_age=max_age, max_clock_skew=max_skew, require_valid_until=True, log_dir=log_dir,
        )[2]
        if debian_release["suite"] not in {"testing", "forky"}:
            raise ProvenanceError("Debian Forky Release suite is neither testing nor forky")
        pgdg_release = release_evidence(
            inrelease=pgdg_release_path, keyring=pgdg_keyring, trusted_primaries=pgdg_primary_fingerprints,
            policy=policy, expected_origin=pgdg["origin"], expected_codename=pgdg["codename"],
            expected_component="main", expected_label=pgdg["label"], expected_suite=pgdg["suite"],
            max_age=pgdg["maxMetadataAgeSeconds"], max_clock_skew=pgdg["maxFutureClockSkewSeconds"],
            require_valid_until=False, log_dir=log_dir,
        )[2]

        debian_index_records, debian_index_info = verify_apt_package_index(
            state=core_state, release=debian_release_path, base_uri=debian_policy["uri"], suite=debian_policy["suite"],
            release_body=cleartext_release_body(debian_release_path.read_bytes()),
            evidence_dir=output_dir / "metadata", log_dir=log_dir, label="debian-forky",
            apt_cached_index=next(path for path in core_state.joinpath("lists").glob("*binary-amd64_Packages*") if "deb.debian.org_debian_dists_forky_" in path.name),
        )
        pgdg_index_records, pgdg_index_info = verify_apt_package_index(
            state=core_state, release=pgdg_release_path, base_uri=pgdg["uri"], suite=pgdg["suite"],
            release_body=cleartext_release_body(pgdg_release_path.read_bytes()),
            evidence_dir=output_dir / "metadata", log_dir=log_dir, label="pgdg-forky",
            apt_cached_index=next(path for path in core_state.joinpath("lists").glob("*binary-amd64_Packages*") if "apt.postgresql.org_pub_repos_apt_dists_forky-pgdg_" in path.name),
        )

        root = policy["rootPackage"]
        if root["requiredOrigin"] != pgdg["origin"]:
            raise ProvenanceError("root package policy origin does not match the pinned PGDG repository")
        plan, archives = run_download_plan(core_state, core_sources, root["name"], root["version"], log_dir)
        package_indexes = [("debian-forky", debian_index_records), ("pgdg-forky", pgdg_index_records)]
        packages_dir = output_dir / "packages"
        packages_dir.mkdir(parents=True, exist_ok=True)
        package_results: list[dict[str, Any]] = []
        for plan_item in plan:
            deb = archives / plan_item["filename"]
            if not deb.is_file():
                raise ProvenanceError(f"APT plan package was not downloaded: {deb.name}")
            fields = dpkg_fields(deb, log_dir)
            planned_origin, planned_filename = repo_and_filename(plan_item["uri"], [
                ("debian-forky", debian_policy["uri"]), ("pgdg-forky", pgdg["uri"]),
            ])
            if pathlib.PurePosixPath(planned_filename).name != deb.name:
                raise ProvenanceError(f"APT URI filename does not match downloaded package name: {deb.name}")
            record, origins = find_index_record(
                [(origin, records) for origin, records in package_indexes if origin == planned_origin],
                fields.get("Package", ""), fields.get("Version", ""),
                fields.get("Architecture", ""), planned_filename,
            )
            if fields.get("Package") == root["name"] and (origins != ["pgdg-forky"] or planned_origin != "pgdg-forky"):
                raise ProvenanceError("pinned PostgreSQL root package is absent from the authenticated PGDG index")
            if int(plan_item["size"]) != int(record.get("Size", "-1")):
                raise ProvenanceError(f"APT plan size differs from authenticated Packages stanza for {deb.name}")
            package_result = verify_package_metadata(record, fields, deb.read_bytes(), expected_size=int(record["Size"]))
            copy_evidence(deb, packages_dir / deb.name)
            package_results.append({**package_result, "filename": record["Filename"], "origins": origins, "aptUri": plan_item["uri"], "depends": record.get("Depends"), "preDepends": record.get("Pre-Depends")})
        package_ids = {(item["package"], item["architecture"]) for item in package_results}
        if len(package_ids) != len(package_results):
            raise ProvenanceError("APT dependency plan contains multiple versions of one package architecture")
        root_results = [item for item in package_results if item["package"] == root["name"]]
        if len(root_results) != 1 or root_results[0]["version"] != root["version"] or "pgdg-forky" not in root_results[0]["origins"]:
            raise ProvenanceError("APT-selected root package does not match the pinned PGDG identity")

        # Store a compact, reviewable package inventory; raw signed indexes remain alongside it.
        manifest = {
            "schemaVersion": 1,
            "status": "PASS",
            "generatedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "workflow": {key: os.environ.get(key) for key in ("GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_EVENT_NAME", "GITHUB_SHA", "PULL_REQUEST_HEAD_SHA")},
            "sourceArtifact": {**source_artifact, "consumed": consume_result},
            "keyringTransition": {
                "artifactBootstrap": {
                    "packageVersion": bootstrap.get("keyringPackageVersion"),
                    "packageSha256": bootstrap.get("keyringPackageSha256"),
                    "extractedKeyringSha256": bootstrap.get("extractedKeyringSha256"),
                    "runnerTrustAnchor": {
                        "keyringPackageVersion": bootstrap.get("preBootstrapRunnerKeyringPackageVersion"),
                        "keyringFileSha256": bootstrap.get("preBootstrapRunnerKeyringFileSha256"),
                    },
                    "bookworm": {**bookworm_release_info,
                                 "packagesIndex": bookworm_index_info,
                                 "keyringPackage": bookworm_keyring_verified,
                                 "inReleaseSigners": bookworm_signers},
                },
                "trixie": {"release": trixie_release_info, "packagesIndex": trixie_index_info,
                           "rotatedKeyringPackage": {**upgraded_package_result, "filename": upgraded_package.name,
                                                     "indexOrigin": "debian-trixie", "indexSha256": trixie_index_info["sha256"]},
                           "extractedKeyringSha256": debian_keyring_hash, "fingerprints": debian_fingerprints},
            },
            "debianForky": {"release": debian_release, "allowedPrimaryFingerprints": debian_policy["primaryFingerprints"],
                            "fingerprintAuthority": "https://ftp-master.debian.org/keys.html",
                            "packagesIndex": debian_index_info},
            "pgdgForky": {"release": pgdg_release, "packagesIndex": pgdg_index_info,
                          "keyUrl": pgdg["keyUrl"], "keyFileSha256": sha256_file(pgdg_ascii),
                          "pinnedPrimaryFingerprint": pgdg_primary, "keyFingerprints": pgdg_key_fingerprints},
            "dependencyClosure": {
                "resolver": "isolated APT with empty dpkg status, amd64, no recommends",
                "command": ["apt-get", "--print-uris", "--yes", "--no-install-recommends", "--no-remove", "install", f"{root['name']}={root['version']}"],
                "rootPackage": root,
                "packages": sorted(package_results, key=lambda item: (item["package"], item["architecture"])),
            },
            "clearance": policy["clearance"],
        }
        write_json(output_dir / "provenance.json", manifest)
        write_json(output_dir / "status.json", {**status, "status": "PASS", "reason": None, "manifestSha256": sha256_file(output_dir / "provenance.json")})
        status.update({"status": "PASS", "reason": None, "manifestSha256": sha256_file(output_dir / "provenance.json")})


if __name__ == "__main__":
    raise SystemExit(main())
