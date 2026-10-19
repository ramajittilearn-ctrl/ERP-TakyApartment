# Independent Pstack Compliance & Quality Audit — Phase 1 through Stage 3B

**Repository:** `ramajittilearn-ctrl/ERP-TakyApartment`
**Audited branch:** `phase-3b-meter-reading`
**Audited HEAD:** `fe702fc` (`Document Stage 3B design and verification`)
**Audit date:** 2026-10-19
**Audit type:** Read-only; no source changes, migrations, deployment, merge, or Stage 3C work

## 1. Executive Summary

This audit covers the delivered product from Phase 1 through Stage 3B: the initial UI foundation, Phase 2 backend/security, Phases 2.5 and 2.6, Stage 3A financial foundation, and Stage 3B meter reading. The implementation has useful scope documents, auditable service boundaries, additive database constraints, transactional audit records, exact-decimal calculations, and substantial automated verification. The checked-out branch is `phase-3b-meter-reading` at `fe702fc`, with the Stage 3B implementation commit `185e7e4` and documentation commit `fe702fc` present; the working tree was clean before this report was created.

The review found three issues that should be resolved before Stage 3C consumes meter readings for billing: staff can submit an `OPENING` reading through the ordinary draft API; confirming different readings out of chronological order does not revalidate the sequence or refresh dependent consumption; and the final reading created during meter replacement is not attached to the canonical billing period. These are supported by the current service implementation and have downstream financial consequences. They are not evidence of data loss already occurring, but they leave paths to incorrect or inaccessible billing inputs.

The available Pstack evidence shows real planning and verification activity, but does not establish complete compliance with the installed feature workflow. In particular, independent Stage 3A/3B code/security review and the required PR/handoff step are not evidenced. GitHub API access was unavailable during this audit, so PR status could not be confirmed. This is an evidence limitation, not proof that no PR exists.

**Recommendation: NO-GO for starting Stage 3C implementation against the current meter-data contract.** First address findings F-01 through F-03, add behavioral regression coverage, and agree the replacement-reading/billing-period contract. This recommendation concerns correctness of the Stage 3C input boundary; it does not penalize the project for intentionally excluding invoices, payments, deposits, or other future-stage work from 3A/3B. Production commissioning is outside this recommendation.

## 2. Audit Scope and Source Coverage

### Scope

Included delivered work:

- Phase 1 static/demo UI foundation.
- Phase 2 application backend, authentication, authorization, and persistence.
- Phase 2.5 backup/restore and operational recovery work.
- Phase 2.6 room, tenant, lease, and occupancy workflows.
- Stage 3A financial foundation, billing-period and utility-rate primitives, and calculation rules.
- Stage 3B meter lifecycle and reading capture, history, corrections, and replacements.
- Pstack workflow records/evidence available in the repository and installed Pstack instructions.

Excluded as future scope: Stage 3C billing/invoices and later payment/deposit work. No production rollout or commissioning assessment was performed.

### Sources reviewed

- Installed Pstack skill: `poteto-mode`, its feature/shipping/investigation playbooks, adapter guidance, and relevant review/writing principles.
- Git branch, status, and recent commits; Stage 3A/3B reports and design/test plans.
- Historical `PSTACK_AUDIT_REPORT.md` for Phase 1–2.6; Phase 1, 2, 2.5, and 2.6 implementation documents.
- `prisma/schema.prisma`, Stage 3A/3B SQL migrations, financial/meter services and validators, meter UI, Playwright configuration and meter spec, PostgreSQL integration tests.
- Original Stage 3B requirements attachment supplied with the task.
- A read-only comment/suppression review found no actionable source-comment issue or compiler/linter suppression in the scoped code and tests.

### Source limitations

- No separate Pstack session/transcript or independently authored Stage 3A/3B code-review/security-review artifact was found. Reports authored as implementation handoff are useful evidence of results, not independent verification of the workflow.
- The GitHub API was unreachable during the read-only PR lookup. PR status is therefore **NOT VERIFIED**.
- Prior phase reports are historical evidence, not fresh reruns at this audit date. Expensive checks were not repeated where exact-commit report evidence was available.
- The report records a full Playwright result of **14/15**, with one Phase 2.6 fixture-cleanup timeout and a successful focused rerun. It does not treat the focused rerun as a 15/15 full-suite result.

## 3. Pstack Workflow Compliance Matrix

Statuses describe available evidence, not an assumption that documentation proves every action took place. “NOT VERIFIED” means the audit could not substantiate it; it does not establish noncompliance.

| Pstack requirement | Status | Evidence and assessment |
|---|---|---|
| Discovery and requirements analysis | VERIFIED | Phase plans and Stage 3A/3B design/test documents capture domain rules, acceptance criteria, risks, and scope. Original Stage 3B requirements were compared to implementation and tests in this audit. |
| Architecture alternatives and decisions | PARTIAL | Phase 3 plan records an alternative/decision around effective-dated utility-rate history, and Stage 3B has a design document. No full decision record or contemporaneous exploration artifact for the principal 3B meter lifecycle/confirmation choices was found. |
| Implementation planning | VERIFIED | `docs/phase-3-implementation-plan.md`, database design, test plan, and Stage 3B design/test plan provide phased scope, acceptance gates, and risks. |
| Task decomposition | PARTIAL | Git history separates Stage 3A implementation/docs and Stage 3B implementation/docs into logical commits. The plan mentions small verified units, but no detailed task ledger or execution log was located. |
| Code review | PARTIAL | An earlier Pstack audit covers Phases 1–2.6. No independent Stage 3A/3B code-review artifact was found. This audit is independent but is post-implementation and read-only. |
| Security review | PARTIAL | Earlier security/operational review and Stage 3A/3B security assertions exist, with auth and role tests. A distinct independent Stage 3A/3B security review record was not found; this audit identifies an opening-reading authorization path. |
| Testing and verification | PARTIAL | Exact test/build/schema evidence is recorded in reports. Stage 3B has 39 unit and 33 PostgreSQL integration tests, 8 test-operations/security checks, Docker build and zero schema drift; full browser run is 14/15, with focused rerun of the timed-out case passing. Requirement-level E2E and cross-record concurrency gaps remain. |
| Documentation and handoff | PARTIAL | Phase-specific plans, designs, test plans, and implementation reports are present; the branch was pushed and implementation/docs are split across commits. A pull request or completed Pstack shipping handoff could not be verified because GitHub API access failed. |

The installed feature workflow also expects an explicit throughput checkpoint, delegated work where appropriate, verification, ordered commits, and a PR handoff. For this read-only audit, implementation/throughput work was not applicable. Commit sequencing and verification are evidenced; a PR handoff is not verified. No broad claim of full Pstack compliance is warranted from the available record.

## 4. Requirements Traceability Matrix

The matrix summarizes major requirements across the full delivered scope. Phase 1–2.6 entries rely on their phase documents and the prior Pstack audit; the focused source review in this audit concentrated on Stages 3A and 3B.

| Requirement | Implementation evidence | Test evidence | Status | Gap |
|---|---|---|---|---|
| Phase 1 Thai-first static/demo UI and core navigation | `docs/phase-1-readme.md`; initial UI routes and demo data | Historical Phase 1 test documents; current Playwright config does not include `tests/frontend.spec.ts` or screenshot specs | PARTIAL | Current default E2E command does not regress those Phase 1 suites. This is a regression-config gap, not proof the original Phase 1 acceptance failed. |
| Phase 2 persisted backend, authentication, role-based access, and audited mutations | `docs/phase-2-architecture.md`; backend route/service and audit patterns; historical audit | Historical integration/security results; report coverage includes auth, RBAC, origin checks, audit, and transaction behavior | VERIFIED (documented) | Historical result evidence was not rerun for this audit. |
| Phase 2.5 backup/restore and recovery path | `PHASE_2_5_IMPLEMENTATION_REPORT.md` documents encrypted local backup, upload pipeline, restore, HTTPS testing | Reported automated and local-backend checks | PARTIAL | Real Google Drive upload/key escrow, owner-admin setup, and second-device trust/recovery remain owner-run/not verified; operational commissioning is not a Stage 3B code defect. |
| Phase 2.6 rooms, tenants, leases, occupancy workflows | `PHASE_2_6_IMPLEMENTATION_REPORT.md` | Historical 41/41 browser result and database/concurrency checks | VERIFIED (documented) | Prior report notes some race scenarios were not exercised; not freshly rerun. |
| Stage 3A canonical monthly billing periods with state/uniqueness constraints | `prisma/schema.prisma` BillingPeriod; `202610180001_phase3a_financial_foundation/migration.sql` | Stage 3A report: six migrations applied, drift zero; test plan and reported integration tests | VERIFIED | No confirmed Stage 3A defect found in reviewed code. |
| Stage 3A exact-decimal financial calculations, input validation, utility-rate history, and auditable administration | `src/server/finance/calculations.ts`, `validation.ts`, `service.ts`; financial migration | Stage 3A report: 35/35 unit, focused 7/7, 25/25 integration; type/lint/format/Prisma/Docker checks reported passing | VERIFIED | Rate-selection and period-close business policies are documented as future decisions for invoice workflow, not 3A omissions. |
| Stage 3B independent water/electric readings and separate user-selected dates, default today | `src/server/meter/service.ts`; `src/features/meters/screen.tsx` maintains dates by meter; design/report | 39 unit tests, 33 database tests; focused mobile browser test persisted different dates after reload | VERIFIED | Browser coverage is focused, not a full workflow E2E. |
| Historical reading entry with future/date/period/lifecycle and meter-history validation | `src/server/meter/service.ts` date and chronology validators | Integration test exercises future rejection and historical-period success through normal dated data; unit/date validation cases | PARTIAL | Confirmation does not repeat chronology checks, leaving a race/order path after draft validation (F-02). Legacy null-date baseline discovery differs between service queries (F-06). |
| Prevent duplicate readings and preserve transactional audit history | Meter uniqueness constraints, serializable writes, audit and append-only history in Stage 3B migration/service | Integration duplicate/concurrency and audit tests; reports 33/33 DB tests and 8/8 test-operations checks | PARTIAL | Same-record concurrent confirmation is covered, but different-reading/out-of-order confirmation is not; confirmation sequence can become inconsistent (F-02). |
| Restrict meter opening/replacement/correction operations to authorized roles | `registerMeter`, `correctReading`, and `replaceMeter` enforce ADMIN; STAFF normal reading path exists | Integration tests verify staff cannot register meter and can submit/confirm normal reading | PARTIAL | Draft API accepts `type: OPENING` without an ADMIN check, bypassing the intended opening-reading path (F-01). |
| Meter replacement captures final old and initial new readings for period-aware downstream use | `src/server/meter/service.ts` replacement workflow and `MeterReplacement` relation | Integration replacement coverage verifies the operation and records | PARTIAL | Final old-meter reading omits the `billingPeriodId` assigned to the initial new-meter reading; downstream billing-period queries and correction flow may miss/reject it (F-03). |
| Mobile/desktop entry, history, correction records show dates and audit context | `src/features/meters/screen.tsx` date fields and `HistoryPanel`; service history DTO | Focused 390px mobile test; integration correction/history coverage | PARTIAL | Ordinary history rows omit recorded/confirmed timestamps, and replacement rows omit creation timestamp despite test-plan expectation; loading race remains (F-04/F-05). Desktop behavior not separately evidenced by a browser run. |
| Prevent stale-data overwrite and allow safe form interaction under loading | UI loads overview on filter changes and after save | No delayed/out-of-order request browser test found | NOT VERIFIED | Fetches are unguarded and old form state remains actionable during filter loading; response order can replace newer state (F-04). |
| Stage 3B verification gates: full browser, Docker production build, schema drift | `PHASE_3B_IMPLEMENTATION_REPORT.md` | Report records 14/15 full browser, focused rerun pass, Docker build pass, seven migrations and zero drift | PARTIAL | Full suite remains 14/15; focused rerun does not elevate aggregate result. One meter E2E hardcodes 2026-10-18 and is date-brittle (F-07). |
| Stage 3C invoices/payments/deposits | Explicitly excluded by Stage 3B scope | Not applicable to Stage 3B | NOT APPLICABLE | No gap; not scored as a Stage 3A/3B defect. |

## 5. Architecture Review

### Stage 3A

The reviewed design has a useful separation between validation, exact-decimal calculation, and persistence/service orchestration. `src/server/finance/calculations.ts` uses Prisma Decimal and explicit rounding, while `src/server/finance/validation.ts` applies strict input shapes. `src/server/finance/service.ts` uses serializable transactions, locks the relevant property/period for administrative mutations, writes audit records in the same transaction, and makes period closing idempotent. The schema gives billing periods a canonical property/month identity, and the migration constrains month shape, uniqueness, lifecycle identity, and utility-rate immutability. No confirmed defect was found in the reviewed Stage 3A paths.

### Stage 3B

Meter behavior is separated into validation, service logic, persistence, and a dedicated screen. The design reuses BillingPeriod and existing MeterReading fields where possible; readingDate is separate from createdAt, and corrections/replacements have append-only records. Locking and serializable transactions are used for drafting and corrections. These are strong foundations.

The important gap is that correctness is established at draft creation but not at the transition to confirmed. `confirmReading` locks a single reading row and marks it confirmed without locking the meter and re-evaluating neighboring confirmed readings. That means valid drafts can become invalid as a set due to confirmation order. Replacement also finds the canonical period but fails to attach the final old-meter reading to it. These gaps cross the persistence/service boundary and need to be resolved before billing relies on the resulting readings.

The UI is a single screen with several workflows. The date state is correctly keyed by meter, supporting independent water/electric dates. However, asynchronous overview loads have no stale-response guard, and the selected reading form can remain actionable against old overview data while a changed filter is loading. A request-generation guard/abort plus explicit loading-state protection would make that boundary safer.

## 6. Security and Data Integrity Findings

No critical finding was established. The three Stage 3B findings below are substantive correctness/authorization issues for the next-stage billing boundary.

### F-01 — Staff can create and confirm an opening reading through the ordinary draft path

- **Severity:** High
- **References:** `src/server/meter/validation.ts:3-25`; `src/server/meter/service.ts:304-388, 391-429`; `tests/integration/meter-reading.test.ts:82-116`
- **Evidence:** Draft input accepts `readingType` OPENING/NORMAL. `upsertDraftReading` validates numeric/date/history rules but does not require ADMIN for OPENING. `confirmReading` also does not authorize by reading type. The tested STAFF restriction covers `registerMeter`, not OPENING through draft.
- **Impact:** A STAFF user can bypass the ADMIN-only meter-registration opening path and potentially establish an incorrect baseline used to compute future consumption.
- **Recommended action:** Enforce the opening-reading authorization invariant in the service/domain boundary for both draft and confirmation, and add STAFF/ADMIN API tests that exercise the ordinary endpoint with `type: OPENING`.
- **Blocks Stage 3C:** Yes.

### F-02 — Confirming drafts out of order can leave confirmed readings chronologically inconsistent

- **Severity:** High
- **References:** `src/server/meter/service.ts:304-388, 391-429`; `tests/integration/meter-reading.test.ts:118-168`
- **Evidence:** Draft creation checks prior and next confirmed readings. Confirmation only locks the target reading; after checking period openness, it marks that row confirmed and does not revalidate neighboring dates/values or recompute dependent consumption. Existing concurrent confirmation coverage targets two requests for the same reading, not two different readings.
- **Impact:** For example, a later period can be confirmed before an earlier draft; the earlier one can then be confirmed without updating the later reading's consumption or rechecking value order. Billing can consume stale consumption or an invalid meter sequence.
- **Recommended action:** Make confirmation serialize on the meter and revalidate the neighboring confirmed sequence inside the transaction; recalculate any affected dependent consumption or reject the transition. Add out-of-order and concurrent-different-reading integration tests.
- **Blocks Stage 3C:** Yes.

### F-03 — Final old-meter replacement reading is not associated with its billing period

- **Severity:** Medium
- **References:** `src/server/meter/service.ts:736-740, 770-800, 501-527`
- **Evidence:** Replacement resolves the open period for the replacement date. The initial reading for the new meter stores `billingPeriodId`; the final reading for the old meter is created without it. Corrections require a confirmed reading with a non-null `billingPeriodId`.
- **Impact:** A Stage 3C query scoped to a billing period can omit the old meter's final consumption. The final reading also cannot use the normal period-linked correction path.
- **Recommended action:** Define the replacement billing contract, associate the old final reading with the resolved period where valid, and test period-based retrieval and correction behavior for both sides of a replacement.
- **Blocks Stage 3C:** Yes, unless Stage 3C explicitly supports and tests a different representation before using this data.

### F-04 — Overview fetch race can restore stale filter data and leave old form actionable

- **Severity:** Medium
- **References:** `src/features/meters/screen.tsx:128-175, 187-227, 306-425`
- **Evidence:** Filter changes trigger asynchronous loads; responses unconditionally set the overview and per-meter form state. There is no abort/request-generation check. The room list has a loading branch, but the selected-room entry form remains rendered from previous state and is not disabled for the pending load.
- **Impact:** A slower earlier response may overwrite the latest filter state, while a user can interact with a stale room/form during transition. This is a plausible wrong-room/data usability risk, not a demonstrated persisted incident.
- **Recommended action:** Guard response application by request identity or abort superseded requests; disable the selected-room form during loading and reset selection when its room is absent from the new overview. Add a delayed-response browser test.
- **Blocks Stage 3C:** No, but fix before relying on the screen for broad operational rollout.

### F-05 — History omits some timestamps promised by the test plan

- **Severity:** Low
- **References:** `src/features/meters/screen.tsx:582-623`; `src/server/meter/service.ts:432-499`; `docs/phase-3b-test-plan.md`
- **Evidence:** Correction rows show createdAt, correctedBy, and original reading date. Normal reading rows show reading date and operator but not createdAt/confirmedAt. Replacement rows show replacement date and operator but not createdAt. The test plan expects operator and timestamps in room history.
- **Impact:** Operators have less audit context in the UI than the documented history acceptance criteria imply. Persisted audit/history records remain available in the backend.
- **Recommended action:** Display recorded/confirmed timestamps for readings and event timestamp for replacement rows, or revise acceptance docs if intentionally excluded; cover displayed history fields in browser tests.
- **Blocks Stage 3C:** No.

### F-06 — Legacy meter readings without a matching canonical period can be invisible as the displayed baseline

- **Severity:** Medium, conditional on such legacy rows existing
- **References:** `prisma/migrations/202610180002_phase3b_meter_reading/migration.sql:27-38`; `src/server/meter/service.ts:128-145, 245-257`
- **Evidence:** Migration backfills dates/period links only when a legacy period matches a canonical BillingPeriod start. `previousConfirmed` has a period fallback for null readingDate; the overview baseline query only selects by readingDate and does not include legacy null-date rows with an earlier period. Thus backend validation can see a previous reading the UI overview does not display.
- **Impact:** For an affected legacy meter, UI can present “no prior reading” and submit an OPENING draft, which service validation then rejects because a historical prior reading exists. Preservation/accessibility of that legacy history is inconsistent.
- **Recommended action:** Before cutover, inventory null-date/unlinked confirmed readings; define safe period mapping or include legacy fallback in overview baseline selection, then add a migration-fixture regression test.
- **Blocks Stage 3C:** Conditional—yes if affected legacy readings exist; otherwise resolve as a migration-data risk before the relevant cutover.

### F-07 — Meter browser test hardcodes the date it considers “today”

- **Severity:** Medium (test reliability)
- **References:** `tests/phase2/meter-reading.spec.ts:99-101`; `src/features/meters/screen.tsx:66-69`
- **Evidence:** The test asserts the date input defaults/max to `2026-10-18`, while the UI computes local today dynamically. No test clock setup was found in the test/config. Audit date is 2026-10-19.
- **Impact:** This E2E becomes date-dependent and can fail as the calendar advances, independently of product behavior.
- **Recommended action:** Freeze browser time in the test or derive the expected local date from the test environment; keep min/max assertions tied to the selected billing period.
- **Blocks Stage 3C:** No, but reduces confidence in repeatable regression gates.

### F-08 — Stage 3B browser coverage does not exercise the complete user workflow

- **Severity:** Medium (verification gap)
- **References:** `tests/phase2/meter-reading.spec.ts:43-135`; `playwright.config.ts:4-7`; `docs/phase-3b-test-plan.md`; `PHASE_3B_IMPLEMENTATION_REPORT.md`
- **Evidence:** The meter E2E exercises mobile date fields, saving water/electric drafts with separate dates, and reload persistence. It does not exercise interactive confirmation, validation errors, history presentation, ADMIN correction/replacement UI, STAFF restrictions, or floor navigation. The default Playwright match targets `phase2/**/*.spec.ts`, excluding Phase 1 frontend/screenshot specs. Aggregate report is 14/15; one Phase 2.6 fixture-cleanup timeout passed only on a focused rerun.
- **Impact:** Some acceptance requirements and regressions are supported only by service/integration tests or not directly verified in the browser. The focused rerun does not prove the full suite passed.
- **Recommended action:** Add targeted user-facing E2E flows for the listed Stage 3B behaviors, fix the known timeout/isolation issue, make the date assertion deterministic, and preserve/report aggregate suite results separately from focused reruns.
- **Blocks Stage 3C:** No for development after F-01–F-03 are addressed; yes as a release gate if the project requires complete browser acceptance before billing rollout.

## 7. UX/UI Review

The meter entry screen supports a compact mobile layout, independent date state for water and electricity, visible reading dates, and date-input bounds based on the period and current local date. The focused 390px run is useful evidence that both readings can be saved with different dates and remain distinct after reload. The history DTO includes operator and timestamp data, and correction rows display the original reading date.

The main risks are transition behavior and incomplete audit presentation. During filter changes the form can remain actionable against old data, and overlapping fetches can apply out of order (F-04). History does not surface timestamps consistently across ordinary readings and replacement events (F-05). Desktop behavior, correction/replacement interaction, and STAFF-denied UI states were not separately established by a complete browser suite. No visual claim beyond the recorded focused mobile case is made.

## 8. Test Evidence Assessment

Evidence from the committed Stage 3B report:

| Check | Reported result | Audit assessment |
|---|---:|---|
| Database integration | 33/33 | Reported pass across four files; includes service/database lifecycle and correction/replacement paths. No repeat needed for this audit. |
| Unit tests | 39/39 | Reported pass across five files. |
| Security/test-operations checks | 8/8 | Reported pass; does not cover STAFF using OPENING through the normal draft endpoint. |
| Full browser suite | 14/15 | One Phase 2.6 fixture-cleanup timeout; the suite must remain reported as 14/15. |
| Focused rerun | Pass | The timed-out test passed when rerun in isolation; this does not change the aggregate full-suite result. |
| Mobile separate-date browser flow | Pass | Focused 390px case saves separate water/electric dates and verifies persistence. |
| Docker production build | Pass | Exact result recorded in Stage 3B report. |
| Prisma schema drift | Zero drift | Seven migrations applied; report records clean drift check. |
| Typecheck/lint/format/Prisma checks | Pass | Reported in implementation report. |

Additional test-quality observations:

- Same-reading concurrent confirmation is not equivalent to concurrent confirmation of two different readings; the latter is needed for F-02.
- Replacement coverage verifies the operation but not period-linked retrieval of the final old-meter reading (F-03).
- No browser test deterministically delays an old overview request to exercise F-04.
- Meter E2E date expectation is hardcoded and time-dependent (F-07).
- Current Playwright default match excludes the historical Phase 1 frontend and screenshot specs. Their historical results remain documented but are not part of the current default browser run.

No new expensive test suite was run. The audit relied on exact-commit reports and targeted source/test inspection; where workflow status could not be checked, it is explicitly marked NOT VERIFIED.

## 9. Weighted Quality Score

Scores assess completed Phase 1–Stage 3B scope only. Weights emphasize behavior coverage, integrity, and security at the boundary that Stage 3C will consume. The score is a structured audit judgment, not a production-readiness certification.

| Dimension | Weight | Score | Basis |
|---|---:|---:|---|
| Pstack workflow compliance | 10% | 60 | Good planning and evidence artifacts; incomplete independent review, execution-log, and shipping/PR evidence. |
| Requirements coverage | 20% | 84 | Broad delivered scope and date functionality; authorization, confirmation-order, replacement-period, and UI acceptance gaps. |
| Architecture and maintainability | 15% | 85 | Clear finance/meter boundaries, typed validation, transactional services; transition consistency and screen request orchestration need strengthening. |
| Database integrity | 15% | 83 | Useful uniqueness/check/immutability/audit constraints and drift evidence; replacement link and legacy mapping risk remain. |
| Security | 15% | 82 | Strong general role/security foundation, but opening-reading path lacks role enforcement. |
| UX/UI implementation | 10% | 80 | Responsive independent-date entry is evidenced; stale loading behavior and timestamp omissions lower confidence. |
| Automated testing | 10% | 71 | Substantial unit/integration coverage and build checks; 14/15 aggregate browser result, E2E gaps, and brittle date. |
| Documentation quality | 5% | 92 | Strong phase plans, design/test docs, and implementation evidence reports; some acceptance claims exceed directly demonstrated browser coverage. |
| **Overall weighted score** | **100%** | **80/100** | Weighted sum: 8.0 + 16.8 + 12.75 + 12.45 + 12.3 + 8.0 + 7.1 + 4.6 = **80.0**. |

## 10. Findings and Remediation Plan

Recommended order:

1. **F-01:** enforce ADMIN authorization for opening-reading creation and confirmation; test the route as STAFF and ADMIN.
2. **F-02:** serialize and revalidate meter chronology when confirming; define recalculation/rejection behavior and test out-of-order plus concurrent distinct readings.
3. **F-03:** settle and implement the billing-period association for both old final and new initial replacement readings; test downstream period lookup and correction eligibility.
4. **F-06:** inventory existing legacy rows and ensure overview and service share a compatible baseline mapping.
5. **F-04:** prevent stale overview responses and disable/reset the form during filter transitions; add a delayed-response UI regression test.
6. **F-07/F-08:** make the browser clock deterministic, address the known 14/15 timeout, and cover confirmation, validation, history, correction/replacement, navigation, and staff restrictions in E2E.
7. **F-05:** align visible history timestamps with the test-plan acceptance criteria.
8. Record independent code/security review and the shipping/handoff evidence in the Pstack workflow record; retry the read-only PR lookup when GitHub is reachable.

## 11. Stage 3C Recommendation

**NO-GO to begin Stage 3C against the current Stage 3B behavior.** F-01, F-02, and F-03 affect authorization and the integrity/completeness of meter inputs that a billing stage would consume. Resolve them with focused tests and agree the replacement-period contract first. Reassess F-06 based on actual legacy data. Once those gates are closed, Stage 3C development can proceed without waiting for unrelated production commissioning tasks; production deployment readiness is outside this audit and is not scored as a Stage 3A/3B defect.

### Audit disposition

This report is the only file created by the audit. No implementation files, migrations, commits, pushes, merges, or deployments were changed or performed. The report is intentionally uncommitted and unpushed.

## 12. Stage 3B Remediation Addendum — 2026-10-19

This addendum records the subsequent remediation work. It supersedes the earlier report's current-state assessment for F-01, F-02, and F-03 only; the original findings remain as the audit evidence for the defects as they existed at `fe702fc`.

| Finding | Original severity | Updated status | Remediation evidence |
|---|---|---|---|
| F-01 — Staff opening-reading authorization | High | RESOLVED | `upsertDraftReading` now requires ADMIN for `OPENING`; `confirmReading` independently checks ADMIN for an opening draft. PostgreSQL regression verifies STAFF draft and confirmation attempts return 403 without mutating the draft; ADMIN confirmation succeeds; the existing STAFF NORMAL flow remains covered. |
| F-02 — Out-of-order confirmation and closed-successor correction | High | OPEN; order protections work, but closed-period integrity is not enforced for successor recalculation | Draft saves and confirmation serialize on the meter, and correction uses the same meter lock and READ COMMITTED. The open-period correction/confirmation race test passes. A separate isolated reproduction found that correcting a predecessor in an open period succeeds after its confirmed successor's period is closed; the service changes successor consumption from 10.000 to 14.500 and appends a correction record in the closed period. `correctReading` checks only the predecessor's period. This violates the closed-period contract. |
| F-03 — Replacement final reading missing billing-period association | Medium | RESOLVED | The final old-meter reading now stores the canonical open `BillingPeriod` already resolved by the replacement transaction. PostgreSQL tests verify both replacement readings are discoverable by that period and the final reading remains eligible for an audited correction while it is open; browser E2E exercises the ADMIN replacement flow and verifies both links. |

### F-02 policy clarification

The implementation rejects out-of-order confirmation and serializes corrections with confirmation. The correction policy is incomplete: it may recalculate a successor whose billing period is closed. The correction row and audit entry record the change, but the closed period is still mutated. F-02 remains open until the service rejects this transition or follows another owner-approved policy without changing closed-period data. No policy change or fix was made during this closure run.

### Remediation-time disposition

The findings below were not part of the original blocking-finding remediation. Their current closure disposition appears in Section 13. The full browser suite remains **14/15**; focused reruns do not change that aggregate.

The remediation created no schema migration and did not change production data. Section 13 records the later read-only inventory and close-out work.

## 13. Final Stage 3B Closure Addendum — 2026-10-19

This addendum records closure verification on the working tree after the remediation changes. It does not remove the original findings or alter the historical weighted audit score, which describes the code at `fe702fc`.

### F-01 through F-03

F-01 and F-03 are **RESOLVED**. F-02 remains **OPEN** because the isolated closed-successor reproduction below shows a confirmed change to a closed billing period. The PostgreSQL suite passed 36/36 before this newly discovered case was added; focused mobile and replacement browser tests each passed 1/1.

### Residual finding disposition

| Finding | Severity | Status | Evidence and risk | Responsible workstream | Target | Development-blocking | Production-blocking |
|---|---|---|---|---|---|---|---|
| F-04 — Overview request race and stale form | Medium | OPEN | `src/features/meters/screen.tsx` applies overview responses and resets draft form state without request identity checks; the form remains actionable while loading. A delayed response can replace unsaved input or show stale filter results. No automatic write occurs; saves use the visible meter identity and the service validates period and reading date. No cross-meter database write was demonstrated. | Frontend | Stage 3B follow-up before operator rollout | No | Yes, until fixed or explicitly accepted after operator testing |
| F-02 — Correction recalculates a successor in a closed period | High | OPEN | On an isolated PostgreSQL database, the service accepted correction of a March predecessor after the May successor period was closed. The successor consumption changed from 10.000 to 14.500 and a correction row was appended to the closed period. `correctReading` only calls `lockPeriod` for the predecessor. | Backend/database | Stage 3B blocker before Stage 3C | Yes | Yes |
| F-05 — History omits some timestamps | Low | OPEN | Reading history omits recorded/confirmed times and replacement history omits event time in the UI, although backend audit records retain timestamps. This limits operator context. | Frontend | Stage 3B follow-up | No | No |
| F-06 — Legacy meter data lacks canonical date/period mapping | Medium, conditional | RESOLVED for the inspected snapshot; re-inventory before billing cutover | A read-only transaction against the accessible local `taky` database returned 0 `UtilityMeter` rows, 0 `MeterReading` rows, and 0 orphan readings. Its migration history contains only the first three migrations; the live schema predates Stage 3A/3B and has no reading-date or period-link columns. There are no existing meter rows to map in this snapshot. This does not certify any later database snapshot. | Database/operations | Recheck after Stage 3A/3B migration and before first actual billing run | No | Yes, if the dataset changes before cutover or any legacy rows appear |
| F-07 — Browser test assumes a fixed current date | Medium, test reliability | RESOLVED | The mobile meter test now freezes browser time at `2026-10-18`; the focused test passed against the final isolated app. | QA/frontend | Completed in Stage 3B closure | No | No |
| F-08 — Browser coverage and aggregate confidence | Medium, verification gap | OPEN | The historical full browser run remains 14/15. Focused separate-date and replacement tests pass, but browser coverage still omits several validation, correction, STAFF-denial, and history interactions. | QA | Stage 3C pre-release/UAT | No | Yes, until required browser regression and operator UAT pass |

The F-04 source review found a user-input-loss risk when an asynchronous overview load resets an unsaved form. It did not find an automatic persistence path or evidence that the service can save a reading against a different physical meter than the one represented by the submitted `meterId`. Period/date validation remains in the service. Treat F-04 as an operator-rollout gate, not a blocker to development closure.

### Closure recommendation

**Stage 3B development: NOT CLOSED. Stage 3C development: NO-GO. Production billing: NO-GO.** F-01 and F-03 are resolved, but F-02 remains a High blocker because correction can change a confirmed successor in a closed period. The open-period correction/confirmation test and full 36/36 integration suite pass, but neither covers this closed-successor case. Resolve F-02 and pass a focused regression before Stage 3C begins. The accessible target database snapshot contains no meter rows, but its schema predates Stage 3A/3B. Recheck it after migration and before billing.

No closure commit or push was made because the F-02 blocker remains. `STAGE_3B_CLOSURE_REPORT.md` records the failed closure gate. No Stage 3C application code, migration, production data change, deployment, merge, or force-push was performed. The closed-period reproduction changed only an isolated test database.

## 14. Final F-02 Remediation and Closure Addendum — 2026-10-19

This dated addendum supersedes the working-tree status in Sections 12–13, but preserves their original audit evidence and the original weighted scores for commit `fe702fc`. The owner-approved policy is now explicit: closed billing periods are immutable; future financial adjustments are deferred to Stage 3C after separate business-rule approval.

### F-02 resolution

`correctReading` retains the per-meter `FOR UPDATE` lock and `READ COMMITTED` transaction. Before any correction history, reading update, successor update, or audit write, it discovers the target and the immediate confirmed successor for the same physical meter, rejects an affected legacy successor without a canonical period, then locks all distinct affected period IDs in sorted order through the existing `lockPeriod` helper. Any closed affected period aborts the transaction. Because the successor lookup is scoped to the physical `meterId`, replacement opening readings on a new meter are not treated as successors of the old meter. No schema or migration change was needed.

The isolated PostgreSQL regression reproduces March `110.000` → May `120.000`, closes May, attempts March correction to `105.500`, and asserts `PERIOD_CLOSED`; March value, consumption, and predecessor link are unchanged; May consumption and predecessor link are unchanged; and correction plus CORRECT/CONFIRM audit counts do not increase. Additional PostgreSQL tests prove an open successor correction still succeeds, an open intermediate successor may be updated without changing a later closed successor, and replacement histories remain separate by meter identity. Independent Pstack review found no new Critical or High defect in the transaction invariants.

| Finding | Final severity/status | Evidence |
|---|---|---|
| F-01 — Opening-reading authorization | High — RESOLVED | Service-level ADMIN checks at draft and confirmation boundaries; PostgreSQL authorization tests. |
| F-02 — Chronology and closed-period successor mutation | High — RESOLVED | Per-meter serialization plus sorted affected-period locks before all writes; atomic PostgreSQL rejection, open-period correction, multi-successor and replacement tests. |
| F-03 — Replacement final-reading period association | Medium — RESOLVED | Both final and initial readings use the canonical period; PostgreSQL and focused ADMIN browser coverage. |

### Final verification evidence

- Unit tests: `npm test`, 40/40.
- PostgreSQL integration: `npm run test:integration` inside the isolated `taky-phase3b-f02` app/database project, 39/39 across four files, including 14 meter workflow tests.
- Focused correction/confirmation concurrency: 1/1 in the prior isolated focused run; the same test passes in the final 39/39 run. A later attempt to run it alone against the already-populated shared test database could not initialize because its unique billing-period fixture already existed; this is not a product-test failure.
- Browser: focused separate water/electric date and ADMIN replacement workflows passed 2/2 against the isolated app. The historical full Playwright run remains 14/15; it is not represented as 15/15.
- Operations/security tests: 8/8. Typecheck, lint, formatting, `git diff --check`, Docker production build, migration status (seven migrations applied), and Prisma schema drift check passed. No migration was added.
- No production database or data was modified. The database used for PostgreSQL/browser checks was an isolated Docker test project.

### Follow-up ownership and stage

| Finding | Severity/status | Owner | Target | Required action |
|---|---|---|---|---|
| F-04 — Overview response race/stale form | Medium, OPEN | Frontend owner | Stage 3B operator-rollout follow-up | Guard stale responses and preserve unsaved input; add delayed-response UI test or record explicit operator acceptance. |
| F-05 — Missing history timestamps in UI | Low, OPEN | Frontend owner | Stage 3B UX follow-up | Display recorded/confirmed and replacement event timestamps. |
| F-06 — Legacy meter date/period mapping | Medium, NOT VERIFIED for intended post-migration target | Database/operations owner | Mandatory pre-billing gate before Stage 3C actual billing | Confirm target identity, migrate, run read-only inventory, map any legacy rows, retain evidence. Must remain open as a billing gate until target data is verified. |
| F-07 — Nondeterministic browser “today” | Medium test-reliability, RESOLVED | QA/frontend owner | Completed in Stage 3B | Browser clock fixed for date regression. |
| F-08 — Browser coverage and aggregate confidence | Medium, OPEN | QA owner | Stage 3C pre-release and operator UAT | Expand validation/correction/history/role E2E coverage; investigate historical 14/15 timeout; run full suite and UAT. |

### Final recommendation

**Stage 3B: CLOSED for development. Stage 3C: CONDITIONAL GO.** F-01 through F-03 are resolved. Stage 3C may begin within its approved scope, but billing against actual target data remains gated on F-06 inventory/mapping. F-04 and F-08 remain operator rollout and pre-release gates; F-05 is a low-severity UX follow-up. No billing, invoice, payment, deposit, adjustment, deployment, or merge work is included here.
