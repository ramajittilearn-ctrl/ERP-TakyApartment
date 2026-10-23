# Stage 3D-1 independent financial/database review

Reviewer: `/root/payment_financial_review`. Implementer: `/root/payment_domain_impl`. Baseline: `b3b0833` in `/private/tmp/taky-payment-development`. The reviewer changed only this evidence document.

Status: correction review in progress. No PostgreSQL verification or implementation acceptance is claimed.

Read the accepted engineering contract, policy authorization, independent design review and correction retest, additive Prisma delta, complete new SQL migration, payment contracts/domain/services, invoice void/revise changes and current tests. Applied the installed Pstack Codex adapter, Poteto agent guidance, TypeScript/type discipline and Unslop instructions.

## Findings and communication

| ID | Severity | Finding | Correction and current evidence |
|---|---|---|---|
| FR-01 | High | The original Receipt INSERT guard checked only snapshot payment ID, receipt number, total amount and fingerprint shape. Deferred validation counted the receipt without comparing its financial content. A direct SQL confirmation could attach a correctly hashed, schema-valid snapshot naming a different tenant/invoice or different allocation amounts. The receipt reader would accept that hash and schema. | Sent directly to the implementer and orchestrator. Implementer accepted and added a deferred exact comparison against payment provenance, sorted allocations, frozen invoice labels/totals, receipt issuer and timestamp, plus canonical SHA-256. Static re-read confirms those checks are present around migration lines 204-207. Issuer display name is checked at insertion and retained historically. Live negative tests and SQL/TypeScript hash parity are still required before closure. |
| FR-02 | Medium | The Receipt number regex permits suffix `0000`; the subsequently added counter predicate `counter.value >= suffix` also permits zero. The contract requires 0001 through 9999. | Sent directly to the implementer and orchestrator. Static retest confirms explicit suffix `BETWEEN 1 AND 9999` at migration line 177. Live direct INSERT rejection remains required. |

## Inspected controls

Static inspection found transition-specific Payment UPDATE allowlists, immutable legacy rows and financial children, explicit managed/non-demo scope, actor-scoped replay authorization, canonical request fingerprints, Decimal calculations, bounded transaction retries, source/period/lease/invoice/payment lock sequencing and atomic audit/command writes. The five lifecycle tables all reach the deferred validator. Cancellation and reversal are linked to the same payment. Reversed allocations remain history and allow subsequent invoice VOID. Both invoice service operations check active managed and legacy confirmed allocations.

Database-side allocation and deferred checks lock Invoice rows. This supports the required cap/state serialization design, but static inspection does not prove concurrent PostgreSQL behavior. Arbitrary direct SQL may invert lock order and safely abort. It must never commit an over-cap payment or active allocation against VOID.

Balance DTOs read tenant identity and labels from BillingFreezeLease. Active-paid sums exclude legacy/demo payments and REVERSED rows. Receipt reads validate schema and fingerprint.

## Verification actually executed

`./node_modules/.bin/vitest run tests/payments.test.ts` exited 0 with 1 file and 12 tests passed. This exercised input boundaries, exact Decimal arithmetic, Bangkok boundaries, numbering helper limits, canonical fingerprints and snapshot edit detection. It did not exercise PostgreSQL triggers, transactions or concurrency.

The implementer added direct SQL confirmation/cap/VOID helpers, a correctly hashed false-tenant receipt rejection, multi-invoice settlement and rollback injections after allocation, receipt, audit and command writes. The reviewer inspected these tests. They had not been executed against PostgreSQL at this checkpoint.

## Remaining implementation acceptance evidence

Require migration deployment on a fresh isolated synthetic database and unchanged legacy fixture rehearsal. Run direct SQL cap and confirmation-versus-VOID races, both invoice void/revise winning orders, multi-invoice settlement, immutable history attempts, legacy child rejection, mismatched cancellation rejection and standalone orphan children. Inject failure after allocation, receipt, audit and command writes and prove rollback. Verify concurrent command replay and receipt number uniqueness, numbering exhaustion, original name preservation after user rename and FR-01/FR-02 negative tests. Inspect final invariant queries.

Transport/UI, private evidence storage, post-VOID exceptions, receipt print identity, Owner UAT and production readiness remain separate scope and release gates.
