# Agent UAT report

Assessment started 2026-10-23 by independent agent `agent_uat_acceptance`. The user authorized agents to perform acceptance testing and retain a report. This records Agent UAT; it does not record human Owner UAT acceptance.

Current result: **scoped Billing 51/51, persisted Payment UI 14/14 and targeted tenant-rent 3/3 plus 1/1 passed; invoice PDF visual acceptance failed; complete ERP release acceptance not granted**. Fresh complete run `92c0237d47f3ec10ef010234` passed all 51 cases with zero skips, unexpected results, flaky results or top-level errors. This closes the corrected monthly success-feedback defect and the billing browser regression gate for this candidate. Earlier failures remain recorded below as correction history.

## Baselines and execution boundaries

The current integration repository is `/private/tmp/taky-development`, HEAD `7944594`, plus reviewed but uncommitted Payment UI work at assessment. Billing was integrated through `d068f40`; tenant-rent correction is in the current committed baseline. The 51-case Billing proof originated in `/private/tmp/taky-billing-remediation`; Payment UI and tenant-rent proofs below run on the integrated candidate. A new complete suite after all changes is still required. Isolated app origin 3820 has not been deployed to original UAT ports 3700/3701. The user's clarification did not identify their observed port or deployed source, so candidate success does not diagnose or repair their existing environment.

Main executes Docker, database and guarded Playwright commands. This assessor reads actual source and retained artifacts, establishes expected behavior, and reports findings to Main and the billing implementer. The assessor does not change application code or database records. Original UAT ports 3700 and 3701 are outside this test target.

Browser plugin is not available in the listed skills. The existing Playwright workflow is used with Chrome, Thai locale, Bangkok timezone, challenged target identity, proxy port 3822, app origin `http://127.0.0.1:3820`, and synthetic database `taky_phase2_test`. Run-specific generated database roles identify each independent test environment. Private credentials remain outside this report.

## Acceptance coverage

| ID | Scenario and expected result | Current result | Evidence or remaining action |
| --- | --- | --- | --- |
| AU-01 | ADMIN creates a demo tenant, edits notes, reloads and sees persisted notes. Creates and updates a draft lease, verifies CSV values, and deletes the synthetic draft and tenant. | Pass | Fresh run `1a1e6c8144e1aa256a787f04`, 1/1 passed. |
| AU-02 | ADMIN creates a monthly period, effective-dated water/electricity rates, and audited selections; values survive reload; duplicate period is rejected without losing input. | Pass after correction | Full run `92c0237d47f3ec10ef010234` completed the original monthly case. Earlier BR-04 feedback failure is retained below. |
| AU-03 | ADMIN installs both synthetic meters, records and confirms readings, closes the complete period, sets due policy, drafts and issues the invoice. | Pass | Original monthly flow completed in fresh full run `92c0237d47f3ec10ef010234`. |
| AU-04 | Issued invoice PDF downloads with the expected invoice filename and PDF header. | Download passed; visual acceptance failed | Billing full run completed filename/header assertions. Independent rendered PDF assessment found missing ฿ and ³ glyphs; 27/39 checks passed, 12 failed. Monetary snapshot checks passed. Correction and independent rendered retest are required. |
| AU-05 | STAFF cannot access ADMIN billing creation controls or mutate periods, utility rates, and selections. | Pass | Full monthly flow completed the three real API 403 assertions and UI absence assertions. |
| AU-06 | A delayed response from the previous billing period cannot display another period's selected rate or approval reason. | Pass | Fresh run `630a110c3be65c3713cdb493`; controlled network responses prove client state isolation, not database approval correctness. |
| AU-07 | Invoice loading, ready, error and recovery states remain accessible at 390px. | Pass | Full run completed the mocked loading/ready/error/recovery assertions and Axe checks at 390px. Persisted lifecycle has separate monthly-flow proof. |
| AU-08 | Rooms, tenants, leases, billing and other protected pages render at 1440px, 768px and 390px without horizontal overflow, browser page errors or Axe violations. | Pass for tested rendering | Full run passed responsive, overflow, browser page-error and Axe assertions. A demo page rendering does not implement its underlying ERP module. |
| AU-09 | Meter replacement, correction, navigation persistence and STAFF restrictions work through actual controls. | Pass | All meter scenarios completed in the fresh full run, including 1440px and 390px validation/correction/replacement/STAFF cases. |
| AU-10 | Payment capture, confirmation, actor-scoped retry recovery, receipt viewing, cancellation and reversal work through persisted UI. | Pass for 14 tested scenarios; final review reconciliation pending | Fresh integrated run `4ab0ea5ccac38cee31e0d4cb` passed 14/14 after recovery-dialog correction. Actual browser evidence includes persisted lifecycle, response-loss replay, account restrictions, keyboard access and concurrent allocations. Receipt PDF remains separate. |
| AU-11 | Deposit liability, deductions/refunds, persisted OPEX/CAPEX and reconciled dashboard/report workflows work end to end. | Not available | These modules remain incomplete in the project backlog. |
| AU-12 | Production recovery, real target migration, operational setup and deployment succeed. | Not run | Synthetic restore evidence does not certify production recovery or a deployment. |
| AU-13 | Entered tenant contract rent survives room selection, immediate save, persisted API/profile reload, and explicit-zero/default handling. | Pass for isolated candidate | Corrected run `0ea382341f1086e5d740d5e6` passed 3/3. Clarified room-first/rent-last run `05437030b03bd82e05af9eba` passed 1/1. No deployment or existing data repair is implied. |

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

## Integrated payment UI acceptance

The assessor inspected actual JSON, execution and database identity records for two fresh runs. Initial run `09315d4d52c7272074c81c2b` recorded 10 expected passes, 4 unexpected failures and no skipped/flaky results or top-level errors. Three failures could not find the original-command retry control after uncertain mutations; another encountered an ambiguous alert assertion. The initial log and failure artifacts remain preserved. These were correction inputs, not an accepted run.

Corrected run `4ab0ea5ccac38cee31e0d4cb` recorded 14 expected passes, zero unexpected/skipped/flaky results and no top-level errors. `execution.json` records success; identity attests database `taky_phase2_test`, role `e2e_4ab0ea5ccac38cee31e0d4cb`. Raw `evidence/agent-uat/payment-ui-browser-attempt2.log` records 14 passed and child exit 0 with successful scoped shutdown and retained volumes.

The 14 cases cover persisted capture/confirmation/receipt lifecycle, STAFF restrictions, response-loss exact replay across Next navigation, cash duplicate review/override, stale invoice rejection, precision and amount validation, narrow/keyboard accessibility, protected uncertainty after 403 and real ADMIN demotion, second-page balances, malformed responses and stale detail isolation, bank duplicates without override, allocation paging failure, unmounted double-click completion, two ADMIN sessions racing allocations without overpayment, list pagination and keyboard-only dialogs. Cases include controlled failure interception as well as actual persisted requests; they are not 14 independent production deployments. Source acceptance and correction verification remain attributed to the separate reviewer; Main must reconcile the final frozen hashes and commit.

## Tenant-rent acceptance and diagnosis limits

The assessor inspected `evidence/tenant-rent/verification.md`, independent review and retained actual result/identity/execution records for corrected runs. Run `0ea382341f1086e5d740d5e6` passed 3/3 with no unexpected/skipped/flaky results or report errors. Its generated role is `e2e_0ea382341f1086e5d740d5e6`. Coverage verifies entered `4100.75` survives room selection/save/reload/reselection, unassigned tenants have no fabricated contract rent, untouched room defaults apply and explicitly entered `0.00` survives room changes and reload.

The retained baseline run `f96e52ffcc45c5a6aea73e80` reproduced entry-before-room-selection being overwritten from `4100.75` to `0`; its unassigned control passed. This is evidence of that particular ordering defect. The user subsequently clarified room selection first and rent entry last. Fresh corrected-candidate run `05437030b03bd82e05af9eba` follows that order, captures the actual tenant POST body with `rent: "4100.75"`, and verifies saved lease API plus profile before and after reload. Its actual JSON records 1/1 passed, no skipped/unexpected/flaky results or report errors; execution succeeded and identity matches role `e2e_05437030b03bd82e05af9eba`.

The clarified flow passes on this candidate. It does not establish the source version at the user's unidentified endpoint, reproduce their exact issue on that deployed endpoint, or recover previously lost values. The source correction preserves explicit entry; it does not guess historical tenant amounts. Logs are `evidence/agent-uat/tenant-rent-fixed-browser.log` and `tenant-rent-save-last-browser.log`; review and before-fix evidence are under `evidence/tenant-rent/`.

## Invoice PDF findings

The separate PDF assessor directly generated four synthetic artifacts with the real renderer, extracted their text and inspected rendered images. Its `evidence/pdf-agent-uat/report.md`, `checks.json` and retained artifacts record 27/39 checks passing and 12 failing despite the existing four PDF tests passing. Issued/VOID/long-name outputs preserve rent 8,500.00, water 63.00, electricity 876.75 and total 9,439.75; independent decimal calculations agree.

PDF-UAT-01 is the visibly missing baht glyph, rendered as an empty square and extracted as U+0000. PDF-UAT-02 is the missing superscript 3 in the actual water unit m³. Both repeat across artifacts. The implementation owner is correcting font coverage; these findings remain open until the independent reviewer regenerates the same artifacts, reruns assertions and visually inspects the corrected output. The beyond-storage-capacity precision fixture's margin overflow is a stress observation, not an established reachable-domain blocker. No physical printer, multi-page pagination or production invoice delivery certification follows from these synthetic artifacts.

## Current release blockers

The user delegated UAT execution to agents, so a separate Owner-executed UAT gate is not required. This report records Agent UAT and does not invent human acceptance. Full combined browser regression after Billing, Payment UI and tenant-rent integration remains required; the separate run counts must not be added and represented as one fresh full-suite pass. Payment UI final review/commit reconciliation and PDF glyph correction with independent visual retest remain open. Deposit workflows, persisted expenses and reconciled reports remain incomplete. AU-UX-01's stale demo footer is also recorded for correction.

Original-repository ancestry integration, remaining security/operations findings, real operational target configuration, deployment and post-deployment verification remain open. None of these scoped passes establishes whole-project completion or Go-Live acceptance. Existing UAT endpoints have not received this candidate, and no historical tenant amount was repaired.

Next assessment sequence: finish payment review reconciliation and PDF correction/retest; run the fresh combined suite on the frozen integrated build; resolve actual deployed-version discrepancies only against an identified endpoint; continue acceptance coverage as missing ERP modules are implemented.
