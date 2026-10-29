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
import resource
import shutil
import stat
import sys
import tempfile
import subprocess
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit


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
GPGV_OUTPUT_LIMIT = 65536
ASCII_ARMORED_PUBLIC_KEY = b"-----BEGIN PGP PUBLIC KEY BLOCK-----"


def is_armored_public_key(raw: bytes) -> bool:
    if not raw.startswith(ASCII_ARMORED_PUBLIC_KEY):
        return False
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError:
        fail("armored source keyring is not valid ASCII")
    if "-----END PGP PUBLIC KEY BLOCK-----" not in text or not text.split(ASCII_ARMORED_PUBLIC_KEY.decode(), 1)[1].strip():
        fail("armored source keyring has malformed public-key framing")
    return True


def run_bounded(command: list[str], *, env: dict[str, str], timeout: int) -> tuple[int, bytes, bytes, bool]:
    def limit_output_files() -> None:
        resource.setrlimit(resource.RLIMIT_FSIZE, (GPGV_OUTPUT_LIMIT, GPGV_OUTPUT_LIMIT))

    with tempfile.TemporaryFile() as stdout_file, tempfile.TemporaryFile() as stderr_file:
        try:
            result = subprocess.run(
                command, stdout=stdout_file, stderr=stderr_file, stdin=subprocess.DEVNULL,
                env=env, timeout=timeout, check=False, preexec_fn=limit_output_files,
            )
            returncode = result.returncode
        except subprocess.TimeoutExpired:
            returncode = -1
        stdout_file.seek(0)
        stderr_file.seek(0)
        stdout = stdout_file.read(GPGV_OUTPUT_LIMIT + 1)
        stderr = stderr_file.read(GPGV_OUTPUT_LIMIT + 1)
        overflow = (os.fstat(stdout_file.fileno()).st_size >= GPGV_OUTPUT_LIMIT
                    or os.fstat(stderr_file.fileno()).st_size >= GPGV_OUTPUT_LIMIT)
    return returncode, stdout, stderr, overflow


def structured_gpg_statuses(stdout: bytes) -> tuple[list[dict[str, object]], list[str]]:
    statuses: list[dict[str, object]] = []
    tokens: list[str] = []
    for line in stdout.splitlines():
        if not line.startswith(b"[GNUPG:] "):
            continue
        fields = line[len(b"[GNUPG:] "):].decode("ascii", errors="replace").split()
        if not fields:
            continue
        token, args = fields[0], fields[1:]
        tokens.append(token)
        safe_fields: list[str] = []
        if token in {"GOODSIG", "BADSIG", "EXPSIG", "EXPKEYSIG", "REVKEYSIG"} and args:
            safe_fields = [args[0], "[REDACTED-UID]"]
        elif token in {"VALIDSIG", "ERRSIG", "NO_PUBKEY", "NODATA", "NEWSIG", "SIG_ID"}:
            safe_fields = [field for field in args if re.fullmatch(r"[A-Fa-f0-9]+|[0-9]+|[0-9A-Fa-f]+", field)]
        statuses.append({"token": token, "fields": safe_fields})
    return statuses, tokens


def redact_diagnostic_text(stderr: str, evidence_dir: Path, temp_root: Path) -> str:
    redacted = stderr.replace(str(evidence_dir), "$EVIDENCE").replace(str(temp_root), "$VERIFICATION_TMP")
    redacted = re.sub(r"(?i)(https?://)[^/\s@]+@", r"\1[REDACTED]@", redacted)
    redacted = re.sub(r"/[\w./-]+/InRelease", "$PRIVATE_INRELEASE", redacted)
    redacted = re.sub(r"(?<![:/])/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+", "$PATH", redacted)
    redacted = re.sub(r"<[^>\r\n]{0,500}>", "[REDACTED-UID]", redacted)
    redacted = "".join(ch if ch in "\n\t" or 32 <= ord(ch) < 127 else "�" for ch in redacted)[:16000]
    if len(stderr) > 16000:
        redacted += "\n[TRUNCATED]"
    return redacted


def normalized_private_argv(
    command: list[str], homedir: str, private_release: Path, private_paths: list[Path],
    armored_source: Path | None = None,
) -> list[str]:
    normalized = []
    for argument in command:
        if argument == homedir:
            normalized.append("$PRIVATE_HOMEDIR")
        elif argument == str(private_release):
            normalized.append("$PRIVATE_INRELEASE")
        elif armored_source is not None and argument == str(armored_source):
            normalized.append("$PRIVATE_ARMORED_KEYRING")
        elif argument in {str(item) for item in private_paths}:
            normalized.append("$PRIVATE_KEYRING")
        else:
            normalized.append(argument)
    return normalized


@dataclass(frozen=True)
class ValidatedProposal:
    evidence_dir: Path
    run: dict[str, object]
    proposal: dict[str, object]
    proposal_sha256: str


@dataclass(frozen=True)
class SignatureRequest:
    suite: str
    source_file: str
    source_stanza_sha256: str
    inrelease_file: str
    inrelease_sha256: str
    inrelease_size_bytes: int
    keyrings: tuple[dict[str, object], ...]


class ValidationDiagnostics:
    def __init__(self, root: Path, evidence_dir: Path):
        if root.is_symlink():
            fail("diagnostics directory must not be a symlink")
        if not root.is_absolute():
            fail("diagnostics directory must be absolute")
        evidence_dir = evidence_dir.resolve(strict=True)
        parent = root.parent.resolve(strict=True)
        normalized_root = parent / root.name
        try:
            normalized_root.relative_to(evidence_dir)
        except ValueError:
            pass
        else:
            fail("diagnostics directory must be outside the immutable evidence directory")
        try:
            evidence_dir.relative_to(normalized_root)
        except ValueError:
            pass
        else:
            fail("diagnostics directory must not contain the immutable evidence directory")
        if root.exists():
            fail("diagnostics directory must be fresh and must not already exist")
        root.mkdir()
        self.root = root
        self.evidence_dir = evidence_dir
        self.records: list[str] = []
        self._manifest: dict[str, object] = {
            "schemaVersion": 1,
            "state": "RUNNING",
            "runId": os.environ.get("GITHUB_RUN_ID"),
            "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
            "revision": os.environ.get("GITHUB_SHA"),
            "evidenceRunSha256": self._optional_hash(evidence_dir / "run.json"),
            "proposalSha256": self._optional_hash(evidence_dir / "gnupg-removal-lock-proposal.json"),
            "attempts": [],
        }
        self._write_manifest()

    @staticmethod
    def _optional_hash(path: Path) -> str | None:
        if path.is_symlink() or not path.is_file():
            return None
        return sha256_file(path)

    def record(self, suite: str, result: dict[str, object], stderr: str) -> Path:
        if not re.fullmatch(r"[a-z0-9-]+", suite):
            fail("diagnostic suite name is unsafe")
        record_name = f"{suite}.json"
        stderr_name = f"{suite}.stderr.txt"
        stderr_path = self.root / stderr_name
        record_path = self.root / record_name
        self._write_text_exclusive(stderr_path, stderr)
        result["redactedStderrFile"] = stderr_name
        result["redactedStderrSha256"] = sha256_file(stderr_path)
        self._write_json_atomic(record_path, result)
        self.records.append(record_name)
        self._manifest["attempts"] = list(self.records)
        self._write_manifest()
        return record_path

    def finish(self, state: str, error: str | None) -> None:
        if state not in {"REJECTED", "VALIDATED"}:
            fail("diagnostics terminal state is unsupported")
        self._manifest["state"] = state
        self._manifest["error"] = error
        inventory: dict[str, str] = {}
        for path in sorted(self.root.iterdir()):
            if path.name == "validation.json":
                continue
            if path.is_symlink() or not path.is_file():
                fail("diagnostics directory contains an unsafe output")
            inventory[path.name] = sha256_file(path)
        self._manifest["diagnosticSha256"] = inventory
        self._write_manifest()

    @staticmethod
    def _write_text_exclusive(path: Path, text: str) -> None:
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(text)

    @staticmethod
    def _write_json_atomic(path: Path, value: dict[str, object]) -> None:
        temporary = path.with_name(f".{path.name}.tmp")
        with temporary.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=True, sort_keys=True, indent=2)
            stream.write("\n")
        os.replace(temporary, path)

    def _write_manifest(self) -> None:
        self._write_json_atomic(self.root / "validation.json", self._manifest)


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


def is_nonnegative_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


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


def parse_source_stanzas(text: str, suffix: str) -> list[dict[str, list[str]]]:
    entries: list[dict[str, list[str]]] = []
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
                    fail("Deb822 source stanza has malformed field framing")
                key, value = line.split(":", 1)
                current = key.lower()
                fields.setdefault(current, []).append(value.strip())
            if fields.get("enabled", ["yes"])[-1].lower() == "no" or "deb" not in " ".join(fields.get("types", [])).split():
                continue
            uris = " ".join(fields.get("uris", [])).split()
            suites = " ".join(fields.get("suites", [])).split()
            key_paths = " ".join(fields.get("signed-by", [])).split()
            if not uris or not suites or not key_paths or any(not item.startswith("/") for item in key_paths):
                fail("APT Deb822 source stanza has unsupported URI, Suite, or Signed-By configuration")
            entries.append({"uris": uris, "suites": suites, "keyPaths": key_paths})
    elif suffix == ".list":
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            match = re.fullmatch(r"deb\s+(?:\[([^]]+)\]\s+)?(\S+)\s+(\S+)\s+(.+)", stripped)
            if not match:
                if re.match(r"(?i)^deb(?:-src)?\s", stripped):
                    fail("APT one-line source stanza has unsupported syntax")
                continue
            options, uri, suite, _components = match.groups()
            signed = re.search(r"(?i)(?:^|[\s,])signed-by\s*=\s*([^\s,]+)", options or "")
            key_paths = signed.group(1).split(",") if signed else []
            if not key_paths or any(not item.startswith("/") for item in key_paths):
                fail("APT one-line source stanza has unsupported Signed-By configuration")
            entries.append({"uris": [uri], "suites": [suite], "keyPaths": key_paths})
    else:
        fail(f"unsupported APT source format: {suffix}")
    return entries


def validate_isolated_release_acquisitions(
    evidence_dir: Path,
    diagnostics: ValidationDiagnostics | None,
    records: object,
    release_by_file: dict[str, dict[str, object]],
    release_contents: dict[str, tuple[str, str, dict[str, tuple[str, int]]]],
    source_keys: dict[str, list[tuple[str, Path]]],
    evidence_hashes: dict[str, str],
    run: dict[str, object],
) -> dict[tuple[str, str, str], dict[str, object]]:
    if not isinstance(records, list) or len(records) != len(EXPECTED_ORIGINS):
        fail("proposal must contain exactly one isolated Release acquisition for each approved suite")
    apt_version = (evidence_dir / "apt-version.txt").read_text().splitlines()[0].strip()
    by_target: dict[tuple[str, str, str], dict[str, object]] = {}
    observed_codenames: set[str] = set()
    required_record_keys = {
        "codename", "configuredDist", "suite", "signedCodename", "signedSuite", "sourceUri", "baseUri",
        "aptVersion", "sourceConfigFile", "sourceConfigSha256", "isolatedSourceFile", "isolatedSourceSha256",
        "aptTargetEvidenceFile", "aptTargetEvidenceSha256", "sourceKeyrings", "exactInReleasePath",
        "inReleaseFile", "inReleaseSha256", "inReleaseSizeBytes", "combinedInReleaseFile",
        "combinedInReleaseSha256", "combinedInReleaseSizeBytes",
        "runId", "runAttempt", "revision", "tree", "image", "imageId", "platform",
    }
    for index, value in enumerate(records):
        record = object_with_keys(value, required_record_keys, f"isolatedReleaseAcquisitions[{index}]")
        codename = record["codename"]
        if codename not in EXPECTED_ORIGINS or codename in observed_codenames:
            fail("isolated Release acquisitions contain an unknown or duplicate codename")
        observed_codenames.add(str(codename))
        expected_suite = EXPECTED_ORIGINS[codename][0]
        if record["configuredDist"] != codename or record["suite"] != expected_suite:
            fail("isolated acquisition configured Dist/suite differs from policy")
        if record["aptVersion"] != apt_version:
            fail("isolated acquisition APT version differs from captured apt-version.txt")
        for field in ("runId", "runAttempt", "revision", "tree", "image", "imageId", "platform"):
            if record[field] != run[field]:
                fail(f"isolated acquisition {field} differs from the verified discovery run")

        source_config_file = safe_relative_path(record["sourceConfigFile"], "isolated source config file")
        if not source_config_file.startswith("apt-sources/"):
            fail("isolated source config file is outside captured APT sources")
        source_config = evidence_dir / source_config_file
        if not source_config.is_file() or source_config.is_symlink() or sha256_file(source_config) != record["sourceConfigSha256"]:
            fail("isolated source config hash does not match captured source stanza")
        source_relative = source_config_file.removeprefix("apt-sources/")
        configured_entries = parse_source_stanzas(source_config.read_text(errors="replace"), source_config.suffix)

        isolated_source_file = safe_relative_path(record["isolatedSourceFile"], "isolated source file")
        if not isolated_source_file.startswith(f"isolated-releases/{codename}/source."):
            fail("isolated source file is outside its codename acquisition directory")
        isolated_source_path = evidence_dir / isolated_source_file
        if not isolated_source_path.is_file() or isolated_source_path.is_symlink() or sha256_file(isolated_source_path) != record["isolatedSourceSha256"]:
            fail("isolated source file hash does not match captured source stanza")
        isolated_entries = parse_source_stanzas(isolated_source_path.read_text(errors="replace"), isolated_source_path.suffix)
        if len(isolated_entries) != 1:
            fail("isolated APT run must use exactly one source stanza")
        isolated_entry = isolated_entries[0]
        if isolated_entry["suites"] != [codename]:
            fail("isolated APT source did not narrow to exactly the configured Dist")
        matching_sources = [
            entry for entry in configured_entries
            if codename in entry["suites"] and entry["uris"] == isolated_entry["uris"]
            and entry["keyPaths"] == isolated_entry["keyPaths"]
        ]
        if len(matching_sources) != 1:
            fail("isolated source does not match exactly one captured original source stanza")
        if len(isolated_entry["uris"]) != 1:
            fail("isolated APT source must have exactly one URI")
        source_uri = isolated_entry["uris"][0].rstrip("/")
        if record["sourceUri"] != source_uri:
            fail("isolated source URI differs from proposal acquisition")
        target_origin = EXPECTED_ORIGINS[codename]
        source_parsed = urlsplit(source_uri)
        if source_parsed.scheme not in {"http", "https"} or source_parsed.hostname != target_origin[1] or source_parsed.path.rstrip("/") != target_origin[2]:
            fail("isolated source URI is outside the approved repository root")

        base_uri = record["baseUri"]
        if not isinstance(base_uri, str):
            fail("isolated acquisition BASE_URI is malformed")
        parsed_base = urlsplit(base_uri)
        if parsed_base.scheme != source_parsed.scheme or parsed_base.hostname != source_parsed.hostname or parsed_base.path.rstrip("/") != expected_suite_base_path(str(codename)):
            fail("isolated APT BASE_URI does not match the source root and configured Dist")
        expected_base_root = base_uri.split(f"/dists/{codename}/", 1)[0].rstrip("/")
        if source_uri != expected_base_root:
            fail("isolated APT source URI does not derive the captured suite-scoped BASE_URI")

        key_records = record["sourceKeyrings"]
        if not isinstance(key_records, list) or not key_records:
            fail("isolated acquisition has no bound Signed-By keyring records")
        if [item.get("path") for item in key_records if isinstance(item, dict)] != isolated_entry["keyPaths"]:
            fail("isolated acquisition keyrings differ from its source stanza")
        bound_original = dict(source_keys.get(source_relative, []))
        selected_keyrings: list[Path] = []
        for key_index, key_value in enumerate(key_records):
            key_record = object_with_keys(key_value, {"path", "sha256", "capturedFile"}, f"isolated sourceKeyrings[{key_index}]")
            key_path = key_record["path"]
            if key_path not in bound_original:
                fail("isolated keyring is not bound to the original source stanza")
            captured_relative = safe_relative_path(key_record["capturedFile"], "isolated captured keyring file")
            if captured_relative != f"apt-keyrings/{key_record['sha256']}":
                fail("isolated captured keyring path does not bind its hash")
            captured = evidence_dir / captured_relative
            if not captured.is_file() or captured.is_symlink() or sha256_file(captured) != key_record["sha256"]:
                fail("isolated source keyring hash differs from captured Signed-By bytes")
            if bound_original[key_path] != captured:
                fail("isolated source keyring bytes differ from source-trust binding")
            selected_keyrings.append(captured)

        target_file = safe_relative_path(record["aptTargetEvidenceFile"], "isolated APT target evidence file")
        if not target_file.startswith(f"isolated-releases/{codename}/") or evidence_hashes.get(target_file) != record["aptTargetEvidenceSha256"]:
            fail("isolated APT target evidence hash is unbound")
        target_path = evidence_dir / target_file
        if sha256_file(target_path) != record["aptTargetEvidenceSha256"]:
            fail("isolated APT target evidence bytes differ from proposal")
        target_rows = [line.split("|") for line in target_path.read_text().splitlines() if line]
        if not target_rows or any(len(row) != 9 for row in target_rows):
            fail("isolated APT target evidence has malformed framing")
        package_targets = 0
        for row in target_rows:
            if row[1] != codename or row[2] != expected_suite or row[6] != base_uri:
                fail("isolated APT target suite or BASE_URI differs from acquisition")
            target_uri = urlsplit(row[5])
            decoded_target_path = unquote(target_uri.path, errors="strict")
            if not (
                target_uri.scheme == source_parsed.scheme
                and target_uri.netloc == source_parsed.netloc
                and target_uri.hostname == target_origin[1]
                and not target_uri.username and not target_uri.password
                and not target_uri.query and not target_uri.fragment
                and target_uri.port in ({None, 80} if source_parsed.scheme == "http" else {None, 443})
                and decoded_target_path.startswith(parsed_base.path.rstrip("/") + "/")
                and ".." not in PurePosixPath(decoded_target_path).parts
            ):
                fail("isolated APT target URI does not match its approved source root")
            if row[0] == "Packages":
                package_targets += 1
        if not package_targets:
            fail("isolated APT acquisition contains no Packages target")

        inrelease_file = safe_relative_path(record["inReleaseFile"], "isolated InRelease file")
        inrelease_record = release_by_file.get(inrelease_file)
        if inrelease_record is None or record["inReleaseSha256"] != inrelease_record["sha256"] or record["inReleaseSizeBytes"] != inrelease_record["sizeBytes"]:
            fail("isolated InRelease file/hash/size differs from authenticated evidence")
        if release_contents[inrelease_file][:2] != (record["signedCodename"], record["signedSuite"]):
            fail("isolated Release signed identity differs from acquisition record")
        if (record["signedCodename"], record["signedSuite"]) != (codename, expected_suite):
            fail("isolated Release signed identity differs from configured Dist and source suite")

        exact_path = record["exactInReleasePath"]
        expected_lists_directory = PurePosixPath(f"/var/lib/apt/phase4-isolated/{codename}/lists")
        exact_pure_path = PurePosixPath(exact_path) if isinstance(exact_path, str) else PurePosixPath(".")
        if (
            not exact_pure_path.is_absolute()
            or exact_pure_path.parent != expected_lists_directory
            or ".." in exact_pure_path.parts
            or not exact_pure_path.name.endswith("InRelease")
        ):
            fail("isolated exact InRelease path is outside the disposable image's dedicated APT lists directory")
        exact_path_record = evidence_dir / f"isolated-releases/{codename}/exact-inrelease-path.txt"
        lists_path_record = evidence_dir / f"isolated-releases/{codename}/lists-path.txt"
        if exact_path_record.read_text().strip() != exact_path or lists_path_record.read_text().strip() != expected_lists_directory.as_posix():
            fail("isolated exact InRelease path differs from its captured APT lists-path records")
        copied_evidence = evidence_dir / inrelease_file
        if not copied_evidence.is_file() or copied_evidence.is_symlink():
            fail("isolated InRelease copy is missing or unsafe")
        digest_record = evidence_dir / f"isolated-releases/{codename}/exact-inrelease-digest.tsv"
        if digest_record.read_text().strip().split("\t") != [record["inReleaseSha256"], str(record["inReleaseSizeBytes"])]:
            fail("isolated InRelease copy differs from the digest captured at its exact APT path")
        signature_request = SignatureRequest(
            suite=str(codename),
            source_file=str(source_config_file),
            source_stanza_sha256=str(record["sourceConfigSha256"]),
            inrelease_file=inrelease_file,
            inrelease_sha256=str(record["inReleaseSha256"]),
            inrelease_size_bytes=int(record["inReleaseSizeBytes"]),
            keyrings=tuple(key_records),
        )
        verify_inrelease_signature(
            copied_evidence,
            selected_keyrings,
            request=signature_request,
            evidence_dir=evidence_dir,
            diagnostics=diagnostics,
        )

        combined_file = safe_relative_path(record["combinedInReleaseFile"], "combined InRelease file")
        if not combined_file.startswith("apt-lists/") or combined_file not in release_by_file:
            fail("combined InRelease association does not reference captured combined-update metadata")
        combined_record = release_by_file[combined_file]
        if record["combinedInReleaseSha256"] != combined_record["sha256"] or record["combinedInReleaseSizeBytes"] != combined_record["sizeBytes"]:
            fail("combined InRelease hash/size differs from its captured evidence record")
        identity_matches = [
            filename for filename, identity in release_contents.items()
            if filename.startswith("apt-lists/") and identity[:2] == (codename, expected_suite)
        ]
        if len(identity_matches) != 1 or identity_matches[0] != combined_file:
            fail("combined APT InRelease identity association is missing or ambiguous")
        if (evidence_dir / combined_file).read_bytes() != copied_evidence.read_bytes():
            fail("combined and isolated APT InRelease snapshots differ")
        target_key = (str(codename), str(expected_suite), base_uri)
        if target_key in by_target:
            fail("multiple isolated acquisitions bind the same target source root")
        by_target[target_key] = record

    if observed_codenames != set(EXPECTED_ORIGINS):
        fail("isolated Release acquisitions do not cover all approved suites")
    acquisition_release_files = {
        filename
        for record in records
        for filename in (record["inReleaseFile"], record["combinedInReleaseFile"])
    }
    if acquisition_release_files != set(release_by_file):
        fail("isolated acquisitions do not cover exactly the authenticated InRelease evidence")
    return by_target


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


def verify_inrelease_signature(
    path: Path,
    keyrings: list[Path],
    *,
    request: SignatureRequest | None = None,
    evidence_dir: Path | None = None,
    diagnostics: ValidationDiagnostics | None = None,
) -> None:
    verifier = shutil.which("gpgv")
    if not verifier:
        fail("trusted gpgv verifier is unavailable; cannot verify captured InRelease signature")
    if not keyrings:
        fail("no source-bound keyrings supplied for InRelease verification")
    if request is None or evidence_dir is None or diagnostics is None:
        fail("signature diagnostics context is required")
    evidence_dir = evidence_dir.resolve(strict=True)
    attempt: dict[str, object] = {
        "suite": request.suite,
        "source": {"file": request.source_file, "stanzaSha256": request.source_stanza_sha256},
        "release": {"file": request.inrelease_file, "sha256": request.inrelease_sha256, "sizeBytes": request.inrelease_size_bytes},
        "keyrings": [],
        "verifier": {"path": str(Path(verifier).resolve()), "sha256": sha256_file(Path(verifier)), "version": "unavailable"},
        "argv": [], "returncode": None, "termination": None, "statuses": [],
        "stdoutSha256": None, "stderrSha256": None, "accepted": False, "failureReason": None,
    }
    env = {**os.environ, "LC_ALL": "C", "LANG": "C"}
    try:
        version_rc, version_out, version_err, version_overflow = run_bounded([verifier, "--version"], env=env, timeout=5)
        version_text = (version_out or version_err).decode("utf-8", errors="replace")
        attempt["verifier"]["version"] = version_text.splitlines()[0][:300] if version_text and not version_overflow else "unavailable"
    except (OSError, subprocess.TimeoutExpired):
        pass
    temp_root = Path(tempfile.mkdtemp(prefix="trixie-inrelease-gpgv-"))
    os.chmod(temp_root, 0o700)
    try:
        private_release = temp_root / "InRelease"
        private_keys: list[Path] = []
        keyring_observations: list[dict[str, object]] = []
        bound_inputs = [(path, request.inrelease_sha256, request.inrelease_size_bytes)]
        if len(keyrings) != len(request.keyrings):
            fail("signature keyring paths differ from bound keyring records")
        for keyring, key_record in zip(keyrings, request.keyrings):
            bound_inputs.append((keyring, str(key_record["sha256"]), None))
        for index, (source_path, expected_hash, expected_size) in enumerate(bound_inputs):
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(source_path, flags)
            with os.fdopen(descriptor, "rb") as source:
                metadata = os.fstat(source.fileno())
                if not stat.S_ISREG(metadata.st_mode):
                    fail("signature input is not a regular file")
                raw = source.read()
            if sha256_bytes(raw) != expected_hash or (expected_size is not None and len(raw) != expected_size):
                fail("signature input changed from its bound evidence hash")
            armored = index > 0 and is_armored_public_key(raw)
            snapshot = private_release if index == 0 else temp_root / f"keyring-{index}.asc" if armored else temp_root / f"keyring-{index}.gpg"
            with snapshot.open("xb") as target:
                target.write(raw)
            os.chmod(snapshot, 0o600)
            if index:
                private_keys.append(snapshot)
                keyring_observations.append({
                    "path": request.keyrings[index - 1]["path"],
                    "sourceSha256": expected_hash,
                    "sourceSizeBytes": len(raw),
                    "capturedFile": request.keyrings[index - 1]["capturedFile"],
                    "sourceFormat": "ASCII_ARMORED_PUBLIC_KEY" if armored else "BINARY",
                    "verificationFormat": "OPENPGP_BINARY" if not armored else "PENDING",
                    "transformation": "PENDING" if armored else "BYTE_FOR_BYTE_PASSTHROUGH",
                })
                attempt["keyrings"] = keyring_observations
        with tempfile.TemporaryDirectory(prefix="gpgv-home-", dir=temp_root) as homedir:
            verification_keys: list[Path] = []
            def record_conversion_failure(
                reason: str, tool: dict[str, object], command: list[str] | None,
                returncode: int | None, termination: str, stdout: bytes = b"", stderr: bytes = b"",
                overflow: bool = False, output_keyring: Path | None = None,
                armored_snapshot: Path | None = None,
            ) -> None:
                attempt["conversionTool"] = tool
                attempt["conversionArgv"] = (
                    normalized_private_argv(command, homedir, private_release,
                                            [*private_keys, *( [output_keyring] if output_keyring else [])], armored_snapshot)
                    if command else []
                )
                attempt["returncode"] = returncode
                attempt["termination"] = "OUTPUT_LIMIT" if overflow else termination
                attempt["stdoutSha256"] = sha256_bytes(stdout)
                attempt["stderrSha256"] = sha256_bytes(stderr)
                attempt["accepted"] = False
                attempt["failureReason"] = reason
                if output_keyring is not None and output_keyring.exists() and not output_keyring.is_symlink() and output_keyring.is_file():
                    attempt["conversionOutput"] = {
                        "sha256": sha256_file(output_keyring),
                        "sizeBytes": output_keyring.stat().st_size,
                    }
                diagnostics.record(
                    request.suite, attempt,
                    redact_diagnostic_text(stderr.decode("utf-8", errors="replace"), evidence_dir, temp_root),
                )
                fail(reason)

            for source_snapshot, observation in zip(private_keys, keyring_observations):
                if observation["sourceFormat"] == "BINARY":
                    observation["verificationFile"] = "$PRIVATE_KEYRING"
                    observation["verificationSha256"] = observation["sourceSha256"]
                    observation["verificationSizeBytes"] = observation["sourceSizeBytes"]
                    observation["transformation"] = "BYTE_FOR_BYTE_PASSTHROUGH"
                    verification_keys.append(source_snapshot)
                    continue
                gpg = shutil.which("gpg")
                if not gpg:
                    attempt["keyrings"] = keyring_observations
                    record_conversion_failure(
                        "gpg is unavailable for armored source keyring conversion",
                        {"available": False, "path": None, "sha256": None, "version": "unavailable"},
                        None, None, "UNAVAILABLE", armored_snapshot=source_snapshot,
                    )
                gpg_path = Path(gpg).resolve()
                gpg_tool = {"available": True, "path": str(gpg_path), "sha256": sha256_file(gpg_path), "version": "unavailable"}
                try:
                    gpg_version_rc, gpg_version_out, gpg_version_err, gpg_version_overflow = run_bounded(
                        [gpg, "--version"], env=env, timeout=5,
                    )
                except OSError as error:
                    record_conversion_failure("gpg version command could not be launched", gpg_tool, [gpg, "--version"],
                                              None, "LAUNCH_ERROR", stderr=str(error).encode(), armored_snapshot=source_snapshot)
                gpg_version_text = (gpg_version_out or gpg_version_err).decode("utf-8", errors="replace")
                if gpg_version_text.strip():
                    gpg_tool["version"] = gpg_version_text.splitlines()[0][:300]
                if gpg_version_rc != 0 or gpg_version_overflow or not gpg_version_text.strip():
                    record_conversion_failure("gpg identity/version check failed for armored source keyring conversion",
                                              gpg_tool, [gpg, "--version"], gpg_version_rc,
                                              "OUTPUT_LIMIT" if gpg_version_overflow else "TIMEOUT" if gpg_version_rc == -1 else "VERSION_ERROR",
                                              gpg_version_out, gpg_version_err, gpg_version_overflow,
                                              armored_snapshot=source_snapshot)
                output_keyring = temp_root / f"keyring-{len(verification_keys) + 1}-dearmored.gpg"
                conversion_argv = [gpg, "--homedir", homedir, "--batch", "--yes", "--dearmor", "--output", str(output_keyring), str(source_snapshot)]
                try:
                    conversion_rc, conversion_stdout, conversion_stderr, conversion_overflow = run_bounded(
                        conversion_argv, env=env, timeout=15,
                    )
                except OSError as error:
                    record_conversion_failure("gpg dearmor command could not be launched", gpg_tool, conversion_argv,
                                              None, "LAUNCH_ERROR", stderr=str(error).encode(),
                                              output_keyring=output_keyring, armored_snapshot=source_snapshot)
                if conversion_rc != 0 or conversion_overflow or not output_keyring.is_file() or output_keyring.is_symlink():
                    record_conversion_failure("gpg failed to dearmor the bound source keyring", gpg_tool, conversion_argv,
                                              conversion_rc, "OUTPUT_LIMIT" if conversion_overflow else "TIMEOUT" if conversion_rc == -1 else "CONVERSION_ERROR",
                                              conversion_stdout, conversion_stderr, conversion_overflow,
                                              output_keyring, source_snapshot)
                output_stat = output_keyring.stat()
                if not stat.S_ISREG(output_stat.st_mode) or output_stat.st_size <= 0 or output_stat.st_size >= GPGV_OUTPUT_LIMIT:
                    record_conversion_failure("gpg produced an empty, oversized, or malformed dearmored keyring", gpg_tool,
                                              conversion_argv, conversion_rc, "MALFORMED_OUTPUT", conversion_stdout,
                                              conversion_stderr, output_keyring=output_keyring, armored_snapshot=source_snapshot)
                with output_keyring.open("rb") as derived_stream:
                    first_packet_octet = derived_stream.read(1)
                if not first_packet_octet or not first_packet_octet[0] & 0x80:
                    record_conversion_failure("gpg produced malformed non-OpenPGP output for the armored source keyring",
                                              gpg_tool, conversion_argv, conversion_rc, "MALFORMED_OUTPUT",
                                              conversion_stdout, conversion_stderr, output_keyring=output_keyring,
                                              armored_snapshot=source_snapshot)
                os.chmod(output_keyring, 0o600)
                observation.update({
                    "transformation": "gpg --dearmor",
                    "verificationFormat": "OPENPGP_BINARY",
                    "verificationFile": "$PRIVATE_KEYRING",
                    "verificationSha256": sha256_file(output_keyring),
                    "verificationSizeBytes": output_stat.st_size,
                    "conversionReturnCode": conversion_rc,
                    "conversionTermination": "EXITED",
                    "conversionStdoutSha256": sha256_bytes(conversion_stdout),
                    "conversionStderrSha256": sha256_bytes(conversion_stderr),
                    "conversionTool": {
                        "path": str(gpg_path),
                        "sha256": sha256_file(gpg_path),
                        "version": gpg_version_text.splitlines()[0][:300],
                        "argv": [str(gpg_path), "--homedir", "$PRIVATE_HOMEDIR", "--batch", "--yes", "--dearmor", "--output", "$PRIVATE_KEYRING", "$PRIVATE_ARMORED_KEYRING"],
                    },
                })
                verification_keys.append(output_keyring)
            attempt["keyrings"] = keyring_observations
            expected_private = [(private_release, request.inrelease_sha256), *zip(private_keys, (str(item["sha256"]) for item in request.keyrings)),
                                *zip(verification_keys, (str(item["verificationSha256"]) for item in keyring_observations))]
            for private_path, expected_hash in expected_private:
                try:
                    private_stat = private_path.lstat()
                except OSError as error:
                    fail(f"private signature snapshot is unavailable before gpgv: {error}")
                if (not stat.S_ISREG(private_stat.st_mode) or private_path.is_symlink()
                        or stat.S_IMODE(private_stat.st_mode) != 0o600 or sha256_file(private_path) != expected_hash):
                    fail("private signature snapshot hash, type, or mode changed before gpgv")
            command = [verifier, "--homedir", homedir, "--status-fd", "1", "--output", os.devnull]
            for keyring in verification_keys:
                command.extend(("--keyring", str(keyring)))
            command.append(str(private_release))
            normalized_argv = []
            for argument in command:
                if argument == homedir:
                    normalized_argv.append("$PRIVATE_HOMEDIR")
                elif argument == str(private_release):
                    normalized_argv.append("$PRIVATE_INRELEASE")
                elif argument in {str(item) for item in verification_keys}:
                    normalized_argv.append("$PRIVATE_KEYRING")
                else:
                    normalized_argv.append(argument)
            attempt["argv"] = normalized_argv
            stdout_bytes, stderr_bytes, overflow = b"", b"", False
            try:
                returncode, stdout_bytes, stderr_bytes, overflow = run_bounded(command, env=env, timeout=30)
                attempt["returncode"] = returncode
                attempt["termination"] = "OUTPUT_LIMIT" if overflow else ("TIMEOUT" if returncode == -1 else "EXITED")
            except (OSError, ValueError) as error:
                stdout_bytes, stderr_bytes = b"", str(error).encode()
                overflow = False
                attempt["termination"] = "LAUNCH_ERROR"
            if overflow:
                attempt["failureReason"] = "gpgv output exceeded the diagnostic byte limit"
            stdout = stdout_bytes.decode("utf-8", errors="replace")
            stderr = stderr_bytes.decode("utf-8", errors="replace")
            expected_snapshot_hashes = [request.inrelease_sha256, *(str(item["sha256"]) for item in request.keyrings)]
            snapshot_paths = [private_release, *private_keys]
            for snapshot, expected in zip(snapshot_paths, expected_snapshot_hashes):
                if (snapshot.is_symlink() or not snapshot.is_file() or stat.S_IMODE(snapshot.stat().st_mode) != 0o600
                        or sha256_file(snapshot) != expected):
                    fail("private signature snapshot changed during gpgv verification")
            for verification_key, observation in zip(verification_keys, keyring_observations):
                if (verification_key.is_symlink() or not verification_key.is_file()
                        or stat.S_IMODE(verification_key.stat().st_mode) != 0o600
                        or sha256_file(verification_key) != observation["verificationSha256"]):
                    fail("private verification keyring changed during gpgv verification")
            for source_path, key_record in zip(keyrings, request.keyrings):
                if sha256_file(source_path) != key_record["sha256"]:
                    fail("bound source keyring changed during gpgv verification")
            attempt["stdoutSha256"] = sha256_bytes(stdout_bytes)
            attempt["stderrSha256"] = sha256_bytes(stderr_bytes)
            statuses, tokens = structured_gpg_statuses(stdout_bytes)
            attempt["statuses"] = statuses
            forbidden = {"BADSIG", "ERRSIG", "NO_PUBKEY", "EXPKEYSIG", "REVKEYSIG", "NODATA"}
            accepted = (not overflow and attempt["returncode"] == 0 and "VALIDSIG" in tokens and not forbidden.intersection(tokens))
            attempt["accepted"] = accepted
            if not accepted:
                attempt["failureReason"] = "gpgv exit/status policy rejected the signature"
            redacted = redact_diagnostic_text(stderr, evidence_dir, temp_root)
            diagnostics.record(request.suite, attempt, redacted)
            if not accepted:
                fail(f"gpgv rejected captured InRelease signature: {request.suite}; diagnostics={request.suite}.json")
    finally:
        shutil.rmtree(temp_root)


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


def _validate_proposal(evidence_dir: Path, diagnostics: ValidationDiagnostics) -> ValidatedProposal:
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
        "isolatedReleaseAcquisitions",
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
    release_by_file: dict[str, dict[str, object]] = {}
    for index, item in enumerate(releases):
        record = validate_file_record(item, f"authenticatedInReleaseFiles[{index}]", evidence_dir, hashes)
        filename = record["file"]
        if not isinstance(filename, str) or not (
            re.fullmatch(r"isolated-releases/[a-z0-9-]+/InRelease", filename)
            or re.fullmatch(r"apt-lists/[^/]+InRelease", filename)
        ):
            fail("authenticated Release evidence has an unexpected file path")
        if filename in release_by_file:
            fail("proposal contains duplicate authenticated InRelease files")
        release_by_file[filename] = record
    captured_inrelease_files = {
        path.relative_to(evidence_dir).as_posix()
        for path in (
            *(evidence_dir / "isolated-releases").glob("*/InRelease"),
            *(evidence_dir / "apt-lists").glob("*InRelease"),
        )
        if path.is_file()
    }
    if {record["file"] for record in release_by_file.values()} != captured_inrelease_files:
        fail("proposal does not cover every combined and isolated InRelease acquisition")
    release_contents: dict[str, tuple[str, str, dict[str, tuple[str, int]]]] = {}
    for inrelease_file, record in release_by_file.items():
        raw = (evidence_dir / record["file"]).read_bytes()
        codename, suite, index_rows = parse_inrelease(raw)
        if codename not in EXPECTED_ORIGINS or suite != EXPECTED_ORIGINS[codename][0]:
            fail(f"isolated authenticated InRelease has an unapproved identity: {inrelease_file}")
        release_contents[inrelease_file] = (codename, suite, index_rows)
    isolated_acquisitions = validate_isolated_release_acquisitions(
        evidence_dir, diagnostics, proposal["isolatedReleaseAcquisitions"], release_by_file, release_contents, source_keys, hashes, run
    )

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
        if not isinstance(release_file, str) or release_file not in release_by_file:
            fail("signed Release index row references an unknown InRelease")
        release_record = release_by_file[release_file]
        if record["releaseSha256"] != release_record["sha256"]:
            fail("signed Release index row has a mismatched InRelease hash")
        codename = record["codename"]
        if codename not in EXPECTED_ORIGINS or record["suite"] != EXPECTED_ORIGINS[codename][0]:
            fail("signed Release index row has an unapproved suite identity")
        if not isinstance(record["path"], str) or not record["path"] or record["path"].startswith("/") or "\\" in record["path"] or ".." in PurePosixPath(record["path"]).parts:
            fail("signed Release index row has an invalid path")
        if not isinstance(record["sha256"], str) or not HEX_SHA256.fullmatch(record["sha256"]) or not is_nonnegative_int(record["size"]):
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
    target_release_map: dict[tuple[str, str, str], str] = {}
    for raw_target in raw_target_rows:
        fields = tuple(raw_target.split("|"))
        if len(fields) != 9:
            fail("captured APT index-target evidence has invalid framing")
        if fields in parsed_targets:
            fail("captured APT index-target evidence contains duplicate rows")
        parsed_targets.add(fields)
        if fields[1] not in EXPECTED_ORIGINS or fields[2] != EXPECTED_ORIGINS[fields[1]][0]:
            fail("captured APT index-target evidence has an unapproved Release identity")
        _, codename, suite, _, filename, uri, base_uri, _, _ = fields
        if not filename.startswith("/var/lib/apt/lists/"):
            fail("captured APT target contains an unexpected local metadata path")
        if any(part == ".." for part in PurePosixPath(filename).parts):
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
        target_key = (codename, suite, base_uri)
        acquisition = isolated_acquisitions.get(target_key)
        if acquisition is None:
            fail(f"APT target does not map to an isolated source-root acquisition: {codename}/{suite}")
        candidate_file = str(acquisition["inReleaseFile"])
        previous = target_release_map.setdefault(target_key, candidate_file)
        if previous != candidate_file:
            fail(f"APT targets map one suite-scoped source root to multiple InRelease files: {codename}/{suite}")
        release_identities.add((candidate_file, codename, suite))
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
    isolated_release_files = {
        str(record["inReleaseFile"]) for record in proposal["isolatedReleaseAcquisitions"]
    }
    if set(signed_rows_by_release) != isolated_release_files:
        fail("signed Release index rows do not cover exactly the isolated authenticated InRelease files")
    for release_file, (codename, suite, actual_rows) in release_contents.items():
        if release_file in isolated_release_files:
            if signed_rows_by_release[release_file] != actual_rows:
                fail(f"proposal signed index rows differ from isolated InRelease SHA256 section: {release_file}")
        else:
            acquisition = next(
                record for record in proposal["isolatedReleaseAcquisitions"]
                if record["combinedInReleaseFile"] == release_file
            )
            isolated_identity = release_contents[acquisition["inReleaseFile"]]
            if (codename, suite, actual_rows) != isolated_identity:
                fail(f"combined InRelease differs from source-isolated signed metadata: {release_file}")

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
        release_record = release_by_file.get(release_file) if isinstance(release_file, str) else None
        if release_record is None or record["releaseSha256"] != release_record["sha256"]:
            fail("package target binding does not match authenticated InRelease evidence")
        origin = EXPECTED_ORIGINS[codename]
        base_uri = record["baseUri"]
        uri = record["uri"]
        if not isinstance(base_uri, str) or not isinstance(uri, str):
            fail("package target binding baseUri is malformed")
        derived_release = target_release_map.get((str(codename), str(record["suite"]), base_uri))
        if derived_release is None or release_file != derived_release:
            fail("package target binding Release file differs from the independently derived target association")
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
            record["filename"], record["uri"], record["baseUri"], record["metaKey"], record["component"],
        )
        if target_tuple not in parsed_targets:
            fail("package target binding does not match captured APT index-target fields")
        key = (str(codename), str(component), str(architecture), str(canonical))
        if key in seen_bindings:
            fail("proposal contains duplicate package target bindings")
        seen_bindings.add(key)

    return ValidatedProposal(evidence_dir, run, proposal, sha256_bytes(proposal_raw))


def validate_proposal(evidence_dir: Path, diagnostics_dir: Path | None = None) -> ValidatedProposal:
    if evidence_dir.is_symlink():
        fail("evidence directory must not be a symlink")
    evidence = evidence_dir.resolve(strict=True)
    owned_temp = None
    if diagnostics_dir is None:
        owned_temp = tempfile.TemporaryDirectory(prefix="trixie-validation-diagnostics-")
        diagnostics_dir = Path(owned_temp.name) / "report"
    diagnostics = ValidationDiagnostics(diagnostics_dir, evidence)
    try:
        validated = _validate_proposal(evidence, diagnostics)
    except Exception as error:
        diagnostics.finish("REJECTED", str(error)[:1000])
        if owned_temp is not None:
            owned_temp.cleanup()
        raise
    diagnostics.finish("VALIDATED", None)
    if owned_temp is not None:
        owned_temp.cleanup()
    return validated


def prepare_candidate(evidence_dir: Path, lock_path: Path, output_path: Path) -> list[dict[str, str]]:
    del evidence_dir, lock_path, output_path
    fail("prepare-candidate is disabled until authenticated GitHub review and exact artifact provenance are verified")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate_parser = subparsers.add_parser("validate-proposal", help="validate discovery evidence without emitting removal tuples")
    validate_parser.add_argument("--evidence-dir", required=True, type=Path)
    validate_parser.add_argument("--diagnostics-dir", required=True, type=Path)
    prepare_parser = subparsers.add_parser("prepare-candidate", help="disabled pending authenticated review and artifact provenance")
    prepare_parser.add_argument("--evidence-dir", required=True, type=Path)
    prepare_parser.add_argument("--frozen-lock", required=True, type=Path)
    prepare_parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "validate-proposal":
        validated = validate_proposal(args.evidence_dir, args.diagnostics_dir)
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
