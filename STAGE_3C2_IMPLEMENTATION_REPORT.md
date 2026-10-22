# Stage 3C-2 implementation report

Date: 2026-10-20. Scope: billing calculations, approved financial inputs and read-only preview. Stage 3C-2 is complete for development and verified. Stage 3C-3 development may begin from this milestone. Stage 3C as a whole is not closed. Production billing remains NO-GO.

## Implemented

- Separate pure billing calculation path with exact rational raw amounts, inclusive contractual rent proration, quantity/rate precision validation, final-only HALF_UP rounding, reference display amounts and reconciliation delta. Existing Stage 3A financial helpers and Stage 3B meter services remain unchanged.
- Explicit ADMIN water/electricity rate selections referencing immutable existing rates, constrained to the owner-approved overlapping effective interval.
- Distinct ADMIN-approved estimates, replacement quantities and explicit open-period actual source supersession. No fake readings or invoice records are created.
- Verified replacement segments retain physical IDs, canonical source reading references, evidence/reason/approval and lifecycle-bounded dates. Duplicate, stale, incomplete and cross-meter sources block calculation.
- Source completeness, canonical scope, occupancy overlap, zero rent, missing data and unsupported allocation validation. Whole-room actual consumption is not silently assigned to a partial lease or a multi-period gap.
- Explicit ADMIN-approved actual quantity per lease with supporting evidence, as approved on 2026-10-20. Canonical same-meter measurements must overlap occupancy. Exact aggregate allocations cannot exceed verified room usage; unallocated remainder is not charged.
- Read-only repeatable-read canonical preview for ADMIN/STAFF, full candidate source snapshots, exact raw quantities/amounts, stable SHA-256 fingerprints and explicit non-issuance state.
- Append-only approval revisions, service/DB authorization guards, open-period locking, database uniqueness and transactional audit. Lease source versions hash contractual fields as well as timestamps, so same-timestamp edits are detected.

## Files and database changes

| Files | Purpose |
|---|---|
| src/server/billing/contracts.ts | Parsed financial source variants, snapshot and result contracts. |
| src/server/billing/calculations.ts | Deterministic exact calculation and fingerprinting. |
| src/server/billing/allocation.ts | Pure exact aggregate allocation limits using integer milliunits. |
| src/server/billing/service.ts, validation.ts, index.ts | Canonical orchestration, approval commands and service authorization. |
| src/app/api/v1/billing/preview/route.ts | Read-only authenticated preview. |
| src/app/api/v1/billing/rate-selections/route.ts | ADMIN rate approval command. |
| src/app/api/v1/billing/consumption-approvals/route.ts | ADMIN financial consumption approval command. |
| prisma/schema.prisma and three migrations | BillingRateSelection and BillingConsumptionApproval, references, revision uniqueness, immutable/open-period guards and expanded source variants. |
| tests/billing-calculations.test.ts, tests/billing-allocations.test.ts | Pure calculation, allocation, validation, precision and snapshot tests. |
| tests/integration/billing-preview.test.ts | PostgreSQL source, approval, RBAC, audit, rollback, concurrency and closed-period tests. |
| scripts/verify-billing-api.mjs | Explicitly isolated HTTP authorization, validation, read-only and successful approval checks. |
| Four Stage 3C design documents, this report, test report and STAGE_3C3_HANDOFF.md | Approved decisions, implementation/verification evidence and next-stage design. |

The new migrations are `202610190001_phase3c2_billing_inputs`, `202610200001_phase3c2_approval_sources` and `202610200002_phase3c2_lease_allocations`. Existing seven migrations are unchanged. All three were applied only to isolated test targets. The second adds nullable lease version provenance and permits explicit ACTUAL selections. Unknown historical lease versions remain NULL and are rejected rather than backfilled. The third transactionally extends the JSON constraint for ALLOCATED_ACTUAL. Prisma explicitly maps the long unique-index name to PostgreSQL's stored identifier. Final migration status and zero drift passed on both targets with all 10 migrations applied.

No invoice, invoice-item, payment, receipt, deposit or expense schema/workflow changed. The existing Invoice unique `(leaseId, period)` remains intact. The existing period-close service remains unchanged; validated close/freeze is required before future invoice issuance.

## Review and verification

Pstack feature workflow used a single scoped implementation worker for the pure engine while the lead implemented approval persistence and orchestration. File ownership stayed disjoint; later service review was read-only. The lead reviewed the pure engine and snapshots, and the worker independently reviewed service authorization, source linkage, transactions, closed-period protection and replacement duplication.

Review found and corrected the explicit-opening NULL period rejection and an estimate-to-actual workflow trap. Additional lead review strengthened JSON round-trip fingerprint stability and lease provenance against same-timestamp contract edits. Executed PostgreSQL tests include simulated audit failure and complete transaction rollback.

After the owner approved per-lease allocation, review found a financial date-overlap defect: an allocation could use measurements entirely after tenancy ended. The pure engine now rejects a predecessor date after occupiedEndsOn, in addition to the existing rejection when the current reading predates occupancy. Its unit and PostgreSQL rejection/no-writes regressions pass. Read-only follow-up review found no further actionable defects. PostgreSQL tenant-turnover and concurrent aggregate-limit tests also pass.

The work compared exact fractions with a high-precision decimal-only approach; fractions preserve recurring rent exactly through the final rounding. Separate approval tables preserve explicit rate FKs and scoped revision history without implementing an invoice ledger. Only one implementation worker was used. No PR, merge, remote push, deployment or production database action was performed.

See `STAGE_3C2_TEST_REPORT.md` for actual commands, artifact identity, intermediate failures and limits. Retained local checks pass with 111 unit tests, typecheck, lint, formatting and Prisma validation. Closure executed 23/23 focused billing PostgreSQL tests, 62/62 full integration tests on a fresh isolated target, all 10 migrations and zero drift on both targets, the final production Docker build, and 11 focused HTTP checks. The earlier approval-review outage is historical; closure commands executed after the environment permissions changed.

The full rerun initially failed because the existing Stage 3B fixture reused fixed months in an already-used synthetic database. The original database was preserved and a fresh isolated target passed the complete suite. No application changes were needed during closure. The fixture repeatability limitation and existing pg warning remain documented; no Stage 3C-2 functional finding remains open.

## Blocked and deferred work

| Item | Current behavior / next action |
|---|---|
| Partial-month actual utility allocation between leases | Owner approved explicit ADMIN per-lease quantities with evidence on 2026-10-20. ALLOCATED_ACTUAL is implemented and verified in unit/PostgreSQL tests. Unapproved allocation still reports OCCUPANCY_ALLOCATION_REQUIRED. |
| Multi-period actual usage following estimates | Returns ACTUAL_PERIOD_ALLOCATION_REQUIRED. Owner approved ADMIN quantities per affected estimated period; reconciliation valuation and future-period document workflow remain deferred. |
| Validated close and immutable source freeze | Preview reports completeness, but every candidate remains PREVIEW_ONLY and eligibleForFutureIssuance=false. Implement transactional freeze/close in 3C-3. |
| Invoice persistence, numbering, due dates, lifecycle and revisions | Design-only handoff; no 3C-3 implementation. |
| F-04 / F-08 | OPEN operator-rollout/pre-release gates. |
| F-05 | OPEN history timestamp usability follow-up. |
| F-06 | OPEN; intended production target and post-migration legacy data unverified. Mandatory before actual billing. |

## Git and working-tree protection

Branch: `codex/stage-3c-billing-invoice`.

- Verified Stage 3B baseline: `c06b95b18c320f14f7f1804cbdf5aaaad50427a1`.
- Existing Stage 3C-1 documentation commit: `fd7dcadb2356d63d799564f217af2af1394066ad`.
- Stage 3C-2 milestone commit: the commit containing this report. Resolve its exact SHA with `git log -1 --format=%H -- STAGE_3C2_IMPLEMENTATION_REPORT.md`; the full SHA is returned in the chat handoff.

Unrelated concurrent login-screen/style and generated Next declaration edits are preserved and excluded from the intended milestone file set and isolated build context. Stage 3B branch refs are preserved. No remote push is authorized or attempted.
