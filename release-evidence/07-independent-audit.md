# Stage 7 — Independent Release Audit

**Verdict: NO-GO for production cutover.** The exact current PR head has a successful local synthetic runtime rehearsal and required GitHub CI. Production target readiness, target-specific recovery and migration evidence, and publication of a source-matched release remain unverified.

**Audit date:** 2026-10-26  
**Audited candidate:** PR #2, `codex/phase4-current-source-20261026`, commit `3d5db3cbae5f16532a3f1e37c7dfe33026c6a966`, tree `aa5cf57c5d1fb90c5eedbdfc9775d494176123bb`.

## Evidence inspected

- Release evidence `01` through `06`, current Stage 5 private summaries and selected nonsecret probe fields, plus the local PDF renderings. I did not read credentials, auth/session traces, raw browser logs, or private key material.
- GitHub PR #2 and its remote branch: PR is OPEN, draft, CLEAN, and its head matches `3d5db3c`. Required check `Phase 4 CI / required-quality` completed successfully for this exact head. PR #1 remains open; no merge was observed.
- GitHub release branch/tag: `release/phase4` and peeled tag `phase4-2026-10-26-rc1` remain at `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`. The release remains draft/prerelease. It does not identify the current PR head as the released candidate.
- Branch protection for `release/phase4`: strict required status check `required-quality`; force pushes and deletion disabled; admin enforcement enabled. Required approving review count is **0**.
- Exact-head Stage 5 evidence: `.local/runtime-uat/stage5-3d5db3c-161958/runtime-summary.json`, `pdf-probe-summary.json`, `dashboard-report-probe.json`, and `image-inventory.json`. These are ignored local evidence, not published release assets.
- Exact-head evidence-validator runtime: `.local/runtime-uat/stage5-evidence-3d5-170742/runtime-summary.json` and `probe-results.json` (0600). The exact-head validator digest is `sha256:b234353c2388124b721af499a5251b90804e8d965f71959e29513ea43404aaa4`, labeled with the same `3d5db3c` revision and `aa5cf57…` source tree as the PR head.
- Exact-head operations backup/restore runtime: `.local/runtime-uat/stage5-ops-3d5-093500/runtime-summary.json`, private backup history record, restore receipt, and `evidence-result.json`. The archive itself and copied restore archive are private synthetic evidence. I inspected only selected checksums, counts, identity, and outcome fields; no key or environment values were read.
- Exact-head browser UAT: `evidence/remediation/browser-f12e112e99231c0a470e3171/results.json` in the clean PR-head clone, plus the updated `release-evidence/06-final-uat.md`. I inspected the JSON stats and report, not raw browser logs or traces.
- Independent image inspection confirmed the app image ID `sha256:b06913e27e4d3565b671d74189ec0c57de6d5e56448f13d90899e5849dba83a7`, OCI revision `3d5db3c…`, tree `aa5cf57…`, and `fast-uri@3.1.9` from inside the image. GitHub's commit API reports the same source tree for the PR head.

## Verified for the local candidate

- Compose configuration passed. A fresh synthetic PostgreSQL database received all 17 migrations explicitly before app startup. App, database, validator, and Caddy became healthy; authenticated access worked, unauthenticated rooms access returned 401, and the session cookie was Secure, HttpOnly, and SameSite=Strict.
- Synthetic invoice `INV-202610-0001` for room 305 totaled **฿4,680.00**; payment was confirmed and receipt `REC-202610-0001` was downloaded. Both PDFs had valid headers/EOF, were one A4 page, and the independently inspected renders show readable Thai text and baht glyphs. Dashboard and monthly reports pages and APIs returned 200 and reflected the synthetic invoice/payment totals and six-month trend.
- The exact-head app image is local only and unpublished. The initial exact-head app runtime used the pinned RC1 validator image and did not start the operations scheduler. Separate exact-head validator and operations checks are recorded below. The operations image build did not include a dedicated OS vulnerability scan.
- A separate exact-head app/current-validator run explicitly applied 17 migrations to a fresh synthetic database. Admin evidence upload returned 201; listing and reading returned 200; download returned 200 with the same 32,546 bytes and SHA-256 as the upload. Unauthenticated read returned 401. STAFF read returned 200 and STAFF upload returned 403. A DELETE probe against the generic resource route returned 422 VALIDATION because `deposit-evidence` is not in that route's resource enum; the evidence remained listed. The exact-head API has no `deposit-evidence/[id]/route.ts` DELETE handler. This is consistent with retained evidence being non-deletable through the API; no direct DB or storage mutation was attempted.
- The validator run started only database, app, validator, and Caddy; operations was never started. Cleanup evidence records zero run containers/networks, no listener on port 45447, generated credentials removed, and four fresh run volumes retained. Independent Docker inspection confirmed those four volumes and found no remaining run containers/networks or port listener.
- The exact-head operations image `sha256:9a03cde45ce44892ba9bd96f01e8ef491652ae365907df7e0f59d1447a2679ea` independently inspected with OCI labels matching commit `3d5db3c…` and tree `aa5cf57…`. A manual backup of fresh synthetic data succeeded: the 51,389-byte archive's independently recomputed SHA-256 is `9f69a21bb1617835a5403ecd1daae9c348dd89ac4aab9ec3a12f317c7b0dcf53`, matching both the backup history record and restore receipt. The copied archive hash and size also match.
- Restore ran in a separate new PostgreSQL 17 database and attachment volume, with no source DB/files mounted. The receipt records inventory version 5, 44 tables, and 17 migrations; all 17 receipt migration checksums independently match the exact-head migration SQL files. It records 15 rooms, one synthetic tenant, one lease, one Attachment, one DepositEvidence, and one attachment content hash. A read-only probe of the restored attachment matched the original 32,546-byte evidence file's SHA-256 (`dd0a702f…`). No production or existing UAT resources were mounted or modified.
- Backup history is `SUCCEEDED`; remote upload was unavailable because no Google Drive remote was configured. The scheduler was never started; only explicit manual backup and isolated-restore jobs ran. Restore's first attempt exited 73 before import because the disposable copied-archive directory was read-only and could not hold `.job.lock`. One corrected retry made only the disposable archive/receipt copy writable, kept the encryption key read-only, and passed. This was a bounded setup correction, not a repeated backup failure.
- Cleanup records zero run containers/networks, port 45448 free, generated secrets removed, and six fresh source/restore volumes retained. Independent Docker inspection confirmed all six volume names, no remaining containers/networks, and no listener on the port.
- The isolated run removed its four containers and three networks, confirmed the port free, removed generated credentials, and retained four fresh run-specific volumes. It did not modify existing UAT or production volumes.
- Exact-head agent browser UAT run `f12e112e99231c0a470e3171` used commit `3d5db3c…` / tree `aa5cf57…`; the clone has no app/test source diff. Its machine-readable Playwright result reports 89 expected, zero unexpected, zero skipped, zero flaky, zero errors, zero retries, one worker, and 198.4 seconds. `06-final-uat.md` reports a fresh isolated DB/role, 17 migrations, 15 synthetic rooms, and cleanup. Independent Docker checks found no run containers/networks or listeners on ports 3820, 3822, or 55452, and only the new run-specific database volume retained. This is agent-run synthetic UAT, not Owner UAT. Existing coverage limits in `06` remain: the browser PDF assertions do not extract Thai glyphs, and monthly report CSV download is not asserted. Exact-head runtime PDF visuals were inspected separately.

## Findings

### BLOCKER — Production target and target-specific safety evidence are absent

The exact production host, Docker context, Compose project, canonical HTTPS origin, and access model are not established. No owner-designated database or attachment volume has been backed up, cloned, restored, or migrated. Migration history/checksums, existing attachment permissions, rollback, certificate trust on owner devices, off-device backup/key recovery, and post-deployment checks are therefore unverified. The inspected local `taky-erp` database is only a development candidate and has 23 public tables/3 migrations versus the Phase 4 source's 44 models/17 migrations; it is not evidence about the production target. Do not deploy against it by assumption.

### BLOCKER — The current candidate is not the published/release branch candidate

PR #2 is still a draft and unmerged. The protected release branch and RC1 tag still point to `89a15a1…`, not `3d5db3c…`; current-head images are not published and deployment-host pullability is unknown. The successful local run is not a release publication or deployment. A source-matched reviewed release artifact and registry availability are required before a cutover can be staged safely.

### HIGH — Scheduled and off-device backup delivery are unverified

The exact-head operations image's manual local backup and isolated restore passed with checksummed synthetic content. However, its scheduler was intentionally not run, and no off-device remote is configured (`Google Drive remote is not configured`). This proves neither scheduled-job behavior nor off-device delivery/key recovery. Continue to require those checks for the designated production setup. The earlier RC1 synthetic restore does not substitute for target recovery.

### MEDIUM — First exact-head restore attempt needed one safe configuration correction

The first restore attempt exited 73 before import because a copied archive directory mounted read-only could not hold the restore lock file. The single retry changed write permission only on the disposable archive/receipt copy; the encryption key remained read-only, and restore passed. No source or production data was changed. Preserve this correction in the isolated-run procedure and validate read-only key mounting on the actual intended restore command.

### MEDIUM — Release branch protection does not require a human approval

GitHub enforces the required CI check and strict up-to-date branches, and prevents force-push/deletion, but the required approving review count is 0. An independent review was performed for this audit; platform policy does not require an approver before merging. Record an explicit reviewer approval or raise the branch's review requirement before treating the branch rules as a human signoff gate.

### MEDIUM — Prior isolated runtime had an operations-start incident

In the earlier `b07ea09` synthetic runtime, an unintended Compose start briefly launched the operations scheduler. One backup attempt failed key validation; no backup payload was created, the isolated operations container was stopped, and no existing UAT/production stack was touched. The initial exact-head app/validator run excluded operations; a later isolated one-shot exact-head operations backup/restore passed, while scheduled behavior remains unverified. Treat the incident as a test-process control finding and retain explicit scheduler isolation.

### LOW — Repository-wide format check has a pre-existing mismatch

The recorded repository-wide `npm run format:check` flags the unchanged `tests/evidence-validator-client.test.ts`; changed-file formatting checks passed and required GitHub CI passed. This is not a production blocker, but the mismatch should be cleaned up or scoped in a later maintenance change.

## Production-specific facts versus synthetic/local evidence

| Area | Verified evidence | Production status |
|---|---|---|
| Source and build | PR head `3d5db3c`; CI green; app image labels match commit/tree | Candidate not merged or published |
| Financial flow and PDFs | Synthetic invoice/payment/receipt; exact totals and visual Thai/baht rendering | No production rows or financial reconciliation tested |
| Migrations | 17 migrations on fresh synthetic DB | No target clone, history reconciliation, or no-seed upgrade rehearsal |
| Backup/restore | Exact-head manual backup and isolated restore; archive/receipt checksum, 44-table/17-migration inventory, and evidence attachment hash matched | Scheduler and Google Drive delivery unavailable; no production backup, off-device key recovery, target restore, or rollback |
| Evidence storage/auth | Exact-head validator runtime verified admin upload/list/download hash and STAFF/anonymous access | Synthetic run only; no production volume/retention/deletion policy verified |
| Network and HTTPS | Local Caddy CA and loopback HTTPS route | No production origin, host certificate trust, or complete egress proof |
| UAT | Exact-head agent-run browser suite 89/89, no retries/failures/skips, on fresh synthetic data | Not Owner UAT or production-host verification; the documented PDF text-extraction and monthly-report CSV browser gaps remain |
| GitHub | PR #2 open draft; required CI succeeded; release tag unchanged | No merged candidate release, published image, or host pull verification |

## Required before a production GO

1. Identify and attest the production host, Docker context, origin, existing services, database/attachment/backup volumes, and secret custody without changing them.
2. Create an isolated clone of a fresh target backup; compare migration history/checksums, run the candidate migrations without seed, verify financial/referential integrity, and rehearse rollback and off-device key recovery.
3. Complete source-matched scheduled-backup and off-device delivery checks on synthetic isolated resources. Exact-head manual operations backup/restore and validator authorization/upload/download checks are now verified.
4. Obtain explicit human review, merge/publish the reviewed candidate, publish immutable source-matched images, and verify pullability from the designated deployment host.
5. Only then stage deployment, perform authorized cutover, and record post-deployment health and recovery checks. Keep the release and production environment unchanged until those target-specific gates are met.

**Final assessment:** Current-source local development verification is strong for the app and synthetic financial flow. Production cutover remains **NO-GO** because the target, release publication, and target-specific operational safety evidence are not established.
