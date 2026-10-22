# Stage 3C-4 development closure

Date: 2026-10-22, Asia/Bangkok. Status: IMPLEMENTATION AND AUTOMATED VERIFICATION COMPLETE. Human operator UAT acceptance and production readiness remain pending.

## Scope and baseline

Owner approved F-04 stale meter response/form protection, F-05 history timestamps, and F-08 browser/integration closure with "ok" after the concrete proposal. The owner then instructed work to continue until complete. The original preflight stop and proposal remain in `STAGE_3C4_PREFLIGHT.md` for history.

Worktree: `/Users/ramajittipasutanavin/.codex/worktrees/stage-3c4/ERP`. Branch: `codex/stage-3c4`. Baseline: `0530eddac1d1e07a578b8715c92884c320ed8baa`. Verified application/test commit: `1026b8fb583aff853412a36be24dc8931ce78032`. This documentation closure follows that commit. No push or merge occurred.

## Implemented behavior

Meter overview reads now have query-bound state and cancellation. Superseded responses cannot restore old filters or form data. Loading/error states have no actionable stale meter form. Selectors remain disabled until hydration attaches their handlers. This also fixes an observed startup race where an early August selection reverted to the server-rendered October default.

Unsaved value/date overlays are keyed by canonical period and physical meter. Saving water retains unsaved electricity input. Changing floors or periods and returning retains the correct pending edits. A write captures its context, blocks duplicate saves and locks filter, room and meter controls until completion. History requests are invalidated on selection changes and refreshes. Admin submissions have their own synchronous submission lock.

Reading history retains backend createdAt and displays recorded/confirmed timestamps and confirmer identity. Correction and replacement events display their event times. All event formatting explicitly uses Asia/Bangkok and time datetime markup. Business reading dates remain separate.

Verification scripts have an explicit Stage 3C-4 mode that pins the app, PostgreSQL address/role and evidence paths. Seven configuration tests reject UAT origins, wrong database identities, missing configuration and URL options. Existing exact Stage 3C-3 guards remain available.

Browser test improvements wait for the actual room PUT before reloading and give each route/viewport an independent test with the existing 45-second timeout. Assertions were preserved. Meter integration fixtures own a separate property and M-prefixed room identities, avoiding other suites' TAKY leases. No server financial code, Prisma schema, applied migration or dependency version changed.

## Verification and review

Final results are recorded in `STAGE_3C4_TEST_REPORT.md`: 120 unit tests, 81 PostgreSQL tests, 46 browser tests, 46 invoice HTTP checks, nine invoice browser groups, seven configuration tests, eight operations tests, production build, static checks, 13 migrations and zero schema drift.

The configured browser suite now has 30 independent route/viewport checks instead of three tests containing ten route steps each. All previous configured scenarios remain. Three new meter scenarios cover request ordering, delayed writes, retained drafts, history context and desktop/mobile ADMIN/STAFF workflows. Phase 2.6 transfer cases all passed in the final aggregate. The old Stage 3B 14/15 result remains historical; it is not rewritten as a pass. Its original cleanup timeout cannot be attributed more precisely from retained historical evidence. The current complete configured suite passed.

Independent source review found no blocking product defect and requested a delayed-mutation regression, which was added and passed. The hydration follow-up also passed source review. Root executed the runtime checks and inspected desktop/mobile screenshots. Review used the available inherited model family; no cross-family review is claimed. The closure decision trail is `STAGE_3C4_DECISIONS.tsv`; its timestamps record entry creation, not reconstructed action times.

## Isolation and retained risks

The UAT checkout remains `/Users/ramajittipasutanavin/Documents/ปลูกหอพัก/ERP` at the original branch/baseline, with its three tracked edits and untracked UAT preparation artifacts preserved. Its app and database remained healthy on port 3700. This task never queried its database, used its credentials, changed its files, migrated its schema, restarted its services or modified its test data.

Final browser/API target: project `taky-stage3c4-r4`, separate PostgreSQL role `stage3c4_test`, loopback port 55440. Integration target: project `taky-stage3c4-integration-r3`, role `stage3c4_integration`, loopback port 55441. Both use database name `taky_phase2_test` inside different dedicated containers/volumes because existing test guards require that name. The production verification app bound only 127.0.0.1:3800. Fresh task-only secrets are ignored, mode 0600, and never copied from UAT. Runtime/build/dependencies and evidence live in this worktree.

Earlier synthetic databases and failed-run evidence are retained. Only this task's verification processes/containers are stopped at closure; no volumes or containers are deleted. Private launch/config files remain under `.local/stage3c4` for local reproduction. Test suites require a fresh synthetic target where documented, rather than resets of existing data.

Shared integration risks remain when the owner later chooses to promote this branch: meter source/contracts, verification scripts and test fixtures need normal conflict review against concurrent work. No migration conflict is introduced here. UAT is not automatically updated by this worktree.

## Remaining owner and operational gates

F-04 and F-05 are implemented and verified for development. F-08 automated coverage is complete for the agreed current configured suite and focused invoice checks. Human operator acceptance still requires the owner or a named operator to sign the UAT checklist. No acceptance is inferred from automated passes or service health.

F-06 operational target identity/legacy mapping, backup/restore and migration rehearsal, due-date/operator commissioning and deployment authorization remain separate gates. Production billing remains NO-GO. Payments, receipts, deposits, taxes, optional charges, ledger posting, bank reconciliation, delivery and future-period reconciliation remain outside this milestone.

Local milestone commits: `4dbfaf0` scope/design; `2482116` primary implementation and verification configuration; `1026b8f` hydration and fixture refinements; the final commit touching this report is documentation closure.
