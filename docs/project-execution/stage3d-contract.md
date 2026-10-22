# Stage 3D-1 engineering contract

Status: proposed for independent design review before implementation. No application or database change accompanies this document.

## Evidence and baseline

Read all five files under `stage3d-design-evidence/`, actual `prisma/schema.prisma`, foundation checks, invoice lifecycle SQL, `src/server/invoices/service.ts`, `gate.ts`, and existing contracts. Local snapshot HEAD is `c8d0d51`. Standing orders identify its copied source as F10 `e13b005`; that original object is unavailable in this snapshot, so this is source compatibility evidence rather than verified Git ancestry. Legacy required `Payment.reference`, `method` string, statuses, allocation uniqueness, positive amount checks and restrictive foreign keys already exist.

Policy provenance is in `policy-authorization.md`. Foundational Thinking makes receipt and reversal part of the confirmation transaction. Sequence Work into Verifiable Units places migration and domain tests before HTTP/UI integration. Installed Pstack's Codex adapter maps the poteto-agent role to the actual collaboration agent and inherited model. Cursor agent executables are unavailable.

## Design choice and boundaries

Retain and extend `Payment` and `PaymentAllocation`. A separate managed-payment namespace would avoid nullable legacy provenance but duplicate the allocation/read model, require consumers to combine two payment sources, and depart from the independently reviewed design without a concrete schema blocker. The additive extension preserves all existing values and excludes legacy rows explicitly. Do not populate legacy fields by inference or rewrite the existing `reference` into a bank reference.

The first coherent unit implements migration, draft/create, confirm, reverse, pending cancel, balance reads and invoice void/revise guards. Confirmation includes immutable receipt creation even though print UI follows later. Post-VOID exception creation/resolution, upload/download, and receipt rendering remain separate units. Bank payments in this first unit require a nonempty external reference and receiving-account key because the alternative private-slip flow is unavailable. Do not silently permit evidence-free bank confirmation.

## Prisma delta

All dates below use `@db.Timestamptz(3)` unless stated. All identifiers and actor/parent IDs use `@db.Uuid`. All parent relations use `onDelete: Restrict`. Implement the named inverse relations on `User` and parent models, and run Prisma validation. Existing fields remain verbatim.

```prisma
enum PaymentMethod {
  CASH
  BANK_TRANSFER
}
// Add CANCELLED to existing PaymentStatus, preserving its existing values.

// Add to existing Payment:
// methodCode PaymentMethod?
// legacyUnmapped Boolean @default(true)
// version Int @default(1)
// recordedById String? @db.Uuid
// confirmedById String? @db.Uuid
// confirmedAt DateTime? @db.Timestamptz(3)
// reversedAt DateTime? @db.Timestamptz(3)
// cancelledAt DateTime? @db.Timestamptz(3)
// cancelledById String? @db.Uuid
// cancelReason String? @db.VarChar(1000)
// externalReference String? @db.VarChar(120)
// receivingAccountKey String? @db.VarChar(80)
// recordedBy User? @relation("PaymentRecordedBy", fields: [recordedById], references: [id], onDelete: Restrict)
// confirmedBy User? @relation("PaymentConfirmedBy", fields: [confirmedById], references: [id], onDelete: Restrict)
// cancelledBy User? @relation("PaymentCancelledBy", fields: [cancelledById], references: [id], onDelete: Restrict)
// reversal PaymentReversal?
// receipt Receipt?

model PaymentReversal {
  id String @id @default(uuid()) @db.Uuid
  paymentId String @unique @db.Uuid
  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  reason String @db.VarChar(1000)
  actorId String @db.Uuid
  actor User @relation("PaymentReversedBy", fields: [actorId], references: [id], onDelete: Restrict)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  receiptCancellation ReceiptCancellation?
}
model Receipt {
  id String @id @default(uuid()) @db.Uuid
  number String @unique @db.VarChar(40)
  paymentId String @unique @db.Uuid
  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  issuedAt DateTime @db.Timestamptz(3)
  issuedById String @db.Uuid
  issuedBy User @relation("ReceiptIssuedBy", fields: [issuedById], references: [id], onDelete: Restrict)
  snapshotVersion String @db.VarChar(20)
  snapshot Json
  fingerprint String @db.Char(64)
  cancellation ReceiptCancellation?
}
model ReceiptCancellation {
  id String @id @default(uuid()) @db.Uuid
  receiptId String @unique @db.Uuid
  receipt Receipt @relation(fields: [receiptId], references: [id], onDelete: Restrict)
  reversalId String @unique @db.Uuid
  reversal PaymentReversal @relation(fields: [reversalId], references: [id], onDelete: Restrict)
  reason String @db.VarChar(1000)
  actorId String @db.Uuid
  actor User @relation("ReceiptCancelledBy", fields: [actorId], references: [id], onDelete: Restrict)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
}
model PaymentCommand {
  id String @id @default(uuid()) @db.Uuid
  actorId String @db.Uuid
  actor User @relation("PaymentCommandActor", fields: [actorId], references: [id], onDelete: Restrict)
  commandKey String @db.VarChar(100)
  operation String @db.VarChar(40)
  requestFingerprint String @db.Char(64)
  result Json
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@unique([actorId, commandKey])
}
model ReceiptMonthCounter {
  month String @id @db.Char(6)
  value Int
}
```

`PaymentCommand` stores a command result rather than a mandatory payment relation because commands include list-independent creation. New internal `Payment.reference` is `PAY-` plus a random UUID, never an external reference. The existing free-text `method` is set to the exact `methodCode` for new rows. No legacy method conversion occurs. The additional `ReceiptCancellation.reversalId` closes the original sketch's weak linkage and permits database enforcement that cancellation and reversal belong to the same payment.

## State and database constraints

- New inserts must explicitly set `legacyUnmapped=false`, `isDemo=false`, `version=1`, valid method, recorded actor, positive amount and PENDING state. Reject new legacy rows through guards. Existing legacy rows and allocations remain untouched and read-only to managed commands. Leave the existing default true to avoid pretending a historical row was mapped.
- Legal transitions are PENDING to CONFIRMED or CANCELLED, and CONFIRMED to REVERSED. No other updates or deletes. Preserve identity, amount, lease, method, reference, receivedAt and creator after insertion. Increment version exactly once per transition. Pending corrections use cancel and new draft.
- New pending/cancelled payments have no allocations, receipt, reversal or confirmation provenance. CONFIRMED requires enabled ADMIN confirmer, confirmation timestamp, allocations summing exactly to amount and exactly one receipt. REVERSED retains the confirmation fields, allocations and receipt and requires exactly one reversal and linked receipt cancellation. Actor must be an enabled ADMIN for confirmation, cancellation and reversal. Recorded actor must be enabled STAFF or ADMIN at creation. Later user disablement does not invalidate history.
- Use deferred constraint triggers to check final transaction state for cross-table sum, receipt and reversal requirements. Immediate checks alone reject legitimate intermediate insertion order. Guard immutable history with BEFORE UPDATE/DELETE triggers on receipts, allocations, reversal/cancellation and command rows. Managed allocation insertion is permitted only during confirmation and must reach a valid final state at commit.
- An allocation must be positive, same lease, against managed non-demo ISSUED invoice, with valid frozen snapshot/finalTotal. Retain the existing unique payment/invoice key. Sum active managed CONFIRMED allocations under invoice locks and reject any total above finalTotal. Retained reversed allocations remain history. Reject new allocations on legacy payments; do not infer legacy allocations into the managed read model.
- Add a BEFORE invoice status transition guard that rejects VOID while any active CONFIRMED allocation exists. Include legacy confirmed allocations as a conservative blocker even though their values are excluded from managed balance totals. New payment confirmation also blocks an invoice with any legacy allocation until explicit mapping. Add explicit service checks to both `voidInvoice` and `reviseInvoice` before writes. Do not broaden allowed invoice updates or alter existing snapshot guards.
- Bank method requires both receivingAccountKey and externalReference in this unit; CASH requires both null. Store trimmed strings with no implicit case folding or account-number inference. Partial unique index on `(receivingAccountKey, externalReference)` for managed BANK_TRANSFER rows in PENDING or CONFIRMED state. REVERSED/CANCELLED release the active key under the documented active-reference recommendation. Treat bank references case-sensitively until a bank-specific normalization rule exists.
- Cash likely-duplicate candidates are managed CONFIRMED rows on the same lease, exact amount and same received calendar day in Asia/Bangkok. Serialize on lease before the check. Confirmation requires `duplicateOverrideReason` when candidates exist; ADMIN authority plus reason and candidate IDs enter the audit record. This predicate is an explicit engineering recommendation for independent review, not an observed preexisting rule.
- Receipt number uses issuance timestamp in Asia/Bangkok, Gregorian YYYYMM and integer 0001 through 9999. Fail with RECEIPT_SEQUENCE_EXHAUSTED instead of rolling to five digits. Counter allocated atomically and number remains reserved after cancellation. Add positive counter <=9999 and valid month checks.
- Receipt/reversal/cancellation, amount strings, invoice IDs and command result commit with audit in one transaction. No payment-status update to Invoice. No financial calculations use JS Number.

## Shared lock and transaction contract

Reuse ReadCommitted transactions, bounded retries and the actual Stage 3C source gate. Acquire in this order:

1. `acquireSourceGate(tx)` shared advisory gate 73422193.
2. Actor-scoped command advisory lock, with payment namespace in its hash input. Check stored operation and canonical request fingerprint before mutations.
3. All relevant BillingPeriod rows sorted by UUID, then one Lease row, then all Invoice rows sorted by UUID.
4. Payment row, then receipt monthly counter if confirmation needs a number. Reversal uses the same invoice set retained in its allocations. All commands touching payment rows follow this order, including pending cancellation with no period/invoice set.

Read invoice IDs and period IDs before locks solely to plan locks. Re-read and validate actual payment/lease/invoice state after locks. For reversal, immutable confirmed allocations determine the lock set. An expected-version mismatch returns STALE_VERSION. Confirmation checks submitted invoice expected versions and recomputes balances after locks. `Invoice.version` does not change for payments because issued content is immutable; balances can still change, so versions alone never replace rechecking money.

The existing invoice SQL trigger locks the period during an invoice update after PostgreSQL has already acquired the row lock. Arbitrary direct SQL can therefore invert service order. Do not claim all direct writes are deadlock-free. Database guards must prevent invariant bypass and transactions that deadlock must abort safely. Ordinary service writers must follow the above order. PostgreSQL concurrency tests must cover both service races and direct SQL mutations. Database guards independently lock every affected Invoice row before final cap and payable-state queries, including direct SQL writers. Service prelocks reduce conflicts but never replace database serialization. Arbitrary direct writes may invert the order and deadlock; PostgreSQL must abort incompatible transactions safely. Test two direct SQL confirmations against one invoice cap and direct confirmation racing direct VOID.

Void/revision winning first makes confirmation reject the VOID invoice. Confirmation winning first makes void/revision reject active allocations. Reversal restores balance by excluding REVERSED payment rows and atomically cancels the receipt. A pending entry cannot block either invoice action. If a pending draft targeted an invoice later voided, confirmation rejects without losing the pending record; explicit exception workflow follows later.

## Service and transport contracts

Place contracts in `src/server/payments/contracts.ts`, domain helpers in `domain.ts`, transaction services in `service.ts`, exports in `index.ts`. Use existing `Actor`, `AppError`, strict Zod, canonical JSON fingerprint and decimal handling patterns.

```ts
createPayment(actor: Actor, input: unknown): Promise<PaymentDto>
confirmPayment(actor: Actor, input: unknown): Promise<PaymentDto>
cancelPendingPayment(actor: Actor, input: unknown): Promise<PaymentDto>
reversePayment(actor: Actor, input: unknown): Promise<PaymentDto>
getPayment(actor: Actor, id: string): Promise<PaymentDto>
listPayments(actor: Actor, input: unknown): Promise<PaymentListDto>
listOutstandingBalances(actor: Actor, input: unknown): Promise<BalanceListDto>
getReceipt(actor: Actor, id: string): Promise<ReceiptDto>
```

Create input is `{leaseId, amount, method, receivedAt, externalReference?, receivingAccountKey?, commandKey}`. Amount is canonical positive decimal string with exactly two digits after the dot and <=12 integer digits, accepted by Decimal without rounding. receivedAt is ISO timestamp with explicit timezone, persisted UTC. Confirm input is `{paymentId, expectedVersion, allocations:[{invoiceId, expectedVersion, amount}], duplicateOverrideReason?, commandKey}` with 1 to 100 distinct invoice IDs. Cancel/reverse input is `{paymentId, expectedVersion, reason, commandKey}`. Reason is trimmed 1 to 1000 characters, commandKey trimmed 8 to 100. No client actor, status, receipt number, snapshot or balance fields are accepted. List reads have bounded pagination, stable receivedAt/id ordering and explicit managed-only scope.

PaymentDto returns decimal strings, method/state/version, creator/confirmation/cancellation timestamps and IDs, allocations, receipt identity and reversal metadata. ReceiptDto contains snapshot plus derived cancellation information. BalanceDto includes invoice ID/number, frozen tenant/room labels and tenant ID, due date, finalTotal, activePaid and outstanding as strings. VOID returns zero collectible outstanding while preserving historical total. Never group by current tenant assignment.

Receipt snapshot schema `receipt.v1` contains payment ID, immutable internal reference, amount, method, receivedAt, external reference, issuedAt, issuedBy ID/display name, receipt number, and a sorted array of `{invoiceId, number, frozenLeaseId, frozenTenantId, labels, finalTotal, allocatedAmount}`. Preserve per-invoice labels if they differ. Legal issuer configuration must be supplied before operational print release; synthetic fixtures must visibly identify themselves. Fingerprint canonical serialized snapshot and verify on read.

Later HTTP wrappers use GET/POST `/api/v1/payments`, GET `/{id}`, POST `/{id}/confirm`, `/cancel`, `/reverse`, GET `/api/v1/receipts/{id}`, GET `/api/v1/outstanding-balances`. Authenticated ADMIN/STAFF read/create; ADMIN alone transition. Reuse exact Origin checks, no-store responses and `{data}` / `{error:{code,message}}` boundaries. No upload route is claimed by this unit.

Errors include FORBIDDEN, PAYMENT_NOT_FOUND, PAYMENT_STATE, STALE_VERSION, IDEMPOTENCY_CONFLICT, DUPLICATE_PAYMENT_REFERENCE, CASH_DUPLICATE_REVIEW_REQUIRED, INVOICE_NOT_PAYABLE, LEGACY_MAPPING_REQUIRED, ALLOCATION_EXCEEDS_BALANCE, PAYMENT_NOT_FULLY_ALLOCATED, INVOICE_HAS_PAYMENTS, RECEIPT_SEQUENCE_EXHAUSTED and RECEIPT_SNAPSHOT_MISMATCH. Use 403/404, 409 state/conflict and 422 invalid input; sanitize database errors.

## Acceptance and ownership

One implementer owns schema, new additive migration, payment modules, invoice guards and financial integration tests. Main owns execution documents and integration. A fresh independent financial/database reviewer reviews design and integrated changes; the implementer cannot approve their own unit. API/UI work may proceed only after the reviewed contract and generated Prisma client agree. Do not let separate agents edit schema or invoice transaction services concurrently.

Required evidence before Stage 3D-1 closes:

- Fresh isolated migration deploy and Prisma validate/generate/typecheck. Synthetic legacy fixture rehearsal verifies every preexisting Payment/PaymentAllocation column value, ID, status, constraint and relationship survives; no real target database is touched.
- Unit tests exercise positive decimal parsing, rejection of extra precision, exact partial/full arithmetic, immutable fingerprint, Bangkok month/day boundaries and sequence exhaustion.
- PostgreSQL tests cover partial/full/multiple/multi-invoice settlement, same-lease rule, no pending receipt/balance, non-demo managed eligibility, legacy blocker, BANK reference uniqueness, CASH duplicate review, ADMIN-only transitions, cancellation and reversal linkage, and immutable allocation/payment/receipt history through direct SQL.
- Concurrent confirmations cannot exceed invoice total. Same-key same-body returns one stored result; changed body/operation conflicts. Concurrent receipt numbers remain unique. Both winning orders of confirmation versus invoice void and revision preserve invariants. Pending cancellation versus confirmation yields exactly one valid transition.
- Inject failure after allocation, receipt, audit and command writes and verify full rollback. Deferred constraints reject incomplete or orphan final states at commit. Reversal restores exact balances and cancels exactly one receipt, preserving its snapshot/number.
- Invariant queries prove all managed confirmed payments are fully allocated and receipted, all reversed ones have linked cancellation, every VOID invoice has no active allocation, every payable invoice has activePaid within [0, finalTotal], and no legacy/demo amount enters managed totals.
- Independent review closes material findings and reruns affected tests. Record actual commands, exit codes and evidence paths. Commit locally after review. Actual legacy mapping, UI/API/browser verification, Owner UAT, legal issuer configuration and production readiness remain separate gates.

## Independent review corrections DR-01 through DR-03

These requirements clarify and take precedence over shorter guard descriptions above.

DR-01: Define an exact UPDATE allowlist for each Payment transition. PENDING to CONFIRMED may change only status, version, confirmedById and confirmedAt. PENDING to CANCELLED may change only status, version, cancelledById, cancelledAt and cancelReason. CONFIRMED to REVERSED may change only status, version and reversedAt. Every other column is immutable, including legacyUnmapped, isDemo, reference, method, methodCode, amount, leaseId, receivedAt, recordedById, createdAt, receivingAccountKey and externalReference. If Prisma writes updatedAt, explicitly permit that technical timestamp only and validate business provenance separately. Original confirmation provenance remains immutable during reversal. Legacy rows cannot be updated, deleted, remapped or acquire new managed allocations, receipts, reversals or cancellations. Every new child must refer to a managed payment and satisfy its final-state constraints. Direct SQL tests must attempt flag toggles, bank-identity edits during otherwise valid transitions, legacy remapping and legacy child creation.

DR-02: Database guards independently serialize the invoice cap and state checks with affected Invoice row locks. The service lock order remains source gate, command lock, sorted periods, lease, sorted invoices, payment, receipt counter. Deferred final-state queries run after database-side invoice locks, even when a caller bypasses services. Direct SQL may deadlock with other arbitrary writers; safely aborted transactions are acceptable, over-allocation or active payment on VOID is not. Both direct-confirmation races and direct confirmation versus direct VOID require PostgreSQL evidence.

DR-03: Final-state validation is reached from inserts and updates of all five lifecycle tables: Payment, PaymentAllocation, Receipt, PaymentReversal and ReceiptCancellation. Cancellation receipt and reversal must belong to the same payment. CONFIRMED and REVERSED each retain exactly one original receipt. Only REVERSED has exactly one reversal and its exactly one linked cancellation. PENDING/CANCELLED has none. Allocation insertion requires an eligible ISSUED invoice; active CONFIRMED allocations remain subject to cap/state checks. Retained REVERSED allocations may subsequently reference VOID invoices and must not prevent reverse-then-void. Test standalone orphan child creation, mismatched cancellation links and unchanged historical allocations/snapshot after reversal then void.

The frozen OPS03 version2 restore registry covers the current33-model schema. Payment schema integration must preserve that registry for old archives and introduce a new current inventory version/registry for the added models. Coordinate serially with the operations owner; do not redefine version2 or edit its files concurrently.
