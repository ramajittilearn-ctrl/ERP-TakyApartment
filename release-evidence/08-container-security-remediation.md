# Container security remediation — 2026-10-26

## Scope

This candidate refreshes the Node runtime and PostgreSQL bases to pinned Node 22.23.4 Trixie and PostgreSQL 17.11 Trixie OCI index digests. The operations image also pins rclone 1.75.2 by its OCI index digest. The app runtime invokes the bundled Prisma and tsx CLIs directly, allowing global npm/npx to be removed from app and validator images. The operations derivative removes its inherited `gosu`; it uses `ENTRYPOINT []` and runs Node/PostgreSQL client commands directly. The actual PostgreSQL service image retains `gosu` because the official entrypoint requires it.

Operator instructions, remediation harness commands, and compose test/restore images were updated to match these runtime paths and digests. The bulk `node_modules` copy remains root-owned and readable to the unprivileged runtime user; it no longer recursively changes ownership during image assembly.

## Source verification

- `npm run typecheck`: passed.
- `npm test`: 422/422 passed across 36 files.
- `npm run test:ops`: 86/86 passed.
- `npm run lint`: passed.
- `npm run build`: passed with Next.js 16.4.1.
- `git diff --check`: passed.
- Independent Pstack review by `independent_release_audit` confirmed the base digests, gosu scope, and direct CLI paths. Its findings about stale integration-test commands and unpinned rclone were corrected and independently confirmed.

These checks validate the source tree, not a successful runtime for all new images.

## Historical local Docker checks and current limits

The local Docker Desktop observations below predate the hosted PR CI run recorded in the next section. They describe local image build/scan attempts, not the result of that hosted run.

- `taky-phase4-validator:security-review` built successfully for `linux/arm64`. Docker Scout reported 0 Critical, 1 High, 0 Medium, and 0 Low findings. The remaining High finding is Debian Trixie's `zlib` package, CVE-2026-85091, with no fixed version listed by the scanner.
- `taky-phase4-operations:security-review` built successfully for `linux/arm64` from the pinned Node, PostgreSQL and rclone sources, with `gosu` removed from this derivative. The Docker Scout scan ended with `unexpected EOF`; no vulnerability verdict is claimed for this image.
- The app image build completed the Next production build, then failed while copying all `node_modules` because Docker Desktop returned `input/output error` while changing file ownership. Removing recursive ownership changes was followed by a retry, which failed when containerd could not write its metadata database (`meta.db: input/output error`). No app image runtime or final-image scan is verified.
- At the time of failure, the host data volume reported 3.2 GB available (99% used). Docker could not retrieve the image list or `docker system df` because its metadata database returned the same I/O error. No prune, reset, volume deletion, or changes to the running UAT stack were attempted.

The Docker engine/storage condition was not changed as part of this work. The hosted runner supplies isolated candidate image build and smoke evidence. The current-head run also exercises synthetic encrypted backup and isolated restore; it does not replace vulnerability scans, production-target checks, or a source-matched published release. Preserve existing UAT databases and volumes. The candidate remains **NO-GO** for production.

## Isolated GitHub verification path

Current PR #2 workflow run [40321746043](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40321746043) passed `container-verification` on head `b91d2036c34b485840d646ff3c6638e790eceb99`. `scripts/ci/verify-container-images.sh` built pinned app, evidence-validator, and operations images on a fresh `ubuntu-24.04` runner for `linux/amd64`, without registry login or push. It requires a clean checkout, records checkout revision/tree in image labels, and checks runtime CLI files. It starts uniquely named synthetic database/app/validator containers on an internal job network, checks app health and 15 seeded rooms, checks validator health, confirms an invalid token receives HTTP 401, then removes only job resources whose ownership labels match this run. It refuses pre-existing volumes before use. The validator uses its production limits and the app keeps `no-new-privileges`. The labels record the clean checkout used by the job; they are not cryptographic build attestations.

The same job runs `scripts/ci/verify-operations-backup-restore.sh` against the exact checkout-labeled app and operations images from the PR merge checkout `608488fd76be6b78d81fb086a5189e852ec5c59f` (PR head `b91d2036c34b485840d646ff3c6638e790eceb99`). It creates isolated source and restore databases/attachment volumes, seeds 15 synthetic rooms and a file-only attachment fixture, creates an encrypted backup, and invokes `restore-isolated` into the separate target. It verifies the restored room count and fixture SHA-256, including readability as the app's `node` user. It does not create or verify an Attachment metadata row. The run did not scan images for vulnerabilities, prove ARM64 behavior, verify off-device backup/key recovery or production-target safety. The separate `agent-uat` job also passed all 89 synthetic browser checks on this PR head; its source-build scope and report are recorded in `06-final-uat.md`. No registry publication or deployment occurred.
