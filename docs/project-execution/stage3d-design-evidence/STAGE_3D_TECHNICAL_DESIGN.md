# Stage 3D technical design

**Status:** Proposed design. The Owner must approve business rules before implementation. No schema, code, API, or database change was made in this design session.

## 1. Baseline and boundaries

The design baseline is commit `0530eddac1d1e07a578b8715c92884c320ed8baa` on `codex/stage-3c-billing-invoice`, checked out in an isolated, detached worktree. The source checkout had unrelated uncommitted Billing UI and UAT files. Those files are excluded from this design baseline. The separate `codex/billing-ui` worktree was not used as implementation evidence.

The current Prisma schema already contains `Payment`, `PaymentAllocation`, `PaymentStatus`, `Attachment.paymentId`, and `SecurityDeposit`. `Payment` has `PENDING`, `CONFIRMED`, and `REVERSED` states; a globally unique required `reference`; a lease link; `DECIMAL(14,2)` amount; free-text method; `receivedAt`; and demo flag. `PaymentAllocation` links a payment to an invoice and has a unique `(paymentId, invoiceId)` pair. Those are existing tables, not a live Stage 3D workflow.

The current `/payments` screen reads and writes `useDemo()` browser state. No persisted payments API, attachment upload/download API, or receipt API was found. The existing invoice routes use `requireActor`, exact-Origin checks for mutations, strict Zod contracts, no-store JSON responses, service-layer authorization, transactions, audit rows, expected versions, and actor-scoped command keys. Reuse these patterns without changing the Stage 3C calculation engine.

Stage 3C invoices have `DRAFT`, `ISSUED`, and `VOID` states. Managed issued content is protected by a snapshot fingerprint and PostgreSQL guards. The invoice void and revise services lock period, lease, and invoice records, but the current implementation does not check payment allocations. Stage 3D must close this lifecycle gap before payments can be accepted.

## 2. Domain shape

### Core records

```text
Lease 1 ── * Invoice 1 ── * PaymentAllocation * ── 1 Payment
                                  │                         │
                                  └── ReceiptLine snapshot  └── 0..1 Receipt
Payment 1 ── * Attachment
Payment 1 ── 0..1 PaymentReversal
Payment 1 ── * PaymentCommand
Receipt 1 ── 0..1 ReceiptCancellation
```

The recommended domain invariants are:

1. A payment belongs to one lease. Its allocations can reference multiple invoices from that same lease.
2. Only managed `ISSUED` invoices accept allocations. `DRAFT`, `VOID`, legacy-unmapped, and demo invoices reject allocations.
3. Confirmed allocation totals never exceed each invoice's immutable `finalTotal`.
4. Under the recommended no-credit policy, every confirmed payment is fully allocated. `Payment.amount` equals the sum of its allocations.
5. A confirmed payment has one receipt. A pending payment has none.
6. Reversal retains the original amount, allocations, receipt snapshot, and receipt number. Reversal and receipt cancellation records append reason and actor.
7. Invoice paid state and outstanding balance are derived from confirmed allocations and reversals. Do not add a mutable paid status to `Invoice`.
8. Tenant balance uses `BillingFreezeLease.tenantId` for managed invoices. Do not group by a mutable current lease assignment or room label.
9. A pending payment has no invoice allocations. It does not reduce outstanding balance or block invoice void/revision. The confirmation command supplies allocations and rechecks invoice state and balance after locks.
10. Funds associated with a VOID invoice enter a separate unresolved exception state only if the Owner approves that workflow. An exception is not confirmed rental income, does not reduce an invoice balance, and has no receipt until it is explicitly resolved.

### Proposed Prisma model delta

The existing payment tables require an additive migration, not a replacement. Preserve all existing rows and references. Confirm a read-only row inventory on the intended database before finalizing any nullability or enum change.

```prisma
enum PaymentMethod {
  CASH
  BANK_TRANSFER
}

enum PaymentExceptionOutcome {
  REALLOCATED
  REFUNDED
}

model Payment {
  // Keep the existing method String and reference columns for legacy rows.
  // New managed records use methodCode; legacy rows remain explicitly unmapped.
  methodCode         PaymentMethod?
  legacyUnmapped     Boolean        @default(true)
  recordedById       String?        @db.Uuid
  confirmedById      String?        @db.Uuid
  confirmedAt        DateTime?      @db.Timestamptz(3)
  externalReference  String?        @db.VarChar(120)
  receivingAccountKey String?       @db.VarChar(80)
  sourceInvoiceId    String?        @db.Uuid
  status             PaymentStatus
  // Add CANCELLED, EXCEPTION, and REFUNDED only after Owner approval.
  // Keep the existing id, reference, leaseId, amount Decimal(14,2),
  // receivedAt, isDemo, createdAt, updatedAt, and restrictive relations.
  reversedAt         DateTime?      @db.Timestamptz(3)
  recordedBy         User?          @relation("PaymentRecordedBy", fields: [recordedById], references: [id], onDelete: Restrict)
  confirmedBy        User?          @relation("PaymentConfirmedBy", fields: [confirmedById], references: [id], onDelete: Restrict)
  sourceInvoice      Invoice?       @relation("PaymentExceptionSourceInvoice", fields: [sourceInvoiceId], references: [id], onDelete: Restrict)
  reversal           PaymentReversal?
  exceptionResolution PaymentExceptionResolution?
  receipt            Receipt?
}

model PaymentReversal {
  id                 String   @id @default(uuid()) @db.Uuid
  paymentId          String   @unique @db.Uuid
  payment            Payment  @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  reason             String   @db.VarChar(1000)
  actorId            String   @db.Uuid
  actor              User     @relation("PaymentReversedBy", fields: [actorId], references: [id], onDelete: Restrict)
  createdAt          DateTime @default(now()) @db.Timestamptz(3)
}

model Receipt {
  id                 String   @id @default(uuid()) @db.Uuid
  number             String   @unique @db.VarChar(40)
  paymentId          String   @unique @db.Uuid
  payment            Payment  @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  issuedAt           DateTime @db.Timestamptz(3)
  issuedById         String   @db.Uuid
  issuedBy           User     @relation("ReceiptIssuedBy", fields: [issuedById], references: [id], onDelete: Restrict)
  snapshotVersion    String   @db.VarChar(20)
  snapshot           Json
  fingerprint        String   @db.Char(64)
  cancellation        ReceiptCancellation?
}

model ReceiptCancellation {
  id                 String   @id @default(uuid()) @db.Uuid
  receiptId          String   @unique @db.Uuid
  receipt            Receipt  @relation(fields: [receiptId], references: [id], onDelete: Restrict)
  reason             String   @db.VarChar(1000)
  actorId            String   @db.Uuid
  actor              User     @relation("ReceiptCancelledBy", fields: [actorId], references: [id], onDelete: Restrict)
  createdAt          DateTime @default(now()) @db.Timestamptz(3)
}

model PaymentCommand {
  id                 String   @id @default(uuid()) @db.Uuid
  actorId            String   @db.Uuid
  commandKey         String   @db.VarChar(100)
  operation          String   @db.VarChar(40)
  requestFingerprint String   @db.Char(64)
  result             Json
  createdAt          DateTime @default(now()) @db.Timestamptz(3)
  actor              User     @relation("PaymentCommandActor", fields: [actorId], references: [id], onDelete: Restrict)
  @@unique([actorId, commandKey])
}

model PaymentExceptionResolution {
  id                 String                 @id @default(uuid()) @db.Uuid
  paymentId          String                 @unique @db.Uuid
  payment            Payment                @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  outcome            PaymentExceptionOutcome
  reason             String                 @db.VarChar(1000)
  evidence           Json
  amount             Decimal                @db.Decimal(14, 2)
  refundReference    String?                @db.VarChar(120)
  resolvedById       String                 @db.Uuid
  resolvedBy         User                   @relation("PaymentExceptionResolvedBy", fields: [resolvedById], references: [id], onDelete: Restrict)
  resolvedAt         DateTime               @default(now()) @db.Timestamptz(3)
}

model ReceiptMonthCounter {
  month String @id @db.Char(6)
  value Int
}
```

The sketch also needs `User` back-relations named `PaymentRecordedBy`, `PaymentConfirmedBy`, `PaymentReversedBy`, `PaymentExceptionResolvedBy`, `ReceiptIssuedBy`, `ReceiptCancelledBy`, and `PaymentCommandActor`, plus an `Invoice` back-relation named `PaymentExceptionSourceInvoice`. These links are part of the proposed schema. The nullable payment actor links preserve rows whose historical actor is unknown. New managed rows require the corresponding actors in database guards. An exception command verifies that the payment lease matches the source invoice lease and that the source invoice is `VOID`.

The sketch omits back-relations and fields that already exist. Retain existing `Payment.reference` until inventory proves its meaning and the Owner approves a migration. Use it as an internal display/reference value only after its current uniqueness and legacy semantics are confirmed. Do not silently repurpose it as the bank reference. A dedicated `externalReference` can have a partial unique index scoped by receiving account when the Owner defines that scope.

`PaymentAllocation` may retain its current shape. Add a check that `amount > 0`; use a trigger or guarded service transaction to assert that payment and invoice leases match, invoice status is `ISSUED`, and the invoice cap is not exceeded. A composite `(invoiceId, leaseId)` foreign key is a stronger option if PostgreSQL migration complexity and Prisma mapping are accepted. Select one approach during implementation and test direct SQL writes as well as service calls. The additive migration must not convert the existing free-text `method` or reinterpret `reference`. Set `legacyUnmapped = true` for pre-existing rows. New managed payment commands set it false and require `methodCode` and `recordedById`. Keep actor fields nullable for retained legacy rows when no source supports a backfill.

### Database checks, triggers, and indexes

- `Payment.amount > 0`; allocation amount `> 0`; receipt amount values use `DECIMAL(14,2)`.
- Partial unique index on normalized non-empty bank reference plus receiving-account key for active and confirmed transfers. The exact predicate, case normalization, and treatment of reversed duplicates require D3D-08 approval.
- Unique receipt number and unique payment-to-receipt relation. Keep receipt numbers reserved after cancellation.
- Unique `PaymentReversal.paymentId` and `ReceiptCancellation.receiptId` to make these actions one-time.
- Index payments by `(leaseId, receivedAt)` and `(status, receivedAt)`. Index allocations by `invoiceId` and `paymentId`. Index receipts by `(issuedAt, number)` and cancellation state if the list query needs it.
- Database guard rejects changes or deletes to confirmed/reversed payment financial fields, allocations attached to confirmed payments, receipt snapshots, reversal rows, cancellation rows, and command results. Permit only state-transition columns through narrowly checked updates.
- Database guard on `Invoice` void/revision rejects an invoice with a non-reversed confirmed allocation. Pending payments have no allocations and do not block invoice lifecycle actions. This complements service checks and serializes with the Stage 3D invoice lock order.
- Use `ON DELETE RESTRICT` for every financial reference. No financial row is hard-deleted through application APIs.

## 3. State machines

### Payment

```text
PENDING ── confirm + allocate + issue receipt ──> CONFIRMED
   │                                               │
   ├── cancel before confirmation ──> CANCELLED*   └── full reversal ──> REVERSED
   └── post-VOID invoice exception ──> EXCEPTION* ── Owner-approved allocation or refund resolution
```

`CANCELLED`, `EXCEPTION`, and `REFUNDED` are proposed enum additions and require Owner approval. `CANCELLED` represents an unconfirmed entry discarded with actor, timestamp, and reason. `EXCEPTION` tracks money reported received against a VOID invoice, with no active allocation, rent balance effect, or receipt. Create it through an ADMIN-only `POST /api/v1/payment-exceptions` command linked to the VOID source invoice and its lease. Keep exceptions in a separate ADMIN queue. Store one `PaymentExceptionResolution` row. A `REALLOCATED` resolution explicitly allocates funds to an eligible issued invoice, then confirms the payment and issues a receipt. A `REFUNDED` resolution records the full amount, refund reference, evidence, actor, and time, then sets the payment to `REFUNDED`; it creates no receipt and no rent balance effect. Never delete an exception. If the Owner does not approve exception handling, do not accept such payments through Stage 3D; keep that case outside the initial scope. `CONFIRMED`, `REVERSED`, `REFUNDED`, and `CANCELLED` are terminal states. Corrections use reversal followed by a new payment. Partial reversal is out of scope unless approved.

Confirmation is a single transaction: validate pending state and evidence policy; lock affected periods, lease, and invoices; validate same-lease allocations, invoice status, remaining amounts, and duplicate external reference; set confirmer and confirmation time; retain the allocations; allocate a receipt number; write the immutable receipt snapshot; append audit and idempotency result. Any failure rolls back every item in this list. Confirmation rechecks each invoice's state and outstanding amount after acquiring all locks.

### Receipt

```text
ISSUED ── cancel with linked payment reversal + reason ──> CANCELLED
```

The receipt record and snapshot never change. Cancellation is an append-only relation. The read model can report `CANCELLED` when that relation exists. The PDF must keep the original receipt number and visibly state that it was cancelled. Pending payments do not receive receipts.

## 4. Transaction, idempotency, and concurrency

Use PostgreSQL transactions with `READ COMMITTED` and explicit row locks, following the existing Stage 3B and 3C pattern. Match the current invoice command order: all affected billing-period rows sorted by ID, the lease row, all invoice rows sorted by UUID, the payment row if one exists, then the receipt counter. Do not acquire the source gate for ordinary payment posting because it protects source-input writes and period closure, not invoice balance; period and invoice row locks coordinate payment posting with invoice issue, void, and revision. Keep every invoice command and payment command in a single transaction where both domains are affected.

Invoice `voidInvoice` and `reviseInvoice` must use the same period → lease → invoice order. After locking each target invoice, they must re-read active confirmed allocations. They reject while a confirmed unreversed allocation exists. Pending payments have no invoice allocation and do not block void/revision. Confirmation supplies allocations, takes those same locks, re-reads invoice state and balance, and rejects if an earlier void or revision won. If confirmation wins first, void or revision sees the active payment and rejects until reversal. If void or revision wins first, confirmation sees `VOID` and rejects. Apply the post-lock recheck to both direct service calls and database guards. Database guards must not acquire rows in an order that conflicts with the service lock order.

Every mutation takes a client-generated command key, expected entity version where edits can conflict, and strict request fingerprint. A `PaymentCommand` row and its result commit with the financial change. Same actor, key, operation, and body returns the prior result. Same key with a different operation or body returns `IDEMPOTENCY_CONFLICT`. Retry only PostgreSQL serialization/deadlock or unique-key races known to be safe, using the existing bounded retry style.

Concurrent confirmations for the same invoice serialize on the invoice row. The second transaction recomputes outstanding after obtaining the lock and rejects an allocation above the remaining amount. Multi-invoice submissions sort and lock every affected billing period, then every invoice in a stable order to avoid cycles and remain compatible with Stage 3C's period-first locks. Receipt counter allocation uses an atomic upsert or a locked counter row. Unique indexes remain the final guard against duplicate payment references and receipt numbers.

Reversal locks the same lease and invoice set as confirmation, verifies that payment is confirmed and not previously reversed, appends reversal, marks the payment reversed, cancels its receipt, updates derived balances by reversal-aware queries, and appends audit in one transaction. It restores the allocated balance on each invoice. The original receipt snapshot remains available with cancelled status.

## 5. API proposal

All JSON responses follow `{data}` or `{error:{code,message}}`, use `Cache-Control: no-store`, exact-Origin checks on mutations, `requireActor`, bounded request parsing, strict Zod schemas, and service-layer authorization.

| Method and path | Purpose | Proposed access |
|---|---|---|
| `GET /api/v1/payments` | Search by month, tenant, room, status, and method. Return paginated payment rows with allocation summaries. | ADMIN, STAFF |
| `POST /api/v1/payments` | Create a PENDING payment draft with one lease, amount, method, date, external reference, and command key. It has no invoice allocations yet. | ADMIN, STAFF |
| `GET /api/v1/payments/{id}` | Read detail, allocations, evidence metadata, event history, and receipt link. | ADMIN, STAFF |
| `POST /api/v1/payments/{id}/confirm` | Confirm with explicit allocations, expected version, and command key. Lock and recheck every selected invoice before writing allocations. | ADMIN by default; Owner decision |
| `POST /api/v1/payments/{id}/cancel` | Cancel an unconfirmed pending entry with reason. | ADMIN; STAFF may cancel own pending draft if approved |
| `POST /api/v1/payments/{id}/reverse` | Full reversal with reason and command key. Reverses allocations and cancels linked receipt. | ADMIN |
| `POST /api/v1/payment-exceptions` | Record funds received against a specific VOID invoice as an unresolved exception with amount, method, date, reason, evidence, and command key. Available only if D3D-14 is approved. | ADMIN |
| `GET /api/v1/payment-exceptions` | Read unresolved post-VOID funds that have no invoice allocation and no receipt. | ADMIN |
| `POST /api/v1/payments/{id}/resolve-exception` | Explicitly reallocate to an issued invoice or record a full refund with amount, reference, reason, and evidence. Exists only if D3D-14 is approved. | ADMIN |
| `POST /api/v1/payments/{id}/evidence` | Upload bounded evidence against a pending payment. Return private metadata only. | ADMIN, STAFF |
| `GET /api/v1/attachments/{id}` | Stream authorized evidence after checking payment access. Never expose storage paths. | ADMIN, STAFF |
| `GET /api/v1/receipts` | Filter and search receipts by tenant, date, invoice, number, and status. | ADMIN, STAFF |
| `GET /api/v1/receipts/{id}` | Read immutable snapshot and cancellation status. | ADMIN, STAFF |
| `GET /api/v1/receipts/{id}/print` | Render a Thai A4 print view from the frozen snapshot. | ADMIN, STAFF |
| `GET /api/v1/receipts/{id}/pdf` | Optional server-generated PDF download. Add only if D3D-19 approves retained server PDF generation. | ADMIN, STAFF |
| `GET /api/v1/outstanding-balances` | Read invoice-level and tenant-level balances, with as-of date and status filters. | ADMIN, STAFF |

The PDF implementation choice is unresolved technically. The current application includes print CSS and Thai fonts but no server PDF endpoint or upload flow. Preferred first release: render a print-ready A4 route from the immutable snapshot and support browser “Save as PDF”. If the Owner requires a server-generated, byte-preserved PDF, add a server PDF renderer and private attachment retention as a separate estimate and verify the deployed font/rendering stack before choosing a package.

## 6. Authorization matrix

| Action | STAFF | ADMIN | Notes |
|---|---:|---:|---|
| Read balances, payments, receipts, and evidence | Yes | Yes | Never return storage keys or secrets. |
| Create pending payment | Yes | Yes | Same-lease invoice options only. |
| Upload evidence to pending payment | Yes | Yes | Pending state; private store; evidence is not settlement confirmation. |
| Confirm payment and allocate | No by default | Yes | Owner decision D3D-05. |
| Cancel pending payment | Own pending entry, if approved | Yes | No receipt exists. |
| Reverse confirmed payment | No | Yes | Required reason and immutable event. |
| Issue or cancel receipt | No separate command by default | Yes | Receipt issues during confirmation; cancellation during reversal. |
| Change receipt, confirmed payment, or allocation | No | No | Use reversal and a new entry. |
| Allocate to VOID, DRAFT, legacy, or demo invoice | No | No | Block at service and database boundary. |

## 7. Error contract

Return stable codes and Thai messages through the existing `AppError` and `handle` boundary. Expected conflicts include `PAYMENT_STATE`, `PAYMENT_EXCEPTION_UNRESOLVED`, `STALE_VERSION`, `IDEMPOTENCY_CONFLICT`, `DUPLICATE_PAYMENT_REFERENCE`, `INVOICE_NOT_PAYABLE`, `INVOICE_VOID`, `INVOICE_LEGACY_UNMAPPED`, `ALLOCATION_EXCEEDS_BALANCE`, `PAYMENT_NOT_FULLY_ALLOCATED`, `RECEIPT_EXISTS`, `REVERSAL_EXISTS`, `EVIDENCE_INVALID`, and `EVIDENCE_TOO_LARGE`. Use 401 for missing session, 403 for role denial, 404 for missing rows, 409 for state/concurrency/uniqueness conflicts, 413 for upload size, 415 for unsupported media, and 422 for strict schema or financial validation errors.

Do not return stack traces, SQL, storage paths, or evidence bytes in errors. Audit accepted transitions with actor, entity, reason where needed, amount strings, affected IDs, and command key. Do not log full transfer slips, account numbers, or personal tenant details.

## 8. UI and navigation

Use the existing shell and `/payments` navigation item. Replace the demo screen only after persisted routes and migration are verified. Provide:

- Payment list with filters for month, room, tenant, method, state, and receipt state. Clearly label pending entries and exclude them from received totals.
- Entry flow that selects a lease, displays issued invoices and current balances, accepts payment date/method/reference, and creates a pending payment.
- Confirmation view for ADMIN with evidence preview, duplicate warning, explicit allocations, remaining balance per invoice, overpayment rejection, and a final confirmation step. Allocations are first persisted on confirmation, not on a pending payment.
- Cash duplicate warnings block confirmation unless an ADMIN enters a reason to override. Record the reviewer, reason, and candidate payment IDs in the same audit event. Owner approval is required before this override rule is implemented.
- ADMIN exception queue for post-VOID funds, if D3D-14 is approved. Show the unresolved amount and source invoice, state that funds are not settled against rent, omit a receipt, and require explicit reallocation or refund resolution with evidence.
- Payment detail with immutable event history, allocation breakdown, evidence, receipt link, and ADMIN reversal action.
- Outstanding view grouped by tenant and invoice. Show invoice number, period, due date, original total, confirmed paid, reversals, and remaining balance. Include zero-balance invoices in history but not the default outstanding list.
- Receipt detail with snapshot values, cancellation banner, A4 print action, and download/save-as-PDF action.
- At 390px width, use stacked cards instead of forcing allocation controls into a wide table. Keep status text visible without relying on color.

Use decimal strings from the API and shared money formatting. Do not recalculate invoice totals in the browser.

## 9. Verification strategy

Tests are a later implementation gate; none were run for this design task.

- Unit: decimal-string parsing, invoice paid-state derivation, reversal arithmetic, same-lease validation, receipt snapshot fingerprinting, and number formatting.
- PostgreSQL integration: additive migration with representative legacy rows; checks and triggers; same-lease constraints; invoice cap under concurrent confirmation; duplicate command keys; duplicate bank references; duplicate receipt numbering; reversal atomicity; receipt immutability; void/revision blocked by active confirmed allocations; confirmation-versus-void and confirmation-versus-revision races in both lock-winning orders; exception creation and refund or reallocation resolution; failure rollback across payment, allocation, receipt, audit, and command rows; direct database writes cannot bypass the invariant.
- HTTP/API: origin rejection, unauthenticated access, STAFF/ADMIN matrix, schema bounds, duplicate requests, no-store headers, error codes, evidence authorization, and download headers.
- Browser: record cash and transfer; partial payment then full settlement; multiple confirmed payments; multi-invoice allocation if approved; outstanding balances; duplicate transfer warning/block; pending transfer has no receipt; reversal and cancelled receipt history; Thai receipt on mobile and A4 print preview.
- Invariant queries: for each invoice, confirmed allocations net of reversals are between zero and `finalTotal`; each confirmed payment is fully allocated under no-credit policy; each confirmed payment has one receipt; no pending or reversed payment contributes to balances; every voided invoice has zero active confirmed allocation.
- Migration rehearsal: fresh database and representative legacy Payment/PaymentAllocation/Invoice rows. Compare every legacy value, check schema drift, examine lock behavior, and verify that no migration mutates production data.

## 10. Migration and rollback

Use one additive migration after a read-only inventory of existing payment and attachment rows. Preserve enum values, references, IDs, amounts, statuses, timestamps, and foreign keys. Backfill new actor/provenance fields only when existing audit evidence supports the value. Otherwise allow a nullable legacy field or mark the legacy payment as unmapped; never infer who confirmed it, which bank reference it represents, or which invoice it paid.

The migration should add receipt and reversal tables, payment confirmation provenance, command records, checks, indexes, and guards. Avoid rewriting all historical payments. Rehearse index and trigger creation against representative volume even though the apartment has only 15 rooms; audit rows and attachment records can grow over time.

After deployment, rollback is forward-only for financial records. Do not drop tables, truncate records, or reverse a migration that has received live payments. If application rollback is needed, retain the additive schema and run the previous app only if it safely ignores the new fields and tables. Restore from a verified backup only under the existing production restore procedure. Any migration preflight that finds linked or ambiguous legacy payments stops for Owner-approved mapping.

## 11. Dependencies and unresolved risks

1. Owner decisions in the business decision log are not approved.
2. Stage 3C `voidInvoice` and `reviseInvoice` do not test allocations. Stage 3D must update their service guards and database protection as part of integration.
3. Current payment `reference` is globally unique and its legacy meaning must be inventoried before schema changes.
4. The app has an `Attachment` metadata model and backup support for `/attachments`, but no user upload/download flow. Evidence requires private storage, MIME/size controls, safe streaming, and lifecycle decisions.
5. No server-side PDF renderer is present in the inspected branch. The Owner must accept browser-generated PDF or approve a separate PDF renderer effort.
6. Stage 3C handoff operational gates remain open, including intended target verification, historic mapping, migration/recovery rehearsal, operator acceptance, deployment commissioning, F-04/F-05/F-08, and mandatory F-06 inventory.
7. `Invoice.status` intentionally excludes payment state. Consumers must use the new balance read model instead of adding payment state to invoice lifecycle.
