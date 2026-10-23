# Stage 3E deposit domain design

Status: architecture proposal for independent review. No deposit workflow, migration, or business policy is implemented by this document.

## Evidence and approved scope

The repository establishes these facts:

| Source                                                                            | Established fact                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/phase-3-implementation-plan.md`, Stage 3E and business rules                | Record receipts, additions, deductions and refunds in an audited liability ledger. Prevent negative balances under concurrent writes. Attach evidence to deductions. Deposits stay outside rental revenue.                                                      |
| `docs/implementation-plan.md`, phases 3 and 4                                     | Exact money, audit history, transactional consistency and deposit reconciliation are project acceptance requirements.                                                                                                                                           |
| `prisma/schema.prisma`, `Lease` and `SecurityDeposit`                             | A lease has a contractual `deposit` amount. Existing deposit rows hold lease, kind, positive decimal amount, occurrence time, demo flag and mutable timestamps. They do not record settlement confirmation, actor, command identity or a reversal relationship. |
| `prisma/migrations/202610160001_foundation/migration.sql`, deposit enum and table | Existing kinds are `RECEIVED`, `REFUNDED`, `DEDUCTED`. The restrictive lease foreign key preserves the lease relationship.                                                                                                                                      |
| `prisma/migrations/202610160002_constraints/migration.sql`                        | `Deposit_positive` enforces positive amounts. No aggregate balance or concurrent deduction constraint exists.                                                                                                                                                   |
| `src/features/live/leases.tsx`, deposit explanatory text                          | Live lease screens describe `Lease.deposit` as the contractual amount and explicitly defer receipt/refund accounting. It must not become an assumed cash receipt.                                                                                               |
| `src/server/lease-service.ts`, `saveLease`                                        | Lease changes use the source gate and tenant/room locking. Started leases cannot change tenant or room. Lease lifecycle and monetary fields alone do not prove actual deposit settlement.                                                                       |
| `docs/project-execution/policy-authorization.md`, D3D-15/17                       | Deposits remain outside invoice payment allocations. Legacy rows have no automatic mapping. Stage 3D recommendations were adopted for development; this does not supply detailed Stage 3E policies.                                                             |
| `src/server/payments/contracts.ts`, `service.ts`, `domain.ts`                     | Payments have dedicated parsed command contracts, decimal strings, actor-scoped idempotency, version checks, locked mutations and immutable receipts. Their rental allocation and receipt invariants must remain intact.                                        |
| `prisma/schema.prisma`, `Attachment` and `AuditLog`                               | Attachment metadata can refer to a lease but has no deposit-entry relation. Audit records carry actor/entity/action/metadata. An attachment row alone does not establish an implemented private upload and retention workflow.                                  |

The existing phase plan's early approval status is historical. The later Owner instruction authorizes routine local engineering. It does not establish that a new financial policy was previously specified, that historical rows represent verified money, or that Owner UAT passed.

## Grounding and alternatives

Current data separates contractual deposit requirements from rudimentary transactions. The finance payment service owns rental invoice settlement and its receipt lifecycle. A deposit service should own liability transactions. Reports join read projections; they must not infer held deposits by summing active leases or count all deposit receipts as rental income.

Candidate A extends `SecurityDeposit` into one mutable balance row per lease with child transaction history. Every writer updates both the balance and history. This makes ordinary reads simple, but creates two authoritative values that can disagree. Existing rows are transaction shaped, so converting them to balances also needs unsupported historical interpretation.

Candidate B keeps immutable deposit entries and derives the balance from their signed effects. Each writer serializes on its lease, validates the resulting balance, and inserts the entry and audit atomically. Reads use one aggregate query. At approximately 15 rooms, this avoids an unnecessary cached balance. Existing legacy rows remain a separate, explicitly unverified stream until reconciled.

Recommend B. Reuse the existing table additively where it keeps migration history clear; a managed/legacy discriminator and new immutable provenance are required. If review shows those variants cannot be expressed safely in one table, use a dedicated managed-entry table and leave `SecurityDeposit` untouched. Do not implement both structures. Choose the migration representation after independent design review.

This task compared the two shapes locally. No additional arena candidates or cross-model agents ran in this bounded assignment. The Main Agent must obtain an independent review before implementation. This follows the installed Pstack Codex adapter rather than claiming unavailable Cursor model routing. The relevant installed guidance was `architect`, `principle-model-the-domain`, `principle-type-system-discipline`, `typescript-best-practices`, and `unslop`.

## Proposed ownership and interfaces

The caller supplies a parsed command to `src/server/deposits/service.ts`. The service repeats role authorization and owns the transaction. Routes use existing session, origin, body-size and no-store response helpers. Deposit endpoints must not use generic CRUD.

Recommended modules are `contracts.ts` for strict Zod input/output contracts, `domain.ts` for exact signed effects and reconciliation, `service.ts` for commands and queries, and `index.ts` for public exports. Do not extract a generic financial command framework from the payment service solely for this stage.

The intended usage is:

```ts
await recordDepositReceipt(actor, rawReceiptCommand);
await recordDepositDeduction(actor, rawDeductionCommand);
await recordDepositRefund(actor, rawRefundCommand);
await reverseDepositEntry(actor, rawReversalCommand);
await getLeaseDepositLedger(actor, rawLeaseQuery);
```

These signatures are a proposal, not callable code. Infer command types from Zod schemas. Parse normalized UUIDs, canonical positive two-decimal strings, bounded reasons, UTC offset timestamps and actor-scoped command keys at the boundary. Use discriminated variants for receipt, deduction, refund and reversal rather than optional fields whose required combinations vary implicitly.

Each posted entry needs an immutable ID, lease ID, kind, positive `NUMERIC(14,2)` amount, actual occurrence timestamp, system posting timestamp, actor, reason where applicable, and command provenance. A reversal references exactly one earlier managed entry on the same lease and derives its opposite effect from that entry. A uniqueness constraint prevents two reversals. Receipt method and bank identity belong only to receipt/refund cash movements, according to the policy chosen below. Deduction evidence must reference authorized retained evidence belonging to the same lease and entry.

Use dedicated command replay storage or another explicitly reviewed unique command representation. A replay by the same actor with the same normalized payload returns the original result. A different payload under the same key returns a conflict. Persist that identity in the same transaction as the ledger and audit.

Ledger DTOs return contractual requirement, managed balance, managed receipt/refund/deduction totals and a distinct legacy status. All money stays in canonical decimal strings. Paginate the history, but compute balances across the complete managed ledger rather than the displayed page. Return legacy rows separately with `unverified` status. Never display an unknown historical total as a verified zero.

## Transaction and integrity contract

1. Acquire the existing source gate if the command observes or changes protected lease identity. Lock the lease before reading its ledger. Any additional shared locks must follow one documented order compatible with lease and payment commands. Validate this order against the actual integrated baseline before coding.
2. Re-read the locked lease and managed entries. Enforce allowed lease states and the chosen historical-review fence. Do not trust an earlier browser balance or a pre-lock plan.
3. Compute effects with Prisma Decimal. Receipts increase liability. Deductions and refunds decrease liability. A reversal applies the opposite signed effect of the referenced entry. Reject any resulting negative balance, including reversal of a receipt whose funds have already been deducted or refunded.
4. Insert the entry, replay result and one audit event in the same serializable transaction. Failed evidence validation, insufficient balance, duplicate identity, audit failure or receipt-number exhaustion must leave no partial posting.
5. Enforce managed entry immutability, restrictive relationships and nonnegative aggregate balance in PostgreSQL as well as the service. Direct SQL writers must serialize on the same lease before aggregation. Reject cross-lease reversal/evidence references and updates/deletes of posted entries. Test the actual trigger locking and transaction behavior with separate database connections.

At this scale the ledger sum is authoritative; no independently maintained balance column is needed. A version field on a stable lease-account record may be useful for stale UI detection, but is optional unless the chosen interface needs it. Idempotency and locked aggregate validation are mandatory regardless of that choice.

Posting order determines whether a spend is available. Backdating `occurredAt` must not bypass the current balance check. A historical statement can show effective dates, but a policy decision is required before promising that every effective-date prefix is nonnegative.

Deposits never create `PaymentAllocation`, change invoice paid balance, reuse a rental `Receipt` with incompatible snapshot content, or mutate an issued invoice. A deduction does not automatically become rental revenue or satisfy an invoice. Its accounting destination requires a separate approved rule.

## Decisions still needed

The recommendations below are proposed development defaults. They are not established policies and must not be silently implemented as such. The Main Agent should reconcile any later Owner instructions or existing approved record before asking for a new decision. Continue unrelated work while these items are unresolved.

| ID     | Missing decision                                | Recommended default and affected tasks                                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D3E-01 | Roles, confirmation and actual receipt evidence | ADMIN posts financial entries; STAFF reads. A posted receipt means ADMIN verified actual funds. No separate pending workflow in the first unit. Bank receipt requires reference/account identity and an authorized evidence mechanism. Blocks posting commands and UI.                                                                                          |
| D3E-02 | Receipt cap, top-ups and lease eligibility      | Permit explicit positive top-ups without automatically changing contractual `Lease.deposit`. Require a non-cancelled lease, with ended-lease posting limited to documented correction/settlement. Do not silently cap at or auto-fill the contractual requirement. Blocks receipt state rules.                                                                  |
| D3E-03 | Deduction grounds and accounting destination    | Require ADMIN reason and retained evidence. No automatic rent offset, expense creation, damage fee, tax treatment or revenue classification. Blocks deductions and finance classification.                                                                                                                                                                      |
| D3E-04 | Refund eligibility, payee and method            | Require explicit ADMIN refund after recorded settlement review. Record amount, method, payee identity snapshot and reference/evidence. Reject refunds above available liability. No automatic payout or bank integration. Blocks refund schema and commands.                                                                                                    |
| D3E-05 | Correction method                               | Append full reversals with reasons and a link to the original entry. Never edit/delete postings. Reject a reversal that makes available liability negative. No automatic chain cancellation. Blocks reversal semantics.                                                                                                                                         |
| D3E-06 | Duplicate matching across deposits and rent     | Always require command replay protection. Propose normalized receiving-account/reference uniqueness across managed receipt streams so one bank transfer cannot silently become both rent and deposit cash. Cash duplicate handling needs an explicit reviewed heuristic. Blocks cash/reference posting rules and may require a shared transfer-identity design. |
| D3E-07 | Deposit documents and numbering                 | Keep deposit documents distinct from rental receipts. Recommend a dedicated immutable deposit receipt series with never-reused monthly issuance numbers. Exact prefix, legal text, refunds and cancellation wording remain undecided. Blocks financial document schema/printing.                                                                                |
| D3E-08 | Historical entry reconciliation                 | Preserve all old rows and their timestamps byte-for-byte. Do not infer actor or settlement. Require an explicit per-lease review before managed spending against historical deposits. A reconciled opening balance must link to the review and must not count as new cash. Blocks live cutover and opening-balance commands.                                    |
| D3E-09 | Evidence formats, limits and retention          | Reuse a private evidence subsystem only once its authorization, MIME/size, retention and backup rules are approved and verified. A text path or attachment metadata row is insufficient. Blocks deductions and required bank/refund evidence.                                                                                                                   |
| D3E-10 | Backdating and closed periods                   | Record actual occurrence separately from posting time. Recommend no implicit reopening or rewriting of prior reports. Define allowed backdating and statement correction behavior before date-based posting. Blocks effective-date reporting and period controls.                                                                                               |

No recommendation in this document makes a legal determination about deposit retention, permissible deductions, refund deadlines or receipt requirements.

## Policy-independent work that can proceed

- Build synthetic characterization tests for the current table and legacy migration inventory. Prove that `Lease.deposit` is a requirement rather than a receipt, and that legacy deposit rows remain unchanged. Do not move actual tenant data.
- Specify and test a pure exact-decimal signed-entry reducer using explicit synthetic effects. It can prove nonnegative arithmetic without declaring which user operations are permitted. Test maximum amounts, fractional satang rejection and sums larger than one entry's precision.
- Build a read-only legacy deposit inventory and separate query DTO. Show row counts and unverified status without claiming spendable balances or historical reconciliation.
- Independently review lock ordering, immutable-row enforcement, replay behavior and an additive migration plan. Verify evidence and report dependencies against current implementations.
- Prepare database test fixtures and a reusable concurrency runner in an isolated synthetic database. No migration or enabled posting endpoint is required to establish the test contract.

New managed schema, posting routes, live reports and financial documents should follow the decision set and independent design review. Do not create placeholder opening balances or expose half-enabled actions to users.

## Verification and milestone gates

Acceptance requires independent review of both the design and integrated implementation. A different agent must inspect the financial, authorization and migration behavior and verify corrections.

Required tests include exact decimal input/results; unknown and forged roles; no cookie or raw secret leakage on failure; Origin enforcement; duplicate/replayed command identity; immutable rows and audit rollback; evidence lease/entry ownership; additive preservation of legacy rows; and complete financial reconciliation excluding deposits from rent revenue.

PostgreSQL tests must race two deductions, two refunds, a refund against a deduction, a receipt reversal against a spend, duplicate reversals and concurrent duplicate receipt references. Assert committed counts, exact final liability and immutable history through real database connections. Test direct SQL attempts as well as public services. A serializable transaction by itself is not proof that the locking plan works.

If a managed ledger introduces tables, add a new restore inventory version after the frozen v3 registry. Preserve legacy, v2 and v3 inventory readers byte-for-byte where their contracts require it. Run new and prior-version synthetic dump/restore verification and schema coverage before integration.

Run unit, integrated database, route/RBAC, browser, migration and restore checks on the agreed integration baseline. A browser flow must distinguish contractual deposit, verified held liability and unverified legacy amounts. Complete local commits and record source, commands and results. Owner UAT, historical reconciliation, operational commissioning and production authorization remain separate gates.
