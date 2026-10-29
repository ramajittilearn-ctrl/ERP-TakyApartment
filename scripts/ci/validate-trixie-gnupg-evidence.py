#!/usr/bin/env python3
"""Validate Trixie GnuPG discovery evidence; candidate preparation remains disabled."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import subprocess
from datetime import datetime
from urllib.parse import urlsplit


IMAGE = "postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe"
PLATFORM = "linux/amd64"
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
HEX_GIT = re.compile(r"^[0-9a-f]{40}$")
PROTECTED_PREFIXES = (
    "apt", "gpgv", "sqv", "debian-archive-keyring", "debian-keyring", "postgresql",
    "libpq", "libxml2", "libapt-pkg", "gosu", "ca-certificates",
)
EXPECTED_ORIGINS = {
    "trixie": ("stable", "deb.debian.org", "/debian"),
    "trixie-updates": ("stable-updates", "deb.debian.org", "/debian"),
    "trixie-security": ("stable-security", "deb.debian.org", "/debian-security"),
    "trixie-pgdg": ("trixie-pgdg", "apt.postgresql.org", "/pub/repos/apt"),
}


@dataclass(frozen=True)
class ValidatedProposal:
    evidence_dir: Path
    run: dict[str, object]
    proposal: dict[str, object]
    proposal_sha256: str


def fail(message: str) -> None:
    raise ValueError(message)


def object_with_keys(value: object, required: set[str], label: str) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != required:
        fail(f"{label} has an invalid schema")
    return value


def read_json(path: Path, label: str) -> tuple[dict[str, object], bytes]:
    def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        value: dict[str, object] = {}
        for key, item in pairs:
            if key in value:
                fail(f"{label} contains duplicate JSON keys")
            value[key] = item
        return value

    try:
        raw = path.read_bytes()
        value = json.loads(raw, object_pairs_hook=unique_object)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read {label}: {error}") from error
    if not isinstance(value, dict):
        fail(f"{label} must be a JSON object")
    return value, raw


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def expected_github_run_identity() -> tuple[int, int]:
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if not run_id.isdecimal() or int(run_id) < 1 or not attempt.isdecimal() or int(attempt) < 1:
        fail("validator requires positive GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT")
    return int(run_id), int(attempt)


def valid_timestamp(value: object, label: str) -> None:
    if not isinstance(value, str):
        fail(f"{label} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} must be an ISO timestamp") from error
    if parsed.tzinfo is None:
        fail(f"{label} must include a timezone")


def safe_relative_path(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        fail(f"{label} is not a safe relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        fail(f"{label} is not a safe relative path")
    return path.as_posix()


def inventory_evidence_files(evidence_dir: Path) -> dict[str, Path]:
    if evidence_dir.is_symlink() or not evidence_dir.is_dir():
        fail("evidence directory must be a real directory")
    files: dict[str, Path] = {}
    for path in evidence_dir.rglob("*"):
        if path.is_symlink():
            fail("evidence tree must not contain symlinks")
        if not path.is_file():
            continue
        relative = path.relative_to(evidence_dir).as_posix()
        if relative != "run.json":
            files[relative] = path
    return files


def validate_evidence_hashes(evidence_dir: Path, run: dict[str, object], actual_run: dict[str, Path]) -> dict[str, str]:
    evidence_hashes = run.get("evidenceSha256")
    if not isinstance(evidence_hashes, dict) or not evidence_hashes:
        fail("run.json has no evidenceSha256 map")
    normalized: dict[str, str] = {}
    for raw_name, digest in evidence_hashes.items():
        name = safe_relative_path(raw_name, "evidence hash path")
        if not isinstance(digest, str) or not HEX_SHA256.fullmatch(digest):
            fail(f"evidence hash is malformed for {name}")
        normalized[name] = digest
    if set(normalized) != set(actual_run):
        fail("evidenceSha256 coverage does not exactly match files in the evidence directory")
    for name, path in actual_run.items():
        if sha256_file(path) != normalized[name]:
            fail(f"evidence hash mismatch for {name}")
    return normalized


def validate_file_record(
    value: object,
    label: str,
    evidence_dir: Path,
    evidence_hashes: dict[str, str],
) -> dict[str, object]:
    record = object_with_keys(value, {"file", "sha256", "sizeBytes"}, label)
    filename = safe_relative_path(record["file"], f"{label}.file")
    digest = record["sha256"]
    size = record["sizeBytes"]
    if not isinstance(digest, str) or not HEX_SHA256.fullmatch(digest) or not is_positive_int(size):
        fail(f"{label} has malformed hash or size")
    if filename not in evidence_hashes or evidence_hashes[filename] != digest:
        fail(f"{label} does not bind to hashed evidence: {filename}")
    path = evidence_dir / filename
    if path.stat().st_size != size:
        fail(f"{label} size does not match evidence: {filename}")
    return record


def parse_inrelease(raw: bytes) -> tuple[str, str, dict[str, tuple[str, int]]]:
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise ValueError("InRelease is not UTF-8 clear-signed text") from error
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines or lines[0] != "-----BEGIN PGP SIGNED MESSAGE-----":
        fail("InRelease clear-sign framing is malformed")
    try:
        separator = lines.index("")
    except ValueError as error:
        raise ValueError("InRelease clear-sign headers are unterminated") from error
    if separator < 2 or not any(line.startswith("Hash: ") for line in lines[1:separator]):
        fail("InRelease clear-sign headers are incomplete")
    signatures = [index for index, line in enumerate(lines) if line == "-----BEGIN PGP SIGNATURE-----"]
    ends = [index for index, line in enumerate(lines) if line == "-----END PGP SIGNATURE-----"]
    if len(signatures) != 1 or len(ends) != 1 or ends[0] != len(lines) - 1 or signatures[0] <= separator:
        fail("InRelease signature framing is malformed or has trailing data")
    body = [line[2:] if line.startswith("- ") else line for line in lines[separator + 1:signatures[0]]]
    fields: dict[str, str] = {}
    for line in body:
        if ": " in line and not line[:1].isspace():
            key, value = line.split(": ", 1)
            if key in {"Codename", "Suite"}:
                if key in fields:
                    fail(f"InRelease has duplicate {key} fields")
                fields[key] = value
    if not fields.get("Codename") or not fields.get("Suite"):
        fail("InRelease is missing Codename or Suite")
    rows: dict[str, tuple[str, int]] = {}
    in_sha256 = False
    found_sha256 = False
    for line in body:
        if line == "SHA256:":
            if found_sha256:
                fail("InRelease has duplicate SHA256 sections")
            found_sha256 = True
            in_sha256 = True
            continue
        if in_sha256 and line and not line[0].isspace():
            in_sha256 = False
        if in_sha256:
            match = re.fullmatch(r"\s+([0-9a-fA-F]{64})\s+([0-9]+)\s+([^\s]+)\s*", line)
            if not match:
                fail("InRelease SHA256 row has malformed framing")
            digest, size_text, path = match.groups()
            if path.startswith("/") or "\\" in path or ".." in PurePosixPath(path).parts:
                fail("InRelease SHA256 row contains an unsafe path")
            if path in rows:
                fail(f"InRelease contains duplicate SHA256 path {path}")
            rows[path] = (digest.lower(), int(size_text))
    if not found_sha256 or not rows:
        fail("InRelease has no SHA256 index records")
    return fields["Codename"], fields["Suite"], rows


def validate_source_trust(evidence_dir: Path) -> dict[str, list[tuple[str, Path]]]:
    trust_path = evidence_dir / "source-trust.tsv"
    inventory_path = evidence_dir / "keyring-sha256.txt"
    inventory: dict[str, str] = {}
    for line in inventory_path.read_text().splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})\s+(.+)", line)
        if not match:
            fail("keyring-sha256.txt contains malformed rows")
        digest, key_path = match.groups()
        if not key_path.startswith("/") or key_path in inventory:
            fail("keyring-sha256.txt contains an invalid or duplicate keyring path")
        inventory[key_path] = digest

    declared: set[tuple[str, str]] = set()
    source_keys: dict[str, list[tuple[str, Path]]] = {}
    for line in trust_path.read_text().splitlines():
        if line == "APT source trust policy: PASS":
            continue
        fields = line.split("\t")
        if len(fields) != 5:
            fail("source-trust.tsv contains malformed keyring bindings")
        key_path, digest, size_text, source_name, captured_name = fields
        if not key_path.startswith("/") or not HEX_SHA256.fullmatch(digest) or not size_text.isdecimal() or int(size_text) < 1:
            fail("source-trust.tsv contains invalid keyring metadata")
        source_relative = safe_relative_path(source_name, "source-trust source path")
        binding = (source_relative, key_path)
        if binding in declared:
            fail("source-trust.tsv contains duplicate source-to-keyring bindings")
        declared.add(binding)
        if inventory.get(key_path) != digest:
            fail("source-trust keyring hash is absent from keyring-sha256.txt")
        source_path = evidence_dir / "apt-sources" / source_relative
        if not source_path.is_file() or source_path.is_symlink():
            fail("source-trust binding references a missing APT source file")
        captured_relative = safe_relative_path(captured_name, "captured keyring path")
        if captured_relative != f"apt-keyrings/{digest}":
            fail("captured keyring path is not content-addressed by its declared digest")
        captured = evidence_dir / captured_relative
        if not captured.is_file() or captured.is_symlink() or captured.stat().st_size != int(size_text) or sha256_file(captured) != digest:
            fail("captured Signed-By keyring bytes do not match source-trust hash and size")
        source_keys.setdefault(source_relative, []).append((key_path, captured))
    if not trust_path.read_text().rstrip().endswith("APT source trust policy: PASS"):
        fail("APT source trust evidence is not marked PASS")

    expected: set[tuple[str, str]] = set()
    has_pgdg_source = False
    source_root = evidence_dir / "apt-sources"

    def reject_bypasses(text: str, label: str) -> None:
        lowered = text.lower()
        patterns = (
            r"(?i)(^|[\s,\[])trusted\s*=\s*yes([\s,\]]|$)",
            r"(?i)(^|[\s,\[])allow-insecure\s*=\s*yes([\s,\]]|$)",
            r"(?i)(^|[\s,\[])allow-weak\s*=\s*yes([\s,\]]|$)",
            r"(?i)(^|[\s,\[])allow-downgrade-to-insecure\s*=\s*yes([\s,\]]|$)",
            r"(?i)(^|[\s,\[])check-valid-until\s*=\s*no([\s,\]]|$)",
            r"(?im)^\s*trusted:\s*yes\s*$",
            r"(?im)^\s*allow-insecure:\s*yes\s*$",
            r"(?im)^\s*allow-weak:\s*yes\s*$",
            r"(?im)^\s*allow-downgrade-to-insecure:\s*yes\s*$",
            r"(?im)^\s*check-valid-until:\s*no\s*$",
        )
        if any(re.search(pattern, lowered) for pattern in patterns):
            fail(f"APT source enables a trust or freshness bypass: {label}")

    for source_path in source_root.rglob("*"):
        if not source_path.is_file():
            continue
        relative = source_path.relative_to(source_root).as_posix()
        content = source_path.read_text(errors="replace")
        if "apt.postgresql.org" in content.lower():
            has_pgdg_source = True
        if source_path.suffix.lower() == ".list":
            for line in content.splitlines():
                stripped = line.lstrip()
                if not stripped or stripped.startswith("#"):
                    continue
                if not re.match(r"(?i)^deb(?:-src)?\s", stripped):
                    continue
                reject_bypasses(line, relative)
                options = re.search(r"\[([^]]*)\]", line)
                signed = re.search(r"(?i)signed-by\s*=\s*([^]]+)", options.group(1)) if options else None
                if not signed:
                    fail(f"enabled APT source stanza has no explicit Signed-By: {relative}")
                tokens = [token for token in re.split(r"[\s,]+", signed.group(1).strip()) if token]
                if not tokens or any(not token.startswith("/") for token in tokens):
                    fail(f"APT source Signed-By syntax is unsupported: {relative}")
                expected.update((relative, token) for token in tokens)
        elif source_path.suffix.lower() == ".sources":
            for paragraph in re.split(r"\n\s*\n", content):
                if re.search(r"(?im)^Enabled:\s*no\s*$", paragraph):
                    continue
                if not re.search(r"(?im)^Types:\s*.*\bdeb(?:-src)?\b", paragraph):
                    continue
                reject_bypasses(paragraph, relative)
                signed = re.search(r"(?ims)^Signed-By:\s*(.*?)(?=^\S|\Z)", paragraph)
                if not signed:
                    fail(f"enabled APT source stanza has no explicit Signed-By: {relative}")
                tokens = [token for token in re.split(r"[\s,]+", signed.group(1).strip()) if token]
                if not tokens or any(not token.startswith("/") for token in tokens):
                    fail(f"APT source Signed-By syntax is unsupported: {relative}")
                expected.update((relative, token) for token in tokens)
    if not has_pgdg_source:
        fail("captured APT sources do not include the expected PGDG origin")
    if expected != declared:
        fail("source-trust.tsv does not exactly cover captured Signed-By keyring references")
    return source_keys


def source_keyrings_for_release(evidence_dir: Path, source_keys: dict[str, list[tuple[str, Path]]], codename: str) -> list[Path]:
    _, host, repo_path = EXPECTED_ORIGINS[codename]
    selected: list[Path] = []
    source_root = evidence_dir / "apt-sources"
    for relative, keys in source_keys.items():
        content = (source_root / relative).read_text(errors="replace")
        if relative.endswith(".list"):
            for line in content.splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or not re.match(r"(?i)^deb(?:-src)?\s", stripped):
                    continue
                option = re.search(r"\[([^]]*)\]", stripped)
                signed = re.search(r"(?i)signed-by\s*=\s*([^]]+)", option.group(1)) if option else None
                if not signed:
                    continue
                fields = re.sub(r"\[[^]]*\]", "", stripped, count=1).split()
                if len(fields) < 3:
                    continue
                uri, suite = fields[1], fields[2]
                parsed = urlsplit(uri)
                if source_uri_matches(parsed, host, repo_path) and suite == codename:
                    paths = [token for token in re.split(r"[\s,]+", signed.group(1).strip()) if token]
                    if not paths or any(not token.startswith("/") for token in paths):
                        fail(f"APT source Signed-By syntax is unsupported: {relative}")
                    key_map = dict(keys)
                    if any(key not in key_map for key in paths):
                        fail(f"APT source keyring binding is missing for {relative}")
                    selected.extend(key_map[key] for key in paths)
                    break
        elif relative.endswith(".sources"):
            for paragraph in re.split(r"\n\s*\n", content):
                if re.search(r"(?im)^Enabled:\s*no\s*$", paragraph):
                    continue
                suites = re.search(r"(?im)^Suites:\s*(.*?)\s*$", paragraph)
                uris = re.search(r"(?im)^URIs:\s*(.*?)\s*$", paragraph)
                signed = re.search(r"(?ims)^Signed-By:\s*(.*?)(?=^\S|\Z)", paragraph)
                if not suites or codename not in suites.group(1).split() or not uris:
                    continue
                for uri in uris.group(1).split():
                    parsed = urlsplit(uri)
                    if source_uri_matches(parsed, host, repo_path):
                        if not signed:
                            fail(f"APT source has no explicit Signed-By for {codename}: {relative}")
                        paths = [token for token in re.split(r"[\s,]+", signed.group(1).strip()) if token]
                        if not paths or any(not token.startswith("/") for token in paths):
                            fail(f"APT source Signed-By syntax is unsupported: {relative}")
                        key_map = dict(keys)
                        if any(key not in key_map for key in paths):
                            fail(f"APT source keyring binding is missing for {relative}")
                        selected.extend(key_map[key] for key in paths)
                        break
    unique = list(dict.fromkeys(selected))
    if not unique:
        fail(f"no captured Signed-By keyring is bound to the {codename} source")
    return unique


def source_uri_matches(parsed: object, host: str, repo_path: str) -> bool:
    try:
        port = parsed.port
    except ValueError:
        return False
    expected_ports = {None, 80} if parsed.scheme == "http" else {None, 443}
    return (
        parsed.scheme in {"http", "https"}
        and parsed.hostname == host
        and parsed.path.rstrip("/") == repo_path
        and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
        and port in expected_ports
    )


def expected_suite_base_path(codename: str) -> str:
    if codename not in EXPECTED_ORIGINS:
        fail(f"unknown Trixie release codename: {codename}")
    return f"{EXPECTED_ORIGINS[codename][2]}/dists/{codename}"


def verify_inrelease_signature(path: Path, keyrings: list[Path]) -> None:
    verifier = shutil.which("gpgv")
    if not verifier:
        fail("trusted gpgv verifier is unavailable; cannot verify captured InRelease signature")
    if not keyrings:
        fail("no source-bound keyrings supplied for InRelease verification")
    with tempfile.TemporaryDirectory(prefix="trixie-inrelease-gpgv-") as homedir:
        command = [verifier, "--homedir", homedir, "--status-fd", "1", "--output", os.devnull]
        for keyring in keyrings:
            command.extend(("--keyring", str(keyring)))
        command.append(str(path))
        result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    statuses = [line for line in result.stdout.splitlines() if line.startswith("[GNUPG:]")]
    if result.returncode != 0 or not any(line.startswith("[GNUPG:] VALIDSIG ") for line in statuses):
        fail(f"gpgv rejected captured InRelease signature: {path.name}")
    forbidden = ("BADSIG", "ERRSIG", "NO_PUBKEY", "EXPKEYSIG", "REVKEYSIG", "NODATA")
    if any(any(line.startswith(f"[GNUPG:] {status} ") or line == f"[GNUPG:] {status}" for status in forbidden) for line in statuses):
        fail(f"gpgv reported a failed or ambiguous signature status: {path.name}")


def validate_apt_verifiers(evidence_dir: Path) -> None:
    rows = (evidence_dir / "apt-verifiers.tsv").read_text().splitlines()
    if not rows:
        fail("apt-verifiers.tsv is empty")
    observed: set[str] = set()
    for line in rows:
        fields = line.split("\t")
        if len(fields) != 3:
            fail("apt-verifiers.tsv contains malformed rows")
        name, path, version = fields
        if name not in {"sqv", "gpgv"} or name in observed or not path.startswith("/") or name not in version.lower():
            fail("apt-verifiers.tsv contains an unsupported or malformed verifier")
        observed.add(name)
    if not observed:
        fail("no supported APT signature verifier was captured")
    apt_version = (evidence_dir / "apt-version.txt").read_text()
    if not re.search(r"(?m)^apt\s+[0-9][^\r\n]*", apt_version):
        fail("apt-version.txt does not report an APT version")


def validate_apt_trusted_paths(path: Path) -> None:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        fields = line.split("\t")
        if len(fields) != 2:
            fail("apt-trusted-paths.tsv contains malformed rows")
        key, value = fields[0].lower(), fields[1]
        if key in values:
            fail("apt-trusted-paths.tsv contains duplicate path names")
        if key == "trustedparts":
            value = str(Path(value))
        values[key] = value
    if values != {"trusted": "<unset>", "trustedparts": "/etc/apt/trusted.gpg.d"}:
        fail("apt-trusted-paths.tsv does not match Debian APT 3 trust defaults")


def validate_installed_and_simulated_removals(evidence_dir: Path) -> list[dict[str, str]]:
    inventory: dict[tuple[str, str], str] = {}
    for line in (evidence_dir / "dpkg-before.tsv").read_text().splitlines():
        fields = line.split("\t")
        if len(fields) != 4:
            fail("dpkg-before.tsv contains malformed rows")
        name, version, architecture, status = fields
        if status != "installed":
            continue
        key = (name, architecture)
        if key in inventory:
            fail("dpkg-before.tsv contains duplicate installed packages")
        inventory[key] = version
    if not inventory:
        fail("dpkg-before.tsv contains no installed packages")
    gnupg_rows = [line.split("\t") for line in (evidence_dir / "gnupg-installed.tsv").read_text().splitlines()]
    if len(gnupg_rows) != 1 or len(gnupg_rows[0]) != 4 or gnupg_rows[0][0] != "gnupg" or gnupg_rows[0][3] != "installed":
        fail("gnupg-installed.tsv does not identify exactly one installed gnupg package")
    if inventory.get((gnupg_rows[0][0], gnupg_rows[0][2])) != gnupg_rows[0][1]:
        fail("gnupg-installed.tsv does not match dpkg-before.tsv")

    planned: dict[tuple[str, str], str] = {}
    for line in (evidence_dir / "gnupg-purge-simulation.txt").read_text().splitlines():
        match = re.match(r"^(?:Remv|Purg)\s+(\S+)\s+\[([^\]]+)\]", line)
        if not match:
            continue
        apt_name, version = match.groups()
        if ":" in apt_name:
            name, architecture = apt_name.rsplit(":", 1)
            key = (name, architecture)
        else:
            matches = [key for key in inventory if key[0] == apt_name]
            if len(matches) != 1:
                fail(f"purge simulation does not uniquely identify architecture for {apt_name}")
            key = matches[0]
        if key in planned:
            fail(f"purge simulation contains duplicate removal {key[0]}:{key[1]}")
        planned[key] = version
    if not planned or not any(name == "gnupg" for name, _ in planned):
        fail("purge simulation is empty or omits gnupg")
    removals = []
    for (name, architecture), version in planned.items():
        if inventory.get((name, architecture)) != version:
            fail(f"purge simulation does not match installed package {name}:{architecture}")
        if name.startswith("libapt-pkg") or any(name == prefix or name.startswith(prefix + "-") for prefix in PROTECTED_PREFIXES):
            fail(f"purge simulation removes protected package {name}")
        removals.append({"name": name, "version": version, "architecture": architecture})
    return sorted(removals, key=lambda item: (item["name"], item["architecture"], item["version"]))


def validate_tuple_list(value: object, label: str) -> list[dict[str, str]]:
    if not isinstance(value, list) or not value:
        fail(f"{label} must be a non-empty list")
    tuples: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for index, item in enumerate(value):
        record = object_with_keys(item, {"name", "version", "architecture"}, f"{label}[{index}]")
        name, version, architecture = record["name"], record["version"], record["architecture"]
        if not all(isinstance(part, str) and part and not re.search(r"[\s\t\r\n]", part) for part in (name, version, architecture)):
            fail(f"{label}[{index}] has malformed package tuple fields")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", architecture):
            fail(f"{label}[{index}] has invalid package name or architecture")
        if (name, architecture) in seen:
            fail(f"{label} contains duplicate package architectures")
        seen.add((name, architecture))
        if name.startswith("libapt-pkg") or any(name == prefix or name.startswith(prefix + "-") for prefix in PROTECTED_PREFIXES):
            fail(f"{label} includes protected package {name}")
        tuples.append({"name": name, "version": version, "architecture": architecture})
    if not any(item["name"] == "gnupg" for item in tuples):
        fail(f"{label} does not include gnupg")
    expected = sorted(tuples, key=lambda item: (item["name"], item["architecture"], item["version"]))
    if tuples != expected:
        fail(f"{label} is not deterministically sorted")
    return tuples


def validate_proposal(evidence_dir: Path) -> ValidatedProposal:
    if evidence_dir.is_symlink():
        fail("evidence directory must not be a symlink")
    evidence_dir = evidence_dir.resolve(strict=True)
    if (evidence_dir / "run.json").is_symlink() or (evidence_dir / "gnupg-removal-lock-proposal.json").is_symlink():
        fail("run.json and proposal must not be symlinks")
    run, _ = read_json(evidence_dir / "run.json", "run.json")
    run_keys = {
        "schemaVersion", "state", "revision", "tree", "runId", "runAttempt", "image", "platform",
        "runtimeClearance", "cveClearance", "generatedAt", "imageId", "repoDigests", "removalCount",
        "evidenceSha256",
    }
    object_with_keys(run, run_keys, "run.json")
    if type(run["schemaVersion"]) is not int or run["schemaVersion"] != 1 or run["state"] != "DISCOVERY_COMPLETE":
        fail("run.json is not a completed supported discovery")
    if not isinstance(run["revision"], str) or not HEX_GIT.fullmatch(run["revision"]):
        fail("run.json revision is malformed")
    if not isinstance(run["tree"], str) or not HEX_GIT.fullmatch(run["tree"]):
        fail("run.json tree is malformed")
    if not is_positive_int(run["runId"]) or not is_positive_int(run["runAttempt"]):
        fail("run.json GitHub run identity is malformed")
    if run["image"] != IMAGE or run["platform"] != PLATFORM:
        fail("run.json image or platform differs from the pinned discovery target")
    image_id = run["imageId"]
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        fail("run.json imageId is malformed")
    repo_digests = run["repoDigests"]
    expected_digest = IMAGE.rsplit("@", 1)[1]
    if not isinstance(repo_digests, list) or not repo_digests or not all(isinstance(item, str) for item in repo_digests):
        fail("run.json repoDigests is malformed")
    if not any(item.endswith("@" + expected_digest) for item in repo_digests):
        fail("run.json repoDigests does not bind the pinned image")
    if run["runtimeClearance"] != "NOT_EVALUATED" or run["cveClearance"] != "NOT_EVALUATED":
        fail("discovery must not claim runtime or CVE clearance")
    valid_timestamp(run["generatedAt"], "run.json generatedAt")
    if not is_positive_int(run["removalCount"]):
        fail("run.json removalCount is malformed")

    actual_files = inventory_evidence_files(evidence_dir)
    hashes = validate_evidence_hashes(evidence_dir, run, actual_files)
    required_evidence = {
        "apt-index-targets.tsv", "apt-signature-config.txt", "apt-trusted-paths.tsv", "source-trust.tsv",
        "gnupg-purge-simulation.txt", "container-status.json", "apt-update.log", "apt-verifiers.tsv",
        "apt-version.txt", "keyring-sha256.txt", "dpkg-before.tsv", "gnupg-installed.tsv",
    }
    if not required_evidence.issubset(hashes):
        fail("evidence bundle is missing required discovery records")
    container_status, _ = read_json(evidence_dir / "container-status.json", "container-status.json")
    object_with_keys(container_status, {"state", "exitCode"}, "container-status.json")
    if container_status != {"state": "DISCOVERY_COMPLETE", "exitCode": 0}:
        fail("container discovery did not complete successfully")
    if not (evidence_dir / "source-trust.tsv").read_text().rstrip().endswith("APT source trust policy: PASS"):
        fail("APT source trust evidence is not marked PASS")
    validate_apt_verifiers(evidence_dir)
    validate_apt_trusted_paths(evidence_dir / "apt-trusted-paths.tsv")
    source_keys = validate_source_trust(evidence_dir)
    expected_run_id, expected_attempt = expected_github_run_identity()
    if run["runId"] != expected_run_id or run["runAttempt"] != expected_attempt:
        fail("evidence runId/runAttempt do not match this hosted GitHub run")
    proposal_path = evidence_dir / "gnupg-removal-lock-proposal.json"
    proposal, proposal_raw = read_json(proposal_path, "gnupg-removal-lock-proposal.json")
    proposal_keys = {
        "schemaVersion", "kind", "revision", "tree", "runId", "runAttempt", "image", "imageId", "platform",
        "authenticatedInReleaseFiles", "signedReleaseIndexHashes", "packageIndexTargetBindings", "localAptIndexFiles",
        "aptSignatureConfigSha256", "aptTrustedPathsSha256", "sourceTrustEvidenceSha256", "purgeSimulationSha256",
        "removals", "runtimeClearance", "cveClearance", "approvalState",
    }
    object_with_keys(proposal, proposal_keys, "discovery proposal")
    if hashes.get("gnupg-removal-lock-proposal.json") != sha256_bytes(proposal_raw):
        fail("proposal bytes do not match run.json evidence hash")
    if type(proposal["schemaVersion"]) is not int or proposal["schemaVersion"] != 1 or proposal["kind"] != "discovery-lock-proposal":
        fail("proposal schema or kind is unsupported")
    for key in ("revision", "tree", "runId", "runAttempt", "image", "imageId", "platform"):
        if proposal[key] != run[key]:
            fail(f"proposal {key} does not match run.json")
    if proposal["runtimeClearance"] != "NOT_EVALUATED" or proposal["cveClearance"] != "NOT_EVALUATED":
        fail("proposal must not claim runtime or CVE clearance")
    if proposal["approvalState"] != "REQUIRES_INDEPENDENT_REVIEW_AND_LOCK_FREEZE":
        fail("discovery proposal must remain pending independent review and lock freeze")
    removals = validate_tuple_list(proposal["removals"], "proposal.removals")
    if run["removalCount"] != len(removals):
        fail("run.json removalCount differs from proposal removals")
    simulated_removals = validate_installed_and_simulated_removals(evidence_dir)
    if removals != simulated_removals:
        fail("proposal removal tuples do not exactly match installed inventory and purge simulation")

    for key, filename in (
        ("aptSignatureConfigSha256", "apt-signature-config.txt"),
        ("aptTrustedPathsSha256", "apt-trusted-paths.tsv"),
        ("sourceTrustEvidenceSha256", "source-trust.tsv"),
        ("purgeSimulationSha256", "gnupg-purge-simulation.txt"),
    ):
        digest = proposal[key]
        if not isinstance(digest, str) or not HEX_SHA256.fullmatch(digest) or hashes.get(filename) != digest:
            fail(f"proposal {key} does not match {filename}")

    releases = proposal["authenticatedInReleaseFiles"]
    local_indices = proposal["localAptIndexFiles"]
    signed_rows = proposal["signedReleaseIndexHashes"]
    bindings = proposal["packageIndexTargetBindings"]
    if not isinstance(releases, list) or not releases or not isinstance(local_indices, list) or not local_indices:
        fail("proposal is missing authenticated Release or local Packages evidence")
    if not isinstance(signed_rows, list) or not signed_rows or not isinstance(bindings, list) or not bindings:
        fail("proposal is missing signed index rows or APT target bindings")
    release_by_name: dict[str, dict[str, object]] = {}
    for index, item in enumerate(releases):
        record = validate_file_record(item, f"authenticatedInReleaseFiles[{index}]", evidence_dir, hashes)
        filename = record["file"]
        if not isinstance(filename, str) or not filename.startswith("apt-lists/") or not filename.endswith("InRelease"):
            fail("authenticated Release evidence has an unexpected file path")
        basename = PurePosixPath(filename).name
        if basename in release_by_name:
            fail("proposal contains duplicate authenticated InRelease files")
        release_by_name[basename] = record
    release_contents: dict[str, tuple[str, str, dict[str, tuple[str, int]]]] = {}
    for basename, record in release_by_name.items():
        raw = (evidence_dir / record["file"]).read_bytes()
        codename, suite, index_rows = parse_inrelease(raw)
        if codename not in EXPECTED_ORIGINS or suite != EXPECTED_ORIGINS[codename][0]:
            fail(f"authenticated InRelease has an unapproved identity: {basename}")
        verify_inrelease_signature(
            evidence_dir / record["file"],
            source_keyrings_for_release(evidence_dir, source_keys, codename),
        )
        release_contents[basename] = (codename, suite, index_rows)

    local_by_name: dict[str, dict[str, object]] = {}
    for index, item in enumerate(local_indices):
        record = validate_file_record(item, f"localAptIndexFiles[{index}]", evidence_dir, hashes)
        filename = record["file"]
        if not isinstance(filename, str) or not filename.startswith("apt-lists/") or "Packages" not in PurePosixPath(filename).name:
            fail("local APT index evidence has an unexpected file path")
        basename = PurePosixPath(filename).name
        if basename in local_by_name:
            fail("proposal contains duplicate local APT index files")
        local_by_name[basename] = record

    signed_index_keys: set[tuple[str, str]] = set()
    signed_index_map: dict[tuple[str, str], tuple[str, int]] = {}
    for index, item in enumerate(signed_rows):
        record = object_with_keys(item, {"releaseFile", "releaseSha256", "codename", "suite", "path", "sha256", "size"}, f"signedReleaseIndexHashes[{index}]")
        release_file = record["releaseFile"]
        if not isinstance(release_file, str) or release_file not in release_by_name:
            fail("signed Release index row references an unknown InRelease")
        release_record = release_by_name[release_file]
        if record["releaseSha256"] != release_record["sha256"]:
            fail("signed Release index row has a mismatched InRelease hash")
        codename = record["codename"]
        if codename not in EXPECTED_ORIGINS or record["suite"] != EXPECTED_ORIGINS[codename][0]:
            fail("signed Release index row has an unapproved suite identity")
        if not isinstance(record["path"], str) or not record["path"] or record["path"].startswith("/") or "\\" in record["path"] or ".." in PurePosixPath(record["path"]).parts:
            fail("signed Release index row has an invalid path")
        if not isinstance(record["sha256"], str) or not HEX_SHA256.fullmatch(record["sha256"]) or not is_positive_int(record["size"]):
            fail("signed Release index row has malformed hash or size")
        key = (release_file, record["path"])
        if key in signed_index_keys:
            fail("proposal has duplicate signed Release index rows")
        signed_index_keys.add(key)
        signed_index_map[key] = (record["sha256"], record["size"])

    raw_target_rows = (evidence_dir / "apt-index-targets.tsv").read_text().splitlines()
    parsed_targets: set[tuple[str, ...]] = set()
    release_identities: set[tuple[str, str, str]] = set()
    observed_release_identities: set[tuple[str, str]] = set()
    for raw_target in raw_target_rows:
        fields = tuple(raw_target.split("|"))
        if len(fields) != 10:
            fail("captured APT index-target evidence has invalid framing")
        if fields in parsed_targets:
            fail("captured APT index-target evidence contains duplicate rows")
        parsed_targets.add(fields)
        if fields[1] not in EXPECTED_ORIGINS or fields[2] != EXPECTED_ORIGINS[fields[1]][0]:
            fail("captured APT index-target evidence has an unapproved Release identity")
        _, codename, _, _, filename, uri, base_uri, _, release_path, _ = fields
        if not filename.startswith("/var/lib/apt/lists/") or not release_path.startswith("/var/lib/apt/lists/"):
            fail("captured APT target contains an unexpected local metadata path")
        if any(part == ".." for part in PurePosixPath(filename).parts + PurePosixPath(release_path).parts):
            fail("captured APT target contains a traversal path")
        target_origin = EXPECTED_ORIGINS[codename]
        parsed_uri = urlsplit(uri)
        parsed_base = urlsplit(base_uri)
        if parsed_uri.scheme not in {"http", "https"} or parsed_uri.scheme != parsed_base.scheme:
            fail("captured APT target has an invalid or mismatched transport scheme")
        if parsed_base.hostname != target_origin[1] or parsed_base.path.rstrip("/") != expected_suite_base_path(codename):
            fail("captured APT target has an unapproved suite-scoped base URI")
        if parsed_uri.hostname != target_origin[1] or parsed_uri.username or parsed_uri.password or parsed_uri.query or parsed_uri.fragment:
            fail("captured APT target URI has an unsafe authority")
        if parsed_base.username or parsed_base.password or parsed_base.query or parsed_base.fragment:
            fail("captured APT target base URI has an unsafe authority")
        if parsed_uri.port not in ({None, 80} if parsed_uri.scheme == "http" else {None, 443}) or parsed_base.port not in ({None, 80} if parsed_base.scheme == "http" else {None, 443}):
            fail("captured APT target uses a non-default port")
        if not parsed_uri.path.startswith(expected_suite_base_path(codename) + "/"):
            fail("captured APT target URI is outside its Release path")
        release_identities.add((PurePosixPath(fields[8]).name, fields[1], fields[2]))
        observed_release_identities.add((fields[1], fields[2]))
    if not parsed_targets:
        fail("captured APT index-target evidence is empty")
    expected_release_identities = {(codename, metadata[0]) for codename, metadata in EXPECTED_ORIGINS.items()}
    if observed_release_identities != expected_release_identities:
        fail("captured APT targets do not contain exactly the expected Release identities")
    for item in signed_rows:
        if (item["releaseFile"], item["codename"], item["suite"]) not in release_identities:
            fail("signed Release index row identity does not match captured APT targets")
    signed_rows_by_release: dict[str, dict[str, tuple[str, int]]] = {}
    for item in signed_rows:
        signed_rows_by_release.setdefault(item["releaseFile"], {})[item["path"]] = (item["sha256"], item["size"])
    if set(signed_rows_by_release) != set(release_contents):
        fail("signed Release index rows do not cover every authenticated InRelease")
    for release_file, (codename, suite, actual_rows) in release_contents.items():
        if signed_rows_by_release[release_file] != actual_rows:
            fail(f"proposal signed index rows differ from InRelease SHA256 section: {release_file}")
        if not any(
            target[0] == "Packages" and target[1] == codename and target[2] == suite
            and PurePosixPath(target[8]).name == release_file for target in parsed_targets
        ):
            fail(f"authenticated InRelease is not bound to a captured Packages target: {release_file}")

    binding_keys = {
        "identifier", "codename", "suite", "component", "architecture", "filename", "uri", "baseUri", "metaKey",
        "releaseFile", "releaseSha256", "canonicalPackagesPath", "signedVariants", "localAptFile", "localAptSha256", "localAptSize",
    }
    seen_bindings: set[tuple[str, str, str, str]] = set()
    for index, item in enumerate(bindings):
        record = object_with_keys(item, binding_keys, f"packageIndexTargetBindings[{index}]")
        codename = record["codename"]
        if codename not in EXPECTED_ORIGINS or record["suite"] != EXPECTED_ORIGINS[codename][0]:
            fail("package target binding has an unapproved suite identity")
        release_file = record["releaseFile"]
        release_record = release_by_name.get(release_file) if isinstance(release_file, str) else None
        if release_record is None or record["releaseSha256"] != release_record["sha256"]:
            fail("package target binding does not match authenticated InRelease evidence")
        origin = EXPECTED_ORIGINS[codename]
        base_uri = record["baseUri"]
        uri = record["uri"]
        if not isinstance(base_uri, str) or not isinstance(uri, str):
            fail("package target binding baseUri is malformed")
        parsed_origin = urlsplit(base_uri)
        parsed_uri = urlsplit(uri)
        if parsed_origin.scheme not in {"http", "https"} or parsed_origin.hostname != origin[1] or parsed_origin.path.rstrip("/") != expected_suite_base_path(codename):
            fail("package target binding uses an unapproved suite-scoped base URI")
        if parsed_uri.scheme != parsed_origin.scheme or parsed_uri.hostname != parsed_origin.hostname:
            fail("package target URI authority differs from its base URI")
        if parsed_origin.username or parsed_origin.password or parsed_origin.query or parsed_origin.fragment or parsed_origin.port not in ({None, 80} if parsed_origin.scheme == "http" else {None, 443}):
            fail("package target binding has an unsafe baseUri authority")
        if parsed_uri.username or parsed_uri.password or parsed_uri.query or parsed_uri.fragment or parsed_uri.port not in ({None, 80} if parsed_uri.scheme == "http" else {None, 443}):
            fail("package target binding has an unsafe URI authority")
        architecture = record["architecture"]
        component = record["component"]
        canonical = record["canonicalPackagesPath"]
        expected_path = f"{component}/binary-{architecture}/Packages"
        if record["identifier"] != "Packages" or not isinstance(canonical, str) or canonical != expected_path or record["metaKey"] != canonical:
            fail("package target binding canonical path does not match component and architecture")
        uri_prefix = expected_suite_base_path(codename) + "/"
        uri_path = parsed_uri.path
        if not uri_path.startswith(uri_prefix):
            fail("package target URI is outside its approved Release path")
        target_packages_path = uri_path[len(uri_prefix):]
        if not target_packages_path.startswith(canonical):
            fail("package target URI does not match its canonical Packages path")
        local_file = record["localAptFile"]
        if PurePosixPath(record["filename"]).name != local_file:
            fail("package target binding local filename differs from its APT target filename")
        local_record = local_by_name.get(local_file) if isinstance(local_file, str) else None
        if local_record is None or local_record["sha256"] != record["localAptSha256"] or local_record["sizeBytes"] != record["localAptSize"]:
            fail("package target binding does not match local APT index evidence")
        variants = record["signedVariants"]
        if not isinstance(variants, list) or not variants:
            fail("package target binding has no signed Packages variants")
        variant_paths: set[str] = set()
        for variant in variants:
            variant_record = object_with_keys(variant, {"path", "sha256", "size"}, "signed Packages variant")
            if not isinstance(variant_record["path"], str) or variant_record["path"] in variant_paths:
                fail("package target binding contains malformed or duplicate signed variants")
            variant_paths.add(variant_record["path"])
            if (release_file, variant_record["path"]) not in signed_index_keys:
                fail("package target variant is absent from signed Release index hashes")
            if not isinstance(variant_record["sha256"], str) or not HEX_SHA256.fullmatch(variant_record["sha256"]) or not is_positive_int(variant_record["size"]):
                fail("package target variant has malformed hash or size")
            if signed_index_map[(release_file, variant_record["path"])] != (variant_record["sha256"], variant_record["size"]):
                fail("package target variant does not match signed Release metadata")
        if target_packages_path not in {variant["path"] for variant in variants}:
            fail("package target URI is not one of its authenticated signed variants")
        target_tuple = (
            record["identifier"], record["codename"], record["suite"], record["architecture"],
            record["filename"], record["uri"], record["baseUri"], record["metaKey"],
            f"/var/lib/apt/lists/{release_file}", record["component"],
        )
        if target_tuple not in parsed_targets:
            fail("package target binding does not match captured APT index-target fields")
        key = (str(codename), str(component), str(architecture), str(canonical))
        if key in seen_bindings:
            fail("proposal contains duplicate package target bindings")
        seen_bindings.add(key)

    return ValidatedProposal(evidence_dir, run, proposal, sha256_bytes(proposal_raw))


def prepare_candidate(evidence_dir: Path, lock_path: Path, output_path: Path) -> list[dict[str, str]]:
    del evidence_dir, lock_path, output_path
    fail("prepare-candidate is disabled until authenticated GitHub review and exact artifact provenance are verified")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser("validate-proposal", help="validate discovery evidence without emitting removal tuples")
    validate_parser.add_argument("--evidence-dir", required=True, type=Path)
    prepare_parser = subparsers.add_parser("prepare-candidate", help="disabled pending authenticated review and artifact provenance")
    prepare_parser.add_argument("--evidence-dir", required=True, type=Path)
    prepare_parser.add_argument("--frozen-lock", required=True, type=Path)
    prepare_parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "validate-proposal":
        validated = validate_proposal(args.evidence_dir)
        print(json.dumps({
            "status": "VALIDATED_DISCOVERY_EVIDENCE",
            "proposalSha256": validated.proposal_sha256,
            "runId": validated.run["runId"],
            "runAttempt": validated.run["runAttempt"],
            "revision": validated.run["revision"],
            "tree": validated.run["tree"],
            "image": validated.run["image"],
            "platform": validated.run["platform"],
        }, sort_keys=True))
        return 0
    prepare_candidate(args.evidence_dir, args.frozen_lock, args.output)
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Trixie GnuPG evidence validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
