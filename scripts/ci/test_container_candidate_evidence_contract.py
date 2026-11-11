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

    def test_restore_matrix_pulls_and_pins_both_legacy_source_images_before_routes(self):
        verifier = (ROOT / "scripts/ci/verify-container-images.sh").read_text()
        pull_helper = re.search(
            r"pull_pinned_restore_source\(\) \{(.*?)\n\}",
            verifier,
            re.DOTALL,
        )
        self.assertIsNotNone(pull_helper)
        for required in (
            'docker pull --platform linux/amd64 "$image" >&2',
            "jq -e --arg digest",
            "{{.Os}}/{{.Architecture}}",
            "^sha256:[a-f0-9]{64}$",
        ):
            self.assertIn(required, pull_helper.group(1))
        trixie_pull = 'legacy_trixie_db_image_id="$(pull_pinned_restore_source "$legacy_trixie_db_image")"'
        bookworm_pull = 'legacy_bookworm_db_image_id="$(pull_pinned_restore_source "$legacy_bookworm_db_image")"'
        self.assertIn(trixie_pull, verifier)
        self.assertIn(bookworm_pull, verifier)
        self.assertLess(verifier.index(trixie_pull), verifier.index("restore_routes=("))
        self.assertLess(verifier.index(bookworm_pull), verifier.index("restore_routes=("))
        self.assertIn('[[ "$source_image_id" == "$legacy_trixie_db_image_id" ]] ', verifier)
        self.assertIn('[[ "$source_image_id" == "$legacy_bookworm_db_image_id" ]] ', verifier)


if __name__ == "__main__":
    unittest.main()
