# Stage 3D-1 final financial and database review

Reviewer: `/root/payment_final_review`. Implementation owner: `/root/payment_domain_impl`. Reviewed baseline: `b3b0833` in `/private/tmp/taky-payment-development`. This reviewer changed only this report and did not connect to or mutate a database.

Decision: the reviewed payment domain and additive migration pass independent review against the accepted Stage 3D-1 contract, including DR-01 through DR-03. No unresolved material finding was identified. FR-01 and FR-02 are closed by inspected corrections and fresh PostgreSQL negative-test evidence. This decision covers domain implementation and synthetic database verification. It does not mark the whole Stage 3D, integration, Owner UAT or production release complete.

## Method and scope

Read the installed Pstack Codex adapter, Poteto feature guidance, TypeScript guidance and its type-system discipline principle, and Unslop. The implementation owner and final reviewer are separate collaboration agents. Read policy authorization, the accepted contract and previous independent review, the full additive migration, Prisma schema delta, payment contracts/domain/service/exports, invoice void/revise guards, unit tests, PostgreSQL integration cases, migration rehearsal script and immutable attempt logs.

## Financial and database controls inspected

- Decimal strings and Prisma Decimal preserve exact amounts. Input rejects extra precision, zero, negative, exponent and out-of-range values. Confirmation requires exact allocation of the whole payment, same-lease payable invoices, frozen invoice integrity and locked balance recomputation.
- Payment transition allowlists preserve business identity, scope flags, bank identity and original confirmation provenance. Legacy rows remain unchanged, immutable and excluded from managed reads. Every financial child table rejects edits/deletes and triggers deferred final-state validation.
- Receipt validation compares the complete snapshot against immutable payment, allocation and frozen invoice evidence. Canonical SQL SHA-256 matches the TypeScript fingerprint. Issuer name is checked on insert and retained through subsequent user rename. Receipt suffix 0000 is explicitly rejected; monthly counters are monotonic and bounded.
- Reversal preserves allocations and the original receipt, appends one reversal and the matching receipt cancellation, restores balances and permits later invoice VOID. Orphan and mismatched child records cannot commit.
- Services use source gate, actor command lock, sorted billing periods, lease, sorted invoices, payment and receipt counter. Database guards independently lock affected invoices before cap and state checks. Arbitrary direct SQL can deadlock safely; no deadlock-free claim is made.
- Actor authorization is rechecked before command replay. Idempotency binds actor, operation and canonical request. Confirmation, receipt, audit and command result commit together. Failure injection after each financial write stage checks full rollback, including counter state.

## Actual evidence inspected

The orchestrator executed these checks. The reviewer inspected their artifacts rather than rerunning a mutating suite.

| Evidence | Observed result |
|---|---|
| `qa-rehearsal-2026-10-23T00-19-31.923Z-92d27e1d-5d10-4574-8784-41f2e5a9cc74.log` and `legacy-migration-rehearsal.json` naming `taky_payment_test_2b5214bd52_r4` | Fresh rehearsal passed. Script asserts every original Payment column value and complete allocation row, original constraint and index definitions, relationships, and original enum order. Three payments, three allocations, seven constraints and seven indexes survived. |
| `qa-integration-2026-10-23T00-20-25.610Z-88f8fb96-4d3e-435d-b64f-2e818c95af33.log` | One PostgreSQL test file passed, 22 of 22 cases. Includes direct SQL cap/VOID races, false hashed receipt rejection, suffix-zero rejection, mutation attempts, rollback injection, replay, reversal linkage, concurrent receipt numbers and final invariant queries. |
| `all-unit-tests.log` | 12 files and 159 tests passed. Payment boundary/domain coverage is included. |
| `typecheck.log` | TypeScript command completed without diagnostics. |
| Reviewer `git diff --check` | Executed successfully, exit 0. |

The r4 fixture correction serializes only synthetic fixture provisioning. Actual confirmation/cancellation and separate-lease receipt confirmations remain concurrent. The direct SQL cap race requires exactly one fulfilled and one rejected transaction and verifies the resulting paid amount. The direct SQL VOID race requires exactly one fulfilled transaction and checks that VOID and CONFIRMED cannot coexist. Assertions were not weakened to accept two aborts.

The first rehearsal's missing-dueDate failure is preserved as a reconstructed transcript note, not original raw stdout. That raw phase log was overwritten once before immutable per-attempt logs were introduced. Later failed and passing attempt logs are retained separately. Earlier unit-checkpoint wording claiming the first raw log survived must be corrected by its owner.

Reviewed SHA-256 values:

- Migration: `7f8fd9b5d1629562c5a3cd91719d990b974cca8727194c49bcb2b11d9799ff91`
- Payment service: `393b4d97f95ffe802fe4cc330c173712c2e0cee03e1de6791e556a137f623497`
- PostgreSQL tests: `dd7a20b4e082085aae49552ea0a24b19b0eaf762c24ab7cb04ca1624082959ce`

## Remaining integration and release gates

Main must reconcile the checkpoint and local commit, integrate the five added models with the operations inventory/restore registry while preserving old version 2 archive compatibility, and run relevant integrated regression checks. Existing PostgreSQL tests emit a pg client query-queue deprecation warning; this did not fail the current suite and remains a dependency-upgrade concern.

API/UI/browser behavior, evidence upload/storage, post-VOID exception handling, receipt print/legal issuer identity, real historical mapping, Owner UAT, backup commissioning and authorized production rollout remain separate work. Original source Git ancestry is unavailable in this copied snapshot. This review establishes no Owner acceptance or whole-project completion.
