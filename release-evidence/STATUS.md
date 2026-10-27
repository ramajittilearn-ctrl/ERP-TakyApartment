# Phase 4 Production Readiness

**Latest continuation (2026-10-27):** PR #2 remains OPEN/Draft on `codex/phase4-current-source-20261026`, remote head `1715628a562f809f766840463aabf8c78e49761e`. PR run [40447771982](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40447771982) passed all four jobs. Matching push run [40447766451](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40447766451) passed quality, container verification, and Agent UAT but failed Stage 5 because `pdftotext -bbox-layout` included a one-second `CreationDate` change in the layout comparison. Failure artifact [12709074906](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40447766451/artifacts/12709074906) shows the metadata line was the only layout diff. The local correction removes only that volatile metadata before comparing layout; it is not yet committed or CI-verified.

The previous exact-source checkpoints below are historical evidence for their stated SHAs and runs; they do not describe current-head CI status.

**Prior exact-head snapshot (2026-10-27):** PR #2 was at `e11ef962d0934bf1fd603cd5d15293667fb235f2`. PR run [40439455111](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40439455111) and push run `40439449997` passed all four CI jobs on that earlier SHA. This evidence is historical and does not describe head `1715628`.

The previous exact-source candidate checkpoint is preserved below as historical evidence; the latest exact head and artifact set are summarized above and in `08-container-security-remediation.md`.

**Status: NO-GO for production cutover.** Candidate engineering checks are strong, but production-target and release-publication gates remain open.

**Current candidate:** PR #2, `codex/phase4-current-source-20261026` → `release/phase4`, OPEN/Draft, remote head `1715628a562f809f766840463aabf8c78e49761e`. PR CI passes, but the matching push run exposed a metadata-sensitive Stage 5 assertion failure; its correction is pending exact-head CI. Alpine app/validator/DB scans are clear; Alpine operations and operational Trixie findings remain open. The PR still requires one approving review; protected `release/phase4` and the RC1 tag remain at `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`.

## Verified candidate work

- Historical run `40327186679` passed install, Prisma generation, typecheck, 425/425 unit tests, 87/87 operations tests, lint, and production build on older PR head `6363f22`. Earlier dependency verification recorded `npm audit` with zero vulnerabilities and `fast-uri` pinned to 3.1.9; that dependency audit is separate from the current image-level Trivy scan.
- Historical run `40327186679` on older PR head `6363f22` passed all three jobs. `required-quality` covered typecheck, unit/operations tests, lint, and production build. `container-verification` built pinned app, validator, and operations images on `linux/amd64`; checked runtime CLI availability, app health with 15 seeded rooms, validator health, and HTTP 401 for an invalid validator token; and passed an exact-checkout synthetic encrypted backup plus isolated restore. It checked restored room count and attachment-file SHA-256; the attachment was a file-only fixture, without an Attachment metadata record. The run scanned all three images; see the security report for exact findings. Images were not published.
- On older candidate `3d5db3c`, Stage 5 app runtime passed with fresh synthetic PostgreSQL and all 17 migrations. It verified secure login/session behavior, authorization, a synthetic ฿4,680 invoice, payment/receipt, dashboard/reports, and Thai/baht PDF rendering. The app image was local and source-labeled to that commit/tree.
- On older candidate `3d5db3c`, a separate app/validator run passed health and evidence upload/list/read/download with byte-for-byte hash confirmation; STAFF upload was denied, invalid login and unauthenticated read returned 401. Evidence DELETE is unsupported by the API (422 validation).
- On older candidate `3d5db3c`, the operations image passed manual synthetic backup/restore into separate empty database/attachment volumes: 44 tables, 17 matching migration checksums, and restored evidence bytes with matching SHA-256. A separate bounded weekly scheduler cycle also succeeded locally. No off-device remote is configured; host sleep/restart timing and off-device delivery/key recovery remain unverified.
- Prior exact-source Agent UAT runs `40356454371`, `40360707470`, `40362968827`, `40365071119`, and `40398283420` passed 90/90. Run `40401983977` attempt 2 passed 90/90 on merge checkout `df63cab` and PR head `87c3ec8`. These are synthetic agent-run UAT, not Owner acceptance. Coverage and limits are in `06-final-uat.md`.
- The detailed Stage 7 code audit in `07-independent-audit.md` covers an older candidate. Its latest evidence addenda record runs `40398283420` and `40401983977`; the latter cross-checks source/artifact identity and does not claim a new full code audit. Production NO-GO findings remain open.
- The synthetic restore rehearsal on older candidate `3d5db3c` passed 44 tables, 17 matching migration checksums, and six attachment hashes. It is not proof of current-head or production restore or off-device key recovery; see `03-backup-restore.md`.

## Open gates before any production cutover

1. The exact production host, Docker context, Compose project, canonical HTTPS origin, service ownership, and access model are not established.
2. No owner-designated production database or attachment volume was backed up, cloned, restored, inspected, or migrated. Target migration-history reconciliation and no-seed migration rehearsal are not done.
3. Target-specific rollback, existing-volume permissions, certificate trust, off-device backup/key recovery, and post-deployment checks are unverified.
4. CI built and scanned current source-matched candidates on hosted runners, but no image is published or verified pullable from a deployment host. Latest artifact `12709750001` reports zero findings for Alpine app, validator, and database candidates; Alpine operations has one Medium and one Unknown; operational Trixie DB has 1 Critical/16 High/38 Medium/61 Low/1 Unknown unique IDs. Remaining findings require remediation or explicit risk disposition. See `08-container-security-remediation.md`; production remains NO-GO.
5. Current-head CI proves synthetic backup and isolated restore for candidate images, including Attachment metadata owner/uploader/Tenant linkage and matching file SHA-256. It does not prove application-level download authorization, production target recovery, or off-device recovery. No off-device remote is configured; host sleep/restart scheduling and off-device delivery/key recovery remain unverified. The manual rehearsal and weekly scheduler cycle on `3d5db3c` remain historical evidence.
6. The candidate PR remains draft/unmerged; no source-matched release is published. `release/phase4` protection requires strict `required-quality`, `container-verification`, `stage5-runtime-verification`, and `agent-uat`, plus one approving PR review; stale approvals are dismissed, admins are included, force-push/deletion are blocked, and conversation resolution is enabled. PR run `40447771982` on head `1715628` passed all four jobs. Matching push run `40447766451` failed Stage 5 on a metadata-only layout assertion; the correction is pending a new exact-head CI run. PR approval is also still outstanding.
7. The Owner requested agent-run UAT instead of Owner UAT. Agent UAT passed 90/90; no Owner acceptance is claimed.

## Next executable work

- Keep PR #2 draft while production-specific gates remain open. Rerun the corrected Stage 5 workflow and all required checks on the new exact head. Agent UAT and current image scans are recorded above. Remaining gates are residual image-finding remediation/disposition, production target identification, target-specific recovery and migration/rollback evidence, image publication/pull, and the required independent PR review.
- Manual and one-cycle scheduled backup/restore checks on older source `3d5db3c` remain historical evidence. Do not imply off-device delivery, production target recovery, application-level attachment authorization, or Owner UAT has passed.
- Production remains NO-GO until an actual target is identified and the target-specific backup, migration, rollback, image publication/pull, and deployment authorization gates are satisfied.

## Environment protection

No production deployment, production data mutation, merge into `release/phase4`, or Owner UAT acceptance occurred in this release-preparation work. Existing UAT environments were not used for these isolated runs.
