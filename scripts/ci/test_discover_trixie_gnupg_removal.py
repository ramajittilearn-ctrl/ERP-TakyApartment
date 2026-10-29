import importlib.util
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("discover-trixie-gnupg-removal.py")
SPEC = importlib.util.spec_from_file_location("trixie_discovery", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class DiscoveryParsingTests(unittest.TestCase):
    def test_suite_source_selector_accepts_spaced_one_line_options(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence = Path(temp)
            source_dir = evidence / "apt-sources" / "sources.list.d"
            source_dir.mkdir(parents=True)
            source = source_dir / "pgdg.list"
            source.write_text(
                "deb [ signed-by=/usr/local/share/keyrings/postgres.gpg.asc ] "
                "http://apt.postgresql.org/pub/repos/apt trixie-pgdg main 17\n"
            )
            start = MODULE.CONTAINER_SCRIPT.index("select_suite_source() {")
            end = MODULE.CONTAINER_SCRIPT.index("\nfor codename in trixie", start)
            selector = MODULE.CONTAINER_SCRIPT[start:end]
            selected = evidence / "source.selected"
            result = subprocess.run(
                [
                    "bash", "-c",
                    f'evidence="$1"\n{selector}\nselect_suite_source "$2" "$3"',
                    "selector-test", str(evidence), "trixie-pgdg", str(selected),
                ],
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(selected.read_text(), source.read_text())
            self.assertEqual(Path(f"{selected}.origin").read_text(), "sources.list.d/pgdg.list\n")

    def test_suite_source_selector_keeps_deb822_fields_in_one_stanza(self):
        with tempfile.TemporaryDirectory() as temp:
            evidence = Path(temp)
            source_dir = evidence / "apt-sources" / "sources.list.d"
            source_dir.mkdir(parents=True)
            source = source_dir / "debian.sources"
            source.write_text(
                "Types: deb\n"
                "# http://snapshot.debian.org/archive/debian/20261020T213255Z\n"
                "URIs: http://deb.debian.org/debian\n"
                "Suites: trixie trixie-updates\n"
                "Components: main\n"
                "Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp\n\n"
                "Types: deb\n"
                "URIs: http://deb.debian.org/debian-security\n"
                "Suites: trixie-security\n"
                "Components: main\n"
                "Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp\n"
            )
            start = MODULE.CONTAINER_SCRIPT.index("select_suite_source() {")
            end = MODULE.CONTAINER_SCRIPT.index("\nfor codename in trixie", start)
            selector = MODULE.CONTAINER_SCRIPT[start:end]
            selected = evidence / "source.selected"
            result = subprocess.run(
                [
                    "bash", "-c",
                    f'evidence="$1"\n{selector}\nselect_suite_source "$2" "$3"',
                    "selector-test", str(evidence), "trixie", str(selected),
                ],
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                selected.read_text(),
                "Types: deb\n"
                "# http://snapshot.debian.org/archive/debian/20261020T213255Z\n"
                "URIs: http://deb.debian.org/debian\n"
                "Suites: trixie\n"
                "Components: main\n"
                "Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp\n\n",
            )
            self.assertEqual(Path(f"{selected}.origin").read_text(), "sources.list.d/debian.sources\n")

    def test_indextargets_format_uses_only_supported_nine_fields(self):
        line = next(item for item in MODULE.CONTAINER_SCRIPT.splitlines() if "apt-get indextargets --format" in item)
        self.assertEqual(line.count("$("), 9)
        self.assertNotIn("RELEASEFILE", line)

    def test_discovery_evidence_setup_does_not_create_scanner_output_root(self):
        with tempfile.TemporaryDirectory() as temp:
            runner_temp = Path(temp)
            scanner_output = runner_temp / "phase4-container-scan"
            evidence = runner_temp / "trixie-gnupg-discovery"
            self.assertFalse(scanner_output.exists())
            MODULE.initialize_evidence_directory(evidence)
            self.assertTrue(evidence.is_dir())
            self.assertFalse(scanner_output.exists())

    def test_isolated_apt_lists_stay_inside_disposable_image_filesystem(self):
        self.assertIn('lists="/var/lib/apt/phase4-isolated/$codename/lists"', MODULE.CONTAINER_SCRIPT)
        self.assertNotIn('lists="$suite_dir/lists"', MODULE.CONTAINER_SCRIPT)
        self.assertIn('if [[ -e "$lists" ]]', MODULE.CONTAINER_SCRIPT)
        self.assertIn('exact-inrelease-digest.tsv', MODULE.CONTAINER_SCRIPT)

    def test_suite_evidence_directory_is_fresh_and_created_before_source_selection(self):
        loop_start = MODULE.CONTAINER_SCRIPT.index("for codename in trixie")
        create_line = '  mkdir "$suite_dir"'
        select_line = '  select_suite_source "$codename" "$selected_source"'
        loop_end = MODULE.CONTAINER_SCRIPT.index(select_line, loop_start) + len(select_line)
        suite_setup = MODULE.CONTAINER_SCRIPT[loop_start:loop_end]
        self.assertIn(create_line, suite_setup)
        self.assertLess(suite_setup.index(create_line), suite_setup.index(select_line))

        with tempfile.TemporaryDirectory() as temp:
            evidence = Path(temp) / "evidence"
            suite_dir = evidence / "isolated-releases" / "trixie"
            evidence.mkdir()
            (evidence / "isolated-releases").mkdir()
            mkdir_command = suite_setup[suite_setup.index(create_line) :].splitlines()[0].strip()

            missing = subprocess.run(
                ["bash", "-c", mkdir_command],
                env={**os.environ, "suite_dir": str(suite_dir)},
                text=True,
                capture_output=True,
            )
            self.assertEqual(missing.returncode, 0, missing.stderr)
            self.assertTrue(suite_dir.is_dir())

            marker = suite_dir / "existing-evidence.txt"
            marker.write_text("preserve me\n")
            existing = subprocess.run(
                ["bash", "-c", mkdir_command],
                env={**os.environ, "suite_dir": str(suite_dir)},
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(existing.returncode, 0)
            self.assertEqual(marker.read_text(), "preserve me\n")

    def test_workflow_validates_and_uploads_discovery_evidence_separately(self):
        workflow = SCRIPT.parents[2] / ".github/workflows/phase4-ci.yml"
        text = workflow.read_text()
        self.assertIn('--evidence-dir "$RUNNER_TEMP/trixie-gnupg-discovery"', text)
        self.assertIn("${{ runner.temp }}/trixie-gnupg-discovery/", text)
        self.assertIn("${{ runner.temp }}/phase4-container-scan/", text)

    def test_plan_is_sorted_and_bound_to_installed_version_and_architecture(self):
        inventory = {
            ("zlib1g", "amd64"): "1:1.3.dfsg-3",
            ("gnupg", "amd64"): "2.4.7-21",
        }
        plan = "Remv zlib1g [1:1.3.dfsg-3]\nPurg gnupg [2.4.7-21]\n"
        self.assertEqual(
            MODULE.parse_removals(plan, inventory),
            [
                {"name": "gnupg", "version": "2.4.7-21", "architecture": "amd64"},
                {"name": "zlib1g", "version": "1:1.3.dfsg-3", "architecture": "amd64"},
            ],
        )

    def test_arch_qualified_apt_name_resolves_to_inventory_architecture(self):
        self.assertEqual(
            MODULE.parse_removals("Remv gnupg:amd64 [2.4.7-21]\n", {("gnupg", "amd64"): "2.4.7-21"})[0]["architecture"],
            "amd64",
        )

    def test_empty_plan_or_missing_gnupg_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            MODULE.parse_removals("Reading package lists... Done\n", {("gnupg", "amd64"): "2.4.7-21"})
        with self.assertRaisesRegex(ValueError, "did not include gnupg"):
            MODULE.parse_removals("Remv zlib1g [1.3.dfsg-3]\n", {("zlib1g", "amd64"): "1.3.dfsg-3"})

    def test_version_mismatch_or_protected_package_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "differs"):
            MODULE.parse_removals("Purg gnupg [2.4.7-20]\n", {("gnupg", "amd64"): "2.4.7-21"})
        with self.assertRaisesRegex(ValueError, "protected"):
            MODULE.parse_removals(
                "Purg gnupg [2.4.7-21]\nRemv gpgv [2.4.7-21]\n",
                {("gnupg", "amd64"): "2.4.7-21", ("gpgv", "amd64"): "2.4.7-21"},
            )
        with self.assertRaisesRegex(ValueError, "protected"):
            MODULE.parse_removals(
                "Purg gnupg [2.4.7-21]\nRemv postgresql-client-17 [17.11-1]\n",
                {("gnupg", "amd64"): "2.4.7-21", ("postgresql-client-17", "amd64"): "17.11-1"},
            )
        with self.assertRaisesRegex(ValueError, "protected"):
            MODULE.parse_removals(
                "Purg gnupg [2.4.7-21]\nRemv libapt-pkg7.0 [2.7.8]\n",
                {("gnupg", "amd64"): "2.4.7-21", ("libapt-pkg7.0", "amd64"): "2.7.8"},
            )

    def test_only_tight_trixie_suite_targets_are_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            targets = Path(temp) / "targets.tsv"
            metadata = Path(temp) / "metadata"
            metadata.mkdir()
            releases = (
                ("trixie", "stable"),
                ("trixie-updates", "stable-updates"),
                ("trixie-security", "stable-security"),
                ("trixie-pgdg", "trixie-pgdg"),
            )
            rows = []
            acquisitions = []
            resolved = {}
            for index, (codename, suite) in enumerate(releases):
                filename = f"/var/lib/apt/lists/{codename}_{suite}_Packages"
                release_name = f"arbitrary-captured-{index}-InRelease"
                (metadata / Path(filename).name).write_text("authenticated by the test fixture\n")
                (metadata / release_name).write_text(
                    "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n"
                    f"Codename: {codename}\nSuite: {suite}\n"
                    "-----BEGIN PGP SIGNATURE-----\nfixture\n=abcd\n-----END PGP SIGNATURE-----\n"
                )
                host, origin_path = MODULE.EXPECTED_ORIGINS[codename]
                origin = f"https://{host}{origin_path}/dists/{codename}"
                index_uri = f"{origin}/main/binary-amd64/Packages.xz"
                rows.append(f"Packages|{codename}|{suite}|amd64|{filename}|{index_uri}|{origin}/|main/binary-amd64/Packages|main")
                isolated_release = f"isolated-releases/{codename}/InRelease"
                acquisitions.append({"codename": codename, "suite": suite, "baseUri": origin + "/", "inReleaseFile": isolated_release})
                resolved[codename] = isolated_release
            targets.write_text("\n".join(rows) + "\n")
            parsed = MODULE.validate_index_targets(targets, metadata, acquisitions)
            self.assertEqual({item["codename"]: item["releaseFile"] for item in parsed}, resolved)
            targets.write_text("Packages|trixie|stable-updates|amd64|/var/lib/apt/lists/trixie_Packages|https://deb.debian.org/debian/dists/trixie/main/binary-amd64/Packages.xz|https://deb.debian.org/debian/dists/trixie/|main/binary-amd64/Packages|main\n")
            with self.assertRaisesRegex(ValueError, "outside"):
                MODULE.validate_index_targets(targets, metadata, acquisitions)

    def test_target_origin_must_match_release_codenames_approved_origin(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            targets = root / "targets.tsv"
            metadata = root / "metadata"
            metadata.mkdir()
            (metadata / "pgdg_Packages").write_text("index fixture\n")
            targets.write_text(
                "Packages|trixie-pgdg|trixie-pgdg|amd64|/var/lib/apt/lists/pgdg_Packages|"
                "https://mirror.example/pub/repos/apt/dists/trixie-pgdg/main/binary-amd64/Packages.xz|"
                "https://mirror.example/pub/repos/apt/dists/trixie-pgdg/|main/binary-amd64/Packages|main\n"
            )
            with self.assertRaisesRegex(ValueError, "suite-scoped origin"):
                MODULE.validate_index_targets(targets, metadata, [])

    def test_effective_apt_trusted_paths_record_unset_and_normalize_parts(self):
        with tempfile.TemporaryDirectory() as temp:
            shell = Path(temp) / "apt-trusted-paths.shell"
            paths = Path(temp) / "apt-trusted-paths.tsv"
            # Debian APT 3 deliberately leaves Trusted unset; don't restore the
            # legacy trusted.gpg trust path. TrustedParts may have a trailing slash.
            shell.write_text("TRUSTED_PARTS='/etc/apt/trusted.gpg.d/';\n")
            MODULE.normalize_apt_trusted_paths(shell, paths)
            self.assertEqual(
                paths.read_text(),
                "trusted\t<unset>\ntrustedParts\t/etc/apt/trusted.gpg.d\n",
            )
            MODULE.validate_apt_trusted_paths(paths)
            for trusted_assignment in (
                "TRUSTED='/tmp/attacker.gpg';\n",
                "TRUSTED='<unset>';\n",
                "TRUSTED='';\n",
            ):
                shell.write_text(
                    trusted_assignment + "TRUSTED_PARTS='/etc/apt/trusted.gpg.d/';\n"
                )
                with self.assertRaisesRegex(ValueError, "must leave Dir::Etc::Trusted unset"):
                    MODULE.normalize_apt_trusted_paths(shell, paths)

    def test_effective_apt_trusted_paths_require_both_resolved_values(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = Path(temp) / "apt-trusted-paths.tsv"
            paths.write_text("trusted\t/etc/apt/trusted.gpg\n")
            with self.assertRaisesRegex(ValueError, "trusted-keyring paths"):
                MODULE.validate_apt_trusted_paths(paths)

    def test_approved_http_pgdg_origin_is_accepted(self):
        MODULE.validate_expected_origin(
            "trixie-pgdg", "http://apt.postgresql.org/pub/repos/apt/dists/trixie-pgdg/"
        )
        with self.assertRaisesRegex(ValueError, "approved suite-scoped origin"):
            MODULE.validate_expected_origin(
                "trixie-pgdg", "http://mirror.example/pub/repos/apt/dists/trixie-pgdg/"
            )
        with self.assertRaisesRegex(ValueError, "suite-scoped origin"):
            MODULE.validate_expected_origin(
                "trixie-pgdg", "http://apt.postgresql.org/pub/repos/apt/"
            )

    def test_suite_scoped_base_uri_must_match_origin_and_codename(self):
        for codename, (host, repo_path) in MODULE.EXPECTED_ORIGINS.items():
            with self.subTest(codename=codename):
                MODULE.validate_expected_origin(
                    codename, f"https://{host}{repo_path}/dists/{codename}/"
                )
        # Regression for the exact BASE_URI emitted by APT in hosted CI.
        MODULE.validate_expected_origin(
            "trixie", "http://deb.debian.org/debian/dists/trixie/"
        )
        with self.assertRaisesRegex(ValueError, "suite-scoped origin"):
            MODULE.validate_expected_origin(
                "trixie", "https://deb.debian.org/debian-security/dists/trixie/"
            )

    def test_target_release_mapping_requires_exact_source_root_acquisition(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            targets = root / "targets.tsv"
            metadata = root / "metadata"
            metadata.mkdir()
            (metadata / "trixie_Packages").write_text("index fixture")
            targets.write_text(
                "Packages|trixie|stable|amd64|/var/lib/apt/lists/trixie_Packages|"
                "https://deb.debian.org/debian/dists/trixie/main/binary-amd64/Packages.xz|"
                "https://deb.debian.org/debian/dists/trixie/|main/binary-amd64/Packages|main\n"
            )
            with self.assertRaisesRegex(ValueError, "exactly one isolated source-root acquisition"):
                MODULE.validate_index_targets(targets, metadata, [])
            acquisitions = [{"codename": "trixie", "suite": "stable", "baseUri": "https://mirror.example/debian/dists/trixie/", "inReleaseFile": "isolated-releases/trixie/InRelease"}]
            with self.assertRaisesRegex(ValueError, "exactly one isolated source-root acquisition"):
                MODULE.validate_index_targets(targets, metadata, acquisitions)

    def test_missing_expected_trixie_suite_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            targets = root / "targets.tsv"
            metadata = root / "metadata"
            metadata.mkdir()
            releases = (("trixie", "stable"), ("trixie-updates", "stable-updates"), ("trixie-security", "stable-security"))
            rows = []
            for index, (codename, suite) in enumerate(releases):
                filename = f"/var/lib/apt/lists/{codename}_{suite}_Packages"
                release_file = f"missing-pgdg-fixture-{index}-InRelease"
                (metadata / Path(filename).name).write_text("authenticated by the test fixture\n")
                (metadata / release_file).write_text(
                    "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n"
                    f"Codename: {codename}\nSuite: {suite}\n"
                    "-----BEGIN PGP SIGNATURE-----\nfixture\n=abcd\n-----END PGP SIGNATURE-----\n"
                )
                host, origin_path = MODULE.EXPECTED_ORIGINS[codename]
                origin = f"https://{host}{origin_path}/dists/{codename}"
                index_uri = f"{origin}/main/binary-amd64/Packages.xz"
                rows.append(f"Packages|{codename}|{suite}|amd64|{filename}|{index_uri}|{origin}/|main/binary-amd64/Packages|main")
            targets.write_text("\n".join(rows) + "\n")
            acquisitions = [
                {"codename": row.split("|")[1], "suite": row.split("|")[2], "baseUri": row.split("|")[6], "inReleaseFile": f"isolated-releases/{row.split('|')[1]}/InRelease"}
                for row in rows
            ]
            with self.assertRaisesRegex(ValueError, "did not provide all required"):
                MODULE.validate_index_targets(targets, metadata, acquisitions)

    def test_target_uri_credentials_and_non_default_ports_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            targets = root / "targets.tsv"
            metadata = root / "metadata"
            metadata.mkdir()
            (metadata / "debian_Packages").write_text("authenticated by the test fixture\n")
            for uri in (
                "https://user:secret@deb.debian.org/debian",
                "https://deb.debian.org:8443/debian",
            ):
                targets.write_text(f"Packages|trixie|stable|amd64|/var/lib/apt/lists/debian_Packages|{uri}|https://deb.debian.org/debian/dists/trixie/|main/binary-amd64/Packages|main\n")
                with self.assertRaisesRegex(ValueError, "URI"):
                    MODULE.validate_index_targets(targets, metadata, [])

    def test_signed_packages_hash_is_separate_from_local_transformed_index_hash(self):
        upstream = b"authenticated upstream uncompressed index"
        upstream_xz = b"authenticated upstream xz index"
        local = b"locally transformed apt lz4 index"
        path = "main/binary-amd64/Packages"
        digest = hashlib.sha256(upstream).hexdigest()
        xz_digest = hashlib.sha256(upstream_xz).hexdigest()
        alternate = b"alternate upstream gzip index"
        alternate_digest = hashlib.sha256(alternate).hexdigest()
        bz2_bytes = b"alternate upstream bzip2 index"
        bz2_digest = hashlib.sha256(bz2_bytes).hexdigest()
        release = (
            "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n"
            f"Origin: Debian\nCodename: trixie\nSuite: stable\nSHA256:\n {digest} {len(upstream)} {path}\n"
            f" {xz_digest} {len(upstream_xz)} {path}.xz\n"
            f" {bz2_digest} {len(bz2_bytes)} {path}.bz2\n"
            f" {alternate_digest} {len(alternate)} {path}.gz\n"
            "-----BEGIN PGP SIGNATURE-----\nZmFrZS1maXh0dXJlLXNpZ25hdHVyZQ==\n="
            "abcd\n-----END PGP SIGNATURE-----\n"
        ).encode()
        with tempfile.TemporaryDirectory() as temp:
            metadata = Path(temp)
            (metadata / "trixie_InRelease").write_bytes(release)
            (metadata / "local_Packages.lz4").write_bytes(local)
            target = {
                "identifier": "Packages", "codename": "trixie", "suite": "stable",
                "component": "main", "architecture": "amd64",
                "releaseFile": "/var/lib/apt/lists/trixie_InRelease",
                "baseUri": "https://deb.debian.org/debian/dists/trixie/",
                "uri": f"https://deb.debian.org/debian/dists/trixie/{path}",
                "metaKey": "main/binary-amd64/Packages",
                "filename": "/var/lib/apt/lists/local_Packages.lz4",
            }
            record = MODULE.signed_package_index_evidence([target], metadata)[0]
            self.assertEqual(
                {
                    "identifier", "codename", "suite", "architecture", "filename", "uri",
                    "baseUri", "metaKey", "releaseFile", "component", "signedVariants",
                    "localAptFile", "localAptSha256", "localAptSize",
                } - record.keys(),
                set(),
            )
            self.assertEqual(record["filename"], target["filename"])
            self.assertEqual(record["uri"], target["uri"])
            self.assertEqual(record["baseUri"], target["baseUri"])
            self.assertEqual(record["localAptSha256"], hashlib.sha256(local).hexdigest())
            self.assertEqual(record["localAptSize"], len(local))
            signed_variants = {item["path"]: item for item in record["signedVariants"]}
            self.assertEqual(set(signed_variants), {path, path + ".xz", path + ".bz2", path + ".gz"})
            self.assertEqual(signed_variants[path]["sha256"], digest)
            self.assertEqual(signed_variants[path]["size"], len(upstream))
            self.assertEqual(signed_variants[path + ".xz"]["sha256"], xz_digest)
            self.assertEqual(signed_variants[path]["size"], len(upstream))
            signed_records = MODULE.signed_release_index_records(metadata, [target])
            self.assertEqual(
                {record["path"] for record in signed_records},
                {path, path + ".xz", path + ".bz2", path + ".gz"},
            )
            self.assertEqual(
                next(record["sha256"] for record in signed_records if record["path"] == path),
                digest,
            )

    def test_uncompressed_xz_and_bz2_target_uris_bind_to_signed_variants(self):
        with tempfile.TemporaryDirectory() as temp:
            metadata = Path(temp)
            path = "main/binary-amd64/Packages"
            contents = {suffix: f"fixture {suffix}".encode() for suffix in ("", ".xz", ".bz2")}
            rows = "".join(
                f" {hashlib.sha256(value).hexdigest()} {len(value)} {path}{suffix}\n"
                for suffix, value in contents.items()
            )
            release = (
                "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n"
                f"Codename: trixie\nSuite: stable\nSHA256:\n{rows}"
                "-----BEGIN PGP SIGNATURE-----\nZmFrZQ==\n=abcd\n-----END PGP SIGNATURE-----\n"
            ).encode()
            (metadata / "trixie_InRelease").write_bytes(release)
            (metadata / "Packages.lz4").write_bytes(b"local transformed index")
            for suffix in ("", ".xz", ".bz2"):
                target = {
                    "identifier": "Packages", "codename": "trixie", "suite": "stable",
                    "component": "main", "architecture": "amd64",
                    "releaseFile": "/var/lib/apt/lists/trixie_InRelease",
                    "baseUri": "https://deb.debian.org/debian/dists/trixie/",
                    "uri": f"https://deb.debian.org/debian/dists/trixie/{path}{suffix}",
                    "metaKey": path,
                    "filename": "/var/lib/apt/lists/Packages.lz4",
                }
                result = MODULE.signed_package_index_evidence([target], metadata)[0]
                self.assertEqual(
                    {item["path"] for item in result["signedVariants"]},
                    {path, path + ".xz", path + ".bz2"},
                )

    def test_signed_by_keyring_is_hashed_and_missing_key_or_bypass_fails(self):
        def invoke(source_text, suffix):
            temporary = tempfile.TemporaryDirectory()
            root = Path(temporary.name)
            sources = root / "sources"
            source_dir = sources / "sources.list.d"
            source_dir.mkdir(parents=True)
            (source_dir / ("apt" + suffix)).write_text(source_text)
            result_path = root / "result.json"
            result = subprocess.run(
                ["bash", "-c", MODULE.SOURCE_SECURITY_COLLECTOR, "collector", str(sources), str(result_path)],
                text=True, capture_output=True,
            )
            return temporary, result, result_path

        with tempfile.TemporaryDirectory() as temp:
            keyring = Path(temp) / "postgres.gpg.asc"
            keyring.write_bytes(b"public key fixture")
            source = f"deb [signed-by={keyring}] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main\n"
            temporary, result, result_path = invoke(source, ".list")
            with temporary:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(f"{keyring}\t{hashlib.sha256(keyring.read_bytes()).hexdigest()}\t{keyring.stat().st_size}", result_path.read_text())
                binding = next(line.split("\t") for line in result_path.read_text().splitlines() if line.startswith(str(keyring) + "\t"))
                captured = result_path.parent / binding[4]
                self.assertEqual(captured.read_bytes(), keyring.read_bytes())

            deb822 = (
                "Types: deb\nURIs: https://apt.postgresql.org/pub/repos/apt\n"
                "Suites: trixie-pgdg\nComponents: main\n"
                f"Signed-By: {keyring}\n"
            )
            temporary, result, result_path = invoke(deb822, ".sources")
            with temporary:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(f"{keyring}\t{hashlib.sha256(keyring.read_bytes()).hexdigest()}\t{keyring.stat().st_size}", result_path.read_text())
            missing = f"deb [signed-by={keyring}.missing] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main\n"
            temporary, result, _ = invoke(missing, ".list")
            with temporary:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("keyring is missing", result.stderr)
            temporary, result, _ = invoke(
                "deb https://apt.postgresql.org/pub/repos/apt trixie-pgdg main\n", ".list"
            )
            with temporary:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("no explicit Signed-By", result.stderr)
            bypasses = (
                "deb [trusted=yes] https://example.invalid/debian trixie main\n",
                "deb [allow-insecure=yes] https://example.invalid/debian trixie main\n",
                "deb [allow-weak=yes] https://example.invalid/debian trixie main\n",
                "deb [allow-downgrade-to-insecure=yes] https://example.invalid/debian trixie main\n",
                "deb [check-valid-until=no] https://example.invalid/debian trixie main\n",
            )
            for source in bypasses:
                temporary, result, _ = invoke(source, ".list")
                with temporary:
                    self.assertNotEqual(result.returncode, 0, source)
                    self.assertIn("bypass is enabled", result.stderr)
            deb822_bypasses = (
                "Allow-Insecure: yes\n", "Allow-Weak: yes\n",
                "Allow-Downgrade-To-Insecure: yes\n", "Check-Valid-Until: no\n", "Trusted: yes\n",
            )
            for field in deb822_bypasses:
                source = "Types: deb\nURIs: https://example.invalid/debian\nSuites: trixie\n" + field
                temporary, result, _ = invoke(source, ".sources")
                with temporary:
                    self.assertNotEqual(result.returncode, 0, source)
                    self.assertIn("bypass is enabled", result.stderr)

    def test_same_signed_by_keyring_binding_is_recorded_for_each_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sources = root / "sources"
            source_dir = sources / "sources.list.d"
            source_dir.mkdir(parents=True)
            keyring = root / "shared.gpg"
            keyring.write_bytes(b"shared public key")
            (source_dir / "debian.list").write_text(
                f"deb [signed-by={keyring}] https://deb.debian.org/debian trixie main\n"
            )
            (source_dir / "pgdg.list").write_text(
                f"deb [signed-by={keyring}] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main\n"
            )
            output = root / "source-trust.tsv"
            result = subprocess.run(
                ["bash", "-c", MODULE.SOURCE_SECURITY_COLLECTOR, "collector", str(sources), str(output)],
                text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            bindings = [line.split("\t") for line in output.read_text().splitlines() if line.startswith(str(keyring) + "\t")]
            self.assertEqual({row[3] for row in bindings}, {"sources.list.d/debian.list", "sources.list.d/pgdg.list"})
            self.assertEqual({row[4] for row in bindings}, {f"apt-keyrings/{hashlib.sha256(keyring.read_bytes()).hexdigest()}"})

    def test_unlisted_upstream_packages_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            metadata = Path(temp)
            body = "Origin: Debian\nCodename: trixie\nSuite: stable\nSHA256:\n " + "a" * 64 + " 1 main/binary-amd64/Packages.xz\n"
            release = f"-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n{body}-----BEGIN PGP SIGNATURE-----\nZmFrZQ==\n=abcd\n-----END PGP SIGNATURE-----\n".encode()
            (metadata / "trixie_InRelease").write_bytes(release)
            (metadata / "local_Packages.lz4").write_bytes(b"local")
            target = {
                "identifier": "Packages", "codename": "trixie", "suite": "stable",
                "component": "contrib", "architecture": "amd64",
                "releaseFile": "/var/lib/apt/lists/trixie_InRelease",
                "baseUri": "https://deb.debian.org/debian/dists/trixie/",
                "uri": "https://deb.debian.org/debian/dists/trixie/contrib/binary-amd64/Packages.gz",
                "metaKey": "contrib/binary-amd64/Packages",
                "filename": "/var/lib/apt/lists/local_Packages.lz4",
            }
            with self.assertRaisesRegex(ValueError, "does not list"):
                MODULE.signed_package_index_evidence([target], metadata)

    def test_index_identity_must_match_signed_release_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            metadata = Path(temp)
            body = (
                "Codename: trixie\nSuite: stable\nSHA256:\n "
                + "a" * 64 + " 1 main/binary-amd64/Packages.xz\n"
            )
            release = (
                "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n" + body
                + "-----BEGIN PGP SIGNATURE-----\nZmFrZQ==\n=abcd\n-----END PGP SIGNATURE-----\n"
            ).encode()
            (metadata / "trixie_InRelease").write_bytes(release)
            (metadata / "local_Packages.lz4").write_bytes(b"local")
            target = {
                "identifier": "Packages", "codename": "trixie", "suite": "stable-updates",
                "component": "main", "architecture": "amd64",
                "releaseFile": "/var/lib/apt/lists/trixie_InRelease",
                "baseUri": "https://deb.debian.org/debian/dists/trixie/",
                "uri": "https://deb.debian.org/debian/dists/trixie/main/binary-amd64/Packages.xz",
                "metaKey": "main/binary-amd64/Packages",
                "filename": "/var/lib/apt/lists/local_Packages.lz4",
            }
            with self.assertRaisesRegex(ValueError, "identity differs"):
                MODULE.signed_package_index_evidence([target], metadata)


if __name__ == "__main__":
    unittest.main()
