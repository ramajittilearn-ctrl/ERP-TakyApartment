from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("validate_forky_candidate_inputs.py")
SPEC = importlib.util.spec_from_file_location("validate_forky_candidate_inputs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

HEAD = "a" * 40
REPO = "ramajittilearn-ctrl/ERP-TakyApartment"
RUN_ID = "42"
ATTEMPT = "2"


def make_row(package: str, version: str, architecture: str, origin: str, data: bytes) -> tuple[dict, str]:
    index_version = version.split(":", 1)[-1] if ":" in version else version
    directory = f"pool/main/{package[0]}/{package}"
    signed_filename = f"{directory}/{package}_{index_version}_{architecture}.deb"
    cache_version = version.replace(":", "%3a", 1)
    cache_filename = f"{package}_{cache_version}_{architecture}.deb"
    return ({
        "package": package, "version": version, "architecture": architecture,
        "filename": signed_filename, "origins": [origin],
        "sha256": hashlib.sha256(data).hexdigest(), "size": len(data),
    }, cache_filename)


def fixture(root: Path) -> Path:
    packages = root / "packages"
    packages.mkdir(parents=True)
    rows = []
    for package, version, architecture, origin, data in [
        ("postgresql-17", "17.11-1.pgdg14+2", "amd64", "pgdg-forky", b"postgres"),
        ("libxml2-16", "2.15.4+dfsg-1", "amd64", "debian-forky", b"libxml"),
        ("libaudit-common", "1:4.1.2-1", "all", "debian-forky", b"all epoch"),
    ]:
        row, filename = make_row(package, version, architecture, origin, data)
        rows.append(row)
        (packages / filename).write_bytes(data)
    manifest = {
        "workflow": {"GITHUB_REPOSITORY": REPO, "GITHUB_RUN_ID": RUN_ID, "GITHUB_RUN_ATTEMPT": ATTEMPT, "GITHUB_SHA": HEAD},
        "dependencyClosure": {
            "rootPackage": {"name": "postgresql-17", "version": "17.11-1.pgdg14+2", "architecture": "amd64", "requiredOrigin": "apt.postgresql.org"},
            "packages": rows,
        },
    }
    source_zip = b"verified source artifact ZIP"
    (root / "source-artifact.zip").write_bytes(source_zip)
    source_digest = hashlib.sha256(source_zip).hexdigest()
    verified = {"repository": REPO, "runId": int(RUN_ID), "runAttempt": int(ATTEMPT), "packageCount": len(rows), "sourceArtifact": {"digest": "sha256:" + source_digest}}
    (root / "provenance.json").write_text(json.dumps(manifest))
    (root / "verified-inputs.json").write_text(json.dumps(verified))
    return root


class CandidateInputTests(unittest.TestCase):
    def run_validated(self, root: Path):
        return MODULE.validate(root, HEAD, REPO, RUN_ID, ATTEMPT)

    def test_accepts_authenticated_amd64_root_and_all_epoch_dependency(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(MODULE.subprocess, "run") as compare:
            result = self.run_validated(fixture(Path(temp)))
        self.assertEqual(result["packageCount"], 3)
        self.assertEqual(result["postgresql17"], "17.11-1.pgdg14+2")
        self.assertEqual(result["libxml2-16"], "2.15.4+dfsg-1")
        compare.assert_called_once_with(["dpkg", "--compare-versions", "2.15.4+dfsg-1", "ge", "2.15.4+dfsg-1"], check=True)

    def test_rejects_changed_package_bytes_and_unlisted_archives(self):
        with tempfile.TemporaryDirectory() as temp:
            root = fixture(Path(temp))
            archive = root / "packages/libaudit-common_1%3a4.1.2-1_all.deb"
            archive.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "failed provenance"):
                self.run_validated(root)
            archive.write_bytes(b"all epoch")
            (root / "packages/extra_1_amd64.deb").write_bytes(b"extra")
            with patch.object(MODULE.subprocess, "run"):
                with self.assertRaisesRegex(ValueError, "file set differs"):
                    self.run_validated(root)

    def test_rejects_wrong_root_tuple_architecture_or_origin(self):
        mutations = (
            lambda m: m["dependencyClosure"]["rootPackage"].update(architecture="all"),
            lambda m: next(x for x in m["dependencyClosure"]["packages"] if x["package"] == "postgresql-17").update(architecture="all"),
            lambda m: next(x for x in m["dependencyClosure"]["packages"] if x["package"] == "postgresql-17").update(origins=["debian-forky"]),
        )
        for mutate in mutations:
            with self.subTest(mutation=mutate), tempfile.TemporaryDirectory() as temp, patch.object(MODULE.subprocess, "run"):
                root = fixture(Path(temp))
                path = root / "provenance.json"
                manifest = json.loads(path.read_text())
                mutate(manifest)
                path.write_text(json.dumps(manifest))
                with self.assertRaises(ValueError):
                    self.run_validated(root)

    def test_rejects_run_identity_filename_traversal_and_duplicate_archives(self):
        with tempfile.TemporaryDirectory() as temp:
            root = fixture(Path(temp))
            verified_path = root / "verified-inputs.json"
            verified = json.loads(verified_path.read_text())
            verified["runId"] = 43
            verified_path.write_text(json.dumps(verified))
            with self.assertRaisesRegex(ValueError, "identity"):
                self.run_validated(root)
        with tempfile.TemporaryDirectory() as temp:
            root = fixture(Path(temp))
            verified_path = root / "verified-inputs.json"
            verified = json.loads(verified_path.read_text())
            verified["sourceArtifact"]["digest"] = "b" * 64
            verified_path.write_text(json.dumps(verified))
            with self.assertRaisesRegex(ValueError, "digest"):
                self.run_validated(root)
        with tempfile.TemporaryDirectory() as temp:
            root = fixture(Path(temp))
            (root / "source-artifact.zip").write_bytes(b"modified source artifact")
            with patch.object(MODULE.subprocess, "run"):
                with self.assertRaisesRegex(ValueError, "retained source artifact ZIP"):
                    self.run_validated(root)
        with tempfile.TemporaryDirectory() as temp:
            root = fixture(Path(temp))
            path = root / "provenance.json"
            manifest = json.loads(path.read_text())
            manifest["dependencyClosure"]["packages"][2]["filename"] = "pool/../escape.deb"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "Filename"):
                self.run_validated(root)


if __name__ == "__main__":
    unittest.main()
