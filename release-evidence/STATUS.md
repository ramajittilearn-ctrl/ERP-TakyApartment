# Phase 4 Production Readiness

**Latest continuation (2026-10-26):** A container-security remediation is in progress; source checks pass and an independent reviewer has reviewed the design. Exact-image verification is incomplete because Docker Desktop returned storage I/O errors and the host data volume had 3.2 GB free. The new validator image scan reports one High `zlib` CVE without an available fix; operations scanning ended unexpectedly; app runtime image did not finish building. See `08-container-security-remediation.md`. Keep this candidate NO-GO and do not infer runtime verification from source CI.

**Status: NO-GO for production cutover.** Candidate engineering checks are strong, but production-target and release-publication gates remain open.

**Current candidate:** PR #2, `codex/phase4-current-source-20261026` → `release/phase4`; tested application/test source is commit `3d5db3cbae5f16532a3f1e37c7dfe33026c6a966`, tree `aa5cf57c5d1fb90c5eedbdfc9775d494176123bb`. Evidence-only documentation is layered above it. The PR remains OPEN, draft, and CLEAN. GitHub Actions `required-quality` passed for the source baseline and the evidence documentation update. The protected `release/phase4` branch and RC1 tag remain unchanged at `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`.

## Verified candidate work

- Candidate CI passed install, Prisma generation, typecheck, unit tests, operations tests, lint, and production build. On the patched dependency tree, unit tests passed 422/422, operations tests 86/86, typecheck/lint/build passed, and `npm audit` reported zero vulnerabilities. The transitive `fast-uri` dependency is pinned to 3.1.9.
- Stage 5 exact-head app runtime passed with fresh synthetic PostgreSQL and all 17 migrations. It verified secure login/session behavior, authorization, a synthetic ฿4,680 invoice, payment/receipt, dashboard/reports, and Thai/baht PDF rendering. The app image is local and source-labeled to candidate commit/tree.
- A separate exact-head app/validator run passed health and evidence upload/list/read/download with byte-for-byte hash confirmation; STAFF upload was denied, invalid login and unauthenticated read returned 401. Evidence DELETE is unsupported by the API (422 validation).
- The exact-head operations image passed manual synthetic backup/restore into separate empty database/attachment volumes: 44 tables, 17 matching migration checksums, and restored evidence bytes with matching SHA-256. A separate bounded weekly scheduler cycle also succeeded locally. No off-device remote is configured; host sleep/restart timing and off-device delivery/key recovery remain unverified.
- Agent-run browser UAT passed 89/89 on fresh synthetic data and 17 migrations against the exact PR head, with zero failures, skips, retries, or flaky tests. It is not Owner UAT. Coverage and limits are in `06-final-uat.md`.
- An independent Stage 7 release audit reviewed exact-head app/validator/operations images, runtime, CI, branch protection, backup/restore and exact-head UAT. Its verdict remains NO-GO for production; findings are in `07-independent-audit.md`.
- Synthetic restore rehearsal passed 44 tables, 17 matching migration checksums, and six attachment hashes. It is not proof of production restore or off-device key recovery; see `03-backup-restore.md`.

## Open gates before any production cutover

1. The exact production host, Docker context, Compose project, canonical HTTPS origin, service ownership, and access model are not established.
2. No owner-designated production database or attachment volume was backed up, cloned, restored, inspected, or migrated. Target migration-history reconciliation and no-seed migration rehearsal are not done.
3. Target-specific rollback, existing-volume permissions, certificate trust, off-device backup/key recovery, and post-deployment checks are unverified.
4. App, validator, and operations images are local only. No current-candidate image is published to a registry or verified pullable from the deployment host.
5. Exact-head manual backup/restore and one weekly local scheduler cycle passed. No off-device remote is configured; host sleep/restart scheduling, off-device delivery/key recovery, and production target recovery remain unverified.
6. The candidate PR remains draft/unmerged; no source-matched release is published. Branch protection requires strict `required-quality`, enforces admins, and prevents force-push/deletion; the configured required-approval count is zero. An independent review is separately recorded.
7. Agent UAT is not Owner UAT; no Owner acceptance is claimed.

## Next executable work

- The independent cross-review of exact-head validator, operations, and UAT evidence is complete and recorded. Commit and push the reviewed release-evidence/checkpoint updates to the candidate branch, then confirm CI; keep PR #2 draft while production-specific gates remain open.
- Exact-head manual and one-cycle scheduled backup/restore checks plus browser UAT passed on synthetic isolated resources. Do not imply off-device delivery, production target recovery, or Owner UAT has passed.
- Production remains NO-GO until an actual target is identified and the target-specific backup, migration, rollback, image publication/pull, and deployment authorization gates are satisfied.

## Environment protection

No production deployment, production data mutation, merge into `release/phase4`, or Owner UAT acceptance occurred in this release-preparation work. Existing UAT environments were not used for these isolated runs.
