# Trixie security index lock review — 2026-11-11

## Evidence and verification

PR run [42985184060](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42985184060), attempt 1, checked out PR head `dfb859d34a829942291c83323b84d2996ba38d3b` at merge revision `e07f2d8f8a50938fd7f88809edc0b80db62cd4d9`, tree `91015fbe4721a92529dfb8b8cf680245f28ffc17`. The container-scan artifact is [13839752648](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42985184060/artifacts/13839752648), GitHub digest `sha256:cb4cd688f09c863079d78ba35ccc2a552705c24634978d13a16e2bb9cb5218b7`. All 84 discovered evidence files match `run.json`; the proposal and run hashes match the signature-diagnostic record.

The captured Debian and PGDG InRelease files were accepted by `gpgv` with the configured, hash-pinned keyrings. Their SHA-256 digests and byte sizes are:

| Release | InRelease SHA-256 | Bytes |
| --- | --- | ---: |
| Trixie | `0584fba32e13e0ab8285fb16c27adea1ec03a73669c18702821094fd6ca86675` | 140421 |
| Trixie updates | `f19fd09f88462e1338c14854425697a35cf8bd400694792ad558ad4b17334a0a` | 47340 |
| Trixie security | `ce67cf57cafb7541662bc08f6e7959f28790939eb29777689f1d521971a56f4f` | 43409 |
| PostgreSQL PGDG | `ac533f523687800ace432f7c778113abc87f92f3a7655170da834ed98a81149e` | 240985 |

The authenticated active Packages map differs from the previous lock in exactly two entries: uncompressed and XZ `trixie-security/main/binary-amd64/Packages`. The InRelease signature diagnostics report accepted signatures for all four sources. The Trixie base Release is 5,185,658 seconds old: over its warning age by 1,658 seconds but within its 7,776,000-second maximum; the three shorter-lived Releases are within their limits.

## Package proposal review and lock decision

The current APT proposal has 14 removal tuples. Their package, version, and architecture values exactly match the existing purge lock. The captured APT purge simulation reports zero installs and upgrades and exactly those 14 removals. No protected-package or runtime/CVE clearance is inferred from this candidate-only package plan.

I refreshed only the two changed signed Packages variants and the candidate lock's corresponding SHA-256, run, proposal, and artifact provenance. Release identity/freshness policy, trust inputs, purge tuples, image digest, and candidate-only status remain pinned. Approval remains `APPROVED_FOR_ISOLATED_CANDIDATE_BUILD_ONLY`; runtime and CVE clearance remain `NOT_EVALUATED`, and production use remains `NOT_AUTHORIZED`.

This lock refresh makes the next exact-head CI run revalidate the current authenticated package map and isolated candidate. It does not authorize production use.

## Verification state

The failed exact-head run above failed closed because the signed security Packages map had advanced beyond the previous lock. The same run's quality, Stage 5, Agent UAT, libxml2 candidate, and Forky provenance jobs passed. The next exact-head run must pass container verification against this refreshed lock before the CI failure is considered resolved.
