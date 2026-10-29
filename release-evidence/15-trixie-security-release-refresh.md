# Trixie security Release metadata refresh

## Scope and source evidence

- Trigger: exact-head PR container verification run [40903022919](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40903022919) and push run [40903013025](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40903013025) failed closed because the signed `trixie-security` InRelease SHA-256 changed from `942258f79bb4c7d35264eba73a5cfecf07451a9eb17e5cfa8be6d5f085ed2ad7` to `dd02c5cba2fe501ce3e2d4d74638f8c34f2ec6910ecc7e1d1bd2489e461988e3`.
- Discovery evidence: run `40903022919`, attempt `1`, source revision `03a63682ecb9ddf2553b6467e8a23d3d300e188a`, tree `c70726f9e54212f3636202cc5a69d5b015f51142`.
- Artifact: [12909992992](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40903022919/artifacts/12909992992), ZIP SHA-256 `b02ee008e5d4844cb06078407144d3f6e1086e82bd990ac3922e616822923489`.
- Proposal SHA-256: `ccb31b114655be6e4c1fdccdafa5fb0bd8828471bff15cdb76c43cc92a74876e`; proposal validation result `VALIDATED`, with 84 evidence files and no validator error.
- Hosted signature diagnostics report accepted signatures for all four configured suites. Independent artifact review verified all 84 evidence hashes, the 14/14 exact package name/version/architecture tuples, and unchanged purge simulation SHA-256 `293214c4d06c49c54de48dbf8815fe2f30ada5ab2f03447ff167cc1e83f6b009`.

## Change boundary and verification

- Only the signed `trixie-security` Release digest and the candidate lock's matching discovery provenance, captured Release digest, and outer Release-lock SHA-256 are refreshed.
- The package purge lock remains byte-identical (SHA-256 `358f19903c7e83abb32750ac7e6b882ebafa4b8abfe2b2658754e483f1e320df`); the trust lock remains byte-identical (SHA-256 `b1aea0a58116e60daa4aca97b99d65ffba7f85d77ad6c83596b12cbe5da5c519`). Signed package-index hashes and the removal proposal are unchanged.
- Local checks on this refresh: `git diff --check` passed; `scripts.ci.test_validate_trixie_gnupg_evidence` passed 46 tests with one skipped because local `gpg/gpgv` is unavailable; `scripts.ci.test_discover_trixie_gnupg_removal` passed 26 tests.
- Local exact-head refresh remains subject to independent source review and hosted exact-head CI. Hosted signature verification is based on the recorded run evidence; it was not reproduced locally.

## Security boundary

This refresh updates authenticated repository metadata and provenance only. It adds no package tuple, does not change the purge simulation, and is not a CVE disposition, runtime security clearance, image publication approval, production-use authorization, or deployment approval. The candidate lock continues to record `runtimeClearance: NOT_EVALUATED`, `cveClearance: NOT_EVALUATED`, and `productionUse: NOT_AUTHORIZED` under `approval`.
