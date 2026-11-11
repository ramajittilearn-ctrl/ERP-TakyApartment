# Trixie GnuPG candidate lock refresh — 2026-11-10

## Why the previous exact lock stopped validating

The reviewed Trixie GnuPG candidate lock was based on run `40975998836`. Exact-head verification on 10 Nov 2026 found that Debian and PGDG signed package indexes had changed since that review. The validator correctly rejected the old `trixie-gnupg-package-index-lock.tsv` rather than accepting a stale active index map.

## New authenticated discovery

Push run [42753456794](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42753456794), attempt 1, head `7623146d60fa465962de98dd74166bd3c4924590`, tree `156c3cd005f97e5bdaaacef2227138f006fa4b8a`, uploaded discovery and diagnostics in container scan artifact [13735550455](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42753456794/artifacts/13735550455), GitHub digest `sha256:f2fa6f4f9917d666bee0448ac7be59a9cc1fb4be8d97654da2a009dd1a7c53b8`.

Independent `/root/head_artifact_audit` verified all 84 evidence-file hashes against `run.json`; all four `gpgv` checks accepted the captured Debian stable, stable-updates, stable-security, and PGDG InRelease files; captured hashes and sizes match the proposal. The signed index map covers 2,117 entries and five selected amd64 package targets. Stable Packages and PGDG PostgreSQL 17 raw hashes remain unchanged, while compressed variants were added; PGDG main, Debian security, and Debian updates package-index hashes/sizes changed. The 13-row refreshed active variant lock is recorded at `release-evidence/trixie-gnupg-package-index-lock.tsv`.

The proposal's exact 14 package name/version/architecture removal tuples still match the previous reviewed purge lock. The APT simulation shows exactly those 14 removals, no installs or upgrades, and no package matching the protected prefixes. The older stable InRelease remains within its configured freshness maximum. The discovery artifact and simulation do not show an actual purge or post-purge runtime result.

## Candidate-only disposition

Independent artifact audit and a separate lock review are complete. `/root/head_artifact_audit` approved freezing this lock for isolated candidate validation only. The reviewer verified all 13 TSV rows against authenticated signed variants; all four lock-file hashes; run, revision, tree, proposal SHA, artifact ID/digest; four release identity/source/hash/size records; and trust hashes. The 14 removal tuples exactly match the signed discovery proposal. The lock binds to proposal SHA-256 `48d3f06bfcaabedbe81373a9e52e680d9110d1206bf9fd75ea0287c765483cee`, discovery run `42753456794` attempt 1, and the artifact above. Its candidate-only disposition records runtime and CVE status `NOT_EVALUATED` and production use `NOT_AUTHORIZED`.

The validator and fixture were updated so future lock refresh reviews can be recorded with a bounded reviewer identifier and canonical, non-future ISO date while preserving the candidate-only/NO-GO invariants. Independent code review approved this change. The focused local validator/discovery test suites pass 82 tests with one skip because local `gpg`/`gpgv` is unavailable. A local attempt to revalidate the captured discovery stops because `gpgv` is not installed here; hosted exact-head CI must perform the signature-backed candidate-lock validation.

This refreshed lock is approved for the next isolated candidate validation step only. It does not grant scanner, CVE, runtime, image-selection, or production clearance. The candidate needs exact-head hosted revalidation and the approved runtime/restore/scan checks. Operational Compose, UAT, and production were not changed.
