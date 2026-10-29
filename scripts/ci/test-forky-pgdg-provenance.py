#!/usr/bin/env python3
import datetime as dt
import hashlib
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import importlib.util

spec = importlib.util.spec_from_file_location("forky_provenance", pathlib.Path(__file__).with_name("prepare-forky-pgdg-provenance.py"))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


NOW = dt.datetime(2026, 10, 29, 12, 0, tzinfo=dt.timezone.utc)
PRIMARY = "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"
SIGNING = "A" * 40
GOOD_RELEASE = """Origin: Debian
Label: Debian
Suite: testing
Codename: forky
Date: Wed, 28 Oct 2026 20:22:33 UTC
Valid-Until: Wed, 04 Nov 2026 20:22:33 UTC
Architectures: all amd64 arm64
Components: main contrib
SHA256:
 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 12 main/binary-amd64/Packages.xz
 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 34 main/binary-amd64/Packages.gz
"""


class Deb822Tests(unittest.TestCase):
    def test_parses_folded_dependency_fields(self):
        record = module.parse_deb822("Package: sample\nDepends: libc6 (>= 2.1),\n libpq5\nArchitecture: amd64\n")[0]
        self.assertEqual(record["Depends"], "libc6 (>= 2.1),\nlibpq5")

    def test_rejects_duplicate_fields_or_orphan_continuations(self):
        with self.assertRaises(module.ProvenanceError):
            module.parse_deb822("Package: one\nPackage: two\n")
        with self.assertRaises(module.ProvenanceError):
            module.parse_deb822(" continuation without field\n")

    def test_rejects_unsafe_release_index_paths(self):
        body = GOOD_RELEASE.replace("main/binary-amd64/Packages.xz", "../Packages.xz")
        with self.assertRaises(module.ProvenanceError):
            module.release_hashes(body)


class ReleaseTests(unittest.TestCase):
    def test_debian_policy_context_binds_repository_and_signers_for_transition(self):
        policy = module.read_json(module.POLICY_PATH)
        debian_policy, trusted_primaries = module.debian_forky_policy_context(policy)
        self.assertEqual(debian_policy["uri"], "https://deb.debian.org/debian")
        self.assertEqual(debian_policy["suite"], "forky")
        self.assertEqual(trusted_primaries, {"04B54C3CDCA79751B16BC6B5225629DF75B188BD"})

    def test_debian_policy_context_rejects_missing_signer_policy(self):
        with self.assertRaisesRegex(module.ProvenanceError, "does not define Debian Forky primary fingerprints"):
            module.debian_forky_policy_context({"debianForky": {"primaryFingerprints": []}})

    def test_validates_fresh_debian_forky_release_and_index_hashes(self):
        result = module.validate_release(
            GOOD_RELEASE,
            expected_origin="Debian",
            expected_codename="forky",
            expected_component="main",
            architecture="amd64",
            now=NOW,
            max_age_seconds=7 * 24 * 60 * 60,
            max_future_skew_seconds=300,
            require_valid_until=True,
            expected_suite="testing",
        )
        self.assertEqual(result["codename"], "forky")
        self.assertEqual(result["sha256IndexCount"], 2)

    def test_accepts_historical_bookworm_release_only_when_snapshot_age_is_unbounded(self):
        body = GOOD_RELEASE.replace("Suite: testing", "Suite: oldstable")
        body = body.replace("Codename: forky", "Codename: bookworm")
        body = body.replace("Date: Wed, 28 Oct 2026 20:22:33 UTC", "Date: Sat, 11 Jul 2026 10:16:37 UTC")
        body = body.replace("Valid-Until: Wed, 04 Nov 2026 20:22:33 UTC\n", "")
        accepted = module.validate_release(
            body, expected_origin="Debian", expected_codename="bookworm", expected_component="main",
            architecture="amd64", now=NOW, max_age_seconds=None, max_future_skew_seconds=300,
            require_valid_until=False, expected_suite="oldstable",
        )
        self.assertEqual(accepted["date"], "2026-07-11T10:16:37Z")
        with self.assertRaisesRegex(module.ProvenanceError, "freshness window"):
            module.validate_release(
                body, expected_origin="Debian", expected_codename="bookworm", expected_component="main",
                architecture="amd64", now=NOW, max_age_seconds=7 * 24 * 60 * 60,
                max_future_skew_seconds=300, require_valid_until=False, expected_suite="oldstable",
            )

    def test_accepts_historical_trixie_release_only_when_snapshot_age_is_unbounded(self):
        body = GOOD_RELEASE.replace("Suite: testing", "Suite: stable")
        body = body.replace("Codename: forky", "Codename: trixie")
        body = body.replace("Date: Wed, 28 Oct 2026 20:22:33 UTC", "Date: Sat, 12 Sep 2026 07:55:41 UTC")
        body = body.replace("Valid-Until: Wed, 04 Nov 2026 20:22:33 UTC\n", "")
        accepted = module.validate_release(
            body, expected_origin="Debian", expected_codename="trixie", expected_component="main",
            architecture="amd64", now=NOW, max_age_seconds=None, max_future_skew_seconds=300,
            require_valid_until=False, expected_suite="stable",
        )
        self.assertEqual(accepted["date"], "2026-09-12T07:55:41Z")
        with self.assertRaisesRegex(module.ProvenanceError, "freshness window"):
            module.validate_release(
                body, expected_origin="Debian", expected_codename="trixie", expected_component="main",
                architecture="amd64", now=NOW, max_age_seconds=7 * 24 * 60 * 60,
                max_future_skew_seconds=300, require_valid_until=False, expected_suite="stable",
            )

    def test_snapshot_age_exemptions_do_not_disable_current_repository_freshness_policy(self):
        policy = module.read_json(module.POLICY_PATH)
        transition = policy["debianKeyringTransition"]
        fork = policy["debianForky"]
        pgdg = policy["pgdg"]
        self.assertIsNone(module.policy_max_age_seconds(
            transition, "bookwormSnapshotMaxAgeSeconds", allow_unbounded=True, label="Bookworm snapshot"
        ))
        self.assertIsNone(module.policy_max_age_seconds(
            transition, "trixieSnapshotMaxAgeSeconds", allow_unbounded=True, label="Trixie snapshot"
        ))
        self.assertEqual(module.policy_max_age_seconds(
            fork, "maxMetadataAgeSeconds", allow_unbounded=False, label="current Debian Forky"
        ), 604800)
        self.assertEqual(module.policy_max_age_seconds(
            pgdg, "maxMetadataAgeSeconds", allow_unbounded=False, label="PGDG"
        ), 604800)
        with self.assertRaisesRegex(module.ProvenanceError, "invalid current Debian Forky metadata freshness"):
            module.policy_max_age_seconds(
                {"maxMetadataAgeSeconds": None}, "maxMetadataAgeSeconds", allow_unbounded=False,
                label="current Debian Forky",
            )

    def test_historical_snapshot_age_exemption_still_rejects_future_dates(self):
        body = GOOD_RELEASE.replace("Suite: testing", "Suite: oldstable")
        body = body.replace("Codename: forky", "Codename: bookworm")
        body = body.replace("Date: Wed, 28 Oct 2026 20:22:33 UTC", "Date: Thu, 29 Oct 2026 13:00:00 UTC")
        body = body.replace("Valid-Until: Wed, 04 Nov 2026 20:22:33 UTC\n", "")
        with self.assertRaisesRegex(module.ProvenanceError, "too far in the future"):
            module.validate_release(
                body, expected_origin="Debian", expected_codename="bookworm", expected_component="main",
                architecture="amd64", now=NOW, max_age_seconds=None, max_future_skew_seconds=300,
                require_valid_until=False, expected_suite="oldstable",
            )

    def test_historical_trixie_snapshot_age_exemption_still_rejects_future_dates(self):
        body = GOOD_RELEASE.replace("Suite: testing", "Suite: stable")
        body = body.replace("Codename: forky", "Codename: trixie")
        body = body.replace("Date: Wed, 28 Oct 2026 20:22:33 UTC", "Date: Thu, 29 Oct 2026 13:00:00 UTC")
        body = body.replace("Valid-Until: Wed, 04 Nov 2026 20:22:33 UTC\n", "")
        with self.assertRaisesRegex(module.ProvenanceError, "too far in the future"):
            module.validate_release(
                body, expected_origin="Debian", expected_codename="trixie", expected_component="main",
                architecture="amd64", now=NOW, max_age_seconds=None, max_future_skew_seconds=300,
                require_valid_until=False, expected_suite="stable",
            )

    def test_historical_snapshot_age_exemption_still_rejects_expired_valid_until(self):
        body = GOOD_RELEASE.replace("Suite: testing", "Suite: oldstable")
        body = body.replace("Codename: forky", "Codename: bookworm")
        body = body.replace("Date: Wed, 28 Oct 2026 20:22:33 UTC", "Date: Sat, 11 Jul 2026 10:16:37 UTC")
        body = body.replace("Valid-Until: Wed, 04 Nov 2026 20:22:33 UTC", "Valid-Until: Fri, 10 Jul 2026 10:16:37 UTC")
        with self.assertRaisesRegex(module.ProvenanceError, "has expired according to Valid-Until"):
            module.validate_release(
                body, expected_origin="Debian", expected_codename="bookworm", expected_component="main",
                architecture="amd64", now=NOW, max_age_seconds=None, max_future_skew_seconds=300,
                require_valid_until=False, expected_suite="oldstable",
            )

    def test_allows_pgdd_style_missing_valid_until_only_with_bounded_age(self):
        body = GOOD_RELEASE.replace("Suite: testing", "Suite: forky-pgdg").replace("Codename: forky", "Codename: forky-pgdg")
        body = body.replace("Origin: Debian", "Origin: apt.postgresql.org").replace("Label: Debian", "Label: PostgreSQL for Debian/Ubuntu repository")
        body = body.replace("Valid-Until: Wed, 04 Nov 2026 20:22:33 UTC\n", "")
        result = module.validate_release(
            body, expected_origin="apt.postgresql.org", expected_codename="forky-pgdg",
            expected_component="main", architecture="amd64", now=NOW,
            max_age_seconds=7 * 24 * 60 * 60, max_future_skew_seconds=300,
            require_valid_until=False, expected_suite="forky-pgdg",
            expected_label="PostgreSQL for Debian/Ubuntu repository",
        )
        self.assertIsNone(result["validUntil"])

    def test_rejects_stale_future_expired_or_wrong_identity_metadata(self):
        cases = [
            (GOOD_RELEASE.replace("Codename: forky", "Codename: bullseye"), "codename"),
            (GOOD_RELEASE.replace("Wed, 28 Oct 2026 20:22:33 UTC", "Wed, 01 Oct 2026 20:22:33 UTC"), "freshness"),
            (GOOD_RELEASE.replace("Wed, 28 Oct 2026 20:22:33 UTC", "Thu, 29 Oct 2026 13:00:00 UTC"), "future"),
            (GOOD_RELEASE.replace("Wed, 04 Nov 2026 20:22:33 UTC", "Wed, 28 Oct 2026 20:22:33 UTC"), "expired"),
            (GOOD_RELEASE.replace("Valid-Until: Wed, 04 Nov 2026 20:22:33 UTC\n", ""), "Valid-Until"),
        ]
        for body, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(module.ProvenanceError, message):
                module.validate_release(
                    body, expected_origin="Debian", expected_codename="forky", expected_component="main",
                    architecture="amd64", now=NOW, max_age_seconds=7 * 24 * 60 * 60,
                    max_future_skew_seconds=300, require_valid_until=True,
                )

    def test_parses_openpgp_cleartext_and_crlf_release(self):
        message = (
            "-----BEGIN PGP SIGNED MESSAGE-----\r\nHash: SHA256\r\n\r\n"
            + GOOD_RELEASE
            + "-----BEGIN PGP SIGNATURE-----\r\nfixture\r\n-----END PGP SIGNATURE-----\r\n"
        ).encode()
        self.assertEqual(module.release_fields(module.cleartext_release_body(message))["Codename"], "forky")

    def test_rejects_duplicate_frames_malformed_headers_and_trailing_data(self):
        frame = "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n" + GOOD_RELEASE + "-----BEGIN PGP SIGNATURE-----\nfixture\n-----END PGP SIGNATURE-----\n"
        cases = [
            (frame + frame, "exactly one"),
            (frame.replace("Hash: SHA256", "Hash: SHA256\nHash: SHA512"), "duplicate"),
            (frame.replace("-----BEGIN PGP SIGNATURE-----", "-----BEGIN PGP SIGNATURE-----\n-----BEGIN PGP SIGNATURE-----"), "duplicate"),
            (frame + "trailing garbage\n", "trailing data"),
            (frame.replace("Hash: SHA256", "not-a-header"), "malformed"),
        ]
        for message, expected in cases:
            with self.subTest(expected=expected), self.assertRaisesRegex(module.ProvenanceError, expected):
                module.cleartext_release_body(message.encode())


class SignatureTests(unittest.TestCase):
    def test_accepts_exact_primary_from_validsig(self):
        status = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING} 2026-10-28 1793218953 0 4 0 1 8 00 {PRIMARY}\n"
        self.assertEqual(module.verified_signers(status, {PRIMARY})[0]["primaryFingerprint"], PRIMARY)

    def test_does_not_label_unpinned_keyring_signature_as_trusted_primary(self):
        status = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING} 2026-10-28 1793218953 0 4 0 1 8 00 {PRIMARY}\n"
        signer = module.verified_signers(status)[0]
        self.assertEqual(signer["trustBasis"], "keyring-signature-valid-no-explicit-primary-pin")

    def test_bookworm_auxiliary_pair_is_artifact_bound_and_not_trusted_bookworm_primary(self):
        bookworm_primary = "B8B80B5B623EAB6AD8775C45B7C5D7D6350947F8"
        stable_primary = "4D64FEC119C2029067D6E791F8D2585B8783D481"
        current_primary = "04B54C3CDCA79751B16BC6B5225629DF75B188BD"
        bookworm_signing = "4CB50190207B4758A3F73A796ED0E7B82643E131"
        current_signing = "B8E5F13176D2A7A75220028078DBA3BC47EF2265"
        bootstrap = {
            "unverifiedAdditionalSignerFingerprints": [current_signing],
            "requiredTrixieSignerFingerprints": [current_signing, module.TRIXIE_STABLE_RELEASE_PRIMARY],
        }
        auxiliary_pairs = module.derive_bookworm_bootstrap_auxiliary_signer_pairs(bootstrap, {current_primary})
        status = (
            f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {bookworm_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {bookworm_primary}\n"
            f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {current_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {current_primary}\n"
            f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {stable_primary} 2026-10-28 1793218953 0 4 0 22 8 00 {stable_primary}\n"
        )
        signers = module.verified_signers(status, {bookworm_primary, stable_primary}, auxiliary_pairs, auxiliary_pairs)
        self.assertEqual(
            {item["signingFingerprint"]: item["trustBasis"] for item in signers},
            {
                bookworm_signing: "trusted-primary",
                current_signing: "artifact-listed-auxiliary-signature-pair",
                stable_primary: "trusted-primary",
            },
        )
        self.assertEqual(
            module.derive_bookworm_transition_signer_pairs(signers),
            module.BOOKWORM_TO_TRIXIE_SIGNER_PAIRS,
        )
        without_auxiliary = status.replace(
            f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {current_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {current_primary}\n", ""
        )
        with self.assertRaisesRegex(module.ProvenanceError, "missing a required exact signer pair"):
            module.verified_signers(without_auxiliary, {bookworm_primary, stable_primary}, auxiliary_pairs, auxiliary_pairs)

    def test_bookworm_auxiliary_pair_requires_artifact_signer_and_policy_primary(self):
        current_signing, current_primary = module.BOOKWORM_BOOTSTRAP_AUXILIARY_SIGNER_PAIR
        cases = [
            ({"unverifiedAdditionalSignerFingerprints": [], "requiredTrixieSignerFingerprints": [current_signing]}, {current_primary}),
            ({"unverifiedAdditionalSignerFingerprints": [current_signing], "requiredTrixieSignerFingerprints": []}, {current_primary}),
            ({"unverifiedAdditionalSignerFingerprints": [current_signing], "requiredTrixieSignerFingerprints": [current_signing]}, {"D" * 40}),
        ]
        for bootstrap, primaries in cases:
            with self.subTest(bootstrap=bootstrap), self.assertRaisesRegex(module.ProvenanceError, "does not bind the exact Bookworm auxiliary"):
                module.derive_bookworm_bootstrap_auxiliary_signer_pairs(bootstrap, primaries)

    def test_accepts_forky_only_with_exact_bookworm_pair_and_current_primary(self):
        bookworm_primary = "B8B80B5B623EAB6AD8775C45B7C5D7D6350947F8"
        bookworm_signing = "4CB50190207B4758A3F73A796ED0E7B82643E131"
        current_primary = "04B54C3CDCA79751B16BC6B5225629DF75B188BD"
        current_signing = "B8E5F13176D2A7A75220028078DBA3BC47EF2265"
        verified_bookworm = [
            {"signingFingerprint": bookworm_signing, "primaryFingerprint": bookworm_primary, "trustBasis": "trusted-primary"},
            {"signingFingerprint": current_signing, "primaryFingerprint": current_primary, "trustBasis": "artifact-listed-auxiliary-signature-pair"},
        ]
        allowed_pairs = module.derive_bookworm_transition_signer_pairs(verified_bookworm)
        status = (
            f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {bookworm_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {bookworm_primary}\n"
            f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {current_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {current_primary}\n"
        )
        signers = module.verified_signers(status, {current_primary}, allowed_pairs)
        self.assertEqual({(item["signingFingerprint"], item["primaryFingerprint"]) for item in signers}, {
            (bookworm_signing, bookworm_primary), (current_signing, current_primary),
        })
        self.assertEqual(
            {item["signingFingerprint"]: item["trustBasis"] for item in signers},
            {bookworm_signing: "artifact-bound-bookworm-signature-pair", current_signing: "trusted-primary"},
        )

    def test_current_primary_only_signature_is_accepted(self):
        current_primary = "04B54C3CDCA79751B16BC6B5225629DF75B188BD"
        status = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {current_primary} 2026-10-28 1793218953 0 4 0 1 8 00 {current_primary}\n"
        signers = module.verified_signers(status, {current_primary}, module.BOOKWORM_TO_TRIXIE_SIGNER_PAIRS)
        self.assertEqual(len(signers), 1)
        self.assertEqual(signers[0]["trustBasis"], "trusted-primary")

    def test_bookworm_pair_only_cannot_satisfy_current_primary_requirement(self):
        signing, primary = next(iter(module.BOOKWORM_TO_TRIXIE_SIGNER_PAIRS))
        status = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {signing} 2026-10-28 1793218953 0 4 0 1 8 00 {primary}\n"
        with self.assertRaisesRegex(module.ProvenanceError, "no valid signature from an explicit trusted primary"):
            module.verified_signers(status, {"04B54C3CDCA79751B16BC6B5225629DF75B188BD"}, module.BOOKWORM_TO_TRIXIE_SIGNER_PAIRS)

    def test_same_bookworm_primary_with_different_subkey_is_rejected(self):
        wrong_signing = "C" * 40
        bookworm_primary = "B8B80B5B623EAB6AD8775C45B7C5D7D6350947F8"
        status = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {wrong_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {bookworm_primary}\n"
        with self.assertRaisesRegex(module.ProvenanceError, "not in the explicit trust set"):
            module.verified_signers(status, {"04B54C3CDCA79751B16BC6B5225629DF75B188BD"}, module.BOOKWORM_TO_TRIXIE_SIGNER_PAIRS)

    def test_trixie_requires_both_exact_release_signer_pairs(self):
        current_primary = "04B54C3CDCA79751B16BC6B5225629DF75B188BD"
        current_signing, _ = module.TRIXIE_CURRENT_ARCHIVE_SIGNER_PAIR
        stable_signing, stable_primary = module.TRIXIE_STABLE_RELEASE_SIGNER_PAIR
        bookworm_signing, bookworm_primary = next(iter(module.BOOKWORM_TO_TRIXIE_SIGNER_PAIRS))
        required = {module.TRIXIE_CURRENT_ARCHIVE_SIGNER_PAIR, module.TRIXIE_STABLE_RELEASE_SIGNER_PAIR}
        allowed_extra = module.BOOKWORM_TO_TRIXIE_SIGNER_PAIRS
        rows = {
            "current": f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {current_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {current_primary}\n",
            "stable": f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {stable_signing} 2026-10-28 1793218953 0 4 0 22 8 00 {stable_primary}\n",
            "bookworm": f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {bookworm_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {bookworm_primary}\n",
        }
        all_rows = rows["current"] + rows["stable"] + rows["bookworm"]
        signers = module.verified_signers(all_rows, {current_primary, stable_primary}, allowed_extra, required, True)
        self.assertEqual(len(signers), 3)
        self.assertEqual(
            {item["signingFingerprint"]: item["trustBasis"] for item in signers},
            {
                current_signing: "trusted-primary-exact-pair",
                stable_signing: "trusted-primary-exact-pair",
                bookworm_signing: "artifact-bound-bookworm-signature-pair",
            },
        )
        for missing in ("current", "stable"):
            with self.subTest(missing=missing), self.assertRaisesRegex(module.ProvenanceError, "missing a required exact signer pair"):
                reduced = rows["stable" if missing == "current" else "current"] + rows["bookworm"]
                module.verified_signers(reduced, {current_primary, stable_primary}, allowed_extra, required, True)
        wrong_current = rows["current"].replace(current_signing, "C" * 40)
        with self.assertRaisesRegex(module.ProvenanceError, "exact required signer set"):
            module.verified_signers(wrong_current + rows["stable"] + rows["bookworm"], {current_primary, stable_primary}, allowed_extra, required, True)

    def test_rejects_unknown_extra_signer_even_when_trusted_signer_is_present(self):
        trusted = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING} 2026-10-28 1793218953 0 4 0 1 8 00 {PRIMARY}\n"
        unknown_signing = "C" * 40
        unknown_primary = "D" * 40
        unknown = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {unknown_signing} 2026-10-28 1793218953 0 4 0 1 8 00 {unknown_primary}\n"
        with self.assertRaisesRegex(module.ProvenanceError, "not in the explicit trust set"):
            module.verified_signers(trusted + unknown, {PRIMARY})

    def test_rejects_bookworm_pair_absent_from_verified_bootstrap_signers(self):
        verified_bookworm = [{"signingFingerprint": PRIMARY, "primaryFingerprint": PRIMARY, "trustBasis": "trusted-primary"}]
        with self.assertRaisesRegex(module.ProvenanceError, "did not observe the pinned transition signer pair"):
            module.derive_bookworm_transition_signer_pairs(verified_bookworm)
        status = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING} 2026-10-28 1793218953 0 4 0 1 8 00 {PRIMARY}\n"
        with self.assertRaisesRegex(module.ProvenanceError, "not in the pinned transition policy"):
            module.verified_signers(status, {PRIMARY}, {("C" * 40, "D" * 40)})

    def test_rejects_signature_event_without_validsig(self):
        with self.assertRaisesRegex(module.ProvenanceError, "signature event has no valid signature record"):
            module.verified_signers("[GNUPG:] NEWSIG\n[GNUPG:] GOODSIG ABCDEF Example\n", {PRIMARY})

    def test_rejects_malformed_trust_fingerprints(self):
        status = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING} 2026-10-28 1793218953 0 4 0 1 8 00 {PRIMARY}\n"
        with self.assertRaisesRegex(module.ProvenanceError, "invalid fingerprint"):
            module.verified_signers(status, {"not-a-fingerprint"})

    def test_rejects_unknown_primary_and_bad_or_expired_signature_status(self):
        valid = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING} 2026-10-28 1793218953 0 4 0 1 8 00 {PRIMARY}\n"
        with self.assertRaisesRegex(module.ProvenanceError, "not in the explicit trust set"):
            module.verified_signers(valid, {"C" * 40})
        for status in ("BADSIG", "REVKEYSIG", "EXPKEYSIG", "KEYEXPIRED", "NO_PUBKEY", "ERRSIG"):
            with self.subTest(status=status), self.assertRaisesRegex(module.ProvenanceError, "unacceptable status"):
                module.verified_signers(f"[GNUPG:] NEWSIG\n[GNUPG:] {status} {SIGNING}\n")

    def test_rejects_bad_status_even_after_a_trusted_valid_signature(self):
        trusted = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING} 2026-10-28 1793218953 0 4 0 1 8 00 {PRIMARY}\n"
        for status in ("BADSIG", "REVKEYSIG", "EXPKEYSIG", "KEYEXPIRED", "NO_PUBKEY", "ERRSIG"):
            with self.subTest(status=status), self.assertRaisesRegex(module.ProvenanceError, "unacceptable status"):
                module.verified_signers(trusted + f"[GNUPG:] NEWSIG\n[GNUPG:] {status} {SIGNING}\n", {PRIMARY})

    def test_rejects_unrecognized_gpg_status_instead_of_ignoring_it(self):
        valid = f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING} 2026-10-28 1793218953 0 4 0 1 8 00 {PRIMARY}\n"
        with self.assertRaisesRegex(module.ProvenanceError, "unrecognized status"):
            module.verified_signers(valid + "[GNUPG:] FUTURE_FAILURE_STATUS\n", {PRIMARY})

    def test_rejects_absent_or_truncated_valid_signature(self):
        with self.assertRaisesRegex(module.ProvenanceError, "no valid signature"):
            module.verified_signers("[GNUPG:] NEWSIG\n[GNUPG:] GOODSIG ABCDEF Example\n")
        with self.assertRaisesRegex(module.ProvenanceError, "truncated"):
            module.verified_signers(f"[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG {SIGNING}\n")

    def test_extracts_primary_fingerprints_without_treating_subkeys_as_primaries(self):
        listing = f"pub:-:1:1:ACCC4CF8:0:0:::::scESC:\nfpr:::::::::{PRIMARY}:\nsub:-:1:1:DEADBEEF:0:0:::::s:\nfpr:::::::::{SIGNING}:\n"
        self.assertEqual(module.primary_fingerprints_from_key_listing(listing), [PRIMARY])


class PackageClosureTests(unittest.TestCase):
    def test_prefers_standard_apt_helper_over_path_shadow(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path_executable = pathlib.Path(temp_dir) / "apt-helper-shadow"
            system_executable = pathlib.Path(temp_dir) / "apt-helper-system"
            for executable in (path_executable, system_executable):
                executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                executable.chmod(0o755)
            with mock.patch.object(module.shutil, "which", return_value=str(path_executable)), mock.patch.object(
                module, "APT_HELPER_FALLBACKS", (system_executable,)
            ):
                self.assertEqual(module.resolve_command("apt-helper"), str(system_executable.resolve()))

    def test_fails_closed_when_standard_apt_helper_is_missing_even_if_path_has_shadow(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path_shadow = pathlib.Path(temp_dir) / "apt-helper-shadow"
            path_shadow.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            path_shadow.chmod(0o755)
            with mock.patch.object(module.shutil, "which", return_value=str(path_shadow)), mock.patch.object(
                module, "APT_HELPER_FALLBACKS", ()
            ), self.assertRaisesRegex(module.ProvenanceError, "required command is unavailable: apt-helper"):
                module.resolve_command("apt-helper")

    def test_resolves_apt_helper_from_standard_install_location_when_not_on_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            executable = pathlib.Path(temp_dir) / "apt-helper"
            executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            executable.chmod(0o755)
            with mock.patch.object(module.shutil, "which", return_value=None), mock.patch.object(
                module, "APT_HELPER_FALLBACKS", (executable,)
            ):
                self.assertEqual(module.resolve_command("apt-helper"), str(executable.resolve()))

    def test_fails_closed_when_apt_helper_is_missing_from_path_and_standard_location(self):
        with mock.patch.object(module.shutil, "which", return_value=None), mock.patch.object(
            module, "APT_HELPER_FALLBACKS", (pathlib.Path("/missing/apt-helper"),)
        ), self.assertRaisesRegex(module.ProvenanceError, "required command is unavailable: apt-helper"):
            module.resolve_command("apt-helper")

    def test_parses_https_apt_uri_plan(self):
        text = "'https://apt.postgresql.org/pub/repos/apt/pool/main/p/postgresql-17/root.deb' root.deb 123 SHA256:abc\n"
        self.assertEqual(module.parse_apt_print_uris(text)[0]["filename"], "root.deb")

    def test_rejects_unsafe_uri_or_empty_plan(self):
        with self.assertRaisesRegex(module.ProvenanceError, "non-HTTPS"):
            module.parse_apt_print_uris("'http://example.test/pkg.deb' pkg.deb 1 MD5Sum:x\n")
        with self.assertRaisesRegex(module.ProvenanceError, "no package downloads"):
            module.parse_apt_print_uris("Reading package lists... Done\n")

    def test_apt_config_isolated_from_host_state_and_proxy_environment(self):
        state = pathlib.Path("/tmp/forky-apt-state")
        command = module.apt_command(state, pathlib.Path("/tmp/sources.list"), "update")
        joined = " ".join(command)
        for path in ("Dir::Etc::main=/dev/null", "Dir::Etc::parts=-", "Dir::Etc::sourceparts=-",
                     "Dir::Etc::trusted=/dev/null", "Dir::Etc::trustedparts=-", "Dir::Cache::pkgcache=/tmp/forky-apt-state/pkgcache.bin",
                     "Dir::Cache::srcpkgcache=/tmp/forky-apt-state/srcpkgcache.bin", "Dir::State::extended_states=/tmp/forky-apt-state/extended_states"):
            self.assertIn(path, joined)
        saved = {key: os.environ.get(key) for key in ("APT_CONFIG", "HTTPS_PROXY", "http_proxy")}
        try:
            os.environ["APT_CONFIG"] = "/tmp/untrusted-apt.conf"
            os.environ["HTTPS_PROXY"] = "https://proxy.invalid"
            os.environ["http_proxy"] = "http://proxy.invalid"
            env = module.apt_environment()
            self.assertEqual(env["APT_CONFIG"], "/dev/null")
            self.assertNotIn("HTTPS_PROXY", env)
            self.assertNotIn("http_proxy", env)
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_requires_downloads_to_match_the_complete_resolver_plan(self):
        plan = [{"filename": "a.deb"}, {"filename": "b.deb"}]
        module.verify_dependency_filenames(plan, ["a.deb", "b.deb"])
        with self.assertRaisesRegex(module.ProvenanceError, "closure differs"):
            module.verify_dependency_filenames(plan, ["a.deb"])
        with self.assertRaisesRegex(module.ProvenanceError, "closure differs"):
            module.verify_dependency_filenames(plan, ["a.deb", "b.deb", "extra.deb"])

    def test_binds_downloaded_package_bytes_and_control_to_signed_index(self):
        payload = b"package payload"
        digest = hashlib.sha256(payload).hexdigest()
        text = (
            "Package: postgresql-17\nVersion: 17.11-1.pgdg14+2\nArchitecture: amd64\n"
            f"Filename: pool/main/p/postgresql-17/postgresql-17_17.11-1.pgdg14+2_amd64.deb\nSize: {len(payload)}\nSHA256: {digest}\n"
            "Depends: libc6 (>= 2.1),\n libpq5\nPre-Depends: adduser\n\n"
        )
        filename = "pool/main/p/postgresql-17/postgresql-17_17.11-1.pgdg14+2_amd64.deb"
        record, origins = module.find_index_record([("pgdg-forky", module.parse_deb822(text))], "postgresql-17", "17.11-1.pgdg14+2", "amd64", filename)
        verified = module.verify_package_metadata(record, {
            "Package": "postgresql-17", "Version": "17.11-1.pgdg14+2", "Architecture": "amd64",
            "Depends": "libc6 (>= 2.1),\nlibpq5", "Pre-Depends": "adduser",
        }, payload, expected_size=len(payload))
        self.assertEqual(origins, ["pgdg-forky"])
        self.assertEqual(verified["sha256"], digest)
        with self.assertRaisesRegex(module.ProvenanceError, "control field differs"):
            module.verify_package_metadata(record, {"Package": "postgresql-17", "Version": "wrong", "Architecture": "amd64"}, payload, expected_size=len(payload))
        with self.assertRaisesRegex(module.ProvenanceError, "no authenticated Packages stanza"):
            module.find_index_record([("pgdg-forky", module.parse_deb822(text))], "postgresql-17", "17.11-1.pgdg14+2", "amd64", "other/path/" + pathlib.PurePosixPath(filename).name)
        with self.assertRaisesRegex(module.ProvenanceError, "Source identity"):
            module.verify_package_metadata(record, {
                "Package": "postgresql-17", "Version": "17.11-1.pgdg14+2", "Architecture": "amd64",
                "Depends": "libc6 (>= 2.1),\nlibpq5", "Pre-Depends": "adduser", "Source": "different-source (1.0)",
            }, payload, expected_size=len(payload))

    def test_maps_apt_uri_to_exact_configured_repo_and_relative_filename(self):
        origin, filename = module.repo_and_filename(
            "https://apt.postgresql.org/pub/repos/apt/pool/main/p/postgresql-17/root.deb",
            [("pgdg-forky", "https://apt.postgresql.org/pub/repos/apt"), ("debian-forky", "https://deb.debian.org/debian")],
        )
        self.assertEqual(origin, "pgdg-forky")
        self.assertEqual(filename, "pool/main/p/postgresql-17/root.deb")
        with self.assertRaisesRegex(module.ProvenanceError, "does not map"):
            module.repo_and_filename("https://example.net/pool/root.deb", [("pgdg-forky", "https://apt.postgresql.org/pub/repos/apt")])
        for unsafe in (
            "https://user:password@apt.postgresql.org/pub/repos/apt/pool/root.deb",
            "https://apt.postgresql.org:444/pub/repos/apt/pool/root.deb",
            "https://apt.postgresql.org/pub/repos/apt/pool/root.deb?mirror=other",
        ):
            with self.subTest(unsafe=unsafe), self.assertRaisesRegex(module.ProvenanceError, "unambiguous HTTPS"):
                module.repo_and_filename(unsafe, [("pgdg-forky", "https://apt.postgresql.org/pub/repos/apt")])

    def test_rejects_disagreement_between_signed_indexes(self):
        base = "Package: example\nVersion: 1\nArchitecture: amd64\nFilename: pool/example.deb\nSize: 1\nSHA256: "
        text_a = base + "a" * 64 + "\n\n"
        text_b = base + "b" * 64 + "\n\n"
        with self.assertRaisesRegex(module.ProvenanceError, "indexes disagree"):
            module.find_index_record([("debian", module.parse_deb822(text_a)), ("pgdg", module.parse_deb822(text_b))], "example", "1", "amd64", "pool/example.deb")
        changed = base + "a" * 64 + "\nDepends: dependency-a\n\n"
        with self.assertRaisesRegex(module.ProvenanceError, "package metadata"):
            module.find_index_record([("debian", module.parse_deb822(text_a)), ("debian", module.parse_deb822(changed))], "example", "1", "amd64", "pool/example.deb")

    def test_preserves_explicit_source_package_version_semantics(self):
        payload = b"binNMU package payload"
        digest = hashlib.sha256(payload).hexdigest()
        text = (
            "Package: sample-bin\nVersion: 1.2-3+b1\nArchitecture: amd64\n"
            "Source: sample-src (1.2-3)\nFilename: pool/main/s/sample/s.deb\n"
            f"Size: {len(payload)}\nSHA256: {digest}\n\n"
        )
        record, _ = module.find_index_record([("debian-forky", module.parse_deb822(text))], "sample-bin", "1.2-3+b1", "amd64", "pool/main/s/sample/s.deb")
        result = module.verify_package_metadata(record, {
            "Package": "sample-bin", "Version": "1.2-3+b1", "Architecture": "amd64",
            "Source": "sample-src (1.2-3)",
        }, payload, expected_size=len(payload))
        self.assertEqual(result["source"], {"name": "sample-src", "version": "1.2-3"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
