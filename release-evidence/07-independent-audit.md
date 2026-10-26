# Stage 7 — Independent Release Audit

**Audit status:** The detailed audit body below is historical and assessed PR source commit `3d5db3cbae5f16532a3f1e37c7dfe33026c6a966`. Current evidence addenda for runs `40356454371`, `40360707470`, `40362968827`, `40365071119`, and `40398283420` follow and were independently cross-reviewed for evidence/source accuracy; they do not replace or extend the old detailed code-level audit findings beyond the evidence listed in those addenda.

## Current evidence addendum — run 40398283420

Run [40398283420](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40398283420) passed all four required checks on PR head `cec582fa73f3e57f92eca422cb9c2bb7ee6940b4`. The merge checkout was `e9e8864e6f7a289eae8224790e2390ded453cf70`, tree `faf5e5cdf2515dac44cd8b10bef0d685b32533e2`. The Stage 5 artifact [12689470944](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40398283420/artifacts/12689470944) records 51 passed checks across 17 fresh-database migrations, including synthetic billing/payment/receipt PDF reconciliation. Agent UAT artifact [12687878698](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40398283420/artifacts/12687878698) reports 90 passed, zero failed/skipped/flaky, including the rent-after-room-selection save/reload regression. These are isolated synthetic tests, not production recovery or Owner acceptance.

The four-image Trivy scan is [artifact 12688330999](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40398283420/artifacts/12688330999). It covers app, validator, operations, and the pinned PostgreSQL image on `linux/amd64`. App and validator each report 8 High unique IDs; operations reports one Critical and 16 High; PostgreSQL reports two Critical and 40 High. The database image's gosu Go-stdlib `CVE-2025-68121` is supported as a scanner false positive by upstream gosu evidence. Debian Trixie libxml2 `CVE-2026-6653` remains unresolved in operations and PostgreSQL; no risk acceptance is recorded. No image was published.

This is an evidence freshness update, not a new full code-level audit. `release/phase4` requires these four strict checks and one approving review; PR #2 remains OPEN/Draft with no approval recorded. Target-specific recovery, migration/rollback, off-device key recovery, registry publication/pull, and production target identification remain open. **Verdict remains NO-GO for production.**

## Current evidence addendum — run 40356454371

An independent release audit on 2026-10-26 reviewed the latest successful code-validation run and artifacts. PR #2's tested app/test source head was `8ca7f4fff329fa15bc9095208911120ea2074088`; `required-quality`, `container-verification`, and `agent-uat` all succeeded in run [40356454371](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40356454371). The run's Agent UAT artifact [12667808269](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40356454371/artifacts/12667808269) reports 90 passed, 0 failed, 0 skipped, 0 flaky on merge checkout `a3268cc17ca2f59f641548dec5bdc41998c42662`.

The container-verification log records current-source pinned app/validator/operations images built on isolated `linux/amd64`, fresh DB/app health with 15 seeded rooms, invalid validator token rejected with HTTP 401, and synthetic encrypted remote upload, read-back, and isolated restore. The restore verified 15 rooms, Attachment metadata owner links, and attachment SHA-256 `68e533fab04c85212338f91bd9dc0acf508f772764fea84333f966cd7275ffd4`. This is not an application download authorization test or production/off-device recovery. The Trivy report [artifact 12666751076](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40356454371/artifacts/12666751076) was inspected: App 0 Critical/8 High, validator 0 Critical/8 High, operations 1 Critical/16 High; all three sidecars share DB hash `36cfc99204b7ee124c2e47daf8a83cd0cf98bf4e6b6a67c30687da049d5828f6`. `CVE-2026-6653` and shared util-linux findings remain; no images were published.

**Current verdict: NO-GO for production cutover.** The audited run validates the candidate code and synthetic flows only. The audit reconfirmed unresolved production target/origin/access identity, target backup/clone/migration/rollback, off-device backup/key recovery, registry publication and deployment-host pullability, and security finding disposition. PR #2 is still OPEN/Draft. Follow-up run `40360707470` on documentation head `76860a474faf49fbcc5292284df4c274619ed4e7` passed all three checks; its Agent UAT artifact reports 90/90 on merge checkout `01fa4f15872f33293987c251bb4c5265297894a7`. This passed CI but does not satisfy the separate required PR approval; production remains NO-GO.

### Historical branch-protection correction

After this review identified that `release/phase4` had no required PR approval and only one required status check, protection was updated on 2026-10-26. At that point it required strict `required-quality`, `container-verification`, and `agent-uat` checks plus one approving review; stale approvals were dismissed. Stage 5 was subsequently added as a fourth required context. Admin enforcement, conversation resolution, and blocks on force-push/deletion remain enabled. This corrects the historical branch-protection finding above. PR #1 and PR #2 remain unmerged; the policy change itself does not establish that either PR is merge-ready.

**Historical verdict: NO-GO for production cutover.** At the time of this audit, production target readiness, target-specific recovery and migration evidence, and publication of a source-matched release remained unverified. The current production readiness status remains NO-GO; see `STATUS.md` for current CI and open gates.

**Audit date:** 2026-10-26  
**Audited candidate code baseline:** PR #2, `codex/phase4-current-source-20261026`, commit `3d5db3cbae5f16532a3f1e37c7dfe33026c6a966`, tree `aa5cf57c5d1fb90c5eedbdfc9775d494176123bb`. Evidence-only documentation is committed on top at `0eeb47742c597289ffad95386afcb5e52d8ab728`; it changed no app or test source.

## Evidence inspected

- Release evidence `01` through `06`, current Stage 5 private summaries and selected nonsecret probe fields, plus the local PDF renderings. I did not read credentials, auth/session traces, raw browser logs, or private key material.
- GitHub PR #2 and its remote branch: PR is OPEN, draft, and CLEAN at evidence commit `0eeb477`; its tested app/test source baseline is `3d5db3c`. Required check `Phase 4 CI / required-quality` passed on source head `3d5db3c` (run `40298101353`) and evidence commit `0eeb477` (run `40302348701`). PR #1 remains open; no merge was observed.
- GitHub release branch/tag: `release/phase4` and peeled tag `phase4-2026-10-26-rc1` remain at `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`. The release remains draft/prerelease. It does not identify the current PR head as the released candidate.
- Branch protection for `release/phase4`: strict required status check `required-quality`; force pushes and deletion disabled; admin enforcement enabled. Required approving review count is **0**.
- Historical Stage 5 evidence for candidate `3d5db3c`: `.local/runtime-uat/stage5-3d5db3c-161958/runtime-summary.json`, `pdf-probe-summary.json`, `dashboard-report-probe.json`, and `image-inventory.json`. These are ignored local evidence, not published release assets.
- Historical evidence-validator runtime for candidate `3d5db3c`: `.local/runtime-uat/stage5-evidence-3d5-170742/runtime-summary.json` and `probe-results.json` (0600). Its image digest is `sha256:b234353c2388124b721af499a5251b90804e8d965f71959e29513ea43404aaa4`, labeled with revision `3d5db3c` and source tree `aa5cf57…`.
- Historical operations backup/restore runtime for candidate `3d5db3c`: `.local/runtime-uat/stage5-ops-3d5-093500/runtime-summary.json`, private backup history record, restore receipt, and `evidence-result.json`. The archive itself and copied restore archive are private synthetic evidence. I inspected only selected checksums, counts, identity, and outcome fields; no key or environment values were read.
- Historical scheduled-backup runtime for candidate `3d5db3c`: `.local/runtime-uat/stage5-sched-3d5-095100/runtime-summary.json` and its single private backup record/archive. I inspected selected scheduler guard, remote configuration state, status, checksum, and cleanup fields only.
- Historical browser UAT for candidate `3d5db3c`: `evidence/remediation/browser-f12e112e99231c0a470e3171/results.json` in the clean PR-head clone, plus `release-evidence/06-final-uat.md`. I inspected the JSON stats and report, not raw browser logs or traces.
- Independent image inspection confirmed the app image ID `sha256:b06913e27e4d3565b671d74189ec0c57de6d5e56448f13d90899e5849dba83a7`, OCI revision `3d5db3c…`, tree `aa5cf57…`, and `fast-uri@3.1.9` from inside the image. GitHub's commit API reports that tree for the tested source baseline; evidence-only documentation is layered above it.

## Verified for the local candidate

- Compose configuration passed. A fresh synthetic PostgreSQL database received all 17 migrations explicitly before app startup. App, database, validator, and Caddy became healthy; authenticated access worked, unauthenticated rooms access returned 401, and the session cookie was Secure, HttpOnly, and SameSite=Strict.
- Synthetic invoice `INV-202610-0001` for room 305 totaled **฿4,680.00**; payment was confirmed and receipt `REC-202610-0001` was downloaded. Both PDFs had valid headers/EOF, were one A4 page, and the independently inspected renders show readable Thai text and baht glyphs. Dashboard and monthly reports pages and APIs returned 200 and reflected the synthetic invoice/payment totals and six-month trend.
- The `3d5db3c` candidate app image is local only and unpublished. The initial `3d5db3c` candidate app runtime used the pinned RC1 validator image and did not start the operations scheduler. Separate `3d5db3c` candidate validator and operations checks are recorded below. The operations image build did not include a dedicated OS vulnerability scan.
- A separate `3d5db3c` candidate app/current-validator run explicitly applied 17 migrations to a fresh synthetic database. Admin evidence upload returned 201; listing and reading returned 200; download returned 200 with the same 32,546 bytes and SHA-256 as the upload. Unauthenticated read returned 401. STAFF read returned 200 and STAFF upload returned 403. A DELETE probe against the generic resource route returned 422 VALIDATION because `deposit-evidence` is not in that route's resource enum; the evidence remained listed. The `3d5db3c` candidate API has no `deposit-evidence/[id]/route.ts` DELETE handler. This is consistent with retained evidence being non-deletable through the API; no direct DB or storage mutation was attempted.
- The validator run started only database, app, validator, and Caddy; operations was never started. Cleanup evidence records zero run containers/networks, no listener on port 45447, generated credentials removed, and four fresh run volumes retained. Independent Docker inspection confirmed those four volumes and found no remaining run containers/networks or port listener.
- The `3d5db3c` candidate operations image `sha256:9a03cde45ce44892ba9bd96f01e8ef491652ae365907df7e0f59d1447a2679ea` independently inspected with OCI labels matching commit `3d5db3c…` and tree `aa5cf57…`. A manual backup of fresh synthetic data succeeded: the 51,389-byte archive's independently recomputed SHA-256 is `9f69a21bb1617835a5403ecd1daae9c348dd89ac4aab9ec3a12f317c7b0dcf53`, matching both the backup history record and restore receipt. The copied archive hash and size also match.
- Restore ran in a separate new PostgreSQL 17 database and attachment volume, with no source DB/files mounted. The receipt records inventory version 5, 44 tables, and 17 migrations; all 17 receipt migration checksums independently match the `3d5db3c` candidate migration SQL files. It records 15 rooms, one synthetic tenant, one lease, one Attachment, one DepositEvidence, and one attachment content hash. A read-only probe of the restored attachment matched the original 32,546-byte evidence file's SHA-256 (`dd0a702f…`). No production or existing UAT resources were mounted or modified.
- In the separate manual backup/restore run, backup history is `SUCCEEDED`; remote upload was unavailable because no Google Drive remote was configured. Its scheduler was never started; only explicit manual backup and isolated-restore jobs ran. Restore's first attempt exited 73 before import because the disposable copied-archive directory was read-only and could not hold `.job.lock`. One corrected retry made only the disposable archive/receipt copy writable, kept the encryption key read-only, and passed. This was a bounded setup correction, not a repeated backup failure.
- Cleanup records zero run containers/networks, port 45448 free, generated secrets removed, and six fresh source/restore volumes retained. Independent Docker inspection confirmed all six volume names, no remaining containers/networks, and no listener on the port.
- A separate `3d5db3c` candidate scheduled run exercised one immediately due weekly cycle under `timeout --signal=TERM --kill-after=5s 120s`, with `restart=no`, no published ports, and an internal-only network. The fresh journal showed the weekly slot due; one `weekly/SUCCEEDED` record and 37,486-byte archive were produced. The archive's independently recomputed SHA-256 `4af8fb7b5a4332962fe9cced25800403df4427926cd32773c66ea52e8892d105` matches the record. Process inspection reported no backup child after success; the scheduler was stopped before the next 60-second tick. The run config and logs indicate no production/UAT project or volume was used.
- The scheduled record's `uploadAttempts` is 2 and `uploadError` says `Google Drive remote is not configured`; this counts logical delivery calls, not network attempts. At `3d5db3c` candidate `operations/backup.mjs`, `uploadRecord` rejects an empty `BACKUP_REMOTE` before checksum work or invoking `rclone`; the schedule and backup paths each call the guarded retry routine. The private network was internal-only. No remote destination or egress attempt was configured.
- Scheduled-run cleanup records three removed containers, one removed network, two fresh source volumes retained, and generated credentials/keys removed. Independent Docker inspection confirmed no run container/network and exactly the two fresh volumes retained.
- The isolated run removed its four containers and three networks, confirmed the port free, removed generated credentials, and retained four fresh run-specific volumes. It did not modify existing UAT or production volumes.
- Audited candidate `3d5db3c` agent browser UAT run `f12e112e99231c0a470e3171` used commit `3d5db3c…` / tree `aa5cf57…`; the clone has no app/test source diff. Its machine-readable Playwright result reports 89 expected, zero unexpected, zero skipped, zero flaky, zero errors, zero retries, one worker, and 198.4 seconds. `06-final-uat.md` reports a fresh isolated DB/role, 17 migrations, 15 synthetic rooms, and cleanup. Independent Docker checks found no run containers/networks or listeners on ports 3820, 3822, or 55452, and only the new run-specific database volume retained. This is agent-run synthetic UAT, not Owner UAT. Existing coverage limits in `06` remain: the browser PDF assertions do not extract Thai glyphs, and monthly report CSV download is not asserted. Audited candidate `3d5db3c` runtime PDF visuals were inspected separately.

## Findings

### BLOCKER — Production target and target-specific safety evidence are absent

The exact production host, Docker context, Compose project, canonical HTTPS origin, and access model are not established. No owner-designated database or attachment volume has been backed up, cloned, restored, or migrated. Migration history/checksums, existing attachment permissions, rollback, certificate trust on owner devices, off-device backup/key recovery, and post-deployment checks are therefore unverified. The inspected local `taky-erp` database is only a development candidate and has 23 public tables/3 migrations versus the Phase 4 source's 44 models/17 migrations; it is not evidence about the production target. Do not deploy against it by assumption.

### BLOCKER — At audit time, the candidate was not the published/release branch candidate

PR #2 is still a draft and unmerged. The protected release branch and RC1 tag still point to `89a15a1…`, not `3d5db3c…`; current-head images are not published and deployment-host pullability is unknown. The successful local run is not a release publication or deployment. A source-matched reviewed release artifact and registry availability are required before a cutover can be staged safely.

### HIGH — Off-device backup delivery and production recovery are unverified

The `3d5db3c` candidate operations image's manual local backup, isolated restore, and one immediately due local weekly scheduled cycle succeeded with synthetic data. The one-cycle rehearsal does not prove Sunday wall-clock behavior across host sleep/restart. No remote was configured; the logical delivery calls short-circuited before network access, and off-device delivery/key recovery remains unverified. Production backup, target restore, and rollback remain unverified; the earlier RC1 synthetic restore does not substitute for target recovery.

### MEDIUM — First `3d5db3c` candidate restore attempt needed one safe configuration correction

The first restore attempt exited 73 before import because a copied archive directory mounted read-only could not hold the restore lock file. The single retry changed write permission only on the disposable archive/receipt copy; the encryption key remained read-only, and restore passed. No source or production data was changed. Preserve this correction in the isolated-run procedure and validate read-only key mounting on the actual intended restore command.

### MEDIUM — HISTORICAL (CORRECTED 2026-10-26): Release branch protection did not require a human approval

GitHub enforces the required CI check and strict up-to-date branches, and prevents force-push/deletion, but the required approving review count is 0. An independent review was performed for this audit; platform policy does not require an approver before merging. Record an explicit reviewer approval or raise the branch's review requirement before treating the branch rules as a human signoff gate.

### MEDIUM — Prior isolated runtime had an operations-start incident

In the earlier `b07ea09` synthetic runtime, an unintended Compose start briefly launched the operations scheduler. One backup attempt failed key validation; no backup payload was created, the isolated operations container was stopped, and no existing UAT/production stack was touched. The later exact-source one-cycle schedule run succeeded under a bounded isolated configuration. Keep the documented scheduler isolation/timeout controls because of this prior test-process incident.

### LOW — Repository-wide format check has a pre-existing mismatch

The recorded repository-wide `npm run format:check` flags the unchanged `tests/evidence-validator-client.test.ts`; changed-file formatting checks passed and required GitHub CI passed. This is not a production blocker, but the mismatch should be cleaned up or scoped in a later maintenance change.

## Production-specific facts versus synthetic/local evidence

| Area | Verified evidence | Production status |
|---|---|---|
| Source and build | PR evidence head `0eeb477` (documentation only); app/test source `3d5db3c`; CI green; app image labels match source/tree | Candidate not merged or published |
| Financial flow and PDFs | Synthetic invoice/payment/receipt; exact totals and visual Thai/baht rendering | No production rows or financial reconciliation tested |
| Migrations | 17 migrations on fresh synthetic DB | No target clone, history reconciliation, or no-seed upgrade rehearsal |
| Backup/restore | Historical `3d5db3c` manual backup/isolated restore and one weekly scheduled synthetic backup; hashes and 44-table/17-migration restore inventory matched | No host sleep/restart schedule proof, Google Drive delivery, production backup, off-device key recovery, target restore, or rollback |
| Evidence storage/auth | Historical `3d5db3c` validator runtime verified admin upload/list/download hash and STAFF/anonymous access | Synthetic run only; no production volume/retention/deletion policy verified |
| Network and HTTPS | Local Caddy CA and loopback HTTPS route | No production origin, host certificate trust, or complete egress proof |
| UAT | Historical agent-run browser suite on `3d5db3c`: 89/89, no retries/failures/skips, on fresh synthetic data | Not Owner UAT or production-host verification; the documented PDF text-extraction and monthly-report CSV browser gaps remain |
| GitHub | PR #2 open draft; required CI succeeded; release tag unchanged | No merged candidate release, published image, or host pull verification |

## Required before a production GO

1. Identify and attest the production host, Docker context, origin, existing services, database/attachment/backup volumes, and secret custody without changing them.
2. Create an isolated clone of a fresh target backup; compare migration history/checksums, run the candidate migrations without seed, verify financial/referential integrity, and rehearse rollback and off-device key recovery.
3. Verify scheduled behavior for the current release candidate across the intended host's real Sunday 02:00 cycle and sleep/restart model, and validate configured off-device delivery and key recovery. The manual backup/restore, one bounded weekly cycle, and validator authorization/upload/download checks were verified for older candidate `3d5db3c` only.
4. Obtain explicit human review, merge/publish the reviewed candidate, publish immutable source-matched images, and verify pullability from the designated deployment host.
5. Only then stage deployment, perform authorized cutover, and record post-deployment health and recovery checks. Keep the release and production environment unchanged until those target-specific gates are met.

**Final assessment:** Current-source local development verification is strong for the app and synthetic financial flow. Production cutover remains **NO-GO** because the target, release publication, and target-specific operational safety evidence are not established.

## Follow-up run on documentation head `76860a4`

Run [40360707470](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40360707470) passed `required-quality`, `container-verification`, and `agent-uat` on PR head `76860a474faf49fbcc5292284df4c274619ed4e7`. Agent UAT artifact [12667957853](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40360707470/artifacts/12667957853) reports 90 passed, zero failed/skipped/flaky on merge checkout `01fa4f15872f33293987c251bb4c5265297894a7`. Container and scan details are recorded in `05-runtime-verification.md` and `08-container-security-remediation.md`. PR #2 remains OPEN/Draft pending the required approving review; production remains NO-GO.

## Follow-up run on evidence head `aa171b8`

Run [40362968827](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40362968827) passed all three checks on PR head `aa171b8e0273e86e77212bf56972d0a2bab89b6e`. Agent UAT artifact [12668289110](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40362968827/artifacts/12668289110) reports 90/90 on merge checkout `08eaa89ed5258b1c1c22a80f649db882afe574aa`. The latest scan artifact is `12669796308`; findings and database provenance match the report in `08-container-security-remediation.md`. PR #2 remains OPEN/Draft pending the required approving review. Production remains NO-GO.


## Follow-up run on evidence head `54ecf19`

Run [40365071119](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40365071119) passed all three checks on PR head `54ecf19a89f03b403c46466e2f3247c14d2cf22c`. Agent UAT artifact [12671305690](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40365071119/artifacts/12671305690) reports 90/90 on merge checkout `b4a9edc18aac982bf5d01f800236dc90b9e1f871`. Scan artifact [12670017880](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40365071119/artifacts/12670017880) was inspected; source/tree, counts, and DB provenance are recorded in `08-container-security-remediation.md`. PR #2 remains OPEN/Draft pending approval; production remains NO-GO.
