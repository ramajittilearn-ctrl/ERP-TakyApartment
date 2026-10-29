import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class CandidateEvidenceContractTests(unittest.TestCase):
    def test_docker_producer_emits_verifier_required_release_filenames(self):
        dockerfile = (ROOT / "docker/postgres/trixie-gnupg-prune-candidate.Dockerfile").read_text()
        verifier = (ROOT / "scripts/ci/verify-container-images.sh").read_text()

        producer_name = re.search(r'output="\$evidence/(inrelease-\$stage\.tsv)"', dockerfile)
        self.assertIsNotNone(producer_name)
        self.assertIn('cp "$output" "$evidence/release-freshness-$stage.tsv"', dockerfile)
        self.assertIn("verify_release_set before-purge;", dockerfile)
        self.assertIn("verify_release_set after-purge;", dockerfile)

        required_block = re.search(
            r"for evidence_file in (.*?)\n  if \[\[ ! -s",
            verifier,
            re.DOTALL,
        )
        self.assertIsNotNone(required_block)
        required_files = set(required_block.group(1).split())
        for stage in ("before-purge", "after-purge"):
            filename = f"inrelease-{stage}.tsv"
            self.assertIn(filename, required_files)
            self.assertEqual(producer_name.group(1).replace("$stage", stage), filename)


if __name__ == "__main__":
    unittest.main()
