# Phase 4 Production Readiness

**Latest continuation (2026-10-26):** PR #2 head `6363f2248cd986ebbb980e7b7dddcb28c941b674` passed all three jobs (`required-quality`, `container-verification`, and `agent-uat`) in [Phase 4 CI run 40327186679](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40327186679). Agent UAT artifact [12654990734](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40327186679/artifacts/12654990734) reports 90 passed, zero failed, skipped, or flaky; it used isolated synthetic browser testing of source-built merge checkout `c4fa83fa182a4fd60c7d0c140769f9d451be8363`, with PR head `6363f2248cd986ebbb980e7b7dddcb28c941b674`. This is agent-run UAT, not Owner UAT or production verification. Container verification built pinned images on `linux/amd64`, checked app health/15 seeded rooms and validator health/invalid-token rejection, and exercised encrypted backup plus isolated restore using the same checkout-labeled app and operations images. It verified restored room count and a synthetic attachment file hash; the fixture is file-only and does not verify an Attachment metadata row. Trivy scanned all three current-checkout images; findings are report-only and include Critical/High issues (details in `08-container-security-remediation.md`). No images were published. See `06-final-uat.md` and `08-container-security-remediation.md` for scope and limits.

**Status: NO-GO for production cutover.** Candidate engineering checks are strong, but production-target and release-publication gates remain open.

**Current candidate:** PR #2, `codex/phase4-current-source-20261026` → `release/phase4`; PR head is `6363f2248cd986ebbb980e7b7dddcb28c941b674`. It remains OPEN and draft. Run `40327186679` passed all three Phase 4 CI jobs. Agent UAT used merge checkout `c4fa83fa182a4fd60c7d0c140769f9d451be8363`, with PR head recorded in its report. The protected `release/phase4` branch and RC1 tag remain unchanged at `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`.

## Verified candidate work

- Current-head run `40327186679` passed install, Prisma generation, typecheck, 425/425 unit tests, 87/87 operations tests, lint, and production build. Earlier dependency verification recorded `npm audit` with zero vulnerabilities and `fast-uri` pinned to 3.1.9; that dependency audit is separate from the current image-level Trivy scan.
- On current PR head `6363f22`, run `40327186679` passed all three jobs. `required-quality` covered typecheck, unit/operations tests, lint, and production build. `container-verification` built pinned app, validator, and operations images on `linux/amd64`; checked runtime CLI availability, app health with 15 seeded rooms, validator health, and HTTP 401 for an invalid validator token; and passed an exact-checkout synthetic encrypted backup plus isolated restore. It checked restored room count and attachment-file SHA-256; the attachment was a file-only fixture, without an Attachment metadata record. The run scanned all three images; see the security report for exact findings. Images were not published.
- On older candidate `3d5db3c`, Stage 5 app runtime passed with fresh synthetic PostgreSQL and all 17 migrations. It verified secure login/session behavior, authorization, a synthetic ฿4,680 invoice, payment/receipt, dashboard/reports, and Thai/baht PDF rendering. The app image was local and source-labeled to that commit/tree.
- On older candidate `3d5db3c`, a separate app/validator run passed health and evidence upload/list/read/download with byte-for-byte hash confirmation; STAFF upload was denied, invalid login and unauthenticated read returned 401. Evidence DELETE is unsupported by the API (422 validation).
- On older candidate `3d5db3c`, the operations image passed manual synthetic backup/restore into separate empty database/attachment volumes: 44 tables, 17 matching migration checksums, and restored evidence bytes with matching SHA-256. A separate bounded weekly scheduler cycle also succeeded locally. No off-device remote is configured; host sleep/restart timing and off-device delivery/key recovery remain unverified.
- Current-head CI Agent UAT passed 90/90 with zero failures, skips, or flaky tests. It used an isolated synthetic browser run against source-built merge checkout `c4fa83f`, and the report binds it to PR head `6363f22`. It is agent-run UAT, not Owner acceptance. Coverage and limits are in `06-final-uat.md`.
- The Stage 7 independent audit in `07-independent-audit.md` covers an older candidate head and is historical pending a current-head audit. Its recorded NO-GO findings remain useful as open risks, not as verification of the current head.
- The synthetic restore rehearsal on older candidate `3d5db3c` passed 44 tables, 17 matching migration checksums, and six attachment hashes. It is not proof of current-head or production restore or off-device key recovery; see `03-backup-restore.md`.

## Open gates before any production cutover

1. The exact production host, Docker context, Compose project, canonical HTTPS origin, service ownership, and access model are not established.
2. No owner-designated production database or attachment volume was backed up, cloned, restored, inspected, or migrated. Target migration-history reconciliation and no-seed migration rehearsal are not done.
3. Target-specific rollback, existing-volume permissions, certificate trust, off-device backup/key recovery, and post-deployment checks are unverified.
4. CI built and scanned candidate images on a hosted runner, but no current-candidate image is published to a registry or verified pullable from the deployment host. The report-only scan found one Critical CVE in operations and High CVEs across images; production remains NO-GO pending verified remediation or an explicit risk disposition.
5. Current-head CI now proves synthetic backup and isolated restore for the candidate images, but not attachment metadata linkage, production target recovery, or off-device recovery. No off-device remote is configured; host sleep/restart scheduling and off-device delivery/key recovery remain unverified. The manual rehearsal and weekly scheduler cycle on `3d5db3c` remain historical evidence.
6. The candidate PR remains draft/unmerged; no source-matched release is published. Branch protection requires strict `required-quality`, enforces admins, and prevents force-push/deletion; the configured required-approval count is zero. An independent review is separately recorded.
7. Agent UAT is not Owner UAT; no Owner acceptance is claimed.

## Next executable work

- Independently review the refreshed current-head release evidence, including exact-current-head operations backup/restore and vulnerability disposition; keep PR #2 draft while production-specific gates remain open.
- Current-head Agent UAT (90/90), hosted container checks, and report-only vulnerability scan passed as CI steps. Older-head manual and one-cycle scheduled backup/restore checks remain historical evidence. Do not imply off-device delivery, production target recovery, or Owner UAT has passed.
- Production remains NO-GO until an actual target is identified and the target-specific backup, migration, rollback, image publication/pull, and deployment authorization gates are satisfied.

## Environment protection

No production deployment, production data mutation, merge into `release/phase4`, or Owner UAT acceptance occurred in this release-preparation work. Existing UAT environments were not used for these isolated runs.
