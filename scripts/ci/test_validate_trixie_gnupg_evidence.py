import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit


SCRIPT = Path(__file__).with_name("validate-trixie-gnupg-evidence.py")
SPEC = importlib.util.spec_from_file_location("trixie_evidence_validator", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
DISCOVERY_SCRIPT = SCRIPT.with_name("discover-trixie-gnupg-removal.py")
DISCOVERY_SPEC = importlib.util.spec_from_file_location("trixie_discovery_for_validation_test", DISCOVERY_SCRIPT)
DISCOVERY = importlib.util.module_from_spec(DISCOVERY_SPEC)
assert DISCOVERY_SPEC and DISCOVERY_SPEC.loader
sys.modules[DISCOVERY_SPEC.name] = DISCOVERY
DISCOVERY_SPEC.loader.exec_module(DISCOVERY)
REAL_VERIFY_SIGNATURE = MODULE.verify_inrelease_signature


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(data: dict) -> bytes:
    return (json.dumps(data, sort_keys=True, indent=2) + "\n").encode()


class EvidenceFixture:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir()
        self.files = {
            "apt-signature-config.txt": b"APT::Key::gpgvcommand \"/usr/bin/sqv\";\n",
            "apt-trusted-paths.tsv": b"trusted\t<unset>\ntrustedParts\t/etc/apt/trusted.gpg.d\n",
            "apt-verifiers.tsv": b"sqv\t/usr/bin/sqv\tsqv 1.3.0\n",
            "apt-version.txt": b"apt 3.0.3 (amd64)\n",
            "gnupg-purge-simulation.txt": b"Remv gnupg [2.4.7-21]\n",
            "container-status.json": b'{"state":"DISCOVERY_COMPLETE","exitCode":0}\n',
            "apt-update.log": b"All packages are up to date.\n",
            "dpkg-before.tsv": b"gnupg\t2.4.7-21\tamd64\tinstalled\n",
            "gnupg-installed.tsv": b"gnupg\t2.4.7-21\tamd64\tinstalled\n",
        }
        debian_key = "/usr/share/keyrings/debian-archive-keyring.gpg"
        pgdg_key = "/usr/local/share/keyrings/postgres.gpg.asc"
        debian_digest = hashlib.sha256(b"synthetic Debian archive key").hexdigest()
        pgdg_digest = hashlib.sha256(b"synthetic PGDG key").hexdigest()
        self.files["keyring-sha256.txt"] = f"{debian_digest}  {debian_key}\n{pgdg_digest}  {pgdg_key}\n".encode()
        self.files["apt-sources/sources.list.d/debian.sources"] = (
            "Types: deb\nURIs: https://deb.debian.org/debian https://deb.debian.org/debian-security\n"
            "Suites: trixie trixie-updates trixie-security\nComponents: main\n"
            f"Signed-By: {debian_key}\n"
        ).encode()
        self.files["apt-sources/sources.list.d/pgdg.list"] = (
            f"deb [signed-by={pgdg_key}] http://apt.postgresql.org/pub/repos/apt trixie-pgdg main\n"
        ).encode()
        self.files["source-trust.tsv"] = (
            f"{debian_key}\t{debian_digest}\t{len(b'synthetic Debian archive key')}\tsources.list.d/debian.sources\tapt-keyrings/{debian_digest}\n"
            f"{pgdg_key}\t{pgdg_digest}\t{len(b'synthetic PGDG key')}\tsources.list.d/pgdg.list\tapt-keyrings/{pgdg_digest}\n"
            "APT source trust policy: PASS\n"
        ).encode()
        self.files[f"apt-keyrings/{debian_digest}"] = b"synthetic Debian archive key"
        self.files[f"apt-keyrings/{pgdg_digest}"] = b"synthetic PGDG key"

        self.run = {
            "schemaVersion": 1,
            "state": "DISCOVERY_COMPLETE",
            "revision": "a" * 40,
            "tree": "b" * 40,
            "runId": 40832145402,
            "runAttempt": 2,
            "image": MODULE.IMAGE,
            "platform": MODULE.PLATFORM,
            "runtimeClearance": "NOT_EVALUATED",
            "cveClearance": "NOT_EVALUATED",
            "generatedAt": "2026-10-29T02:00:00+00:00",
            "imageId": "sha256:" + "c" * 64,
            "repoDigests": ["postgres@" + MODULE.IMAGE.rsplit("@", 1)[1]],
            "removalCount": 1,
        }
        self.proposal = {
            "schemaVersion": 1,
            "kind": "discovery-lock-proposal",
            "revision": self.run["revision"],
            "tree": self.run["tree"],
            "runId": self.run["runId"],
            "runAttempt": self.run["runAttempt"],
            "image": self.run["image"],
            "imageId": self.run["imageId"],
            "platform": self.run["platform"],
            "authenticatedInReleaseFiles": [],
            "signedReleaseIndexHashes": [],
            "packageIndexTargetBindings": [],
            "localAptIndexFiles": [],
            "aptSignatureConfigSha256": digest(self.files["apt-signature-config.txt"]),
            "aptTrustedPathsSha256": digest(self.files["apt-trusted-paths.tsv"]),
            "sourceTrustEvidenceSha256": digest(self.files["source-trust.tsv"]),
            "purgeSimulationSha256": digest(self.files["gnupg-purge-simulation.txt"]),
            "removals": [{"name": "gnupg", "version": "2.4.7-21", "architecture": "amd64"}],
            "runtimeClearance": "NOT_EVALUATED",
            "cveClearance": "NOT_EVALUATED",
            "approvalState": "REQUIRES_INDEPENDENT_REVIEW_AND_LOCK_FREEZE",
        }
        target_rows = []
        for codename, (suite, host, origin_path) in MODULE.EXPECTED_ORIGINS.items():
            origin = f"https://{host}{origin_path}"
            release_name = f"repo_dists_{codename}_InRelease"
            local_name = f"repo_dists_{codename}_main_binary-amd64_Packages.lz4"
            signed_path = "main/binary-amd64/Packages.xz"
            signed_hash = hashlib.sha256(f"signed index {codename}".encode()).hexdigest()
            signed_size = 123 + len(codename)
            release_bytes = (
                "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n"
                f"Codename: {codename}\nSuite: {suite}\nSHA256:\n {signed_hash} {signed_size} {signed_path}\n"
                "-----BEGIN PGP SIGNATURE-----\nZmFrZS1zaWduYXR1cmU=\n=abcd\n-----END PGP SIGNATURE-----\n"
            ).encode()
            local_bytes = f"synthetic local Packages fixture {codename}\n".encode()
            self.files[f"apt-lists/{release_name}"] = release_bytes
            self.files[f"apt-lists/{local_name}"] = local_bytes
            release_hash = digest(release_bytes)
            local_hash = digest(local_bytes)
            filename = f"/var/lib/apt/lists/{local_name}"
            release_path = f"/var/lib/apt/lists/{release_name}"
            uri = f"{origin}/dists/{codename}/{signed_path}"
            base_uri = origin + "/"
            meta_key = "main/binary-amd64/Packages"
            target_rows.append("|".join(("Packages", codename, suite, "amd64", filename, uri, base_uri, meta_key, release_path, "main")))
            self.proposal["authenticatedInReleaseFiles"].append({
                "file": f"apt-lists/{release_name}", "sha256": release_hash, "sizeBytes": len(release_bytes),
            })
            self.proposal["signedReleaseIndexHashes"].append({
                "releaseFile": release_name, "releaseSha256": release_hash, "codename": codename,
                "suite": suite, "path": signed_path, "sha256": signed_hash, "size": signed_size,
            })
            self.proposal["localAptIndexFiles"].append({
                "file": f"apt-lists/{local_name}", "sha256": local_hash, "sizeBytes": len(local_bytes),
            })
            self.proposal["packageIndexTargetBindings"].append({
                "identifier": "Packages", "codename": codename, "suite": suite, "component": "main",
                "architecture": "amd64", "filename": filename, "uri": uri, "baseUri": base_uri,
                "metaKey": meta_key, "releaseFile": release_name, "releaseSha256": release_hash,
                "canonicalPackagesPath": "main/binary-amd64/Packages",
                "signedVariants": [{"path": signed_path, "sha256": signed_hash, "size": signed_size}],
                "localAptFile": local_name, "localAptSha256": local_hash, "localAptSize": len(local_bytes),
            })
        self.files["apt-index-targets.tsv"] = ("\n".join(target_rows) + "\n").encode()
        for relative, data in self.files.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.write()

    def write(self):
        (self.root / "gnupg-removal-lock-proposal.json").write_bytes(json_bytes(self.proposal))
        self.run["evidenceSha256"] = {
            path.relative_to(self.root).as_posix(): digest(path.read_bytes())
            for path in sorted(self.root.rglob("*")) if path.is_file() and path.name != "run.json"
        }
        (self.root / "run.json").write_bytes(json_bytes(self.run))

    def frozen_lock(self):
        proposal_raw = (self.root / "gnupg-removal-lock-proposal.json").read_bytes()
        return {
            "schemaVersion": 1,
            "kind": "frozen-reviewed-lock",
            "proposalSha256": digest(proposal_raw),
            "runId": self.run["runId"],
            "runAttempt": self.run["runAttempt"],
            "revision": self.run["revision"],
            "tree": self.run["tree"],
            "image": self.run["image"],
            "imageId": self.run["imageId"],
            "platform": self.run["platform"],
            "removals": self.proposal["removals"],
            "reviewStatus": "INDEPENDENT_REVIEW_APPROVED",
            "reviewer": "independent-reviewer@example.test",
            "reviewedAt": "2026-10-29T03:00:00+00:00",
            "frozenAt": "2026-10-29T03:05:00+00:00",
            "reviewEvidenceRef": "https://github.com/example/repo/pull/123#review-456",
            "reviewEvidenceSha256": "f" * 64,
        }


class EvidenceValidationTests(unittest.TestCase):
    def setUp(self):
        self.run_identity = patch.dict(os.environ, {"GITHUB_RUN_ID": "40832145402", "GITHUB_RUN_ATTEMPT": "2"})
        self.run_identity.start()
        self.addCleanup(self.run_identity.stop)
        self.signature_verifier = patch.object(MODULE, "verify_inrelease_signature")
        self.signature_verifier.start()
        self.addCleanup(self.signature_verifier.stop)

    def fixture(self, temp: str) -> EvidenceFixture:
        return EvidenceFixture(Path(temp) / "evidence")

    def test_discovery_requires_github_run_identity(self):
        with patch.dict(os.environ, {"GITHUB_RUN_ID": "40832145402", "GITHUB_RUN_ATTEMPT": "2"}, clear=True):
            self.assertEqual(DISCOVERY.required_github_run_identity(), (40832145402, 2))
        for env in ({}, {"GITHUB_RUN_ID": "0", "GITHUB_RUN_ATTEMPT": "2"}, {"GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1.5"}):
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                with self.assertRaisesRegex(RuntimeError, "GITHUB_RUN_ID"):
                    DISCOVERY.required_github_run_identity()

    def test_valid_proposal_is_read_only_and_cli_emits_no_package_tuples(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            before = sorted(path.relative_to(fixture.root).as_posix() for path in fixture.root.rglob("*") if path.is_file())
            validated = MODULE.validate_proposal(fixture.root)
            self.assertEqual(validated.proposal_sha256, digest((fixture.root / "gnupg-removal-lock-proposal.json").read_bytes()))
            fake_bin = Path(temp) / "fake-bin"
            fake_bin.mkdir()
            fake_gpgv = fake_bin / "gpgv"
            fake_gpgv.write_text("#!/bin/sh\nprintf '[GNUPG:] VALIDSIG test-fixture\n'\n")
            fake_gpgv.chmod(0o755)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "validate-proposal", "--evidence-dir", str(fixture.root)],
                text=True, capture_output=True,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PATH": f"{fake_bin}:{os.environ.get('PATH', '')}"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("gnupg", result.stdout)
            after = sorted(path.relative_to(fixture.root).as_posix() for path in fixture.root.rglob("*") if path.is_file())
            self.assertEqual(before, after)

    def test_run_identity_must_match_hosted_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            with patch.dict(os.environ, {"GITHUB_RUN_ATTEMPT": "3"}):
                with self.assertRaisesRegex(ValueError, "do not match this hosted GitHub run"):
                    MODULE.validate_proposal(fixture.root)

    def test_fake_signature_is_rejected_by_trusted_verifier(self):
        original = REAL_VERIFY_SIGNATURE
        release = Path("/tmp/fake-InRelease")
        keyring = Path("/tmp/source-bound-keyring")
        with patch.object(MODULE.shutil, "which", return_value="/usr/bin/gpgv"), patch.object(
            MODULE.subprocess, "run",
            return_value=subprocess.CompletedProcess([], 1, "[GNUPG:] BADSIG 1234 user\n", "bad signature"),
        ):
            with self.assertRaisesRegex(ValueError, "gpgv rejected captured InRelease signature"):
                original(release, [keyring])

    def test_unsigned_inrelease_is_rejected(self):
        with patch.object(MODULE.shutil, "which", return_value="/usr/bin/gpgv"), patch.object(
            MODULE.subprocess, "run",
            return_value=subprocess.CompletedProcess([], 2, "[GNUPG:] NODATA 1\n", "no valid OpenPGP data"),
        ):
            with self.assertRaisesRegex(ValueError, "gpgv rejected captured InRelease signature"):
                REAL_VERIFY_SIGNATURE(Path("/tmp/unsigned-InRelease"), [Path("/tmp/source-bound-keyring")])

    def test_prepare_candidate_is_disabled_even_for_forged_lock_and_never_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            lock_path = Path(temp) / "forged-lock.json"
            lock_path.write_bytes(json_bytes(fixture.frozen_lock()))
            output = Path(temp) / "candidate-removals.tsv"
            with self.assertRaisesRegex(ValueError, "disabled until authenticated GitHub review"):
                MODULE.prepare_candidate(fixture.root, lock_path, output)
            self.assertFalse(output.exists())

    def test_captured_keyring_tampering_is_rejected_before_signature_check(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            keyring = next((fixture.root / "apt-keyrings").iterdir())
            keyring.write_bytes(b"changed key bytes")
            fixture.write()
            with self.assertRaisesRegex(ValueError, "captured Signed-By keyring bytes"):
                MODULE.validate_proposal(fixture.root)

    def test_release_uses_only_source_keyrings_bound_to_its_origin_and_suite(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            source_keys = MODULE.validate_source_trust(fixture.root)
            debian = MODULE.source_keyrings_for_release(fixture.root, source_keys, "trixie")
            pgdg = MODULE.source_keyrings_for_release(fixture.root, source_keys, "trixie-pgdg")
            self.assertEqual([path.name for path in debian], [digest(b"synthetic Debian archive key")])
            self.assertEqual([path.name for path in pgdg], [digest(b"synthetic PGDG key")])

            pgdg_source = fixture.root / "apt-sources/sources.list.d/pgdg.list"
            pgdg_source.write_text(pgdg_source.read_text().replace("apt.postgresql.org", "mirror.example.test"))
            with self.assertRaisesRegex(ValueError, "no captured Signed-By keyring"):
                MODULE.source_keyrings_for_release(fixture.root, source_keys, "trixie-pgdg")

    def test_source_origin_binding_rejects_credentials_and_non_default_ports(self):
        for uri in (
            "http://user@apt.postgresql.org/pub/repos/apt",
            "http://apt.postgresql.org:8080/pub/repos/apt",
            "http://apt.postgresql.org/pub/repos/apt?redirect=1",
        ):
            with self.subTest(uri=uri):
                self.assertFalse(MODULE.source_uri_matches(urlsplit(uri), "apt.postgresql.org", "/pub/repos/apt"))
        self.assertTrue(MODULE.source_uri_matches(
            urlsplit("https://apt.postgresql.org/pub/repos/apt"),
            "apt.postgresql.org", "/pub/repos/apt",
        ))

    def test_evidence_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            (fixture.root / "source-trust.tsv").write_bytes(b"tampered\n")
            with self.assertRaisesRegex(ValueError, "evidence hash mismatch"):
                MODULE.validate_proposal(fixture.root)

    def test_unlisted_extra_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            (fixture.root / "unbound.txt").write_text("extra")
            with self.assertRaisesRegex(ValueError, "coverage"):
                MODULE.validate_proposal(fixture.root)

    def test_proposal_run_identity_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            fixture.proposal["runAttempt"] += 1
            fixture.write()
            with self.assertRaisesRegex(ValueError, "runAttempt does not match"):
                MODULE.validate_proposal(fixture.root)

    def test_unsafe_evidence_hash_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            fixture.run["evidenceSha256"]["../outside"] = "e" * 64
            (fixture.root / "run.json").write_bytes(json_bytes(fixture.run))
            with self.assertRaisesRegex(ValueError, "safe relative path"):
                MODULE.validate_proposal(fixture.root)

    def test_target_binding_must_match_captured_apt_target(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            targets = fixture.root / "apt-index-targets.tsv"
            targets.write_text(
                targets.read_text().replace(
                    "/var/lib/apt/lists/repo_dists_trixie_main_binary-amd64_Packages.lz4",
                    "/var/lib/apt/lists/other_Packages.lz4",
                )
            )
            fixture.write()
            with self.assertRaisesRegex(ValueError, "captured APT index-target"):
                MODULE.validate_proposal(fixture.root)

    def test_source_trust_pass_footer_cannot_hide_policy_bypass(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            source = fixture.root / "apt-sources/sources.list.d/pgdg.list"
            source.write_text(source.read_text().replace("[signed-by=", "[trusted=yes signed-by="))
            fixture.write()
            with self.assertRaisesRegex(ValueError, "trust or freshness bypass"):
                MODULE.validate_proposal(fixture.root)

    def test_enabled_source_without_signed_by_is_rejected_even_with_pass_footer(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            source = fixture.root / "apt-sources/sources.list.d/debian.sources"
            source.write_text(source.read_text().replace("Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg\n", ""))
            fixture.write()
            with self.assertRaisesRegex(ValueError, "no explicit Signed-By"):
                MODULE.validate_proposal(fixture.root)

    def test_source_trust_keyring_hash_must_match_keyring_inventory(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            inventory = fixture.root / "keyring-sha256.txt"
            lines = inventory.read_text().splitlines()
            lines[0] = "0" * 64 + lines[0][64:]
            inventory.write_text("\n".join(lines) + "\n")
            fixture.write()
            with self.assertRaisesRegex(ValueError, "absent from keyring-sha256"):
                MODULE.validate_proposal(fixture.root)

    def test_proposal_signed_hash_rows_must_match_actual_inrelease(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            release_record = fixture.proposal["authenticatedInReleaseFiles"][0]
            release_path = fixture.root / release_record["file"]
            original_row = fixture.proposal["signedReleaseIndexHashes"][0]
            release_path.write_bytes(
                release_path.read_bytes().replace(original_row["sha256"].encode(), b"0" * 64)
            )
            release_record["sha256"] = digest(release_path.read_bytes())
            release_record["sizeBytes"] = release_path.stat().st_size
            fixture.proposal["packageIndexTargetBindings"][0]["releaseSha256"] = release_record["sha256"]
            fixture.proposal["signedReleaseIndexHashes"][0]["releaseSha256"] = release_record["sha256"]
            fixture.write()
            with self.assertRaisesRegex(ValueError, "differ from InRelease SHA256 section"):
                MODULE.validate_proposal(fixture.root)

    def test_installed_inventory_and_simulation_must_match_proposal(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            inventory = fixture.root / "dpkg-before.tsv"
            inventory.write_text("gnupg\t2.4.7-20\tamd64\tinstalled\n")
            installed = fixture.root / "gnupg-installed.tsv"
            installed.write_text("gnupg\t2.4.7-20\tamd64\tinstalled\n")
            simulation = fixture.root / "gnupg-purge-simulation.txt"
            simulation.write_text("Remv gnupg [2.4.7-21]\n")
            fixture.write()
            with self.assertRaisesRegex(ValueError, "does not match installed package"):
                MODULE.validate_proposal(fixture.root)

    def test_simulation_must_match_exactly_and_cannot_remove_protected_packages(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            (fixture.root / "dpkg-before.tsv").write_text(
                "gnupg\t2.4.7-21\tamd64\tinstalled\n"
                "zlib1g\t1.3.dfsg-3\tamd64\tinstalled\n"
            )
            (fixture.root / "gnupg-purge-simulation.txt").write_text(
                "Remv gnupg [2.4.7-21]\nRemv zlib1g [1.3.dfsg-3]\n"
            )
            fixture.write()
            with self.assertRaisesRegex(ValueError, "exactly match installed inventory"):
                MODULE.validate_proposal(fixture.root)

        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            (fixture.root / "dpkg-before.tsv").write_text(
                "gnupg\t2.4.7-21\tamd64\tinstalled\n"
                "libapt-pkg7.0\t2.7.8\tamd64\tinstalled\n"
            )
            (fixture.root / "gnupg-purge-simulation.txt").write_text(
                "Remv gnupg [2.4.7-21]\nRemv libapt-pkg7.0 [2.7.8]\n"
            )
            fixture.write()
            with self.assertRaisesRegex(ValueError, "protected package"):
                MODULE.validate_proposal(fixture.root)

    def test_signed_variant_must_match_release_hash_and_size(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            fixture.proposal["packageIndexTargetBindings"][0]["signedVariants"][0]["size"] += 1
            fixture.write()
            with self.assertRaisesRegex(ValueError, "signed Release metadata"):
                MODULE.validate_proposal(fixture.root)

    def test_proposal_cannot_claim_clearance_or_change_schema(self):
        for key, value in (("runtimeClearance", "PASSED"), ("schemaVersion", 2)):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as temp:
                fixture = self.fixture(temp)
                fixture.proposal[key] = value
                fixture.write()
                with self.assertRaises(ValueError):
                    MODULE.validate_proposal(fixture.root)



if __name__ == "__main__":
    unittest.main()
