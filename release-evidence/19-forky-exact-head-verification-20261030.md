# Exact-head Forky candidate and restore verification — 2026-10-30

## Result and source binding

PR #2 targets protected `release/phase4` and remains OPEN / REVIEW_REQUIRED / BLOCKED. The PR head `f2e50b9662b9c83eba07f0642641fbe0703dac31` is a documentation-only commit on top of the reviewed Forky candidate implementation. PR run [41005172907](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41005172907) and push run [41005168490](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41005168490) both passed all eight jobs. The Stage 5 report binds the PR head to merge checkout `da9c894ed0d0de24372bd9c5eb7befcbca98f2d8` and tree `9fc92a7a7d6a0b69c64ef2a3a2b453749bbbab23`.

Independent agent `head_artifact_audit` reviewed the exact-head artifacts and found no artifact-binding or restore-matrix integrity defects. It verified the run/head bindings, matrix copies, Stage 5 financial evidence, Forky target identity, and remaining candidate-only gates.

## Exact run artifacts

| Artifact | ID | SHA-256 digest |
| --- | ---: | --- |
| Stage 5 runtime | [12954739921](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41005172907/artifacts/12954739921) | `sha256:bf121208fd307ef3205622f15740492f61d0689b642cba6fc0c1a604d470298f` |
| Synthetic Agent UAT | [12954889818](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41005172907/artifacts/12954889818) | `sha256:d8a553e98f8e2df67f7045e07e3618e07de0922dd9ae057a6e179a12acd19e77` |
| Forky candidate image | [12954803810](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41005172907/artifacts/12954803810) | `sha256:5b1e2bca4442261d6a88bff2f60e8f84ae462aa57825b2b7406de49126b49e81` |
| Forky candidate evidence | [12955029791](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41005172907/artifacts/12955029791) | `sha256:c6adfd91a48fb98202a52b718014a24473edadae921482ab1d49200df6a7c671` |
| Container scan and restore matrix | [12955638672](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41005172907/artifacts/12955638672) | `sha256:6720748594d0d57182d7afdbf09dc13b88efa029e0a9b5a20c484d347432dd9b` |
| libxml2 source provenance | [12955272335](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41005172907/artifacts/12955272335) | `sha256:2d4c68558c695a21de5514a4d4d82b1dc45518363a356b3b9d914d0a79c9cf58` |

## Functional and restore results

- Stage 5 passed 52 checks and 17 migrations, with no failures. The synthetic tenant's entered rent `1000.00` persisted. Invoice, payment, and receipt totals reconcile at `1050.01` with an explicit `-0.01` rounding adjustment row.
- The embedded and uploaded restore matrices are byte-identical with SHA-256 `4c48173cfdfc4e75f16b1cf4a43b5cd93dedf0a6c66435b88b527075d8b9ca2d`. All eight routes passed: Trixie and Bookworm sources to Trixie, GnuPG-pruned Trixie, Bookworm, and Forky targets.
- Both source-to-Forky routes used the same target image ID `sha256:d4163fd7eb1f91e9a4f0cce6121a8e82d3510b60a8e1f72a14afd608cb3a75a3`. The routes preserved PostgreSQL 17.11 and extension versions, and recorded collation evidence. Synthetic restore checks verified 15 rooms, attachment owner links and SHA-256 `68e533fab04c85212338f91bd9dc0acf508f772764fea84333f966cd7275ffd4`, rebuilt indexes, and a collation index returning 19 rows.
- The candidate finalizer reports candidate validation PASS and `candidateOnly=true`. Its runtime, provenance, gosu `govulncheck`, restore, and Stage 5 checks passed. The exact-run Trivy assertion is scoped to `/usr/local/bin/gosu` (`gosuTrivyNoCriticalHigh=true`); it does not establish image-wide scan clearance. This finite synthetic matrix is not production-wide compatibility proof.
- Synthetic Agent UAT passed on isolated CI with no production data. It is not a claim that production behavior was tested or that Owner UAT occurred.

## Raw scan and security disposition

Raw Trivy reports remain preserved. Exact-head counts are Bookworm database **2 Critical / 66 High**, Trixie database **1 Critical / 61 High**, Trixie GnuPG-pruned database **1 Critical / 54 High**, and one Operations finding. The exact-run Forky finalizer confirms no Critical/High finding in the gosu binary target only; the image-wide Forky raw report was not independently inspected in this audit. Candidate evidence deliberately leaves `scannerClearance`, `cveDisposition`, `imageSelection`, and `productionClearance` false.

Debian's current [CVE-2026-76642 tracker](https://security-tracker.debian.org/tracker/CVE-2026-76642) lists Trixie `util-linux 2.41.5-0+deb13u1` as vulnerable; DSA-6442-1 covers different CVEs and does not clear this finding. Debian also lists Trixie's `libxml2` vulnerable for [CVE-2026-6653](https://security-tracker.debian.org/tracker/CVE-2026-6653), and Trixie's `util-linux` vulnerable for [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) and [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409). These are not Owner risk acceptance or overall scanner clearance.

## Remaining release gates

- PR #2 requires one independent GitHub approving review; none is recorded.
- Security findings need a supported remediation or explicit disposition before production image selection.
- No exact production host/registry is attested; the repository has no configured GitHub deployment environment or production deployment workflow.
- Target-matched encrypted backup/restore and migration/rollback rehearsal, immutable image publication and target pull, authorized deployment, and post-deployment evidence remain outstanding.

No protected branch, production image, production environment, or existing UAT volume was changed. Production remains **NO-GO**.
