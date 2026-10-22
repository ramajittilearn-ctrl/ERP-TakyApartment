# Stage 3C decision log

Owner approval was supplied in the Stage 3C-2 brief and follow-up replies on 2026-10-19. The rules below supersede the 3C-1 recommendations in commit `fd7dcad`.

| ID | Status | Exact owner-approved rule | Stage 3C-2 application |
|---|---|---|---|
| D-01 | OWNER APPROVED, 2026-10-19 | ADMIN selects the applicable utility rate for each canonical billing period, separately for water and electricity. | Append a selection referencing an existing rate. |
| D-02 | OWNER APPROVED, 2026-10-19 | When actual meter consumption is unavailable, ADMIN may enter estimated consumption quantity, provide a reason, and approve it. Estimated usage must remain explicitly identifiable. | Separate financial approval, never a fabricated MeterReading. |
| D-03 | OWNER APPROVED, 2026-10-19 | For a physical meter replacement within a period, ADMIN reviews and approves verified chargeable consumption for each physical meter segment, with reason and supporting evidence. | Explicit per-meter approved quantities and references. |
| D-04 | OWNER APPROVED, 2026-10-19 | Calculate all raw charge amounts using exact decimal arithmetic, sum raw amounts, then round the final invoice total once to two decimal places. Display individual line amounts for reference. | New calculation path; exact fractions preserve repeating prorations; final HALF_UP once. Existing Stage 3A helpers unchanged. |
| D-05 | OWNER APPROVED, 2026-10-19 | Do not add VAT, tax, or optional service charges automatically. | Only rent, water and electricity. |
| D-06 | OWNER APPROVED, 2026-10-19 | Provide a configurable property-wide default payment due-date policy; ADMIN may override the due date for an individual invoice. | Design only; due-date policy values remain configuration inputs for 3C-3. |
| D-07 | OWNER APPROVED, 2026-10-19 | Invoice number format: INV-YYYYMM-0001, with unique, concurrency-safe numbering. | 3C-3 only. |
| D-08 | OWNER APPROVED, 2026-10-19 | Invoice lifecycle: DRAFT, ISSUED, VOID. | 3C-3 only. |
| D-09 | OWNER APPROVED, 2026-10-19 | Validate required billing inputs before closing a period. | Preview exposes completeness. Existing close command is unchanged; validated close/freeze is a 3C-3 gate. |
| D-10 | OWNER APPROVED, 2026-10-19 | One active invoice per lease per canonical billing period. | 3C-3 only; existing unique constraint unchanged. |
| D-11 | OWNER APPROVED, 2026-10-19 | Rent is prorated by actual inclusive occupancy days, using contractual lease rent. | Exact inclusive intersection using Lease.rent. |
| D-12 | OWNER APPROVED, 2026-10-19 | A voided issued invoice may be replaced by a new revision with a new number referencing the previous invoice. Preserve the original invoice and audit history. | 3C-3 only. |
| D-13 | OWNER APPROVED, 2026-10-19 | An invoice cannot be issued when contractual rent is zero. | Structured ZERO_RENT non-issuable preview. |

## Additional owner approvals

- OWNER APPROVED, 2026-10-19: validate and close the billing period before issuing invoices.
- OWNER APPROVED, 2026-10-19: STAFF may prepare invoice drafts; only ADMIN may issue or void invoices.
- OWNER APPROVED, 2026-10-19: when actual consumption becomes available after an estimate, ADMIN records an approved difference for a future period; preserve the original issued invoice.
- OWNER APPROVED, follow-up 2026-10-19: ADMIN approves quantities for each affected estimated period. Reconciliation persistence and adjustment lines remain deferred.
- OWNER APPROVED, follow-up 2026-10-19: a selectable rate must have been effective for at least one date of the billing month: effectiveFrom <= period end AND (next effectiveFrom > period start OR no next rate). Either overlapping rate may be chosen explicitly when a change occurs mid-month.
- No additional business charges are approved.

## Lease allocation approval

OWNER APPROVED, follow-up 2026-10-20: ADMIN approves an explicit actual quantity for each lease, with supporting evidence, when room-meter usage spans a mid-month tenant change. The implementation adds ALLOCATED_ACTUAL with immutable reason/evidence/approval, canonical same-meter readings and exact aggregate allocation limits. The measured interval must overlap lease occupancy. Unallocated usage remains uncharged. Without explicit approval, partial-month whole-room usage reports OCCUPANCY_ALLOCATION_REQUIRED. Rent proration never determines utility allocation. Local unit checks and PostgreSQL allocation tests passed; the migration was applied only to isolated test targets.

## F-06 and release gates

F-06 remains OPEN and mandatory before actual billing. The intended production target and its post-migration legacy meter inventory have not been verified. The earlier accessible local snapshot was pre-3A/3B and cannot verify the intended target. No production migration, data backfill or real invoice is authorized. F-04 and F-08 remain operator-rollout/pre-release gates; F-05 remains a history-display follow-up. Historical Stage 3B full browser result remains 14/15.
