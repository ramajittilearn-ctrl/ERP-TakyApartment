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
            "Types: deb\nURIs: https://deb.debian.org/debian\nSuites: trixie trixie-updates\n"
            "Components: main\n" + f"Signed-By: {debian_key}\n\n"
            "Types: deb\nURIs: https://deb.debian.org/debian-security\nSuites: trixie-security\n"
            "Components: main\n" + f"Signed-By: {debian_key}\n"
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
            "isolatedReleaseAcquisitions": [],
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
        expected_run_sources = {
            "trixie": "sources.list.d/debian.sources",
            "trixie-updates": "sources.list.d/debian.sources",
            "trixie-security": "sources.list.d/debian.sources",
            "trixie-pgdg": "sources.list.d/pgdg.list",
        }
        for release_index, (codename, (suite, host, origin_path)) in enumerate(MODULE.EXPECTED_ORIGINS.items()):
            origin = f"https://{host}{origin_path}"
            combined_name = f"unrelated-name-{release_index}-InRelease"
            isolated_name = f"isolated-releases/{codename}/InRelease"
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
            self.files[f"apt-lists/{combined_name}"] = release_bytes
            self.files[isolated_name] = release_bytes
            self.files[f"apt-lists/{local_name}"] = local_bytes
            source_relative = expected_run_sources[codename]
            source_uri = f"http://{host}{origin_path}" if codename == "trixie-pgdg" else f"https://{host}{origin_path}"
            source_key = pgdg_key if codename == "trixie-pgdg" else debian_key
            source_digest = pgdg_digest if codename == "trixie-pgdg" else debian_digest
            suffix = ".list" if codename == "trixie-pgdg" else ".sources"
            isolated_source = f"isolated-releases/{codename}/source{suffix}"
            if suffix == ".list":
                source_text = f"deb [signed-by={source_key}] {source_uri} {codename} main\n"
            else:
                source_text = f"Types: deb\nURIs: {source_uri}\nSuites: {codename}\nComponents: main\nSigned-By: {source_key}\n"
            self.files[isolated_source] = source_text.encode()
            base_uri = f"{source_uri}/dists/{codename}/"
            uri = f"{base_uri}{signed_path}"
            meta_key = "main/binary-amd64/Packages"
            filename = f"/var/lib/apt/lists/{local_name}"
            target_row = "|".join(("Packages", codename, suite, "amd64", filename, uri, base_uri, meta_key, "main"))
            target_rows.append(target_row)
            isolated_target = f"isolated-releases/{codename}/apt-index-targets.tsv"
            self.files[isolated_target] = (target_row + "\n").encode()
            lists_root = f"/var/lib/apt/phase4-isolated/{codename}/lists"
            exact_release = f"{lists_root}/repo_dists_{codename}_InRelease"
            self.files[f"isolated-releases/{codename}/exact-inrelease-path.txt"] = (exact_release + "\n").encode()
            self.files[f"isolated-releases/{codename}/lists-path.txt"] = (lists_root + "\n").encode()
            self.files[f"isolated-releases/{codename}/exact-inrelease-digest.tsv"] = (
                f"{digest(release_bytes)}\t{len(release_bytes)}\n"
            ).encode()
            self.files[f"isolated-releases/{codename}/original-source-relative.txt"] = (source_relative + "\n").encode()
            self.files[f"isolated-releases/{codename}/configured-dist.txt"] = (codename + "\n").encode()
            self.files[f"isolated-releases/{codename}/source-path.txt"] = (f"/tmp/source-{codename}{suffix}\n").encode()
            self.files[f"isolated-releases/{codename}/apt-update.log"] = b"Hit: signed source\n"
            combined_file = f"apt-lists/{combined_name}"
            isolated_file_hash = digest(release_bytes)
            combined_hash = digest(release_bytes)
            local_hash = digest(local_bytes)
            self.proposal["authenticatedInReleaseFiles"].extend([
                {"file": combined_file, "sha256": combined_hash, "sizeBytes": len(release_bytes)},
                {"file": isolated_name, "sha256": isolated_file_hash, "sizeBytes": len(release_bytes)},
            ])
            source_key_records = [{"path": source_key, "sha256": source_digest, "capturedFile": f"apt-keyrings/{source_digest}"}]
            self.proposal["isolatedReleaseAcquisitions"].append({
                "codename": codename, "configuredDist": codename, "suite": suite,
                "signedCodename": codename, "signedSuite": suite, "sourceUri": source_uri,
                "baseUri": base_uri, "aptVersion": "apt 3.0.3 (amd64)",
                "runId": self.run["runId"], "runAttempt": self.run["runAttempt"],
                "revision": self.run["revision"], "tree": self.run["tree"], "image": self.run["image"],
                "imageId": self.run["imageId"], "platform": self.run["platform"],
                "sourceConfigFile": f"apt-sources/{source_relative}",
                "sourceConfigSha256": digest(self.files[f"apt-sources/{source_relative}"]),
                "isolatedSourceFile": isolated_source, "isolatedSourceSha256": digest(source_text.encode()),
                "aptTargetEvidenceFile": isolated_target, "aptTargetEvidenceSha256": digest((target_row + "\n").encode()),
                "sourceKeyrings": source_key_records, "exactInReleasePath": exact_release,
                "inReleaseFile": isolated_name, "inReleaseSha256": isolated_file_hash,
                "inReleaseSizeBytes": len(release_bytes), "combinedInReleaseFile": combined_file,
                "combinedInReleaseSha256": combined_hash, "combinedInReleaseSizeBytes": len(release_bytes),
            })
            self.proposal["signedReleaseIndexHashes"].append({
                "releaseFile": isolated_name, "releaseSha256": isolated_file_hash, "codename": codename,
                "suite": suite, "path": signed_path, "sha256": signed_hash, "size": signed_size,
            })
            self.proposal["localAptIndexFiles"].append({
                "file": f"apt-lists/{local_name}", "sha256": local_hash, "sizeBytes": len(local_bytes),
            })
            self.proposal["packageIndexTargetBindings"].append({
                "identifier": "Packages", "codename": codename, "suite": suite, "component": "main",
                "architecture": "amd64", "filename": filename, "uri": uri, "baseUri": base_uri,
                "metaKey": meta_key, "releaseFile": isolated_name, "releaseSha256": isolated_file_hash,
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
        self.verify_signature_mock = self.signature_verifier.start()
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

    def test_diagnostics_directory_rejects_symlink_overlap_and_stale_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            evidence = root / "evidence"
            evidence.mkdir()
            stale = root / "stale"
            stale.mkdir()
            with self.assertRaisesRegex(ValueError, "fresh"):
                MODULE.ValidationDiagnostics(stale, evidence)
            with self.assertRaisesRegex(ValueError, "outside"):
                MODULE.ValidationDiagnostics(evidence / "diagnostics", evidence)
            link = root / "link"
            link.symlink_to(root / "missing", target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlink"):
                MODULE.ValidationDiagnostics(link, evidence)

    def test_workflow_uploads_signature_diagnostics_separately(self):
        workflow = (SCRIPT.parents[2] / ".github/workflows/phase4-ci.yml").read_text()
        self.assertIn("--diagnostics-dir \"$RUNNER_TEMP/trixie-gnupg-signature-diagnostics\"", workflow)
        self.assertIn("${{ runner.temp }}/trixie-gnupg-signature-diagnostics/", workflow)

    def test_valid_proposal_is_read_only_and_cli_emits_no_package_tuples(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            before = sorted(path.relative_to(fixture.root).as_posix() for path in fixture.root.rglob("*") if path.is_file())
            validated = MODULE.validate_proposal(fixture.root)
            self.assertEqual(validated.proposal_sha256, digest((fixture.root / "gnupg-removal-lock-proposal.json").read_bytes()))
            self.assertEqual(self.verify_signature_mock.call_count, 4)
            fake_bin = Path(temp) / "fake-bin"
            fake_bin.mkdir()
            fake_gpgv = fake_bin / "gpgv"
            fake_gpgv.write_text("#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'gpgv (GnuPG) fixture'; exit 0; fi\nprintf '[GNUPG:] VALIDSIG test-fixture\\n'\n")
            fake_gpgv.chmod(0o755)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "validate-proposal", "--evidence-dir", str(fixture.root),
                 "--diagnostics-dir", str(Path(temp) / "diagnostics")],
                text=True, capture_output=True,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PATH": f"{fake_bin}:{os.environ.get('PATH', '')}"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("gnupg", result.stdout)
            report = json.loads((Path(temp) / "diagnostics" / "validation.json").read_text())
            self.assertEqual(report["state"], "VALIDATED")
            self.assertEqual(len(report["attempts"]), 4)
            after = sorted(path.relative_to(fixture.root).as_posix() for path in fixture.root.rglob("*") if path.is_file())
            self.assertEqual(before, after)

    def test_wrong_suite_scoped_base_origin_or_suite_is_rejected_before_signature_check(self):
        replacements = (
            ("base", "https://mirror.example/debian/dists/trixie/", "suite-scoped base URI"),
            ("base", "https://deb.debian.org/debian-security/dists/trixie/", "suite-scoped base URI"),
            ("suite", "stable-updates", "unapproved Release identity"),
        )
        for kind, new_value, message in replacements:
            with self.subTest(replacement=new_value), tempfile.TemporaryDirectory() as temp:
                fixture = self.fixture(temp)
                target_file = fixture.root / "apt-index-targets.tsv"
                self.verify_signature_mock.reset_mock()
                fields = target_file.read_text().splitlines()[0].split("|")
                fields[6 if kind == "base" else 2] = new_value
                target_file.write_text("|".join(fields) + "\n" + "\n".join(target_file.read_text().splitlines()[1:]) + "\n")
                fixture.write()
                with self.assertRaisesRegex(ValueError, message):
                    MODULE.validate_proposal(fixture.root)

    def test_isolated_release_must_match_exact_configured_source_root(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            acquisition = fixture.proposal["isolatedReleaseAcquisitions"][0]
            acquisition["sourceUri"] = "https://mirror.example/debian"
            fixture.write()
            with self.assertRaisesRegex(ValueError, "isolated source URI differs from proposal acquisition"):
                MODULE.validate_proposal(fixture.root)

    def test_exact_inrelease_path_must_be_inside_its_disposable_lists_directory(self):
        invalid_paths = (
            "/var/lib/apt/phase4-isolated/trixie-updates/lists/repo_dists_trixie_InRelease",
            "/var/lib/apt/phase4-isolated/trixie/lists/../tmp/InRelease",
        )
        for invalid_path in invalid_paths:
            with self.subTest(path=invalid_path), tempfile.TemporaryDirectory() as temp:
                fixture = self.fixture(temp)
                fixture.proposal["isolatedReleaseAcquisitions"][0]["exactInReleasePath"] = invalid_path
                fixture.write()
                with self.assertRaisesRegex(ValueError, "outside the disposable image's dedicated APT lists directory"):
                    MODULE.validate_proposal(fixture.root)

    def test_exact_inrelease_digest_sidecar_must_match_captured_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            (fixture.root / "isolated-releases/trixie/exact-inrelease-digest.tsv").write_text(
                f"{'0' * 64}\t1\n"
            )
            fixture.write()
            with self.assertRaisesRegex(ValueError, "differs from the digest captured at its exact APT path"):
                MODULE.validate_proposal(fixture.root)

    def test_combined_and_isolated_release_snapshots_must_be_byte_identical(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            acquisition = fixture.proposal["isolatedReleaseAcquisitions"][0]
            combined_path = fixture.root / acquisition["combinedInReleaseFile"]
            combined_path.write_bytes(combined_path.read_bytes() + b"\n")
            combined = next(item for item in fixture.proposal["authenticatedInReleaseFiles"] if item["file"] == acquisition["combinedInReleaseFile"])
            combined["sha256"] = digest(combined_path.read_bytes())
            combined["sizeBytes"] = combined_path.stat().st_size
            acquisition["combinedInReleaseSha256"] = combined["sha256"]
            acquisition["combinedInReleaseSizeBytes"] = combined["sizeBytes"]
            fixture.write()
            with self.assertRaisesRegex(ValueError, "snapshots differ"):
                MODULE.validate_proposal(fixture.root)

    def test_acquisition_hash_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            fixture.proposal["isolatedReleaseAcquisitions"][0]["inReleaseSha256"] = "0" * 64
            fixture.write()
            with self.assertRaisesRegex(ValueError, "hash/size differs from authenticated evidence"):
                MODULE.validate_proposal(fixture.root)

    def test_package_binding_cannot_reassign_derived_inrelease_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            binding = fixture.proposal["packageIndexTargetBindings"][0]
            other_release = fixture.proposal["authenticatedInReleaseFiles"][2]
            binding["releaseFile"] = other_release["file"]
            binding["releaseSha256"] = other_release["sha256"]
            fixture.write()
            with self.assertRaisesRegex(ValueError, "authenticated InRelease evidence|independently derived target association"):
                MODULE.validate_proposal(fixture.root)

    def test_run_identity_must_match_hosted_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            with patch.dict(os.environ, {"GITHUB_RUN_ATTEMPT": "3"}):
                with self.assertRaisesRegex(ValueError, "do not match this hosted GitHub run"):
                    MODULE.validate_proposal(fixture.root)

    def test_gpgv_status_policy_and_diagnostic_redaction(self):
        cases = (
            ("[GNUPG:] VALIDSIG fingerprint\n", 1, False),
            ("[GNUPG:] VALIDSIG fingerprint\n[GNUPG:] BADSIG 1234 Alice Example\n", 0, False),
            ("[GNUPG:] FUTURE_STATUS detail\n[GNUPG:] VALIDSIG fingerprint\n", 0, True),
        )
        for stdout, returncode, expected_accept in cases:
            with self.subTest(stdout=stdout), tempfile.TemporaryDirectory() as temp:
                base = Path(temp)
                release, keyring = base / "InRelease", base / "keyring.gpg"
                release.write_bytes(b"signed metadata")
                keyring.write_bytes(b"source key")
                evidence = base / "evidence"
                evidence.mkdir()
                diagnostics = MODULE.ValidationDiagnostics(base / "diagnostics", evidence)
                fake_gpgv = base / "gpgv"
                fake_gpgv.write_text("fixture verifier\n")
                request = MODULE.SignatureRequest(
                    "trixie", "sources.list", "a" * 64, "isolated-releases/trixie/InRelease",
                    digest(b"signed metadata"), len(b"signed metadata"),
                    ({"path": "/keyring.gpg", "sha256": digest(b"source key"), "capturedFile": "apt-keyrings/key"},),
                )
                raw_stdout = stdout.encode() + (b"\xff" if expected_accept else b"")
                raw_stderr = b"<Alice Example> at /private/path\x01 https://user@example.test https://user:secret@example.test\n"
                outputs = [(0, b"gpgv (GnuPG) fixture\n", b""), (returncode, raw_stdout, raw_stderr)]
                def fake_run(_command, **kwargs):
                    code, out, err = outputs.pop(0)
                    kwargs["stdout"].write(out)
                    kwargs["stderr"].write(err)
                    return subprocess.CompletedProcess([], code)
                with patch.object(MODULE.shutil, "which", return_value=str(fake_gpgv)), patch.object(
                    MODULE.subprocess, "run", side_effect=fake_run,
                ):
                    if expected_accept:
                        REAL_VERIFY_SIGNATURE(release, [keyring], request=request, evidence_dir=evidence, diagnostics=diagnostics)
                    else:
                        with self.assertRaisesRegex(ValueError, "gpgv rejected"):
                            REAL_VERIFY_SIGNATURE(release, [keyring], request=request, evidence_dir=evidence, diagnostics=diagnostics)
                record = json.loads((base / "diagnostics" / "trixie.json").read_text())
                self.assertEqual(record["accepted"], expected_accept)
                self.assertEqual([status["token"] for status in record["statuses"]], [line.split()[1] for line in stdout.splitlines()])
                self.assertEqual(record["stdoutSha256"], digest(raw_stdout))
                self.assertIn("$PRIVATE_HOMEDIR", record["argv"])
                stderr = (base / "diagnostics" / "trixie.stderr.txt").read_text()
                self.assertNotIn("Alice Example", stderr)
                self.assertNotIn("/private/path", stderr)
                self.assertNotIn("user@", stderr)
                self.assertNotIn("secret@", stderr)

    def test_status_arguments_and_uri_userinfo_are_sanitized(self):
        raw = b"[GNUPG:] NEWSIG owner@example.test\n[GNUPG:] EXPSIG 1234 owner@example.test\n[GNUPG:] FUTURE_SECRET private-user@example.test\n"
        parsed, tokens = MODULE.structured_gpg_statuses(raw)
        self.assertEqual(tokens, ["NEWSIG", "EXPSIG", "FUTURE_SECRET"])
        self.assertEqual(parsed, [
            {"token": "NEWSIG", "fields": []},
            {"token": "EXPSIG", "fields": ["1234", "[REDACTED-UID]"]},
            {"token": "FUTURE_SECRET", "fields": []},
        ])
        for uri in ("https://user@example.test/path", "https://user:secret@example.test/path"):
            sanitized = MODULE.redact_diagnostic_text(uri, Path("/evidence"), Path("/tmp/private"))
            self.assertEqual(sanitized, "https://[REDACTED]@example.test$PATH")

    def test_bounded_capture_handles_invalid_utf8_and_rejects_output_overflow(self):
        invalid = subprocess.run(
            [sys.executable, "-c", "import os; os.write(1, b'\\xff')"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        )
        self.assertEqual(invalid.stdout, b"\xff")
        overflow_code, overflow_out, _overflow_err, overflow = MODULE.run_bounded(
            [sys.executable, "-c", "import os; os.write(1, b'x' * 1000000)"], env=os.environ.copy(), timeout=5,
        )
        self.assertTrue(overflow)
        self.assertGreaterEqual(len(overflow_out), MODULE.GPGV_OUTPUT_LIMIT)
        self.assertIsInstance(overflow_code, int)

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

    def test_isolated_acquisition_keyring_must_match_its_captured_source(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            fixture.proposal["isolatedReleaseAcquisitions"][0]["sourceKeyrings"][0]["path"] = "/tmp/unbound.gpg"
            fixture.write()
            with self.assertRaisesRegex(ValueError, "keyrings differ from its source stanza"):
                MODULE.validate_proposal(fixture.root)

    def test_isolated_package_target_uri_is_bound_to_source_root(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            acquisition = fixture.proposal["isolatedReleaseAcquisitions"][0]
            target_file = fixture.root / acquisition["aptTargetEvidenceFile"]
            fields = target_file.read_text().strip().split("|")
            fields[5] = fields[5].replace("deb.debian.org", "mirror.example.test")
            target_file.write_text("|".join(fields) + "\n")
            acquisition["aptTargetEvidenceSha256"] = digest(target_file.read_bytes())
            fixture.write()
            with self.assertRaisesRegex(ValueError, "target URI does not match"):
                MODULE.validate_proposal(fixture.root)

    def test_non_packages_target_uri_is_also_bound_to_source_root(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            acquisition = fixture.proposal["isolatedReleaseAcquisitions"][0]
            target_file = fixture.root / acquisition["aptTargetEvidenceFile"]
            fields = target_file.read_text().strip().split("|")
            fields[0] = "Translations"
            fields[5] = fields[5].replace("deb.debian.org", "mirror.example.test")
            target_file.write_text("|".join(fields) + "\n")
            acquisition["aptTargetEvidenceSha256"] = digest(target_file.read_bytes())
            fixture.write()
            with self.assertRaisesRegex(ValueError, "APT target URI does not match"):
                MODULE.validate_proposal(fixture.root)

    def test_isolated_acquisition_requires_packages_target(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            acquisition = fixture.proposal["isolatedReleaseAcquisitions"][0]
            target_file = fixture.root / acquisition["aptTargetEvidenceFile"]
            fields = target_file.read_text().strip().split("|")
            fields[0] = "Translations"
            target_file.write_text("|".join(fields) + "\n")
            acquisition["aptTargetEvidenceSha256"] = digest(target_file.read_bytes())
            fixture.write()
            with self.assertRaisesRegex(ValueError, "contains no Packages target"):
                MODULE.validate_proposal(fixture.root)

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
            release_record = next(item for item in fixture.proposal["authenticatedInReleaseFiles"] if item["file"].startswith("isolated-releases/trixie/"))
            release_path = fixture.root / release_record["file"]
            original_row = fixture.proposal["signedReleaseIndexHashes"][0]
            changed = release_path.read_bytes().replace(original_row["sha256"].encode(), b"0" * 64)
            release_path.write_bytes(changed)
            acquisition = fixture.proposal["isolatedReleaseAcquisitions"][0]
            combined = next(item for item in fixture.proposal["authenticatedInReleaseFiles"] if item["file"] == acquisition["combinedInReleaseFile"])
            (fixture.root / combined["file"]).write_bytes(changed)
            release_record["sha256"] = digest(changed)
            release_record["sizeBytes"] = len(changed)
            combined["sha256"] = digest(changed)
            combined["sizeBytes"] = len(changed)
            acquisition["inReleaseSha256"] = digest(changed)
            acquisition["combinedInReleaseSha256"] = digest(changed)
            (fixture.root / "isolated-releases/trixie/exact-inrelease-digest.tsv").write_text(
                f"{digest(changed)}\t{len(changed)}\n"
            )
            fixture.proposal["packageIndexTargetBindings"][0]["releaseSha256"] = digest(changed)
            fixture.proposal["signedReleaseIndexHashes"][0]["releaseSha256"] = digest(changed)
            fixture.write()
            with self.assertRaisesRegex(ValueError, "signed index rows differ from isolated InRelease SHA256 section"):
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
