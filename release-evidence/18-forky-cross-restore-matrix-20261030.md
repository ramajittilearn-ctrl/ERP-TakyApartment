# Forky same-run image and cross-version restore verification — 2026-10-30

## Result and exact-head bindings

The active candidate PR #2 remains open and unmerged. PR run [41000173875](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41000173875) and push run [41000168916](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41000168916) both completed successfully at head `2f164547b8f010ab95108a27aa243bda6aea5470`. All eight workflow jobs passed, including required quality, Stage 5, synthetic Agent UAT, provenance, candidate builds, and container verification.

The PR container-scan artifact is [12953258414](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41000173875/artifacts/12953258414), digest `sha256:fefa301e79718448f579bf1ee59a4a6b69d57b209baba53d8fa791781813b54d`, size 145,235,415 bytes. The exact Forky Docker image artifact is [12952968679](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41000173875/artifacts/12952968679), digest `sha256:490d66610dddb250f6b530051f91dc88e0ba20a8013ac1bc06f6d45aa0286109`, size 273,917,245 bytes. It was produced in the same run as Stage 5 and consumed by `container-verification`; provenance, digest, archive SHA-256, image ID, source revision/tree, pinned base and candidate labels were checked before and after Docker load.

Independent artifact review passed. It verified artifact 12953258414 belongs to run 41000173875/head `2f164547b8f010ab95108a27aa243bda6aea5470`, and `restore-matrix.txt` SHA-256 `551772d2ec90edf1a7fbb645d9d11c86c9b0494849fae3d1505aed7c006d4da5` contains the eight expected routes. The reviewer matched the Forky target image and manifest/archive/inspect hashes, and confirmed PostgreSQL version, extension and collation evidence for both Forky routes.

## Cross-restore results

The shared application backup/restore harness passed all eight configured routes. The exact route logs report source and target image IDs:

| Source → target | Source image ID | Target image ID | Result |
| --- | --- | --- | --- |
| Trixie → Trixie candidate | `sha256:82903352d6faf8f8a318bc4353d1cb1db67d4a5ff968d2799b2718e2cb00afa2` | `sha256:f2f772148e4b65dfe1a98011a35062da095cbff7b25228a4e9aa0df74155eb33e` | PASS |
| Trixie → Trixie GnuPG-prune candidate | `sha256:82903352d6faf8f8a318bc4353d1cb1db67d4a5ff968d2799b2718e2cb00afa2` | `sha256:7de8eb230d3d058e134c0e706b65bf044f267a42b98f0768164e436d751285fb` | PASS |
| Trixie → Bookworm candidate | `sha256:82903352d6faf8f8a318bc4353d1cb1db67d4a5ff968d2799b2718e2cb00afa2` | `sha256:24d900ad092cab69ac79b534eee07b7499e1c4f586496543604fe50094aded57` | PASS |
| Bookworm → Trixie candidate | `sha256:e4bdd2f9eeabc0f516e1fa42c4acea97ae571f20877982ac082921b205a52618` | `sha256:f2f772148e4b65dfe1a98011a35062da095cbff7b25228a4e9aa0df74155eb33e` | PASS |
| Bookworm → Trixie GnuPG-prune candidate | `sha256:e4bdd2f9eeabc0f516e1fa42c4acea97ae571f20877982ac082921b205a52618` | `sha256:7de8eb230d3d058e134c0e706b65bf044f267a42b98f0768164e436d751285fb` | PASS |
| Bookworm → Bookworm candidate | `sha256:e4bdd2f9eeabc0f516e1fa42c4acea97ae571f20877982ac082921b205a52618` | `sha256:24d900ad092cab69ac79b534eee07b7499e1c4f586496543604fe50094aded57` | PASS |
| Trixie → Forky PGDG candidate | `sha256:82903352d6faf8f8a318bc4353d1cb1db67d4a5ff968d2799b2718e2cb00afa2` | `sha256:00fe2d30c5043b429caadb6b8f886e174163c7a38ce4c9a5bf61f68adb280800` | PASS |
| Bookworm → Forky PGDG candidate | `sha256:e4bdd2f9eeabc0f516e1fa42c4acea97ae571f20877982ac082921b205a52618` | `sha256:00fe2d30c5043b429caadb6b8f886e174163c7a38ce4c9a5bf61f68adb280800` | PASS |

Before running routes, the workflow explicitly pulled the digest-pinned Trixie and Bookworm source images for `linux/amd64`, checked each reported repository digest, platform and stable image ID, and checked those IDs again at route time. This fixes the previously observed missing Bookworm source image in the runner.

For both Forky targets, the verifier required PostgreSQL `17.11` and `server_version_num=170011`, compared installed extension names and versions after restore, and persisted source/target collation provider, locale, ctype and recorded/actual collation versions. Logs show 15 synthetic rooms, attachment owner links and matching attachment SHA-256 `68e533fab04c85212338f91bd9dc0acf508f772764fea84333f966cd7275ffd4`, 19-value collation ordering/pairwise comparison probes, valid rebuilt indexes and an executed collation index returning all 19 rows. The encrypted backup was uploaded to a run-local synthetic remote, read back and restored. The Forky routes report source collation versions `2.41` (Trixie) and `2.36` (Bookworm), and target version `2.43`.

This proves the finite synthetic restore paths exercised on these exact images. It does not prove compatibility for every production dataset or replace a target-matched backup/restore and rollback rehearsal.

## Release disposition and next work

The candidate's application checks passed, but this evidence does not select a production database image, clear the raw security findings, or authorize publication, deployment or Go-Live. PR #2 is still `OPEN`, `REVIEW_REQUIRED`, and merge-blocked. The latest container scan retains raw Debian database Critical/High findings; see [the exact scan refresh](17-container-scan-refresh-20261030.md). Production remains **NO-GO** until security disposition, independent GitHub approval, production target/registry identity, target-matched recovery and migration rollback, publication/deployment authorization and post-deployment evidence are complete. Agent UAT passed synthetically; no Owner acceptance is claimed.
