# Stage 3B closure report

**Repository:** `ramajittilearn-ctrl/ERP-TakyApartment`
**Branch:** `phase-3b-meter-reading`
**Baseline:** `fe702fc`
**Date:** 2026-10-19

## Executive summary

**Stage 3B development: NOT CLOSED.** F-01 and F-03 are resolved. F-02 remains OPEN (High): correcting an open-period predecessor changed a confirmed successor in a closed period. This is a newly confirmed integrity defect and blocks closure.

**Stage 3C development: NO-GO. Production billing: NO-GO.** F-02 must be resolved under an owner-approved correction policy and covered by a focused regression before Stage 3C starts. The accessible local deployment database contains no meter records, but its schema predates Stages 3A and 3B; confirm whether it is the intended production target and repeat the read-only inventory after migration and before actual billing.

This closure adds no Stage 3C application code. It does not deploy, merge, force-push, or modify production data.

## Verified scope and requirements

Stage 3B captures water and electricity readings independently by physical meter and billing period. Each utility has its own actual reading date. Service validation enforces the period, meter lifecycle, future-date, value, and meter-sequence rules. Corrections preserve the original date and append correction and audit history. Replacement records keep old-meter final consumption separate from the new meter's opening value.

The work reuses the existing `UtilityMeter`, `MeterReading`, `BillingPeriod`, `MeterReadingCorrection`, `MeterReplacement`, and `AuditLog` models. No Prisma schema or migration changed in this closure.

## Pstack compliance evidence

The closure followed the installed Pstack `poteto-mode` workflow and its Codex adapter. I read the shipping and bug-fix playbooks and the relevant verification, sequence, test-behavior, and technical-writing principles. I established the branch and diff baseline, reviewed the audit and remediation reports, design and test plans, source changes, and test output. The stale-snapshot concurrency regression failed once, identified the cause, and passed after the transaction isolation fix. I then reviewed the final diff and verified the implementation on PostgreSQL and the browser surface.

Overall Pstack compliance remains **PARTIAL**. The repository does not contain a contemporaneous task ledger or complete independent review record for the original Stage 3A/3B implementation. The earlier audit also could not verify a PR handoff. This closure does not claim those historical steps occurred. No PR was created because this task authorizes two commits and a branch push, not a pull request.

## F-01, F-02, and F-03 closure evidence

| Finding | Severity | Status | Implementation and test evidence |
|---|---|---|---|
| F-01 — Opening-reading authorization | High | RESOLVED | `upsertDraftReading` requires ADMIN for `OPENING`; `confirmReading` repeats the check at the service boundary. PostgreSQL tests verify STAFF rejection, no draft mutation, ADMIN success, and the ordinary STAFF `NORMAL` flow. |
| F-02 — Out-of-order confirmation and closed-successor correction | High | OPEN | Chronology checks and the open-period correction/confirmation race pass. However, an isolated PostgreSQL reproduction closed the May successor period, corrected its March predecessor from 110.000 to 105.500, and the service accepted it: May consumption changed from 10.000 to 14.500 and a correction row was appended in the closed period. `correctReading` checks only the predecessor's period before recalculating successors. |
| F-03 — Replacement final reading missing its billing period | Medium | RESOLVED | The old meter's final reading and new meter's opening reading both link to the canonical period. PostgreSQL tests verify period-scoped retrieval and correction eligibility; the ADMIN browser test verifies both links. Values are never subtracted across meter identities. |

## Residual findings F-04 through F-08

| Finding | Severity and status | Evidence and risk | Responsible workstream | Target | Development-blocking | Production-blocking |
|---|---|---|---|---|---|---|
| F-04 — Overview request race and stale form | Medium, OPEN | `screen.tsx` applies overview responses without a request-generation guard and resets form values while loading. A delayed response can replace unsaved input or leave stale filter results visible. No automatic write occurs. The save request carries the displayed meter identity, and the service validates the period and date. No cross-meter persistence was demonstrated. | Frontend | Stage 3B follow-up before operator rollout | No | Yes, until fixed or explicitly accepted after operator testing |
| F-05 — Missing history timestamps | Low, OPEN | The UI omits recorded/confirmed timestamps for ordinary readings and the event timestamp for replacements. Backend audit records retain the timestamps. This reduces operator context. | Frontend | Stage 3B UX follow-up | No | No |
| F-06 — Legacy meter records without canonical dates or periods | Medium, NOT VERIFIED for a distinct hosted production target; no rows in the accessible local snapshot | A PostgreSQL `READ ONLY` inventory of local database `taky` returned 0 `UtilityMeter`, 0 `MeterReading`, and 0 orphan readings. Its migration history contains only `202610160001_foundation`, `202610160002_constraints`, and `202610170001_backup_operations`; the schema predates Stages 3A/3B. There are no local meter rows to map, but equivalence to any separate hosted target is unverified. | Database/operations | Confirm target identity; repeat after migration and before actual billing | No | Yes, until the intended target is inventoried and any rows are mapped |
| F-07 — Browser test uses a fixed “today” | Medium, test reliability; RESOLVED | The separate-date browser test freezes browser time at `2026-10-18`. The focused test passed against the isolated final app. | QA/frontend | Completed in closure | No | No |
| F-08 — Browser coverage and aggregate confidence | Medium, OPEN | The historical full browser suite remains 14/15. The separate-date and ADMIN replacement focused tests each pass 1/1, but browser tests still omit several validation, correction, STAFF-denial, and history interactions. | QA | Stage 3C pre-release and operator UAT | No | Yes, until required regression coverage and operator UAT pass |

F-04 can lose unsaved form input. The current evidence shows a user-interface state problem, not silent database corruption: the UI does not submit until the operator acts, and the request remains tied to a meter ID. Operators can re-read a physical meter, but the screen must be fixed or explicitly accepted before broad rollout.

## F-06 inventory and access limit

The inventory used the local deployment database `taky` through the running `taky-erp-db-1` container. The checks ran inside PostgreSQL `READ ONLY` transactions and returned aggregate counts and migration names only. They read no meter values, tenant records, or other row-level business data. No database changes were made.

The accessible database is still on a pre-Stage-3A/3B schema. The check therefore establishes that this snapshot has no legacy meter rows; it does not verify a separate hosted production database or any later snapshot. The owner must confirm the target identity. Repeat the inventory after the planned migrations and before Stage 3C uses meter history for actual billing.

## Verification results

| Check | Result |
|---|---|
| Unit tests, `npm test` | PASS, 40/40 across five files. |
| PostgreSQL integration, final isolated database | PASS, 36/36 across four files; all 11 meter-workflow tests passed. |
| Focused correction/confirmation contention test | PASS, 1/1; final successor consumption `14.500`, correction history retained. |
| Focused separate-date browser test | PASS, 1/1 at 390 px with browser time frozen. |
| Focused ADMIN replacement browser test | PASS, 1/1; both readings link to the selected period. |
| Historical full browser suite | 14/15. This remains 14/15; focused passes do not change the aggregate. |
| TypeScript, lint, and format | PASS. |
| Test operations/security suite | PASS, 8/8. |
| Docker production build | PASS on the final backend source. The later test-only browser-clock change does not affect the production bundle. |
| Prisma migrations | All seven existing migrations applied in the isolated test database. No migration was added. |
| Migration status and schema drift | PASS; schema up to date and no difference detected. |
| Diff hygiene | `git diff --check` passed before documentation and commit preparation; it is rerun before commit. |

The PostgreSQL suite emitted an existing `pg` deprecation warning about concurrent `client.query()` calls. All tests passed. No production migration or write was run.

## Database, security, and audit status

The application enforces ADMIN-only opening-reading drafts, registration, correction, and replacement. STAFF retains ordinary reading draft and confirmation access. Meter mutations keep financial values as decimal strings and use PostgreSQL decimal columns. Audit and correction records are appended in the same transaction as accepted changes. Database triggers protect correction and replacement history.

F-02 correction/confirmation handling uses the same per-meter lock. `READ COMMITTED` is limited to the correction transaction, where the lock serializes meter-sequence writers and each query after the lock must see commits that completed while it waited. The focused contention regression and full PostgreSQL suite pass on that behavior.

## Known limitations and owner decisions

- F-04 remains a stale-response and unsaved-input risk. Close it or approve an operator-tested mitigation before broad meter-entry rollout.
- F-05 remains a low-priority history-display gap.
- F-06 is only verified for the accessible local database snapshot. Confirm whether it is the production target and repeat the inventory after migration.
- F-08 remains an E2E coverage gap. Do not report the full suite as 15/15. Complete the required browser regression and operator UAT before production billing.
- Phase 2.5 still has owner-run commissioning requirements for off-device backup recovery, key escrow, normal admin setup, HTTPS trust, host reliability, and a controlled recovery drill.

## Git revision evidence

- Baseline branch: `phase-3b-meter-reading`.
- Baseline HEAD and `origin/phase-3b-meter-reading` at task start: `fe702fc`.
- Expected Stage 3B commits `185e7e4` and `fe702fc` are ancestors of the closure branch.
- Remediation source/test commit: to be recorded after the first closure commit.
- Documentation commit: this report is included in the closure documentation commit; its exact hash is available from `git log` for this path.
- Remote URL: `https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/tree/phase-3b-meter-reading`.
- Final remote HEAD and clean-tree status: verify after the authorized push; report the exact result in the task completion message.

## Development closure decision

**Stage 3B: NOT CLOSED.** F-02 is a confirmed High integrity blocker: correction of a predecessor can mutate a successor in a closed period. Do not close Stage 3B until the correction policy is approved, the service enforces it, and a PostgreSQL regression proves closed-period data is preserved. This report does not claim the existing suite covered this case.

## Stage 3C readiness decision

**NO-GO for Stage 3C development.** Resolve F-02 and pass its focused regression first. No Stage 3C handoff was created. Afterward, verify the target database identity, repeat the legacy-data inventory after migration, and complete the applicable operator and browser-readiness gates.

## Production readiness restrictions

This report does not authorize production deployment or billing. Do not issue invoices from an uninventoried target database. Do not calculate charges from legacy meter rows until their date and period mapping is verified. Do not edit an issued invoice in place; Stage 3C must use an owner-approved void or adjustment workflow. Complete the remaining backup, security, and operator-readiness checks before production use.

## Final F-02 remediation and closure addendum — 2026-10-19

This addendum supersedes the earlier closure decision in this report. It preserves the failed closure reproduction above as historical evidence; it does not rewrite what the earlier working tree did.

### Final F-02 result

The confirmed defect was fixed without a schema change. `correctReading` serializes on the physical meter as before, identifies its same-meter immediate confirmed successor, and locks the distinct target/successor billing periods in stable sorted order before any correction, reading, or audit write. A closed affected period (or a successor with no canonical period) aborts the full transaction. Corrections that affect only open periods continue to work. The successor search does not cross a meter replacement boundary.

The exact isolated PostgreSQL reproduction now rejects March `110.000` → `105.500` when its May `120.000` successor is in a CLOSED period. Assertions prove March value, consumption, and predecessor link stay unchanged; May consumption and predecessor link stay unchanged; and correction and confirmation/audit counts do not increase. Separate tests cover open-period recalculation, multiple successors where only an open intermediate is affected, correction/confirmation contention, and old/new meter identity isolation. Independent Pstack review found no new Critical or High defect.

| Finding | Severity | Final status | Acceptance evidence |
|---|---|---|---|
| F-01 — Opening-reading authorization | High | RESOLVED | ADMIN enforced by service on both opening draft and confirmation; role regression tests pass. |
| F-02 — Chronology and closed-period successor mutation | High | RESOLVED | Affected periods checked under stable locks before writes; atomic closed-period PostgreSQL regression and open/multiple-successor/replacement/concurrency tests pass. |
| F-03 — Replacement-period handling | Medium | RESOLVED | Final old-meter and initial new-meter readings link to canonical period and remain separate by meter ID. |

### Final verification record

| Verification | Final result |
|---|---|
| Unit tests | PASS — 40/40. |
| PostgreSQL integration tests | PASS — 39/39 across four files, 14 meter tests, run in isolated `taky-phase3b-f02` app/database project. |
| Focused correction/confirmation concurrency | PASS — 1/1 in prior fresh focused run and within final 39/39 suite. Running the test alone later against the already-populated shared test DB could not initialize its duplicate unique-period fixture. |
| Focused browser tests | PASS — 2/2 (separate water/electric dates and ADMIN replacement). Historical full Playwright suite remains **14/15**. |
| Operations/security | PASS — 8/8. |
| Typecheck, lint, formatting, and diff check | PASS. |
| Docker production build | PASS. |
| Migration/schema drift | PASS — all seven existing migrations applied; no diff; no migration added. |

No production data was modified. No Stage 3C code, deployment, merge, or force-push occurred.

### Remaining findings and explicit owners

| Finding | Status | Owner | Target | Gate/next action |
|---|---|---|---|---|
| F-04 — Overview response race and stale form | OPEN, Medium | Frontend owner | Stage 3B operator-rollout follow-up | Guard stale responses and preserve unsaved input; verify with delayed-response UI test or document operator acceptance before rollout. |
| F-05 — History UI omits some timestamps | OPEN, Low | Frontend owner | Stage 3B UX follow-up | Show recorded/confirmed times and replacement event time. |
| F-06 — Legacy records lack verified canonical date/period mapping | NOT VERIFIED for intended post-migration target | Database/operations owner | Mandatory before actual Stage 3C billing | Confirm target identity, migrate, run read-only inventory, map any legacy rows, and retain sign-off. Remains open until target data is verified. |
| F-07 — Browser clock nondeterminism | RESOLVED | QA/frontend owner | Completed in Stage 3B | Browser clock frozen for date test. |
| F-08 — Browser coverage and aggregate confidence | OPEN, Medium | QA owner | Stage 3C pre-release and operator UAT | Add validation/correction/history/role browser coverage, investigate historical 14/15 timeout, rerun full suite and operator UAT. |

### Final decision

**Stage 3B: CLOSED for development. Stage 3C: CONDITIONAL GO.** F-01/F-02/F-03 are resolved. Stage 3C development may proceed within its approved scope; actual billing remains prohibited until F-06 is cleared on the intended target and mapped data is verified. F-04 and F-08 remain operator-rollout/pre-release gates; F-05 remains a low-severity usability follow-up. Future billing adjustments remain out of scope until business-rule approval.

### Git finalization record

This report is included in the documentation commit. Source/test and documentation commits, push result, remote HEAD, and final clean status are recorded here after GitHub verification. Branch URL: https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/tree/phase-3b-meter-reading.
