#!/usr/bin/env python3
"""Validate the materialized package closure before building the isolated Forky image."""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
import subprocess
import sys
from typing import Any

ROOT_PACKAGE = {"name": "postgresql-17", "version": "17.11-1.pgdg14+2", "architecture": "amd64", "origin": "pgdg-forky"}
LIBXML_PACKAGE = "libxml2-16"
LIBXML_VERSION_FLOOR = "2.15.4+dfsg-1"
ALLOWED_ORIGINS = {"debian-forky", "pgdg-forky"}


def fail(message: str) -> None:
    raise ValueError(message)


def archive_name(row: dict[str, Any]) -> str:
    package, version, architecture = row.get("package"), row.get("version"), row.get("architecture")
    if (not isinstance(package, str) or not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", package)
        or not isinstance(version, str) or not re.fullmatch(r"(?:[0-9]+:)?[A-Za-z0-9.+~_-]+", version)
        or architecture not in {"amd64", "all"}):
        fail("package identity is malformed or architecture is unsupported")
    cache_version = re.sub(r"^([0-9]+):", r"\1%3a", version, count=1)
    return f"{package}_{cache_version}_{architecture}.deb"


def validate_signed_filename(row: dict[str, Any]) -> None:
    filename = row.get("filename")
    package, version, architecture = row["package"], row["version"], row["architecture"]
    if not isinstance(filename, str) or not re.fullmatch(r"pool/(?:[A-Za-z0-9.+~_-]+/)*[A-Za-z0-9.+~_-]+\.deb", filename):
        fail("signed package Filename is malformed")
    if any(part in {"", ".", ".."} for part in filename.split("/")):
        fail("signed package Filename contains traversal components")
    index_version = re.sub(r"^[0-9]+:", "", version, count=1)
    expected = f"{package}_{index_version}_{architecture}.deb"
    if not filename.endswith("/" + expected):
        fail("signed package Filename does not match package identity")


def validate(input_dir: pathlib.Path, head: str, repository: str, run_id: str, attempt: str,
             expected_postgres: str = ROOT_PACKAGE["version"], minimum_libxml: str = LIBXML_VERSION_FLOOR) -> dict[str, Any]:
    if input_dir.is_symlink():
        fail("verified input directory must not be a symlink")
    root = input_dir.resolve(strict=True)
    manifest_path, verified_path = root / "provenance.json", root / "verified-inputs.json"
    if manifest_path.is_symlink() or verified_path.is_symlink():
        fail("verified input manifests must not be symlinks")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    verified = json.loads(verified_path.read_text(encoding="utf-8"))
    if (verified.get("repository") != repository or str(verified.get("runId")) != run_id
        or str(verified.get("runAttempt")) != attempt):
        fail("verified input identity does not match this workflow run")
    workflow = manifest.get("workflow", {})
    if (workflow.get("GITHUB_REPOSITORY") != repository or str(workflow.get("GITHUB_RUN_ID")) != run_id
        or str(workflow.get("GITHUB_RUN_ATTEMPT")) != attempt or workflow.get("GITHUB_SHA") != head):
        fail("manifest workflow identity does not match this candidate build")
    package_closure = manifest.get("dependencyClosure", {})
    packages = package_closure.get("packages")
    if not isinstance(packages, list) or len(packages) != verified.get("packageCount") or not packages:
        fail("package closure is incomplete")
    root_record = package_closure.get("rootPackage", {})
    if root_record != {
        "name": ROOT_PACKAGE["name"], "version": expected_postgres,
        "architecture": ROOT_PACKAGE["architecture"], "requiredOrigin": "apt.postgresql.org",
    }:
        fail("root package identity is not pinned")
    source = verified.get("sourceArtifact", {})
    digest = source.get("digest") if isinstance(source, dict) else None
    if not isinstance(digest, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        fail("verified source artifact digest is malformed")
    source_zip = root / "source-artifact.zip"
    if source_zip.is_symlink() or not source_zip.is_file():
        fail("retained source artifact ZIP differs from its verified digest")
    with source_zip.open("rb") as stream:
        digest_state = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest_state.update(chunk)
        source_digest = digest_state.hexdigest()
    if source_digest != digest.removeprefix("sha256:"):
        fail("retained source artifact ZIP differs from its verified digest")

    seen_ids: set[tuple[str, str]] = set()
    seen_files: set[str] = set()
    postgres: list[dict[str, Any]] = []
    libxml: list[dict[str, Any]] = []
    for row in packages:
        if not isinstance(row, dict):
            fail("package closure row is malformed")
        filename = archive_name(row)
        validate_signed_filename(row)
        origins = row.get("origins")
        if not isinstance(origins, list) or len(origins) != 1 or origins[0] not in ALLOWED_ORIGINS:
            fail("package origin is missing or not authenticated")
        identity = (row["package"], row["architecture"])
        if identity in seen_ids or filename in seen_files:
            fail("package identity or archive filename is duplicated")
        seen_ids.add(identity)
        seen_files.add(filename)
        package_path = root / "packages" / filename
        if package_path.is_symlink() or not package_path.is_file():
            fail("materialized package archive is missing or unsafe: " + filename)
        data = package_path.read_bytes()
        if (len(data) != row.get("size") or not isinstance(row.get("sha256"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"])
            or hashlib.sha256(data).hexdigest() != row["sha256"]):
            fail("package bytes failed provenance hash/size verification: " + filename)
        if row["package"] == ROOT_PACKAGE["name"]:
            postgres.append(row)
        if row["package"] == LIBXML_PACKAGE:
            libxml.append(row)

    if (len(postgres) != 1 or postgres[0].get("version") != expected_postgres
        or postgres[0].get("architecture") != ROOT_PACKAGE["architecture"]
        or postgres[0].get("origins") != [ROOT_PACKAGE["origin"]]):
        fail("the exact PostgreSQL root package is absent from authenticated PGDG Forky")
    if len(libxml) != 1:
        fail("the authenticated runtime closure must contain exactly one libxml2-16 package")
    subprocess.run(["dpkg", "--compare-versions", libxml[0]["version"], "ge", minimum_libxml], check=True)
    package_dir = root / "packages"
    if package_dir.is_symlink() or not package_dir.is_dir():
        fail("materialized package directory is missing or unsafe")
    actual_files = {path.name for path in package_dir.glob("*.deb") if path.is_file() and not path.is_symlink()}
    if actual_files != seen_files:
        fail("materialized package file set differs from the authenticated manifest")
    return {
        "packageCount": len(packages), "postgresql17": postgres[0]["version"],
        "libxml2-16": libxml[0]["version"], "inputDigest": digest,
    }


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 5:
        print("usage: validate_forky_candidate_inputs.py INPUT_DIR GITHUB_SHA GITHUB_REPOSITORY GITHUB_RUN_ID GITHUB_RUN_ATTEMPT", file=sys.stderr)
        return 2
    try:
        print(json.dumps(validate(pathlib.Path(args[0]), *args[1:]), sort_keys=True))
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
