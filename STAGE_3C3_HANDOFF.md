# Stage 3C-3 handoff

Stage 3C-2 provides a pure calculation engine, canonical read-only preview and append-only ADMIN approval records. This handoff designs the next milestone; it does not implement or authorize invoice issuance.

## Baseline and available interfaces

The development branch is `codex/stage-3c-billing-invoice`. Stage 3B baseline is `c06b95b18c320f14f7f1804cbdf5aaaad50427a1`; the 3C-1 documentation commit is `fd7dcadb2356d63d799564f217af2af1394066ad`. Resolve the verified 3C-2 milestone SHA with `git log -1 --format=%H -- STAGE_3C2_IMPLEMENTATION_REPORT.md`. No remote push is authorized by the 3C-2 request.

| Interface | Roles | Behavior |
|---|---|---|
| GET /api/v1/billing/preview/?billingPeriodId=UUID | ADMIN, STAFF | Canonical financial validation/calculation in a read-only transaction. |
| POST /api/v1/billing/rate-selections/ | ADMIN | Append an explicit WATER or ELECTRICITY rate selection for an OPEN period. |
| POST /api/v1/billing/consumption-approvals/ | ADMIN | Append estimate, replacement quantities, explicit actual source supersession or per-lease actual allocation for an OPEN period. |

Mutations require the exact configured Origin, an authenticated session and bounded JSON. Command schemas reject caller-supplied approver identity/time. Revisions and audits are atomic. Approval history is append-only and protected against closed-period inserts. The `/billing` operator UI remains the existing demonstration; Stage 3C-3 must build the live workflow.

## Source snapshot and freeze requirement

`calculateBillingPreview` returns COMPLETE/INCOMPLETE, structured issues, exact raw fractions, final total, reference line amounts, reconciliation delta and a detached PREVIEW_ONLY snapshot with canonical SHA-256 fingerprint. Same inputs have the same fingerprint. The snapshot carries property/period/lease/room/tenant identity, contractual rent/version and dates, proration days, selected rate IDs/intervals/approvals, actual/estimate classification, physical meter/readings/versions, replacement evidence and raw amounts.

It is a candidate snapshot, not a persisted financial freeze. `eligibleForFutureIssuance` is always false. The current closeBillingPeriod service still follows Stage 3A and closes without checking these inputs. A closed period lacking new approvals remains incomplete; never infer readiness from CLOSED alone.

Before issuing, implement an explicit validated close/freeze transaction. It must lock the period and participating source writers consistently, validate all eligible leases and source allocations, retain the complete immutable source set with fingerprint/version/close actor/time, and close atomically. Include contractual lease values in the freeze, because current lease services can edit rent/dates after close. Source changes must never rewrite the frozen set. Issuance must validate the persisted freeze and its fingerprint transactionally and copy an immutable financial snapshot into the invoice. Do not retrospectively populate missing frozen inputs for existing closed periods by assumption.

## Approved invoice lifecycle and database strategy

The approved states are DRAFT, ISSUED and VOID. STAFF may prepare drafts; ADMIN alone issues or voids. Issuance follows validated period closure. A voided issued invoice remains in history; its replacement is a new revision with a new number and explicit predecessor ID. Never reuse numbers or overwrite issued lines/snapshots.

Existing Invoice has a global unique number and unique `(leaseId, period)`. The latter cannot retain multiple historical VOID revisions. In Stage 3C-3, after a reviewed additive design and any separately authorized legacy mapping, add canonical billingPeriodId and predecessorInvoiceId, retain restrictive references, and use a partial unique index on `(leaseId, billingPeriodId)` WHERE status IN ('DRAFT','ISSUED'). Review existing data before replacing the old all-status uniqueness constraint. Stage 3C-2 has not removed it.

Use a dedicated transactional monthly number counter plus the unique invoice-number constraint for `INV-YYYYMM-0001`. Decide explicitly whether YYYYMM is billing month or issue month and how sequence overflow beyond 9999 behaves before implementing the allocator. Preserve allocated numbers through voids. Lock and revalidate the active invoice slot under concurrency; database uniqueness remains the final guard. Audit draft, issue, void and revision creation in their transactions.

Due-date configuration is property-wide with ADMIN invoice override. The owner has not supplied day/offset values, so configuration must be explicit and date behavior deterministic. No automatic tax, VAT or optional charge is approved. Zero contractual rent prohibits issuance.

## Rounding and display contract

The new billing path sums exact raw values and rounds the aggregate HALF_UP once to two decimals. Existing Stage 3A per-charge helpers are unchanged. Raw rational amounts must survive snapshot persistence even when the decimal representation repeats. Do not reconstruct the invoice total by summing InvoiceItem.amount values: existing line amount columns have only two decimals. Persist an authoritative final total and raw source snapshot. Show reference line values and the returned rounding reconciliation clearly; it is not an extra service charge.

## Estimates, actuals and replacement evidence

Estimates remain financial inputs, never fake confirmed readings. Before close, an explicit ADMIN ACTUAL selection can supersede an unissued estimate and retains both revisions. A source correction invalidates the old approval until reapproved in an open period. Closed approvals cannot change.

For later issued estimate reconciliation, the owner approved ADMIN allocation of actual quantities to each affected estimated period. The owner also approved per-lease quantities with supporting evidence. A future reconciliation contract must retain original invoice/estimate IDs, physical source readings and coverage interval, each approved period/lease quantity, approver/reason/evidence/time and the target future period. Quantity difference is approved actual quantity minus original estimated quantity. Difference charges still require a defined valuation/rate rule and an implemented cross-period reconciliation contract. No automatic day-based allocation is approved. Do not backdate actual readings or change closed meter data.

Replacement sources keep physical meters independent. Canonical READINGS segments use same-meter differences; ADMIN_EVIDENCE segments preserve canonical reading anchors, lifecycle-bounded dates and external evidence references for an explicitly verified quantity. Never invent a second same-month MeterReading beside a new meter opening. Reused, incomplete, stale or insufficient evidence blocks calculation.

The owner approved explicit ADMIN actual quantities per lease with supporting evidence on 2026-10-20. ALLOCATED_ACTUAL preserves same-meter source readings and approval provenance, requires measurement/occupancy overlap, and caps the exact combined latest allocations at verified room consumption. It never allocates the remainder automatically. Partial leases without approval remain blocked. This path does not implement multi-period reconciliation or shared replacement-segment allocation. Unit and PostgreSQL turnover/concurrency/date-guard tests passed, and the migration was applied only to isolated test targets.

## Continuing verification and release gates

Stage 3C-2 verification passed with 111 unit tests, 23 focused billing PostgreSQL tests, 62 full PostgreSQL integration tests, all 10 migrations and zero drift on isolated targets, the final production image build and 11 HTTP checks against that image. Typecheck, lint, formatting and Prisma validation also passed. The reused-database Stage 3B fixture collision is documented; the complete suite passed on a fresh isolated target. No Stage 3C-2 functional finding remains open. The earlier approval-review outage no longer blocks this handoff.

Carry forward F-04 stale overview/form state, F-05 missing history event timestamps, F-06 target-data verification and F-08 browser/UAT coverage. F-04/F-08 remain rollout/pre-release gates. F-06 remains mandatory before actual billing; the intended production database and post-migration legacy meter inventory are unverified. Historical Stage 3B full browser result remains 14/15.

The next milestone must add transaction/concurrency tests for validated close/freeze, active invoice uniqueness, numbering, issue/void roles, immutable snapshots, revision links and complete rollback, plus focused responsive Thai UI coverage. No deployment, production migration, real invoice, payment, receipt, deposit or expense work is authorized by this handoff.
