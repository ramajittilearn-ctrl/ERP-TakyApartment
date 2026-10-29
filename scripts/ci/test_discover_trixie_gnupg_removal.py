import importlib.util
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("discover-trixie-gnupg-removal.py")
SPEC = importlib.util.spec_from_file_location("trixie_discovery", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class DiscoveryParsingTests(unittest.TestCase):
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
            suites = ("trixie", "trixie-updates", "trixie-security", "trixie-pgdg")
            rows = []
            for suite in suites:
                filename = f"/var/lib/apt/lists/{suite}_Packages"
                (metadata / Path(filename).name).write_text("authenticated by the test fixture\n")
                rows.append(f"Packages|trixie|{suite}|amd64|{filename}|https://deb.debian.org/debian")
            targets.write_text("\n".join(rows) + "\n")
            MODULE.validate_index_targets(targets, metadata)
            targets.write_text("Packages|bookworm|bookworm|amd64|/var/lib/apt/lists/debian_Packages|https://deb.debian.org/debian\n")
            with self.assertRaisesRegex(ValueError, "outside"):
                MODULE.validate_index_targets(targets, metadata)

    def test_missing_expected_trixie_suite_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            targets = root / "targets.tsv"
            metadata = root / "metadata"
            metadata.mkdir()
            suites = ("trixie", "trixie-updates", "trixie-security")
            rows = []
            for suite in suites:
                filename = f"/var/lib/apt/lists/{suite}_Packages"
                (metadata / Path(filename).name).write_text("authenticated by the test fixture\n")
                rows.append(f"Packages|trixie|{suite}|amd64|{filename}|https://deb.debian.org/debian")
            targets.write_text("\n".join(rows) + "\n")
            with self.assertRaisesRegex(ValueError, "did not provide all required"):
                MODULE.validate_index_targets(targets, metadata)

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
                targets.write_text(f"Packages|trixie|trixie|amd64|/var/lib/apt/lists/debian_Packages|{uri}\n")
                with self.assertRaisesRegex(ValueError, "URI"):
                    MODULE.validate_index_targets(targets, metadata)


if __name__ == "__main__":
    unittest.main()
