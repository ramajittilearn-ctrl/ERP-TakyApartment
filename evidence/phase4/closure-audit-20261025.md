# Phase 4 expense closure audit

Reviewer: `/root/evidence_review`, who did not implement the expense backend or UI. This is a read-only source and retained-evidence audit. No tests, database commands, browser, network requests or service changes were performed for this audit.

Inspected the durable Main baseline through `4950e90`, the accepted expense contracts and reviews, source and retained raw logs. The user's original priorities, as relayed by Main, define item 5 as Phase 4 Expense Management and item 6 as Dashboard and Reporting. The later stop instruction ends after Stage 3E and Phase 4. Historical `docs/implementation-plan.md` used a broader phase heading; that heading does not authorize implementing the later Dashboard/Reporting item. Maintenance and reporting demo modules remain visible backlog facts, not completed functionality.

No missing feature was established in the approved expense unit. One expense-specific runtime evidence gate remains open. Stage 3E and final integration dependencies also prevent closure.

## Requirement coverage

| Approved requirement | Source | Actual retained evidence | Pending or limit |
| --- | --- | --- | --- |
| Current-role STAFF/ADMIN preparation, ADMIN approval/cancellation/full reversal, immutable corrections and categories | `src/server/expenses/contracts.ts`; `service.ts:233`; `service.ts:284`; `service.ts:318`; `service.ts:348`; `service.ts:378`; migration `202610240001_phase4_expenses` | Independent backend review accepts through `18e3ef1`. Raw `evidence/expenses/database-qa-2026-10-24T04-24-45.895Z-78fdfd09-0148-40bf-ba06-dad8d8a7442c.log` records 22/22, child exit 0 and QA outcome 0. | Regress these accepted commands on the final Stage 3E integration baseline. No new expense policy or service change is required by this audit. |
| Finite exact money, actor/key replay, stale versions, audit rollback, category/post locking and immutable provenance | Same service/contracts and expense migration; `tests/integration/expenses.test.ts` | The accepted 22-case log includes attributed raw NaN rejection with finite positive control, concurrent transitions and rollback cases. Independent review reconciles assertions with the raw log. | Source review and a historical passing suite do not replace the final combined regression. |
| Preserve original Expense/Category/Attachment data and exclude unverified legacy values from managed totals | Expense migration, `listExpenses`; migration rehearsal driver | `evidence/expenses/migration-rehearsal-1d68887c-53a6-4c63-8eb7-d3cbdb39660e.json` records PASS, two Expense rows, one Category, one Attachment, 13 constraints and 12 indexes preserved. Actual service proof returns excludedLegacyCount2, managedRows0 and exact zero managed totals. Matching execution log ends QA outcome 0. | Preserve this historical evidence and rerun only against a new pristine target if another rehearsal is needed. |
| Strict filters, complete approved OPEX/CAPEX totals independent of the displayed page | `src/server/expenses/query.ts`; `service.ts:478`, RepeatableRead | The 22-case backend suite proves two posted maximum amounts produce `1999999999999.98` with limit=1 and total=2. | No first-page total approximation was found. |
| Persisted default UI with explicit demo separation; lifecycle/category/history/correction controls; exact decimal/date entry; stale-read fencing and in-modal command replay | `src/app/(erp)/expenses/page.tsx`; `src/features/expenses/live-screen.tsx`; `journal.ts`; `recovery.tsx` | Raw `evidence/remediation/6da15bf60576d8a202839939-browser.log` records eight genuine guarded browser cases passed, no skips/retries, exit 0. Covers STAFF denial, ADMIN lifecycle/categories, lost response and exact replay, real role change/logout, 105-row paging/CSV, mobile keyboard/Axe, detail-modal recovery and delayed filter/detail responses. | This establishes the recovered expense baseline. New integrated deposit browser results are separate. The collector saved 33 observations but exited 1 during teardown; no complete 90-sample or performance/root-cause conclusion is supported. |
| Complete filtered, exact and formula-safe CSV, empty summaries, reversal history and all-or-error 10,000-row ceiling | `src/server/expenses/export.ts:39`; shared `query.ts`; `service.ts:529`; export route | Independent EUI-02 retest closed the C1 control-prefix bug using actual CSV formatting/parsing. Recovered `evidence/recovery/fresh-unit.log` records 363/363. The fresh browser suite validates actual downloaded 105-row CSV and source/UI parity. | E4-G01 below remains open for real PostgreSQL 10,000/10,001, concurrent snapshot and large-total export acceptance. |
| Expense-aware backup/restore inventory preserving prior versions | `operations/inventory.mjs`; isolated inventory harness; frozen v4 contract | `evidence/restore-v4/real-pg-attempt1.log` and independent review record 60 PASS reporting checkpoints, exit 0, covering historical legacy/v2/v3 and 39-table v4 round trips and corruption probes. Retained full operations evidence records 54/54. | The final 44-table V5/publication/session-lock/orphan integration is a Stage 3E dependency and remains independently gated. Historical v4 success does not establish that new protocol. |
| Type/lint/build and complete integration before publication/closure | Retained recovery build/unit/lint logs, execution backlog `P4-CLOSE-25` | The recovered Main expense baseline has 363/363, full lint and completed supported Webpack build. | Final integrated regressions, independent corrections, newest operations proof, reviewed local commits and requested development-branch publication remain Main-owned gates. No Go-Live approval follows. |

## E4-G01: real PostgreSQL export acceptance evidence

Severity: medium verification gap, not an established application defect.

The durable evidence tree contains no successful raw execution log for `tests/integration/expense-export.test.ts`. The independent UI review and checkpoint preserve the first attempt's four fixture failures and one passing authentication/query case. That attempt failed on a 43-character Property.code before those export paths ran. The source correction now uses `EX-` plus 29 UUID hex characters, exactly 32 characters under the actual 40-character limit. Authored assertions and corrected fixture source are not a passing runtime result.

The recovered eight-case browser pass proves actual 105-row export, but cannot substitute for the required 10,000/10,001 boundary, aggregate beyond one-entry precision or actual concurrent export/approval checks. Close this gate only after Main recovers an attributable successful raw log or executes the existing five cases and the independent reviewer inspects the results. Preserve failed attempts separately.

## Existing export-suite setup review

No additional test or fixture change was required by source inspection. The suite creates its own synthetic ADMIN, STAFF, genuine stored STAFF session, properties, categories and expenses. It requires no historical legacy rows, seed users, validator or attachment directory. Historical legacy preservation is already covered by the separate accepted migration rehearsal.

Main's new target must be loopback `127.0.0.1`, named `taky_expense_test_[a-z0-9_]+`, have no URL query, and attest its actual database and role to the configured identity. Apply the 17 current migrations and use its own generated 44-model client. Supply a private `SESSION_SECRET` of at least 32 characters. The GET route/session tests do not need APP_ORIGIN or login passwords. Keep credentials out of source, logs and this report.

Run only the existing five-case file through the guarded private wrapper. Its child invocation is:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/expense-export.test.ts
```

The normal suite is sequential. Its final case disables only its synthetic STAFF user after the preceding cases. It does not reset or delete records or disable database guards. The volume case uses one `INSERT SELECT generate_series(1,10000)` for synthetic managed PENDING rows, with integrity triggers enabled. Those rows establish volume acceptance, not service lifecycle or financial approval evidence. Vendors are distinct. The export query has 10,000 UUID parameters, below PostgreSQL's parameter limit. The case has a 60-second test bound while the export service retains its 30-second transaction bound. Do not weaken triggers, transaction limits or assertions preemptively.

The concurrency case starts actual export and approval together and checks internally consistent returned status/totals. It does not force a commit between individual SELECT statements. This limitation was already disclosed in independent review; the source explicitly uses RepeatableRead. Record actual child exit 0, five passed, no skips and no timeout/output truncation before accepting the result.

## Closure boundary

Phase 4 expense closure is pending E4-G01 and Main's final dependency gates. The audit does not label maintenance or report demo screens implemented, remove their backlog items, approve the full ERP or authorize Dashboard/Reporting or Go-Live work. Complete the agreed Stage 3E and Phase 4 integration, verification and reviewed publication, then stop.
