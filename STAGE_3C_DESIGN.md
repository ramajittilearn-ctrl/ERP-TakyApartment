# Stage 3C design

Stage 3C-2 implements calculations, financial input approvals and a read-only API preview. Invoice persistence, numbering, issuance, voiding, revisions, final due dates and validated period close/freeze belong to Stage 3C-3.

## Existing architecture and placement

Route handlers authenticate, check origin on mutations, parse bounded JSON and return no-store responses through `src/server/http.ts`. The new `src/server/billing` module owns service authorization, source validation, Prisma transactions and audit. The existing finance and meter public services and their Stage 3A/3B rounding, chronology and closed-period behavior are unchanged.

`contracts.ts` defines Zod source schemas and the result union. `calculations.ts` performs pure validation and calculation without a database or system clock. `service.ts` reads canonical data, persists approvals and prepares calculation inputs. `validation.ts` parses API command inputs; callers cannot supply approval identity or time.

## Financial arithmetic

The owner-approved D-04 supersedes the earlier proposed sum-of-rounded-lines rule for this new billing path. Inputs retain money scale 2, quantity scale 3 and rate scale 4. Internally, reduced BigInt numerator/denominator pairs preserve exact arithmetic, including rent divided by 28/29/30/31 days. The engine sums exact raw amounts and performs HALF_UP rounding on the aggregate exactly once. A local Prisma.Decimal clone with precision 80 renders raw decimal approximations. The numerator/denominator pair remains authoritative when a proration repeats.

Every line returns an exact raw amount and a two-decimal reference display amount. The result returns raw total, final total, sum of reference display lines and `reconciliationDelta = finalTotal - displayLineTotal`. A future UI must display the final total as authoritative and label the delta as a rounding reconciliation, not a new service charge. Do not add a fabricated financial line to force the display sum to match.

## Financial sources and approvals

`BillingRateSelection` references an existing immutable UtilityRate. ADMIN chooses each utility independently. The selected rate must match property/kind and have an effective interval intersecting the month. Historical revisions are append-only; the greatest revision is current. The approver, timestamp and reason are retained, with the selected value/effective interval recorded in transactional audit metadata.

`BillingConsumptionApproval` is a separate financial input, linked to period and lease, with utility, revision, canonical lease version, source JSON and ADMIN approval identity/time. It never creates meter readings. Supported source variants are:

- ESTIMATE with explicit quantity, reason, evidence references and source context. Actual/estimate conflicts block preview.
- REPLACEMENT with independently approved physical-meter segments. READINGS verifies a same-meter difference and caps the approved quantity at verified usage. ADMIN_EVIDENCE preserves canonical supporting reading references and explicit segment dates/quantity plus external evidence references. This permits a verified new-meter quantity without fabricating a second same-month meter record beside its opening.
- ACTUAL selection explicitly supersedes an unissued estimate while the period is OPEN. ADMIN supplies canonical reading ID, reason and evidence. It cannot bypass replacement completeness, partial-lease allocation or multi-period allocation checks. This is source selection before close, not issued-invoice reconciliation.
- ALLOCATED_ACTUAL records the owner-approved ADMIN quantity per lease, reason and evidence against canonical same-meter readings. The measured interval must overlap occupancy. The exact sum of latest allocations across leases cannot exceed verified room consumption; unallocated remainder is not charged. `allocation.ts` sums integer milliunits without floating-point arithmetic. Multi-period reconciliation and replacement segment sharing remain outside this source variant.

Canonical actual usage requires confirmed current and predecessor readings, matching physical identity and quantity, truthful dates and valid period assignment. A dated confirmed OPENING is an explicit physical anchor even when its canonical billingPeriodId is NULL. A same-month opening may support the first actual charge; otherwise the preceding canonical period must be adjacent. Unknown legacy NORMAL/FINAL dates or periods and multi-period gaps are rejected.

Preview includes ACTIVE and ENDED leases overlapping the period, uses Lease.rent and rejects overlapping occupancy. Partial-month rent is computed exactly. Whole-room actual utility quantities require explicit ALLOCATED_ACTUAL approval for partial leases; otherwise this case reports OCCUPANCY_ALLOCATION_REQUIRED.

## Transactions, audit and source staleness

Approval commands repeat ADMIN authorization in the service, lock the period, require OPEN, validate canonical scope, allocate the next revision and insert approval plus audit in one Serializable transaction. Unique revision indexes guard concurrent duplicates; serialization conflicts are explicit retryable conflicts rather than silent overwrites. Database triggers reject non-ADMIN/disabled approvers, wrong-scope records, invalid rate eligibility and new approvals after close. UPDATE and DELETE on approval history are rejected.

Replacement approvals cover the physical meter set and reject duplicate/reused allocations to another lease in the same period. Evidence dates must cover the relevant meter lifecycle/period/occupancy intersection. Preview compares stored reading versions and values with canonical rows, and rejects changed lease versions or source evidence. It does not silently refresh an approval.

Actual allocation commands use the same period lock and Serializable transaction. The sum check includes the latest approval once per other eligible lease and the proposed replacement for the current lease. Preview repeats the aggregate check and source validation. PostgreSQL tests passed for concurrent aggregate limits, tenant turnover and rejection of sources measured entirely after tenancy.

Preview runs in PostgreSQL REPEATABLE READ with SET TRANSACTION READ ONLY. It has no writes to invoices, items, readings, approvals or audit. Candidate snapshots include source identities, approval references, lease/period versions, contractual rent/dates, rent proration, actual/estimated classification, physical-meter and reading references, selected rates, exact raw charges, final rounding and a SHA-256 fingerprint of canonical JSON. Snapshots are detached from caller and display mutations.

## Completeness and future freeze

`complete` and `readyToClose` describe financial input validation only. `eligibleForFutureIssuance` remains false in Stage 3C-2 because no frozen source set exists. All snapshots say PREVIEW_ONLY. An old CLOSED period lacking selections/approvals fails completeness; closure is never substituted for source evidence.

Before enabling issuance, Stage 3C-3 must lock the period and all source writers in a documented order, validate every billable lease, create an immutable complete source set and close in the same transaction. This requires a new freeze record or equivalent persisted snapshot set, not a caller assertion. It must include lease inputs as well as financial approvals, because current lease services allow contractual edits after period closure. Invoice issuance must revalidate the frozen identity/fingerprint transactionally, then persist its own immutable copy. Closed financial approval records already reject insert/update/delete. No existing CLOSED period may be repaired retrospectively without a separately approved operational process.

## Additive migrations and operational limits

Three new migrations create approval tables/guards, add nullable lease-version metadata plus explicit actual-source selection, and extend the JSON source constraint for ALLOCATED_ACTUAL. All three were applied only to isolated test databases; migration status and zero drift passed with all 10 project migrations. The third wraps constraint replacement in a transaction. Applied migrations remain unchanged; NULL historical lease versions are rejected rather than invented. Invoice tables and their existing unique constraints remain unchanged.

F-06 remains OPEN on the intended production target. Only synthetic fixtures in a newly isolated loopback PostgreSQL database are authorized for this milestone. No production migration, backfill, real billing or deployment is included.
