#!/usr/bin/env python3
"""Collect authenticated, non-mutating Trixie GnuPG purge-plan evidence."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit
from datetime import datetime, timezone


IMAGE = "postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe"
PLATFORM = "linux/amd64"
EVIDENCE_BASE = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "phase4-container-scan" / "trixie-gnupg-discovery"
PROTECTED_PREFIXES = (
    "apt", "gpgv", "debian-archive-keyring", "debian-keyring", "postgresql",
    "libpq", "libxml2", "libapt-pkg", "gosu", "ca-certificates",
)
ALLOWED_SUITES = {"trixie", "trixie-updates", "trixie-security", "trixie-pgdg"}

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
find /usr/share/keyrings -maxdepth 1 -type f \( -name '*debian*' -o -name '*pgdg*' \) -print0 \
  | LC_ALL=C sort -z | xargs -0 -r sha256sum > "$evidence/keyring-sha256.txt"
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
apt-get indextargets --format '$(IDENTIFIER)|$(CODENAME)|$(SUITE)|$(ARCHITECTURE)|$(FILENAME)|$(URI)' > "$evidence/apt-index-targets.raw"
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
  echo 'Authenticated InRelease or Packages metadata was not captured' >&2
  exit 24
fi
apt-get --simulate purge --auto-remove gnupg > "$evidence/gnupg-purge-simulation.txt" 2>&1
'''


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


def validate_index_targets(path: Path, metadata_directory: Path) -> None:
    rows = [line.split("|") for line in path.read_text().splitlines() if line]
    if not rows:
        raise ValueError("APT reported no authenticated index targets")
    observed_suites: set[str] = set()
    for row in rows:
        if len(row) != 6:
            raise ValueError("APT index-target output has unexpected framing")
        identifier, codename, suite, _, filename, uri = row
        if suite not in ALLOWED_SUITES or (codename and codename != "trixie"):
            raise ValueError(f"APT target is outside the approved Trixie suites: {suite!r}/{codename!r}")
        observed_suites.add(suite)
        parsed_uri = urlsplit(uri)
        if parsed_uri.scheme not in {"https", "http"} or not parsed_uri.hostname or parsed_uri.username or parsed_uri.password:
            raise ValueError("APT target URI is malformed or contains credentials")
        if parsed_uri.port not in {None, 80, 443}:
            raise ValueError("APT target URI uses a non-default port")
        if not filename.startswith("/var/lib/apt/lists/"):
            raise ValueError("APT target has an unexpected local path or unsupported source URI")
        if "Packages" in identifier and not (metadata_directory / Path(filename).name).is_file():
            raise ValueError(f"authenticated package index was not preserved: {filename}")
    missing_suites = ALLOWED_SUITES - observed_suites
    if missing_suites:
        raise ValueError(f"APT did not provide all required Trixie suites: {', '.join(sorted(missing_suites))}")


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


def main() -> int:
    EVIDENCE_BASE.parent.mkdir(parents=True, exist_ok=True)
    if EVIDENCE_BASE.exists():
        raise RuntimeError(f"refusing to overwrite existing discovery evidence: {EVIDENCE_BASE}")
    EVIDENCE_BASE.mkdir()
    revision = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    tree = run(["git", "rev-parse", "HEAD^{tree}"]).stdout.strip()
    manifest: dict[str, object] = {
        "schemaVersion": 1,
        "state": "DISCOVERY_RUNNING",
        "revision": revision,
        "tree": tree,
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
        validate_index_targets(EVIDENCE_BASE / "apt-index-targets.tsv", EVIDENCE_BASE / "apt-lists")
        inventory = parse_inventory(EVIDENCE_BASE / "dpkg-before.tsv")
        removals = parse_removals((EVIDENCE_BASE / "gnupg-purge-simulation.txt").read_text(), inventory)
        metadata_files = []
        for path in sorted((EVIDENCE_BASE / "apt-lists").iterdir()):
            if path.is_file():
                metadata_files.append({"file": path.relative_to(EVIDENCE_BASE).as_posix(), "sha256": sha256(path)})
        inrelease = [item for item in metadata_files if item["file"].endswith("InRelease")]
        packages = [item for item in metadata_files if "Packages" in item["file"]]
        if not inrelease or not packages:
            raise RuntimeError("missing authenticated Release or Packages metadata hashes")
        lock = {
            "schemaVersion": 1,
            "kind": "discovery-lock-proposal",
            "revision": revision,
            "tree": tree,
            "image": IMAGE,
            "imageId": manifest["imageId"],
            "platform": PLATFORM,
            "authenticatedReleaseMetadata": inrelease,
            "authenticatedPackagesMetadata": packages,
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
