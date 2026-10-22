# Stage 3C requirements — billing and invoices

**Status:** Stage 3C-2 is complete for development under the owner-approved rules in `STAGE_3C_DECISION_LOG.md`. Final unit, isolated PostgreSQL, production build and focused HTTP checks passed. Invoice persistence and lifecycle remain outside this milestone.

## Scope and authority

Stage 3C consumes canonical billing periods, leases, room assignments, contractual rent, confirmed meter readings, effective-dated utility rates, meter replacement history, and audit history. It produces a traceable preview and, after policy approval, draft and issued invoices. It does not authorize production billing, production migrations, legacy-data backfills, payments, receipts, deposits, expenses, or deployment.

Stage 3B is closed for development. The final F-02 addendum in `STAGE_3B_CLOSURE_REPORT.md` supersedes the earlier interim “not closed” paragraphs: correction of a reading now locks affected periods and rejects mutation of any closed affected period atomically. Preserve this behavior.

## Existing contracts mapped to requirements

| Requirement | Existing source of truth | Stage 3C constraint |
|---|---|---|
| Billing period | `BillingPeriod`: property, canonical Gregorian month boundaries, OPEN/CLOSED; unique property/month | Use the canonical period ID and boundaries. Never redefine months or reopen a closed period. |
| Lease/room/rent | `Lease` owns room, tenant, start/end dates, contractual rent, status; `Room.rent` is mutable operational data | Charge contractual `Lease.rent`, not current room rent. Preview includes ACTIVE and ENDED leases intersecting the period; overlapping occupancy blocks calculation. Partial-month actual utility allocation is not inferred from rent proration. |
| Rent proration | `src/server/finance/calculations.ts`: inclusive intersection of lease and period dates; monthly rent × occupied days ÷ period days; no overlap errors; exact decimal; one `ROUND_HALF_UP` to 2 places | Preserve this verified function contract. Do not invent extensions for move-in, move-out, or contract changes. |
| Meter stream | `UtilityMeter`, `MeterReading`; separate WATER/ELECTRICITY streams and physical meter identities; consumption `DECIMAL(14,3)` | Only confirmed, period-linked readings can support actual consumption; never subtract values across meter IDs. |
| Reading dates | `readingDate` is business date; `createdAt`/`confirmedAt` are event timestamps | Keep actual dates distinct. Water and electricity dates may differ. ADMIN selects water/electricity rates independently for the month; approved overlapping effective intervals determine eligibility. |
| Replacement | `MeterReplacement` links old/new meters and final/initial readings; separate physical identities | Do not subtract across replacement. ADMIN approves each verified physical-meter segment with a reason and evidence; insufficient or duplicate evidence blocks calculation. |
| Utility rates | `UtilityRate` append-only change points by property/kind/effectiveFrom; `DECIMAL(14,4)`; resolver returns latest rate not after a caller-selected date and has no future fallback | Keep effective history and use decimal-safe arithmetic. Stage 3C-2 uses explicit ADMIN selection among rates with an effective interval intersecting the canonical month, preserving rate history. |
| Usage charge | `calculateUsageCharge`: current − previous, exact quantity × rate, round monetary amount once to 2 places `ROUND_HALF_UP` | Preserve the old helper contract; Stage 3C-2 sums exact raw charges and rounds the final total once. Display lines are reference values, with a reconciliation delta. |
| Meter correction | Audited append-only correction; affected closed periods reject atomically | Preview must read current valid source data; never rewrite closed-period usage. Future issued corrections use approved void/revision or later-period reconciliation; no original snapshot mutation. |
| Authorization/audit | Authenticated route handlers; service-level ADMIN/STAFF checks; mutation services use transactions and audit rows | Enforce roles at service boundaries. Financial actions and source references must be auditable. |
| Invoice schema | `Invoice` already has unique `number`, lease/period, dueDate, DRAFT/ISSUED/VOID, issuedAt; unique `(leaseId, period)`. `InvoiceItem` stores description, quantity, unit price, amount. | Existing uniqueness is per lease and period; the approved rule is one active invoice per lease and canonical period, retaining VOID history in 3C-3. Models lack source IDs/rate snapshots and do not encode immutable issued snapshots. Review additive migration needs after policy approval. |
| Existing UI | `/billing` and demo finance data are demonstrations; README says these figures are not operational accounting | Do not treat demo behavior as live billing or migrate demo data into invoices. |
| F-06 data gate | Closure report: accessible local DB had no meter rows but was pre-3A/3B; intended target identity and post-migration rows remain unverified | Plan only a read-only inventory after applicable migrations. Actual billing is blocked until target identity and legacy mapping are verified and signed off. |

## Financial policies and milestone boundaries

The exact approved policies are recorded in the decision log. Stage 3C-2 implements explicit rate selection, identifiable ADMIN-approved estimates, separately verified replacement segments, contractual rent proration, exact raw aggregation and final-only HALF_UP rounding. No automatic tax or optional charge is allowed. Zero rent blocks financial eligibility.

The old Stage 3A per-charge rounding helpers remain unchanged. Stage 3C-2 uses a separate exact path and preserves reduced numerator/denominator pairs for repeating prorated values. A two-decimal display-line sum can differ from the final total. The preview returns the exact raw total, final total, display-line total and reconciliation delta.

Preview must be read-only, deterministic for the same canonical inputs, and authorized at the service boundary. Approval mutations require ADMIN, open period, scope validation, append-only history and transactional audit. All approval revisions remain immutable; the latest revision is used. Preview must detect stale source evidence and actual/estimate conflicts rather than double charge.

Canonical partial-month actual room consumption requires ADMIN-approved quantity per lease with reason and evidence, as approved on 2026-10-20. ALLOCATED_ACTUAL must retain canonical reading identity, overlap occupancy and keep the exact combined allocation within verified room usage. No utility allocation is derived from the rent formula. Actual usage spanning missing periods also requires explicit allocation and is not assigned automatically to one month; future reconciliation remains deferred.

## Source completeness and issuance boundary

A closed period alone does not prove input completeness. Stage 3C-2 returns a candidate PREVIEW_ONLY source snapshot with a stable fingerprint; it does not persist an invoice or a frozen source set. Even a complete preview is not authorized for issuance. Stage 3C-3 must implement validated close/freeze, transactional source revalidation and immutable invoice persistence before issuance can be enabled.

Requirements and risk-based checks map to `STAGE_3C_TEST_PLAN.md`. Production remains NO-GO until F-06 and the operator/pre-release gates are cleared.
