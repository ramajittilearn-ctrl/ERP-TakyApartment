# Stage 3C handoff — meter and financial foundation

**Repository:** `ramajittilearn-ctrl/ERP-TakyApartment`
**Branch:** `phase-3b-meter-reading`
**Handoff date:** 2026-10-19
**Status:** Stage 3B development closed; Stage 3C is conditional go.

## Verified Stage 3B interfaces

Stage 3B exposes these authenticated API surfaces:

| Interface | Purpose |
|---|---|
| `GET /api/v1/meter-readings/` | Billing-period meter overview and completion state. |
| `POST /api/v1/meter-readings/drafts/` | Create/update a draft with its actual `readingDate`. |
| `POST /api/v1/meter-readings/{id}/confirm/` | Confirm a draft with chronology and meter lifecycle validation. |
| `GET /api/v1/meter-readings/history/` | Read readings, actual dates, correction/replacement provenance and operators. |
| `POST /api/v1/meter-readings/{id}/corrections/` | ADMIN-only audited correction of a confirmed reading in an open affected period. |
| `POST /api/v1/meters/` | ADMIN-only physical-meter registration and opening reading. |
| `POST /api/v1/meters/replacements/` | ADMIN-only replacement with old-meter final and new-meter opening readings. |
| `/api/v1/utility-rates/` | Read/manage effective-dated utility rates. |
| `/api/v1/billing-periods/` and `/api/v1/billing-periods/{id}/close/` | Read/create periods and close an open period. |

Core persisted records are `UtilityMeter`, `MeterReading`, `MeterReadingCorrection`, `MeterReplacement`, `UtilityRate`, `BillingPeriod`, and `AuditLog`. Meter values and consumption use `DECIMAL(14,3)`; rates use `DECIMAL(14,4)`. A reading carries `billingPeriodId`, business `readingDate`, `createdAt`, status/type, physical `meterId`, optional consumption, and optional `previousReadingId`. Corrections preserve the original reading date and append correction/audit provenance. Replacement final/initial readings are intentionally attached to distinct old/new physical meter identities.

## Invariants for downstream billing work

- Water and electricity are separate physical meter streams and may have different actual dates within one billing period.
- A business `readingDate` is not the system `createdAt` timestamp. Use the former for meter chronology and keep the latter for event/audit chronology.
- Do not calculate consumption across physical meter identities. At replacement, old-meter final consumption and new-meter opening value have separate meaning.
- Confirmed readings are chronologically constrained per physical meter. Mutations serialize on that meter.
- **Closed billing periods are immutable.** A correction that would modify the corrected reading or its immediate same-meter confirmed successor in a closed period is rejected atomically before reading, correction, or audit writes. No silent recalculation or in-place financial adjustment is permitted.
- Corrections affecting only open periods remain supported with immutable correction history.
- No invoice, payment, receipt, deposit, or adjustment workflow is part of Stage 3B. Do not infer a billable amount solely from meter records without the approved Stage 3C contract.

## Stage 3C decisions still requiring business approval

Before calculating or issuing bills, the owner must decide and document:

1. Which date selects a utility rate: period start, actual reading date, or another approved date.
2. Missing/late reading behavior, whether closing requires all expected readings, and any approved estimation rule.
3. How replacement-period consumption maps to a tenant charge, including any proration or allocation rule.
4. Rounding at line, tax, fee, and invoice-total levels; treatment of taxes/fees and display precision.
5. The authorized workflow for a meter correction after a period is closed or after a bill is issued. Stage 3B rejects closed-period mutation; any adjustment/void/reissue behavior is future work only after approval.
6. Billing lifecycle, idempotency, invoice numbering, reopening/voiding, and audit requirements.

Do not implement these as assumptions. Stage 3C must add its own requirements, design, tests, and audit trail for approved behavior.

## Remaining gates and owners

| Finding | Owner | Target | Required action |
|---|---|---|---|
| F-04 — overview-response race and unsaved form state | Frontend owner | Stage 3B operator-rollout follow-up | Prevent stale responses from replacing current data/input; verify delayed-response behavior or record explicit acceptance. |
| F-05 — history UI omits some event timestamps | Frontend owner | Stage 3B UX follow-up | Display recorded/confirmed and replacement event times. |
| F-06 — legacy meter dates/periods on actual target | Database/operations owner | **Mandatory before actual billing** | Confirm target identity after migration; run read-only inventory; map and verify any existing rows; retain sign-off. Status remains NOT VERIFIED for the intended post-migration target. |
| F-07 — nondeterministic browser clock | QA/frontend owner | Completed | Browser time is frozen for the date-entry regression. |
| F-08 — incomplete browser coverage and historical aggregate | QA owner | Stage 3C pre-release/operator UAT | Investigate historical 14/15 timeout, add coverage for validation/correction/history/roles, rerun full suite and UAT. |

## Verification carried forward

Final Stage 3B evidence: 40/40 unit tests; 39/39 isolated PostgreSQL integration tests across four files (14 meter tests); 8/8 operations/security tests; focused browser regressions 2/2; typecheck, lint, format, and diff hygiene passed; Docker production build passed; seven existing migrations applied with no schema drift and no new migration. The historical complete Playwright run is **14/15**, not 15/15. A focused correction/confirmation contention run passed 1/1 previously and is included in the final integration suite. See `STAGE_3B_CLOSURE_REPORT.md` for detailed dated evidence and final Git verification.

**Recommendation:** Stage 3C development is **CONDITIONAL GO** within the approved business scope. Actual billing is **NO-GO until F-06 is cleared** and the business rules above are approved. This handoff authorizes no deployment or production data change.
