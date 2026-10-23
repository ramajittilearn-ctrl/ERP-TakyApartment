# Agent UAT report

Assessment started 2026-10-23 by independent agent `agent_uat_acceptance`. The user authorized agents to perform acceptance testing and retain a report. This records Agent UAT; it does not record human Owner UAT acceptance.

Current result: **scoped Billing Agent UAT passed, 51/51; complete ERP release acceptance not granted**. Fresh complete run `92c0237d47f3ec10ef010234` passed all 51 cases with zero skips, unexpected results, flaky results or top-level errors. This closes the corrected monthly success-feedback defect and the billing browser regression gate for this candidate. Earlier failures remain recorded below as correction history.

## Baselines and execution boundaries

The accepted integration repository is `/private/tmp/taky-development`, with accepted API baseline `6da96b7`. Payment UI implementation is now under review there; its browser acceptance has not run. The billing candidate is `/private/tmp/taky-billing-remediation`, based on `0e4e302`, with imported billing UI and reviewed remediation changes still uncommitted. These are different source states. A candidate browser pass cannot establish that every integrated payment API or restore change works in the billing candidate.

Main executes Docker, database and guarded Playwright commands. This assessor reads actual source and retained artifacts, establishes expected behavior, and reports findings to Main and the billing implementer. The assessor does not change application code or database records. Original UAT ports 3700 and 3701 are outside this test target.

Browser plugin is not available in the listed skills. The existing Playwright workflow is used with Chrome, Thai locale, Bangkok timezone, challenged target identity, proxy port 3822, app origin `http://127.0.0.1:3820`, and synthetic database `taky_phase2_test`. Run-specific generated database roles identify each independent test environment. Private credentials remain outside this report.

## Acceptance coverage

| ID | Scenario and expected result | Current result | Evidence or remaining action |
| --- | --- | --- | --- |
| AU-01 | ADMIN creates a demo tenant, edits notes, reloads and sees persisted notes. Creates and updates a draft lease, verifies CSV values, and deletes the synthetic draft and tenant. | Pass | Fresh run `1a1e6c8144e1aa256a787f04`, 1/1 passed. |
| AU-02 | ADMIN creates a monthly period, effective-dated water/electricity rates, and audited selections; values survive reload; duplicate period is rejected without losing input. | Pass after correction | Full run `92c0237d47f3ec10ef010234` completed the original monthly case. Earlier BR-04 feedback failure is retained below. |
| AU-03 | ADMIN installs both synthetic meters, records and confirms readings, closes the complete period, sets due policy, drafts and issues the invoice. | Pass | Original monthly flow completed in fresh full run `92c0237d47f3ec10ef010234`. |
| AU-04 | Issued invoice PDF downloads with the expected invoice filename and PDF header. | Pass for download only | Fresh full run completed filename/header assertions. Visual Thai layout and exact invoice amounts require separate inspection. A PDF header alone does not certify either. |
| AU-05 | STAFF cannot access ADMIN billing creation controls or mutate periods, utility rates, and selections. | Pass | Full monthly flow completed the three real API 403 assertions and UI absence assertions. |
| AU-06 | A delayed response from the previous billing period cannot display another period's selected rate or approval reason. | Pass | Fresh run `630a110c3be65c3713cdb493`; controlled network responses prove client state isolation, not database approval correctness. |
| AU-07 | Invoice loading, ready, error and recovery states remain accessible at 390px. | Pass | Full run completed the mocked loading/ready/error/recovery assertions and Axe checks at 390px. Persisted lifecycle has separate monthly-flow proof. |
| AU-08 | Rooms, tenants, leases, billing and other protected pages render at 1440px, 768px and 390px without horizontal overflow, browser page errors or Axe violations. | Pass for tested rendering | Full run passed responsive, overflow, browser page-error and Axe assertions. A demo page rendering does not implement its underlying ERP module. |
| AU-09 | Meter replacement, correction, navigation persistence and STAFF restrictions work through actual controls. | Pass | All meter scenarios completed in the fresh full run, including 1440px and 390px validation/correction/replacement/STAFF cases. |
| AU-10 | Payment capture, confirmation, actor-scoped retry recovery, receipt viewing, cancellation and reversal work through persisted UI. | Not run; implementation under review | Payment UI now exists in the separate integrated checkout. Review finding UI-CR-01 concerns sticky uncertainty and duplicate submissions; correction and actual guarded browser tests remain required. Reported 261 unit passes do not establish browser acceptance. Domain/API evidence is separate below. |
| AU-11 | Deposit liability, deductions/refunds, persisted OPEX/CAPEX and reconciled dashboard/report workflows work end to end. | Not available | These modules remain incomplete in the project backlog. |
| AU-12 | Production recovery, real target migration, operational setup and deployment succeed. | Not run | Synthetic restore evidence does not certify production recovery or a deployment. |

## Inspected browser attempts

### Attempt b27aeb21dfc049cdbe65001a

Main command selected `--grep '^tenant and lease UI create, update and delete draft$'`. Actual `results.json` records `Error: No tests found`, an empty suites array and zero expected, skipped, unexpected and flaky tests. `execution.json` records `browserStarted: true` and `succeeded: false`. This is test-selection failure AU-ENV-01, not an application defect.

The retained log confirms all 14 migrations and synthetic seed/account setup completed successfully. `database-identity.json` attests database `taky_phase2_test` and role `e2e_b27aeb21dfc049cdbe65001a`. The standalone server started on port 3820. Scoped Compose shutdown retained the generated volume.

Evidence in this candidate:

- `evidence/billing-remediation/tenant-uat-run.log`
- `evidence/remediation/browser-b27aeb21dfc049cdbe65001a/results.json`
- `evidence/remediation/browser-b27aeb21dfc049cdbe65001a/database-identity.json`
- `evidence/remediation/browser-b27aeb21dfc049cdbe65001a/execution.json`

Correction sent to Main and the implementer: use the unanchored unique title substring because Playwright matches the full title including its file context. Use a fresh run identifier and preserve the unsuccessful attempt. The handoff's other anchored grep examples have the same selection risk.

### Attempt 1a1e6c8144e1aa256a787f04

Main reran the tenant case with the unanchored unique substring on a fresh synthetic project. Actual `results.json` records one expected test, zero unexpected, skipped or flaky tests, and passed status. The command log records 1 passed and exit 0. The source case verifies tenant creation, saved notes after reload, draft lease creation and changed rent after reload, filtering, CSV contents and synthetic draft/tenant deletion. This closes AU-01 for this candidate.

Both the browser guard log and `database-identity.json` identify database `taky_phase2_test`, role `e2e_1a1e6c8144e1aa256a787f04`, origin 3820 and proxy 3822. Evidence is `evidence/billing-remediation/tenant-uat-attempt2.log` and `evidence/remediation/browser-1a1e6c8144e1aa256a787f04/`. Passing runs retain the report and logs; screenshot/trace capture is configured for failures, so this pass does not supply a separate visual screenshot audit.

### Attempt 630a110c3be65c3713cdb493

Main executed monthly billing and delayed rate-history scenarios on a fresh synthetic project. Actual `results.json` records one expected test, one unexpected test, no skipped or flaky tests. The billing command exited 1. The delayed rate-history scenario passed and closes AU-06 within its mocked-response scope.

Monthly billing failed at `tests/phase2/billing-setup.spec.ts:89` because the exact created-period success message never appeared within the unchanged assertion timeout. The assessor inspected the retained error context and the trace ZIP network stream without running a GUI. The POST to `/api/v1/billing-periods` returned 308, followed by the canonical trailing-slash POST returning 201. The DOM contained January 2020 as the selected period and no success notice. This establishes successful creation with missing feedback, not a failed database write or environmental setup failure.

At this failed attempt, BR-04 required owner correction. Main and the owner identified the period-change effect clearing the operation's notice. No later monthly assertions from this failed attempt count as tested. Its subsequent independently reviewed correction and original-case pass are recorded in the final scoped assessment below.

An additional observed UX issue, AU-UX-01, is the billing page footer text `หน้านี้ยังไม่เชื่อมต่อฐานข้อมูล • รีเซ็ตเมื่อโหลดใหม่`. That contradicts this actual persisted database operation. Main received the evidence for later scoped correction; this text is not the cause of BR-04.

Identity evidence attests `taky_phase2_test` and role `e2e_630a110c3be65c3713cdb493`. Evidence includes `evidence/billing-remediation/billing-uat-run.log`, `evidence/remediation/browser-630a110c3be65c3713cdb493/results.json`, and its monthly test's retained `error-context.md`, screenshot and `trace.zip`. All evidence and scoped database volumes are retained.

## Separate automated evidence inspected

These are successful engineering checks, not substitutes for the unexecuted acceptance flows above. Evidence is in `/private/tmp/taky-development` unless stated otherwise.

| Check | Inspected result | Scope and limitation |
| --- | --- | --- |
| Payment financial PostgreSQL suite | 22 passed, exit 0 | Actual managed financial lifecycle, concurrency and invariants. Immutable log `evidence/payments/qa-integration-2026-10-23T00-20-25.610Z-88f8fb96-4d3e-435d-b64f-2e818c95af33.log`; it executes domain tests rather than browser payment actions. |
| Existing PostgreSQL regressions | 91 passed across 7 files, exit 0 | `evidence/payments/qa-baseline-integration.log`. Separate synthetic database; no browser proof. |
| Legacy payment migration rehearsal | PASS | `evidence/payments/legacy-migration-rehearsal.json` preserves 3 payment rows, 3 allocations, 7 constraints, 7 indexes and original enum order across 14 migrations. Synthetic data only. |
| Payment API transport | 6 real-session PostgreSQL route tests passed, exit 0 | Inspected immutable log `evidence/payments/qa-routes-integration-2026-10-23T06-25-02.114Z-ca5128c8-5e3d-4129-bf73-917058cdcde8.log` and its exact target attestation. Independent reviewer separately records 63 boundary tests. The 235 unit count is an implementation report, not an assessor rerun. |
| Restore v3 | 48 runtime PASS lines; 36 operations tests passed with 0 failures | Inspected `evidence/operations-inventory/qa-v3-runtime-attempt2.log` and `qa-v3-all-ops.log`. Actual migrated synthetic 33/38-model schemas and private restore; operational recovery remains untested. |

## Final scoped full-suite assessment

The assessor inspected the actual `results.json`, `execution.json`, `database-identity.json`, complete wrapper log and independent billing review for fresh full run `92c0237d47f3ec10ef010234`. Its JSON contains 51 expected passes, zero skipped, unexpected or flaky tests, and an empty top-level errors array. The raw child browser log records exit 0, the wrapper records successful scoped shutdown with volumes retained, and execution records `browserStarted: true` and `succeeded: true`. Database identity names `taky_phase2_test` and role `e2e_92c0237d47f3ec10ef010234`.

The complete run includes tenant/lease CRUD, the unchanged original monthly billing flow, delayed rate-history isolation, invoice accessible states, meter recording/replacement/correction/STAFF restrictions, guarded destinations, and protected responsive pages. BR-04 is closed by its independently reviewed correction and this original-case pass. BR-01 through BR-03 were also accepted in the independent billing review. The extra delayed-history case raises this suite from the historical 50 to 51 cases. The prior 24/50 result is historical rather than current verification.

Evidence is `evidence/billing-remediation/full-agent-uat-run.log`, `evidence/billing-remediation/independent-review.md` and `evidence/remediation/browser-92c0237d47f3ec10ef010234/`. Passing screenshot evidence is retained for responsive pages. Trace capture is configured for failures, so passing cases need not have traces. This assessor inspected the retained execution artifacts; Main executed the browser command.

This scoped assessment accepts the tested Billing candidate for controlled local integration. After integration, relevant regression reconciliation remains Main's responsibility because the candidate and integrated payment UI are different source states. No claim covers untested financial policies or real production data.

## Current release blockers

The user delegated UAT execution to agents, so a separate Owner-executed UAT gate is not required. This report records Agent UAT and does not invent human acceptance. A newly reported tenant rent displaying zero still requires investigation and a targeted reproduction; the successful draft-lease rent test does not disprove that separate user report. Payment UI correction, independent code review and actual browser verification, invoice PDF exact monetary content and Thai visual layout, deposits, persisted expenses and reconciled reports remain required. AU-UX-01's stale demo footer is also recorded for correction.

Original-repository ancestry integration, remaining security/operations findings, real operational target configuration, deployment and post-deployment verification remain open. A scoped 51-case Billing pass is not whole-project completion or Go-Live acceptance.

Next assessment sequence: investigate the user-reported zero rent; reconcile integrated regression checks; execute persisted payment UI uncertainty, account isolation and lifecycle scenarios against its actual integrated build; directly inspect invoice PDF amounts and Thai layout; then continue acceptance coverage as missing ERP modules are implemented.
