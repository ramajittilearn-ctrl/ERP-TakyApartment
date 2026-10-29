import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
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
            signed_rows = [(signed_path, signed_hash, signed_size)]
            if codename == "trixie-pgdg":
                signed_rows.append(("14/source/Sources", hashlib.sha256(b"").hexdigest(), 0))
            signed_sha256_lines = "".join(f" {row_hash} {row_size} {row_path}\n" for row_path, row_hash, row_size in signed_rows)
            release_bytes = (
                "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n"
                f"Codename: {codename}\nSuite: {suite}\nSHA256:\n{signed_sha256_lines}"
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
            for row_path, row_hash, row_size in signed_rows:
                self.proposal["signedReleaseIndexHashes"].append({
                    "releaseFile": isolated_name, "releaseSha256": isolated_file_hash, "codename": codename,
                    "suite": suite, "path": row_path, "sha256": row_hash, "size": row_size,
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

    def candidate_lock(self, lock_root: Path) -> Path:
        release_dir = lock_root / "release-evidence"
        release_dir.mkdir(parents=True, exist_ok=True)
        package_path = release_dir / "trixie-gnupg-purge-lock.tsv"
        package_path.write_text("".join(
            f"{item['name']}\t{item['version']}\t{item['architecture']}\n"
            for item in self.proposal["removals"]
        ))
        release_path = release_dir / "trixie-gnupg-release-lock.tsv"
        releases = []
        for acquisition in self.proposal["isolatedReleaseAcquisitions"]:
            release = {
                "codename": acquisition["codename"], "suite": acquisition["signedSuite"],
                "baseUri": acquisition["baseUri"], "inReleaseFile": acquisition["inReleaseFile"],
                "sha256": acquisition["inReleaseSha256"],
            }
            releases.append(release)
        release_path.write_text("".join(
            f"{item['codename']}\t{item['suite']}\t{item['sha256']}\n" for item in releases
        ))
        source_configs = {}
        for acquisition in self.proposal["isolatedReleaseAcquisitions"]:
            source_configs[acquisition["sourceConfigFile"]] = acquisition["sourceConfigSha256"]
        keyrings = {}
        for line in (self.root / "source-trust.tsv").read_text().splitlines():
            if line == "APT source trust policy: PASS":
                continue
            path, sha256, size, _source, _captured = line.split("\t")
            keyrings[path] = {"path": path, "sha256": sha256, "sizeBytes": int(size)}
        trust_path = release_dir / "trixie-gnupg-trust-lock.tsv"
        trust_rows = [
            ["source", path.removeprefix("apt-sources/"), sha256]
            for path, sha256 in source_configs.items()
        ] + [["keyring", item["path"], item["sha256"]] for item in keyrings.values()] + [
            ["apt-signature-config", "apt-signature-config.txt", self.proposal["aptSignatureConfigSha256"]],
            ["apt-trusted-paths", "apt-trusted-paths.tsv", self.proposal["aptTrustedPathsSha256"]],
        ]
        trust_path.write_text("".join("\t".join(row) + "\n" for row in trust_rows))
        verifier_row = (self.root / "apt-verifiers.tsv").read_text().strip().split("\t")
        lock = {
            "schemaVersion": 1,
            "kind": "reviewed-trixie-gnupg-candidate-lock",
            "approval": {
                "state": "APPROVED_FOR_ISOLATED_CANDIDATE_BUILD_ONLY",
                "reviewer": "apt_purge_lock_review", "reviewDate": "2026-10-29",
                "runtimeClearance": "NOT_EVALUATED", "cveClearance": "NOT_EVALUATED",
                "productionUse": "NOT_AUTHORIZED",
            },
            "discovery": {
                "runId": self.run["runId"], "runAttempt": self.run["runAttempt"],
                "revision": self.run["revision"], "tree": self.run["tree"],
                "proposalSha256": digest((self.root / "gnupg-removal-lock-proposal.json").read_bytes()),
                "evidenceArtifactId": 123, "evidenceArtifactSha256": "a" * 64,
                "proposalPath": "trixie-gnupg-discovery/gnupg-removal-lock-proposal.json",
                "baseImage": self.run["image"], "baseImageId": self.run["imageId"],
                "platform": self.run["platform"], "reviewedEvidenceFileCount": 84,
            },
            "apt": {
                "verifier": {"path": verifier_row[1], "version": verifier_row[2]},
                "signatureConfigSha256": self.proposal["aptSignatureConfigSha256"],
                "trustedPathsSha256": self.proposal["aptTrustedPathsSha256"],
                "sourceTrustEvidenceSha256": self.proposal["sourceTrustEvidenceSha256"],
                "sourceConfigs": [
                    {"path": path, "sha256": sha256} for path, sha256 in source_configs.items()
                ],
                "keyrings": list(keyrings.values()),
            },
            "releases": releases,
            "packageLockPath": "release-evidence/trixie-gnupg-purge-lock.tsv",
            "releaseLockPath": "release-evidence/trixie-gnupg-release-lock.tsv",
            "trustLockPath": "release-evidence/trixie-gnupg-trust-lock.tsv",
            "lockFileSha256": {
                "package": digest(package_path.read_bytes()), "release": digest(release_path.read_bytes()),
                "trust": digest(trust_path.read_bytes()),
            },
        }
        lock_path = release_dir / "trixie-gnupg-candidate-lock.json"
        lock_path.write_bytes(json_bytes(lock))
        return lock_path


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

    def test_reviewed_candidate_lock_accepts_matching_semantic_discovery(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            lock_path = fixture.candidate_lock(Path(temp) / "repo")
            result = MODULE.validate_candidate_lock(fixture.root, lock_path)
            self.assertEqual(result["status"], "VALIDATED_REVIEWED_CANDIDATE_LOCK")
            self.assertEqual(result["packageCount"], 1)
            self.assertEqual(result["releaseCount"], 4)
            self.assertTrue(result["candidateOnly"])
            self.assertEqual(result["runtimeClearance"], "NOT_EVALUATED")
            self.assertEqual(result["cveClearance"], "NOT_EVALUATED")

    def test_reviewed_candidate_lock_rejects_tuple_release_source_keyring_sqv_and_tsv_drift(self):
        mutations = (
            "package", "release", "source", "keyring", "sqv", "tsv-hash", "tsv-symlink",
            "signature-config-row", "missing-trusted-paths-row", "artifact-hash",
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                fixture = self.fixture(temp)
                lock_path = fixture.candidate_lock(Path(temp) / "repo")
                lock = json.loads(lock_path.read_text())
                package_path = lock_path.parent / "trixie-gnupg-purge-lock.tsv"
                release_path = lock_path.parent / "trixie-gnupg-release-lock.tsv"
                trust_path = lock_path.parent / "trixie-gnupg-trust-lock.tsv"
                if mutation == "package":
                    package_path.write_text("gnupg\t2.4.7-22\tamd64\n")
                    lock["lockFileSha256"]["package"] = digest(package_path.read_bytes())
                elif mutation == "release":
                    lock["releases"][0]["sha256"] = "0" * 64
                    rows = release_path.read_text().splitlines()
                    fields = rows[0].split("\t")
                    fields[2] = "0" * 64
                    rows[0] = "\t".join(fields)
                    release_path.write_text("\n".join(rows) + "\n")
                    lock["lockFileSha256"]["release"] = digest(release_path.read_bytes())
                elif mutation == "source":
                    lock["apt"]["sourceConfigs"][0]["sha256"] = "0" * 64
                    rows = trust_path.read_text().splitlines()
                    fields = rows[0].split("\t")
                    fields[2] = "0" * 64
                    rows[0] = "\t".join(fields)
                    trust_path.write_text("\n".join(rows) + "\n")
                    lock["lockFileSha256"]["trust"] = digest(trust_path.read_bytes())
                elif mutation == "keyring":
                    lock["apt"]["keyrings"][0]["sha256"] = "0" * 64
                    rows = trust_path.read_text().splitlines()
                    fields = rows[-2].split("\t")
                    fields[2] = "0" * 64
                    rows[-2] = "\t".join(fields)
                    trust_path.write_text("\n".join(rows) + "\n")
                    lock["lockFileSha256"]["trust"] = digest(trust_path.read_bytes())
                elif mutation == "signature-config-row":
                    rows = trust_path.read_text().splitlines()
                    fields = rows[-2].split("\t")
                    fields[2] = "0" * 64
                    rows[-2] = "\t".join(fields)
                    trust_path.write_text("\n".join(rows) + "\n")
                    lock["lockFileSha256"]["trust"] = digest(trust_path.read_bytes())
                elif mutation == "missing-trusted-paths-row":
                    rows = trust_path.read_text().splitlines()
                    trust_path.write_text("\n".join(rows[:-1]) + "\n")
                    lock["lockFileSha256"]["trust"] = digest(trust_path.read_bytes())
                elif mutation == "sqv":
                    (fixture.root / "apt-verifiers.tsv").write_text("sqv\t/usr/sbin/sqv\tsqv 1.3.0\n")
                    fixture.write()
                elif mutation == "artifact-hash":
                    lock["discovery"]["evidenceArtifactSha256"] = "bad-hash"
                elif mutation == "tsv-hash":
                    package_path.write_text(package_path.read_text() + "\n")
                elif mutation == "tsv-symlink":
                    original = package_path.read_bytes()
                    outside = Path(temp) / "outside.tsv"
                    outside.write_bytes(original)
                    package_path.unlink()
                    package_path.symlink_to(outside)
                lock_path.write_bytes(json_bytes(lock))
                with self.assertRaises(ValueError):
                    MODULE.validate_candidate_lock(fixture.root, lock_path)

    def test_reviewed_candidate_lock_rejects_symlinked_lock_file(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            lock_path = fixture.candidate_lock(Path(temp) / "repo")
            copy = Path(temp) / "candidate-lock.json"
            copy.write_bytes(lock_path.read_bytes())
            lock_path.unlink()
            lock_path.symlink_to(copy)
            with self.assertRaisesRegex(ValueError, "symlink"):
                MODULE.validate_candidate_lock(fixture.root, lock_path)

    def test_candidate_lock_does_not_pin_dynamic_run_or_proposal_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            lock_path = fixture.candidate_lock(Path(temp) / "repo")
            fixture.run["runId"] += 1
            fixture.run["runAttempt"] += 1
            fixture.run["revision"] = "d" * 40
            fixture.run["tree"] = "e" * 40
            for acquisition in fixture.proposal["isolatedReleaseAcquisitions"]:
                acquisition["runId"] = fixture.run["runId"]
                acquisition["runAttempt"] = fixture.run["runAttempt"]
                acquisition["revision"] = fixture.run["revision"]
                acquisition["tree"] = fixture.run["tree"]
            fixture.proposal.update({
                "runId": fixture.run["runId"], "runAttempt": fixture.run["runAttempt"],
                "revision": fixture.run["revision"], "tree": fixture.run["tree"],
            })
            fixture.write()
            with patch.dict(os.environ, {
                "GITHUB_RUN_ID": str(fixture.run["runId"]),
                "GITHUB_RUN_ATTEMPT": str(fixture.run["runAttempt"]),
            }):
                result = MODULE.validate_candidate_lock(fixture.root, lock_path)
            self.assertEqual(result["status"], "VALIDATED_REVIEWED_CANDIDATE_LOCK")

    def test_empty_signed_release_index_is_accepted_but_negative_size_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = self.fixture(temp)
            empty_row = next(row for row in fixture.proposal["signedReleaseIndexHashes"] if row["path"] == "14/source/Sources")
            self.assertEqual(empty_row["sha256"], hashlib.sha256(b"").hexdigest())
            self.assertEqual(empty_row["size"], 0)
            MODULE.validate_proposal(fixture.root)

            empty_row["size"] = True
            fixture.write()
            with self.assertRaisesRegex(ValueError, "signed Release index row has malformed hash or size"):
                MODULE.validate_proposal(fixture.root)

            empty_row["size"] = -1
            fixture.write()
            with self.assertRaisesRegex(ValueError, "signed Release index row has malformed hash or size"):
                MODULE.validate_proposal(fixture.root)

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
                keyring_record = record["keyrings"][0]
                self.assertEqual(keyring_record["sourceFormat"], "BINARY")
                self.assertEqual(keyring_record["transformation"], "BYTE_FOR_BYTE_PASSTHROUGH")
                self.assertEqual(keyring_record["sourceSha256"], keyring_record["verificationSha256"])
                stderr = (base / "diagnostics" / "trixie.stderr.txt").read_text()
                self.assertNotIn("Alice Example", stderr)
                self.assertNotIn("/private/path", stderr)
                self.assertNotIn("user@", stderr)
                self.assertNotIn("secret@", stderr)

    def test_armored_source_key_is_dearmored_privately_and_bound_in_report(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            armored = b"-----BEGIN PGP PUBLIC KEY BLOCK-----\nYWJj\n-----END PGP PUBLIC KEY BLOCK-----\n"
            release, keyring = base / "InRelease", base / "postgres.gpg.asc"
            release.write_bytes(b"signed metadata")
            keyring.write_bytes(armored)
            evidence = base / "evidence"; evidence.mkdir()
            diagnostics = MODULE.ValidationDiagnostics(base / "diagnostics", evidence)
            fake_gpgv, fake_gpg = base / "gpgv", base / "gpg"
            fake_gpgv.write_bytes(b"gpgv fake executable")
            fake_gpg.write_bytes(b"gpg fake executable")
            request = MODULE.SignatureRequest(
                "trixie-pgdg", "sources.list", "a" * 64, "isolated-releases/trixie-pgdg/InRelease",
                digest(b"signed metadata"), len(b"signed metadata"),
                ({"path": "/postgres.gpg.asc", "sha256": digest(armored), "capturedFile": "apt-keyrings/key"},),
            )
            derived = b"\x99binary-openpgp-public-key"
            calls = []
            def fake_bounded(command, *, env, timeout):
                calls.append(command)
                if command[-1] == "--version":
                    return 0, (b"gpg (GnuPG) fixture\n" if command[0] == str(fake_gpg) else b"gpgv fixture\n"), b"", False
                if "--dearmor" in command:
                    out_path = Path(command[command.index("--output") + 1])
                    out_path.write_bytes(derived)
                    return 0, b"", b"", False
                return 0, b"[GNUPG:] VALIDSIG fingerprint\n", b"", False
            with patch.object(MODULE.shutil, "which", side_effect=lambda name: str(fake_gpg if name == "gpg" else fake_gpgv)), patch.object(
                MODULE, "run_bounded", side_effect=fake_bounded,
            ):
                REAL_VERIFY_SIGNATURE(release, [keyring], request=request, evidence_dir=evidence, diagnostics=diagnostics)
            conversion = next(command for command in calls if "--dearmor" in command)
            self.assertIn("--homedir", conversion)
            self.assertTrue(Path(conversion[conversion.index("--homedir") + 1]).is_absolute())
            report = json.loads((base / "diagnostics" / "trixie-pgdg.json").read_text())
            key_record = report["keyrings"][0]
            self.assertEqual(key_record["sourceSha256"], digest(armored))
            self.assertEqual(key_record["sourceSizeBytes"], len(armored))
            self.assertEqual(key_record["verificationSha256"], digest(derived))
            self.assertEqual(key_record["verificationSizeBytes"], len(derived))
            self.assertEqual(key_record["transformation"], "gpg --dearmor")
            self.assertEqual(key_record["conversionTool"]["sha256"], digest(b"gpg fake executable"))
            self.assertIn("$PRIVATE_HOMEDIR", key_record["conversionTool"]["argv"])
            self.assertIn("$PRIVATE_KEYRING", report["argv"])

    def test_armored_conversion_failure_fails_closed_before_gpgv(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            armored = b"-----BEGIN PGP PUBLIC KEY BLOCK-----\nYWJj\n-----END PGP PUBLIC KEY BLOCK-----\n"
            release, keyring = base / "InRelease", base / "postgres.gpg.asc"
            release.write_bytes(b"signed metadata"); keyring.write_bytes(armored)
            evidence = base / "evidence"; evidence.mkdir()
            diagnostics = MODULE.ValidationDiagnostics(base / "diagnostics", evidence)
            fake_gpgv, fake_gpg = base / "gpgv", base / "gpg"
            fake_gpgv.write_bytes(b"gpgv"); fake_gpg.write_bytes(b"gpg")
            request = MODULE.SignatureRequest(
                "trixie-pgdg", "sources.list", "a" * 64, "isolated-releases/trixie-pgdg/InRelease",
                digest(b"signed metadata"), len(b"signed metadata"),
                ({"path": "/postgres.gpg.asc", "sha256": digest(armored), "capturedFile": "apt-keyrings/key"},),
            )
            calls = []
            def fail_conversion(command, *, env, timeout):
                calls.append(command)
                if command[-1] == "--version":
                    return 0, b"tool version\n", b"", False
                if "--dearmor" in command:
                    return 2, b"", b"bad armor from <Hidden Owner> https://user:secret@example.test", False
                return 0, b"[GNUPG:] VALIDSIG fingerprint\n", b"", False
            with patch.object(MODULE.shutil, "which", side_effect=lambda name: str(fake_gpg if name == "gpg" else fake_gpgv)), patch.object(
                MODULE, "run_bounded", side_effect=fail_conversion,
            ):
                with self.assertRaisesRegex(ValueError, "failed to dearmor"):
                    REAL_VERIFY_SIGNATURE(release, [keyring], request=request, evidence_dir=evidence, diagnostics=diagnostics)
            self.assertFalse(any("--status-fd" in command for command in calls))
            report = json.loads((base / "diagnostics" / "trixie-pgdg.json").read_text())
            self.assertEqual(report["returncode"], 2)
            self.assertEqual(report["termination"], "CONVERSION_ERROR")
            self.assertEqual(report["stderrSha256"], digest(b"bad armor from <Hidden Owner> https://user:secret@example.test"))
            redacted = (base / "diagnostics" / "trixie-pgdg.stderr.txt").read_text()
            self.assertNotIn("Hidden Owner", redacted)
            self.assertNotIn("secret", redacted)
            self.assertIn("$PRIVATE_HOMEDIR", report["conversionArgv"])
            self.assertIn("$PRIVATE_ARMORED_KEYRING", report["conversionArgv"])

    def test_missing_gpg_converter_records_suite_diagnostic_before_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            armored = b"-----BEGIN PGP PUBLIC KEY BLOCK-----\nYWJj\n-----END PGP PUBLIC KEY BLOCK-----\n"
            release, keyring = base / "InRelease", base / "postgres.gpg.asc"
            release.write_bytes(b"signed metadata"); keyring.write_bytes(armored)
            evidence = base / "evidence"; evidence.mkdir()
            diagnostics = MODULE.ValidationDiagnostics(base / "diagnostics", evidence)
            fake_gpgv = base / "gpgv"; fake_gpgv.write_bytes(b"gpgv")
            request = MODULE.SignatureRequest(
                "trixie-pgdg", "sources.list", "a" * 64, "isolated-releases/trixie-pgdg/InRelease",
                digest(b"signed metadata"), len(b"signed metadata"),
                ({"path": "/postgres.gpg.asc", "sha256": digest(armored), "capturedFile": "apt-keyrings/key"},),
            )
            with patch.object(MODULE.shutil, "which", side_effect=lambda name: str(fake_gpgv) if name == "gpgv" else None), patch.object(
                MODULE, "run_bounded", return_value=(0, b"gpgv version\n", b"", False),
            ):
                with self.assertRaisesRegex(ValueError, "gpg is unavailable"):
                    REAL_VERIFY_SIGNATURE(release, [keyring], request=request, evidence_dir=evidence, diagnostics=diagnostics)
            report = json.loads((base / "diagnostics" / "trixie-pgdg.json").read_text())
            self.assertEqual(report["termination"], "UNAVAILABLE")
            self.assertEqual(report["conversionTool"]["available"], False)
            self.assertEqual(report["stderrSha256"], digest(b""))

    def test_gpg_version_timeout_overflow_and_malformed_output_are_recorded(self):
        cases = (
            ("version_error", (1, b"", b"version failed", False), None),
            ("version_timeout", (-1, b"", b"version timed out", False), None),
            ("version_overflow", (0, b"", b"", True), None),
            ("conversion_timeout", (0, b"", b"", False), (-1, b"", b"dearmor timed out", False)),
            ("conversion_overflow", (0, b"", b"", False), (0, b"", b"", True)),
            ("empty_output", (0, b"", b"", False), (0, b"", b"", False, b"")),
            ("malformed_output", (0, b"", b"", False), (0, b"", b"", False, b"not an OpenPGP packet")),
        )
        for label, version_result, conversion_result in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temp:
                base = Path(temp)
                armored = b"-----BEGIN PGP PUBLIC KEY BLOCK-----\nYWJj\n-----END PGP PUBLIC KEY BLOCK-----\n"
                release, keyring = base / "InRelease", base / "postgres.gpg.asc"
                release.write_bytes(b"signed metadata"); keyring.write_bytes(armored)
                evidence = base / "evidence"; evidence.mkdir()
                diagnostics = MODULE.ValidationDiagnostics(base / "diagnostics", evidence)
                fake_gpgv, fake_gpg = base / "gpgv", base / "gpg"
                fake_gpgv.write_bytes(b"gpgv"); fake_gpg.write_bytes(b"gpg")
                request = MODULE.SignatureRequest(
                    f"trixie-pgdg-{label.replace('_', '-')}", "sources.list", "a" * 64, "isolated-releases/trixie-pgdg/InRelease",
                    digest(b"signed metadata"), len(b"signed metadata"),
                    ({"path": "/postgres.gpg.asc", "sha256": digest(armored), "capturedFile": "apt-keyrings/key"},),
                )
                def fake_bounded(command, *, env, timeout):
                    if command[0] == str(fake_gpgv):
                        return 0, b"gpgv version\n", b"", False
                    if command[-1] == "--version":
                        return version_result
                    if conversion_result is None:
                        raise AssertionError("conversion should not run after failed gpg version check")
                    result = conversion_result
                    if len(result) == 5:
                        output_key = Path(command[command.index("--output") + 1])
                        output_key.write_bytes(result[4])
                        return result[:4]
                    output_key = Path(command[command.index("--output") + 1])
                    output_key.write_bytes(b"\x99binary key")
                    return result
                with patch.object(MODULE.shutil, "which", side_effect=lambda name: str(fake_gpg if name == "gpg" else fake_gpgv)), patch.object(
                    MODULE, "run_bounded", side_effect=fake_bounded,
                ):
                    with self.assertRaises(ValueError):
                        REAL_VERIFY_SIGNATURE(release, [keyring], request=request, evidence_dir=evidence, diagnostics=diagnostics)
                report = json.loads((base / "diagnostics" / f"{request.suite}.json").read_text())
                self.assertFalse(report["accepted"])
                self.assertIn(report["termination"], {"OUTPUT_LIMIT", "TIMEOUT", "VERSION_ERROR", "MALFORMED_OUTPUT"})
                self.assertIn("stderrSha256", report)
                self.assertTrue((base / "diagnostics" / f"{request.suite}.stderr.txt").is_file())

    def test_private_snapshot_tampering_is_rejected_before_gpgv_launch(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            armored = b"-----BEGIN PGP PUBLIC KEY BLOCK-----\nYWJj\n-----END PGP PUBLIC KEY BLOCK-----\n"
            release, keyring = base / "InRelease", base / "postgres.gpg.asc"
            release.write_bytes(b"signed metadata"); keyring.write_bytes(armored)
            evidence = base / "evidence"; evidence.mkdir()
            diagnostics = MODULE.ValidationDiagnostics(base / "diagnostics", evidence)
            fake_gpgv, fake_gpg = base / "gpgv", base / "gpg"
            fake_gpgv.write_bytes(b"gpgv"); fake_gpg.write_bytes(b"gpg")
            request = MODULE.SignatureRequest(
                "trixie-pgdg", "sources.list", "a" * 64, "isolated-releases/trixie-pgdg/InRelease",
                digest(b"signed metadata"), len(b"signed metadata"),
                ({"path": "/postgres.gpg.asc", "sha256": digest(armored), "capturedFile": "apt-keyrings/key"},),
            )
            calls = []
            def tamper_private_release(command, *, env, timeout):
                calls.append(command)
                if command[0] == str(fake_gpgv):
                    return 0, b"gpgv version\n", b"", False
                if command[-1] == "--version":
                    return 0, b"gpg version\n", b"", False
                output_key = Path(command[command.index("--output") + 1])
                output_key.write_bytes(b"\x99derived key")
                private_release = Path(command[command.index("--homedir") + 1]).parent / "InRelease"
                private_release.write_bytes(b"tampered private data")
                return 0, b"", b"", False
            with patch.object(MODULE.shutil, "which", side_effect=lambda name: str(fake_gpg if name == "gpg" else fake_gpgv)), patch.object(
                MODULE, "run_bounded", side_effect=tamper_private_release,
            ):
                with self.assertRaisesRegex(ValueError, "changed before gpgv"):
                    REAL_VERIFY_SIGNATURE(release, [keyring], request=request, evidence_dir=evidence, diagnostics=diagnostics)
            self.assertFalse(any(command[0] == str(fake_gpgv) and "--status-fd" in command for command in calls))

    @unittest.skipUnless(shutil.which("gpg") and shutil.which("gpgv"), "local gpg/gpgv unavailable")
    def test_real_gpg_dearmor_and_gpgv_accepts_ephemeral_armored_signing_key(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            home = base / "signer-home"; home.mkdir(mode=0o700)
            env = {**os.environ, "GNUPGHOME": str(home), "LC_ALL": "C", "LANG": "C"}
            generated = subprocess.run(
                [shutil.which("gpg"), "--batch", "--pinentry-mode", "loopback", "--passphrase", "",
                 "--quick-generate-key", "ERP Fixture <fixture@example.invalid>", "ed25519", "sign", "0"],
                env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=True,
            )
            listing = subprocess.run([shutil.which("gpg"), "--batch", "--with-colons", "--list-keys"],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=True)
            fingerprint = next(line.split(":")[9] for line in listing.stdout.decode().splitlines() if line.startswith("fpr:"))
            exported = subprocess.run([shutil.which("gpg"), "--batch", "--armor", "--export", fingerprint],
                                      env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=True).stdout
            message = base / "message.txt"; message.write_text("Trixie signature fixture\n")
            release = base / "InRelease"
            subprocess.run([shutil.which("gpg"), "--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase", "",
                            "--local-user", fingerprint, "--clearsign", "--output", str(release), str(message)],
                           env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=True)
            keyring = base / "postgres.gpg.asc"; keyring.write_bytes(exported)
            evidence = base / "evidence"; evidence.mkdir()
            diagnostics = MODULE.ValidationDiagnostics(base / "diagnostics", evidence)
            request = MODULE.SignatureRequest(
                "trixie-pgdg", "sources.list", "a" * 64, "isolated-releases/trixie-pgdg/InRelease",
                digest(release.read_bytes()), release.stat().st_size,
                ({"path": "/postgres.gpg.asc", "sha256": digest(exported), "capturedFile": "apt-keyrings/key"},),
            )
            REAL_VERIFY_SIGNATURE(release, [keyring], request=request, evidence_dir=evidence, diagnostics=diagnostics)
            report = json.loads((base / "diagnostics" / "trixie-pgdg.json").read_text())
            self.assertTrue(report["accepted"])
            self.assertEqual(report["keyrings"][0]["sourceFormat"], "ASCII_ARMORED_PUBLIC_KEY")
            self.assertEqual(report["keyrings"][0]["transformation"], "gpg --dearmor")

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
