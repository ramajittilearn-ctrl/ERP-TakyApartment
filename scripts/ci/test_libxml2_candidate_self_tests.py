from __future__ import annotations

import pathlib
import shlex
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts/ci/run-libxml2-candidate-self-tests.sh"


class CandidateSelfTestRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="libxml2-self-tests-")
        self.root = pathlib.Path(self.temp.name)
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self.evidence_dir = self.root / "evidence"
        self.write_test("testapi", "Total: 42 functions, 17 tests, 0 errors\n")
        self.write_test("testchar", "testing char range: 1 2 3 4 done\n")
        self.write_test("testdict", "dictionary tests succeeded 20000 strings\n")
        self.write_test("testlimits", "Total 514 tests, no errors\n")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_test(self, name: str, output: str, exit_code: int = 0) -> None:
        args = "\n".join(
            [
                "#!/bin/sh",
                'if [ "$1" = "-q" ] || [ "$1" = "-quiet" ]; then shift; fi',
                f"printf '%s' {shlex.quote(output)}",
                f"exit {exit_code}",
                "",
            ]
        )
        path = self.bin_dir / name
        path.write_text(args)
        path.chmod(0o755)

    def run_runner(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(RUNNER), str(self.bin_dir), str(self.evidence_dir)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_records_all_four_successful_behavior_checks(self) -> None:
        result = self.run_runner()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("4 passed", result.stdout)
        self.assertEqual(
            (self.evidence_dir / "self-tests.tsv").read_text().splitlines(),
            [
                "testapi\tPASS\tTotal: 42 functions, 17 tests, 0 errors",
                "testchar\tPASS\ttesting char range: 1 2 3 4 done",
                "testdict\tPASS\tdictionary tests succeeded 20000 strings",
                "testlimits\tPASS\tTotal 514 tests, no errors",
            ],
        )
        for name in ("testapi", "testchar", "testdict", "testlimits"):
            self.assertTrue((self.evidence_dir / f"{name}.log").is_file())

    def test_fails_when_a_required_binary_is_missing(self) -> None:
        (self.bin_dir / "testlimits").unlink()

        result = self.run_runner()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("required libxml2 self-test is missing: testlimits", result.stderr)

    def test_rejects_zero_test_api_summary(self) -> None:
        self.write_test("testapi", "Total: 0 functions, 0 tests, 0 errors\n")

        result = self.run_runner()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("did not report its expected successful test summary", result.stderr)

    def test_rejects_testchar_assertion_failure_even_with_zero_exit(self) -> None:
        self.write_test("testchar", "testing char range: 1 2 3 4 done\nFailed to parse invalid input\n")

        result = self.run_runner()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("testchar reported a failed", result.stderr)

    def test_rejects_nonzero_test_exit(self) -> None:
        self.write_test("testdict", "dictionary tests failed with 1 errors\n", exit_code=1)

        result = self.run_runner()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("testdict exited with status 1", result.stderr)

    def test_rejects_testlimits_error_summary(self) -> None:
        self.write_test("testlimits", "Total 514 tests, 1 errors, 0 leaks\n")

        result = self.run_runner()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("did not report its expected successful test summary", result.stderr)


if __name__ == "__main__":
    unittest.main()
