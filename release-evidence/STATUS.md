# Phase 4 Production Readiness

**Latest continuation (2026-10-26):** PR #2 head `573bbed8e9ba48dcdba115095457d32426f1a124` passed all three jobs in [Phase 4 CI run 40317435858](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40317435858): `required-quality`, `container-verification`, and `agent-uat`. The source-bound Agent UAT report and result files are in [artifact 12648590286](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40317435858/artifacts/12648590286); it reports 89 passed, zero failed, skipped, or flaky tests. This was isolated synthetic browser UAT of a source-built app, not Owner UAT or production verification. Container verification built the pinned images on `linux/amd64` and smoke-checked app health/15 seeded rooms and validator health/invalid-token rejection; it did not publish images, scan them for vulnerabilities, or verify operations backup/restore. Local Docker Desktop image build and scan failures below are historical local-environment findings. See `06-final-uat.md` and `08-container-security-remediation.md` for scope and limits.

**Status: NO-GO for production cutover.** Candidate engineering checks are strong, but production-target and release-publication gates remain open.

**Current candidate:** PR #2, `codex/phase4-current-source-20261026` → `release/phase4`; PR head is `573bbed8e9ba48dcdba115095457d32426f1a124` (tree `c3c4b5fb8855a19d551ae25fc41fc972723d30c5`). It remains OPEN, draft, and CLEAN. Run `40317435858` passed all three Phase 4 CI jobs. Agent UAT checked out merge commit `945a409022f22cf1e94c899e25fe55a60727fa38`, with the PR head explicitly recorded as `573bbed8e9ba48dcdba115095457d32426f1a124`. The protected `release/phase4` branch and RC1 tag remain unchanged at `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`.

## Verified candidate work

- Candidate CI passed install, Prisma generation, typecheck, unit tests, operations tests, lint, and production build. On the patched dependency tree, unit tests passed 422/422, operations tests 86/86, typecheck/lint/build passed, and `npm audit` reported zero vulnerabilities. The transitive `fast-uri` dependency is pinned to 3.1.9.
- Phase 4 CI run `40317435858` passed `required-quality`, `container-verification`, and `agent-uat` on the PR merge checkout. Container verification built the app, validator, and operations images on `linux/amd64`; it checked runtime CLI availability, app health with 15 seeded rooms, validator health, and HTTP 401 for an invalid validator token. Images were not published and the workflow did not perform vulnerability scans or backup/restore.
- On older candidate `3d5db3c`, Stage 5 app runtime passed with fresh synthetic PostgreSQL and all 17 migrations. It verified secure login/session behavior, authorization, a synthetic ฿4,680 invoice, payment/receipt, dashboard/reports, and Thai/baht PDF rendering. The app image was local and source-labeled to that commit/tree.
- On older candidate `3d5db3c`, a separate app/validator run passed health and evidence upload/list/read/download with byte-for-byte hash confirmation; STAFF upload was denied, invalid login and unauthenticated read returned 401. Evidence DELETE is unsupported by the API (422 validation).
- On older candidate `3d5db3c`, the operations image passed manual synthetic backup/restore into separate empty database/attachment volumes: 44 tables, 17 matching migration checksums, and restored evidence bytes with matching SHA-256. A separate bounded weekly scheduler cycle also succeeded locally. No off-device remote is configured; host sleep/restart timing and off-device delivery/key recovery remain unverified.
- The current CI Agent UAT report passed 89/89 with zero failures, skips, or flaky tests. It used an isolated synthetic browser run against the source-built PR merge checkout; the artifact records checkout `945a409` and PR head `573bbed`. It is not Owner UAT. Coverage and limits are in `06-final-uat.md`.
- The Stage 7 independent audit in `07-independent-audit.md` covers an older candidate head and is historical pending a current-head audit. Its recorded NO-GO findings remain useful as open risks, not as verification of the current head.
- The synthetic restore rehearsal on older candidate `3d5db3c` passed 44 tables, 17 matching migration checksums, and six attachment hashes. It is not proof of current-head or production restore or off-device key recovery; see `03-backup-restore.md`.

## Open gates before any production cutover

1. The exact production host, Docker context, Compose project, canonical HTTPS origin, service ownership, and access model are not established.
2. No owner-designated production database or attachment volume was backed up, cloned, restored, inspected, or migrated. Target migration-history reconciliation and no-seed migration rehearsal are not done.
3. Target-specific rollback, existing-volume permissions, certificate trust, off-device backup/key recovery, and post-deployment checks are unverified.
4. CI built candidate images on a hosted runner, but no current-candidate image is published to a registry or verified pullable from the deployment host.
5. Manual backup/restore and one weekly local scheduler cycle were verified on the older `3d5db3c` candidate, not the current `573bbed` head. No off-device remote is configured; host sleep/restart scheduling, off-device delivery/key recovery, current-head operations restore, and production target recovery remain unverified.
6. The candidate PR remains draft/unmerged; no source-matched release is published. Branch protection requires strict `required-quality`, enforces admins, and prevents force-push/deletion; the configured required-approval count is zero. An independent review is separately recorded.
7. Agent UAT is not Owner UAT; no Owner acceptance is claimed.

## Next executable work

- Refresh and independently review the current-head release evidence, including exact-current-head operations backup/restore and vulnerability disposition; keep PR #2 draft while production-specific gates remain open.
- Current synthetic Agent UAT and hosted container smoke checks passed. Older-head manual and one-cycle scheduled backup/restore checks remain historical evidence. Do not imply off-device delivery, production target recovery, or Owner UAT has passed.
- Production remains NO-GO until an actual target is identified and the target-specific backup, migration, rollback, image publication/pull, and deployment authorization gates are satisfied.

## Environment protection

No production deployment, production data mutation, merge into `release/phase4`, or Owner UAT acceptance occurred in this release-preparation work. Existing UAT environments were not used for these isolated runs.
