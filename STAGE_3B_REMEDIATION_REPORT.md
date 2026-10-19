# Stage 3B Audit Remediation Report

**Date:** 2026-10-19
**Branch:** `phase-3b-meter-reading`
**Scope:** Audit findings F-01, F-02, and F-03 only
**Restrictions honored:** No Stage 3C, production-data changes, deployment, merge, or force-push

## Outcome

F-01 and F-03 are resolved. F-02 remains open after a later closure check found that correcting an open-period predecessor can mutate its confirmed successor in a closed period. No Prisma schema or migration change was made. The implementation still uses the existing role, meter, billing-period, audit, and correction-history structures.

Stage 3C recommendation: **NO-GO until F-02 is resolved**. The accessible local `taky` database has no meter rows, but its schema predates Stage 3A/3B; repeat the inventory after migration and before the first actual billing run. This is not production deployment authorization.

## Finding and acceptance-criteria traceability

### F-01 — Staff can create or confirm an opening reading through the ordinary draft path

- **Original severity:** High
- **Original evidence:** `src/server/meter/validation.ts:5,17-25` allowed `OPENING`; `src/server/meter/service.ts:304-388` accepted it without role enforcement, and `391-429` confirmed without checking role/type. The earlier integration test at `tests/integration/meter-reading.test.ts:82-116` only covered STAFF denial for meter registration, not the draft endpoint.
- **Acceptance criteria:** Only ADMIN may create or update an `OPENING` draft or confirm one. STAFF must retain ordinary `NORMAL` draft/confirm access. Denied operations must leave readings and audit history unchanged.
- **Change:** `upsertDraftReading` now calls the existing `requireAdmin` policy for `OPENING`; `confirmReading` checks the stored reading type and role before confirming. The existing registration and replacement paths remain ADMIN-controlled.
- **Regression evidence:** `tests/integration/meter-reading.test.ts:118-165` verifies STAFF opening-draft rejection with 403 and no row-count change, STAFF confirmation rejection with the draft still unchanged, ADMIN confirmation success, and the pre-existing STAFF NORMAL workflow. The final full PostgreSQL suite passed 36/36.
- **Status:** **RESOLVED**.

### F-02 — Out-of-order confirmation can leave confirmed readings inconsistent

- **Original severity:** High
- **Original evidence:** `src/server/meter/service.ts:304-388` calculated predecessor/consumption at draft time; `391-429` locked only the target reading and confirmed without rechecking neighboring readings or recomputing consumption. Previous concurrency coverage was limited to two confirmations of the same row (`tests/integration/meter-reading.test.ts:118-151`).
- **Acceptance criteria:** Confirmation must serialize for a meter, validate the latest confirmed/draft sequence at transition time, reject an order that would leave confirmed readings inconsistent, recompute the candidate's predecessor and consumption from current data, and leave existing confirmed readings/audit unchanged on rejection. Concurrent confirmations of different readings must not create an invalid sequence.
- **Change:** Confirmation discovers the meter, locks it before mutating sequence state, then validates the billing period, meter lifecycle, actual date, previous confirmed reading, earlier drafts, and later confirmed readings within the transaction. It refuses confirmation with `READING_ORDER` when an earlier draft or later confirmed reading exists, and persists consumption and `previousReadingId` calculated from the live predecessor. Draft creation also rejects a backdated draft before a later confirmed reading. `correctReading` now discovers and locks the same meter before reading/period state. Its transaction uses `READ COMMITTED`: if it waits behind a confirmation, subsequent sequence queries see that newly committed successor and append a recalculation correction; if correction wins first, confirmation reads the corrected predecessor. This avoids a serializable snapshot being taken before a lock wait and then missing the successor.
- **Policy decision:** Out-of-order confirmation is rejected and ordinary corrections recalculate affected successors under the meter lock. That policy does not yet preserve closed-period immutability: a correction can recalculate a successor in a closed period, as the later reproduction below confirms. The owner must approve how such corrections should be handled; no business rule is silently changed here.
- **Regression evidence:**
  - Unit behavior: `tests/meter-reading.test.ts:51-72` verifies the chronological-confirmation predicate for clear, earlier-draft, and later-confirmed states.
  - PostgreSQL behavior: `tests/integration/meter-reading.test.ts:168-324` verifies a later draft is blocked while an earlier draft exists; confirming in order recomputes exact 10.000 consumption for both readings; a backdated write and a stale pre-existing draft are rejected after a later reading is confirmed; the existing confirmed consumption and confirmation audit remain unchanged; concurrent distinct-period confirmations end in a valid sequence.
  - Correction/confirmation contention: `tests/integration/meter-reading.test.ts:453-520` concurrently corrects February from 110.000 to 105.500 while confirming March at 120.000, retries only a serialization-conflicted operation, and verifies final March consumption is 14.500 with the predecessor's correction record preserved. A first full-run attempt exposed the stale serializable-snapshot defect (March remained 10.000); after changing the correction transaction to READ COMMITTED under the meter lock, the focused PostgreSQL race and the full integration suite passed.
- **Additional closure reproduction:** A later isolated PostgreSQL reproduction created a confirmed March predecessor and confirmed May successor, closed May, then corrected March from 110.000 to 105.500. The service accepted the correction, changed May consumption from 10.000 to 14.500, and appended a correction row for the closed May period. `correctReading` locks and checks only the predecessor's billing period before it updates the successor. This violates the requirement not to mutate a closed billing period.
- **Status:** **OPEN — HIGH closure blocker**. The earlier chronology and open-period race fixes remain effective, but closed-successor correction behavior needs an owner-approved policy and a focused regression before Stage 3B can close.

### F-03 — Replacement final old-meter reading lacks its billing-period association

- **Original severity:** Medium
- **Original evidence:** `src/server/meter/service.ts:736-740` resolved the open period; the final reading insert at `770-784` omitted `billingPeriodId`, while the initial reading insert at `786-800` included it. `correctReading` requires a non-null period link (`501-527`).
- **Acceptance criteria:** Both final old-meter and initial new-meter readings must link to the canonical period resolved for the replacement date; period-scoped lookup must retrieve both; the final reading must remain correction-eligible in an open period, preserving its actual reading date and correction audit.
- **Change:** The existing `period.id` is now assigned to the final old-meter reading. No schema change was necessary.
- **Regression evidence:** PostgreSQL test `tests/integration/meter-reading.test.ts:478-538` checks both IDs in period-scoped retrieval and corrects the final reading while preserving its period/date. Browser test `tests/phase2/meter-reading.spec.ts:140-242` performs registration and replacement through the ADMIN UI, then verifies both readings in history have the selected period ID.
- **Status:** **RESOLVED**.

## Verification

| Verification | Result |
|---|---|
| `npm test` | **PASS — 40/40** across 5 files. |
| `npm run test:integration` against a clean isolated PostgreSQL database built from the final remediation image | **PASS — 36/36** across 4 files, including all 11 meter-workflow tests. |
| Focused PostgreSQL correction/confirmation race (`... -t 'serializes predecessor correction with successor confirmation'`) | **PASS — 1/1**; final successor consumption 14.500 and predecessor audit record retained. |
| Focused Playwright separate-date test against the final isolated app | **PASS — 1/1**; browser clock is frozen at 2026-10-18 to keep the historical date assertion deterministic. |
| Focused Playwright replacement test against the final isolated app | **PASS — 1/1**; both replacement readings link to the selected period. |
| `npm run typecheck` | **PASS**. |
| `npm run lint` | **PASS**. |
| `npm run format:check` | **PASS**. |
| Docker production image build from the remediation checkout | **PASS**; `next build` completed. |
| Prisma migration status on a clean isolated test database | **PASS**; all 7 existing migrations applied. No migration/schema edits were made. |
| Schema/migration changes | **None**; no migration was generated. |

The first focused replacement-browser attempt exposed a fixture issue: it installed and replaced the meter on the same day, so no prior reading existed for final-consumption calculation. The browser fixture now installs it one day earlier; the focused test then passed. This did not require a product-code workaround.

The full browser suite was not rerun during remediation. Its last recorded aggregate remains **14/15**, with one Phase 2.6 fixture-cleanup timeout and a successful focused rerun. The focused 1/1 remediation result is not presented as a full-suite pass and does not change that aggregate.

The only database writes were migrations and test fixtures in isolated Docker test databases. The local `taky` target database was queried in PostgreSQL `READ ONLY` transactions for schema metadata and aggregate row counts only. No meter values, tenant records, or other row-level business data were read, and no production data was changed.

## Remaining audit findings

The following findings were not part of the requested blocking remediation:

| Finding | Severity | Status | Evidence and risk | Responsible workstream | Target stage | Development-blocking | Production-blocking |
|---|---|---|---|---|---|---|---|
| F-04 — Overview request race and stale form during loading | Medium | OPEN | Delayed overview responses can replace unsaved form state or leave stale filter results visible. No automatic write or cross-meter persistence path was demonstrated. | Frontend | Stage 3B follow-up before operator rollout | No | Yes, until fixed or explicitly accepted after operator testing |
| F-05 — History UI omits some reading/replacement timestamps | Low | OPEN | Persisted audit times remain available, but the UI omits normal reading and replacement event timestamps. | Frontend | Stage 3B UX follow-up | No | No |
| F-06 — Legacy meter records need canonical reading dates/periods | Medium, conditional | NOT VERIFIED for a distinct hosted target | Read-only inventory found 0 meters, 0 readings, 0 orphan readings in local `taky`. The schema predates Stage 3A/3B, so repeat inventory after migration and before billing; hosted-target equivalence is unknown. | Database/operations | Before first actual billing run | No | Yes, until intended target is inventoried |
| F-07 — Browser test assumes a fixed current date | Medium, test reliability | RESOLVED | The test freezes browser time at 2026-10-18; focused date-entry E2E passed. | QA/frontend | Completed in closure | No | No |
| F-08 — Browser E2E coverage and aggregate confidence | Medium, verification gap | OPEN | Historical full suite remains 14/15. Focused date-entry and replacement browser tests pass, but validation, correction, STAFF-denial, and history interactions still lack broad browser coverage. | QA | Stage 3C pre-release/UAT | No | Yes, until required browser regression and operator UAT pass |

## Final disposition

**F-01: RESOLVED. F-02: OPEN. F-03: RESOLVED.** Stage 3B is **NOT CLOSED**. Stage 3C development is **NO-GO** until the closed-period successor mutation is addressed and retested. No implementation change was made for this newly discovered defect. F-04 and F-08 remain production/operator-readiness gates, F-05 remains a low-priority UX follow-up, F-06 is verified only for the accessible local snapshot, and F-07 is resolved by the deterministic browser clock. The full browser suite remains **14/15**, not 15/15. No commit or push was made.

## Final F-02 remediation addendum — 2026-10-19

This addendum supersedes the earlier open F-02 disposition while retaining the original discovery and reproduction above as historical evidence. The owner-approved rule is: **closed billing periods are immutable**. A correction that would alter a closed period is rejected atomically; adjustments are deferred to Stage 3C after business-rule approval.

### Confirmed defect and minimal change

The confirmed defect was that correcting an open-period predecessor recalculated the immediate confirmed successor without first checking/locking that successor's billing period. In the exact March `110.000`, May `120.000`, May CLOSED case, changing March to `105.500` previously changed May consumption from `10.000` to `14.500` and appended correction history.

The service now keeps its existing meter-level serialization and `READ COMMITTED` correction transaction. Before any write, it collects the target and immediate confirmed successor period IDs for the same meter, rejects a successor with no canonical period, then locks every affected period in sorted order using the existing period-lock helper. If any is closed, the entire transaction aborts before setting the correction trigger flag, appending correction history, updating readings, or writing the audit log. The lookup remains meter-scoped, so an old meter's final reading and a replacement meter's opening reading cannot become cross-meter dependencies. There are no schema or migration changes.

### Acceptance and regression evidence

The new isolated PostgreSQL test verifies the correction is rejected with `PERIOD_CLOSED`; the March value, consumption, and predecessor relationship remain unchanged; May consumption and predecessor relationship remain unchanged; and no new correction or CORRECT/CONFIRM audit row appears. Companion tests verify open-period correction still works, an open intermediate successor can be recalculated without changing a later CLOSED successor, and meter replacement remains isolated across meter identities. The prior correction/confirmation contention regression still passes under per-meter serialization.

Independent Pstack review of the final transaction invariants found no new Critical or High defect. It recommended the explicit predecessor-derived-field assertion now present in the closed-period test.

### Final status

| Finding | Final status | Closure evidence |
|---|---|---|
| F-01 — Opening-reading authorization | RESOLVED | ADMIN enforced at service draft/confirmation boundaries and verified by PostgreSQL role tests. |
| F-02 — Chronology and closed-period successor integrity | RESOLVED | Affected period locks precede writes; exact reproduction and atomic no-change assertions pass; open-period, concurrency, multiple-successor, and replacement regressions pass. |
| F-03 — Replacement-period handling | RESOLVED | Both old final and new initial readings retain the canonical period and distinct meter identity. |

| Final verification | Result |
|---|---|
| Unit suite | PASS — 40/40. |
| PostgreSQL integration suite on isolated Docker test database | PASS — 39/39 across 4 files; meter workflow 14/14. |
| Focused correction/confirmation contention | PASS — 1/1 in a prior fresh isolated focused run and also included in final 39/39. A later isolated-only attempt was unable to initialize because its unique period fixture already existed in the reused populated test DB. |
| Focused browser workflows | PASS — 2/2 (separate water/electric dates and ADMIN replacement). Historical full browser suite remains 14/15; no 15/15 claim. |
| Operations/security suite | PASS — 8/8. |
| Typecheck, lint, formatting, diff hygiene | PASS. |
| Docker production build | PASS. |
| Prisma migration status/schema drift | PASS — seven existing migrations; no difference detected; no migration added. |

**F-01/F-02/F-03: RESOLVED. Stage 3B: CLOSED for development. Stage 3C: CONDITIONAL GO.** F-06 remains a mandatory pre-billing gate until the intended post-migration target is verified and legacy rows, if any, are mapped. F-04 and F-08 remain operator rollout/pre-release follow-ups; F-05 remains a low-priority UX follow-up. See `STAGE_3B_CLOSURE_REPORT.md` and `STAGE_3C_HANDOFF.md`. This remediation did not implement billing/adjustments, deploy, merge, or modify production data.
