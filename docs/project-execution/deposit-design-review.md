# Stage 3E independent design review

Reviewed 2026-10-23 against snapshot baseline `6da96b7` and the current `deposit-domain-design.md`. This is a design review. No application, database, migration, Git state or financial policy changed.

## Opinion

The proposal correctly separates `Lease.deposit`, a contractual requirement, from actual held liability. Its append-only ledger, exact decimal amounts, preserved legacy rows, transactional audit and real PostgreSQL concurrency tests are suitable constraints. Accept the read-only groundwork. Managed posting is not implementation-ready until the findings below have explicit answers and an additive schema sketch.

I read the installed Pstack Codex adapter, `architect`, `principle-model-the-domain`, `principle-type-system-discipline`, and `unslop`, including their upstream guidance. This assignment is an independent review of the existing two-candidate design. I did not spawn an arena, implement a third candidate, or claim cross-model review.

## Findings to resolve before posting

### DRE-01: define whether a reversal can itself be reversed

Severity: medium. Evidence: design lines 54 and 64 allow a reversal of an earlier managed entry and derive its opposite effect. D3E-05 prohibits automatic chain cancellation but does not prohibit a manual reversal of a reversal.

For example, receipt 100, refund 40, reversal of refund 40, and reversal of that reversal 40 satisfy the current wording. This creates an undeclared correction lifecycle and makes the reversal target's reporting classification ambiguous. A unique target alone does not decide whether this sequence is permitted.

Recommended correction: limit reversal targets to original receipt, deduction or refund entries, require the same lease, copy the exact original amount and effect, and prohibit reversal-of-reversal. If the intended policy permits further corrections, specify that workflow explicitly. Enforce the chosen target rule in both SQL and the parsed command/service contract. Add direct SQL and service tests for a reversal target that is already a reversal.

### DRE-02: cross-stream bank reference uniqueness needs one agreed transfer model

Severity: medium. Evidence: D3E-06 proposes receiving-account/reference uniqueness across deposits and rent, while the existing payment contract records one payment amount and rejects unallocated credit. Existing rental payment uniqueness belongs to `Payment`; it does not represent a shared transfer with rent and deposit portions.

A tenant may send 8,000 once for 5,000 rent and 3,000 deposit. A global unique reference would reject the second entry unless the product explicitly prohibits this case. Allowing an arbitrary reference suffix instead would defeat duplicate detection. Neither behavior follows from the current approved rental rules.

Choose and document one first-unit behavior. The smallest choice is to flag a cross-stream collision for explicit review and decline automatic posting until resolved; it must also state whether a mixed transfer is unsupported in that unit. If mixed transfers are supported, design one verified transfer amount with bounded rent and deposit uses before implementing cross-stream claims. Do not add a general transfer framework solely on this review's suggestion. Require a real PostgreSQL race between rental confirmation and deposit receipt against the same bank identity. Existing payment behavior must receive its own independent review if changed.

This finding does not authorize a new policy or require a new Owner prompt automatically. The Main Agent should reconcile the standing broad development authorization and record the concrete selected behavior.

### DRE-03: define totals so the ledger DTO actually reconciles reversals

Severity: medium. Evidence: line 58 promises managed balance and receipt/refund/deduction totals; lines 54 and 64 add a fourth signed effect, reversal. The proposal does not say whether those totals are gross, net of reversal, or accompanied by reversal totals.

Receipt 100, refund 40, reversal of refund 40 has a liability of 100. Gross receipt minus gross refund yields 60. A client using only the advertised totals cannot explain the balance.

Recommended correction: specify exact equations for each reported total and expose reversal effects explicitly or attribute them to their target's net bucket. Retain original gross amounts in history. Test both a reversed receipt and a reversed refund/deduction, including a paginated history whose totals cover the full ledger. Any one read response must derive its totals and balance from one database snapshot.

## Schema and integration constraints

The current `SecurityDeposit` table has positive amounts, three kinds, `isDemo`, and mutable `updatedAt`. It has no actor, command identity, settlement confirmation or reversal target. Its values cannot be relabeled verified cash by an additive column default. `Lease.deposit` must remain unchanged by receipt, refund, deduction or opening reconciliation.

A dedicated managed-entry table is the simpler safe first representation if reusing `SecurityDeposit` would require nullable provenance and per-row immutability exceptions. This is a recommendation, not an implemented schema. Select one representation and specify required fields, exact allowed kinds, foreign keys, legacy discriminator behavior and SQL checks before the migration is written. Preserve original row values and timestamps. Historical reconciliation remains a separate explicit operation, never an automatic opening cash receipt.

`acquireSourceGate` is a shared advisory gate, not serialization between writers. Current `saveLease` takes it before tenant/room locks, and payment commands take it before their command identity and entity locks. Deposit posting should enter that gate before its command/lease locks because eligibility reads lease identity and state. Establish the complete lock order once the shared transfer choice is settled. A lease lock is necessary for balance aggregation; the shared gate alone is insufficient. Prove trigger behavior at the actual transaction isolation used by direct SQL, including waits and stale snapshots.

The existing `Attachment` row has lease/payment/expense links but no deposit-entry link or verified upload lifecycle. The proposal correctly treats this as a dependency. A storage key alone must not satisfy deduction evidence. Do not substitute a synthetic evidence record for a real authorized artifact in live operation.

No mutable cached balance is required for approximately 15 rooms. Keep money as exact decimal strings at interfaces and exact decimal/NUMERIC during calculation. Aggregate results can exceed the precision of one entry; do not reuse a `NUMERIC(14,2)` input ceiling as the ledger-total ceiling.

## Genuine blockers and work that can proceed

The ten proposed policy rows are not ten reasons to stop all development. The Main Agent can select routine reversible development defaults under the standing authorization and record them. Approval provenance must stay distinct from actual evidence and UAT.

Posting needs concrete role/confirmation, eligibility, correction, duplicate handling, and historical-review rules. Deductions additionally need authorized retained evidence and a defined accounting treatment before reports classify the released liability. Refunds need payee/method provenance and an explicit settlement review meaning. These facts cannot be inferred from `Lease.deposit`.

Historical account opening needs actual per-lease review and mappings. Production release needs real issuer/account configuration, evidence retention operation and actual UAT acceptance. Broad authorization does not supply those facts. Deposit document prefix and printing can remain pending while read-only characterization or a separately bounded synthetic domain unit proceeds. Effective-date rules block effective-date posting/report promises, not every database inspection or arithmetic test.

The following bounded work can proceed without adopting a new cash policy:

- Read-only legacy inventory with authenticated ADMIN/STAFF access and explicit `unverified` status. Show contractual requirements and legacy transaction counts/amounts separately. Do not label legacy totals spendable or count contractual deposits as received cash.
- Pure exact-decimal signed-effect tests with synthetic entries, clearly separate from enabled receipt/refund commands. Test precision, invalid fractional satang and totals above one entry's input ceiling.
- Characterization of original deposit rows and constraints using isolated synthetic data, preserving all values and timestamps.
- Additive migration and SQL concurrency test design after the representation is selected. Review the schema before any migration is integrated.

## Verification performed and limits

I read `prisma/schema.prisma`, foundation/constraints references, `src/server/lease-service.ts`, the shared invoice gate, payment contracts and command locking, the live lease wording, Phase 3 requirements and `policy-authorization.md`. I compared the proposed managed design with the actual `SecurityDeposit`, `Lease`, `Attachment` and `AuditLog` shapes.

No database commands, behavioral tests, migration rehearsal or browser checks ran in this review. This report does not approve a managed migration or certify financial behavior. Return the clarified reversal, transfer and totals contracts to an independent reviewer before declaring the design accepted for posting.
