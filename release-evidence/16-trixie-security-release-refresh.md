# Trixie signed metadata and package-index lock — follow-up

## Why the lock changed

Exact-head CI on PR #2 at `fe128e4554e5471137a1bba191f0efc85550cabf` failed closed when the signed Trixie security `InRelease` digest changed. Re-pinning a whole `InRelease` digest would make routine signed metadata refreshes fail even when the authenticated package indexes and suite identity remain stable.

The candidate lock now binds the four approved Release identities, suite-scoped source roots, bounded Release freshness policy, and the complete signed SHA-256/size map for every active APT Packages target. The candidate still fails closed on signature, Origin/Codename/Suite, source/trust, package-index, target, purge tuple, or simulation drift. The Debian stable base suite has a 90-day maximum Release age and 60-day warning; security, updates and PGDG have 7-day maximum and 6-day warning. Every Release Date is mandatory, future skew is limited to five minutes, and any Valid-Until must parse and remain valid. This is a candidate-only replay bound; it is not proof that repositories are current or security-cleared.

## Source evidence and lock verification

- Hosted PR run [40909208002](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40909208002), attempt 1, used PR merge checkout `a3b89afae140a78a0f329896647d49f20dd24035`.
- Container evidence artifact [12912128356](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40909208002/artifacts/12912128356), ZIP SHA-256 `c6b0ec0c42665d27480be56750bc83a5c4d4e75312a5056dacc60e85ee2dc7d1`; discovery proposal SHA-256 `ed6b0d24a278b78d03a6677833d45d806837469907d80cc3572ae5aa7d3f8189`.
- The artifact's 84 evidence hashes validate. Hosted gpgv accepted all four signatures with return code 0 and the expected suite/signing identities. The 13 locked Packages path/hash/size rows were independently compared with the corresponding signed InRelease SHA256 sections; all 13 matched.
- The package lock still has the exact 14 reviewed removals and simulation SHA-256 `293214c4d06c49c54de48dbf8815fe2f30ada5ab2f03447ff167cc1e83f6b009`. Trust/source/keyring locks and protected-package constraints remain in force.
- Independent reviewer `trixie_candidate_review` found no actionable findings after the implementation fixes. The Docker candidate binds each active APT URI to exact Base-URI plus canonical MetaKey, compares the full signed index map, and excludes `Packages.diff/Index`.

## Verification and remaining work

Local focused verification passes: 80 tests across the discovery and evidence-validator suites (one skipped because local gpg/gpgv is unavailable), Python compilation, Docker RUN shell syntax, all lock-file SHA-256 values, and a replay of the Docker signed-index filter against the four artifact InRelease files. That replay produced exactly the 13 locked rows and excluded `Packages.diff/Index`.

The current hosted artifact predates the new discovery schema, so it cannot validate the changed proposal format. A fresh hosted discovery and exact-head candidate build are required after these reviewed changes are committed to the existing PR branch. No local Docker daemon is available. In run 40909208002, required quality, Stage 5 runtime, Agent UAT (90 passed, 0 failed/skipped/flaky), libxml2 source provenance/candidate, and Forky/PGDG provenance succeeded; only container verification failed on the prior exact InRelease digest check.

This change does not clear the raw Critical/High findings, authorize image publication, or authorize production use. PR #2 remains unmerged with GitHub approval required. Production remains **NO-GO**.
