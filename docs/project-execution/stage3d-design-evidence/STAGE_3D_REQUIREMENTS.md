# Stage 3D requirements: payments, balances, and receipts

**Status:** Draft for Owner approval. Design only. No Stage 3D implementation is authorized by this document.

## Purpose and scope

Stage 3D will record received cash and bank-transfer payments against issued Stage 3C invoices, calculate outstanding balances from confirmed allocations, retain a payment history, and issue Thai receipts. It will replace the demo behavior on `/payments` with authenticated persisted behavior only after the Owner approves the business decisions in [STAGE_3D_BUSINESS_RULE_DECISIONS.md](STAGE_3D_BUSINESS_RULE_DECISIONS.md).

The design uses the Stage 3C invoice's `finalTotal` as the amount due. It does not change the billing calculation engine, invoice snapshot, invoice total, or issued invoice content. It does not add tax, service charges, accounting ledger posting, bank feed integration, tenant self-service, or deposit accounting.

## Evidence labels

- **Approved requirement** means a binding rule already accepted in Stage 3A, 3B, or 3C, or a direct Stage 3D scope requirement in the Owner's brief.
- **Recommended assumption** means a proposed default that needs Owner approval before implementation.
- **Open Owner decision** means the implementation must not choose a final business rule without approval.
- **Existing dependency** means the current code or operational state must be extended or verified before live use.

## Functional requirements

### Payment recording

| ID | Requirement | Status |
|---|---|---|
| PAY-01 | Record a payment with an amount, method, business payment date, internal identifier, creator, and audit timestamps. | Approved requirement |
| PAY-02 | Support cash and bank transfer as the proposed initial methods. | Open Owner decision on accepted methods |
| PAY-03 | Record payments manually. A receipt image or transfer slip is evidence only and never confirms settlement by itself. | Approved by prior Stage 3 plan; retain as a requirement pending confirmation of final workflow |
| PAY-04 | Keep payment evidence private, checksum-verified, linked to a payment, and available only to authorized users. | Approved requirement; file types and size limits need approval |
| PAY-05 | Make repeated submission of the same command idempotent. Reject a reused command key with a different request body. | Approved requirement; matches Stage 3C command behavior |
| PAY-06 | Detect duplicate bank references within the approved uniqueness scope. For cash, warn on likely duplicates and rely on command idempotency because cash has no external transaction identifier. | Recommended assumption |

### Allocation and balances

| ID | Requirement | Status |
|---|---|---|
| PAY-07 | Support a full payment, partial payment, and multiple payment events against one issued invoice if the Owner allows partial payments. | Open Owner decision |
| PAY-08 | Allocate one payment to one or more invoices belonging to the same lease. Do not allocate across tenants or leases in the initial scope. | Recommended assumption |
| PAY-09 | Enforce that confirmed allocations never exceed an invoice's `finalTotal`. | Approved financial-integrity requirement |
| PAY-10 | Derive invoice balance as `finalTotal - active confirmed allocations`, where a reversed payment's allocations are excluded. Do not store a separately editable balance or mutate `Invoice.status`. | Recommended assumption consistent with invoice immutability |
| PAY-11 | Show unpaid, partially paid, fully paid, and void states from invoice and allocation records. Show tenant totals using the tenant identity frozen with each managed invoice. | Approved requirement |
| PAY-12 | Preserve payment and allocation history, including original allocations after reversal. | Approved requirement |
| PAY-13 | Reject overpayment by default. Do not create an unallocated credit unless the Owner approves a separate credit liability model. | Recommended assumption; Stage 3 plan currently names overpayment rejection |
| PAY-14 | Do not mix lease deposits with invoice payments. Keep deposits outside rental balances and receipts in this stage. | Recommended assumption grounded in current separation |
| PAY-15 | Record funds associated with a VOID invoice as unresolved exceptions only if the Owner approves the exception workflow. Exceptions do not reduce rent balance or produce a receipt until explicitly resolved. | Open Owner decision |
| PAY-16 | Pending payment entries have no invoice allocation and do not affect balance or block invoice void/revision. Confirmation supplies allocations and rechecks invoice state and balance under the shared invoice lock order. | Recommended technical rule |

### Receipts and corrections

| ID | Requirement | Status |
|---|---|---|
| REC-01 | Issue a receipt only after a payment is confirmed and fully allocated under the approved allocation policy. | Recommended assumption |
| REC-02 | Create one receipt per confirmed payment. A payment allocated across invoices produces one receipt listing each allocation. | Recommended assumption |
| REC-03 | Give each receipt a unique number and retain the number after cancellation. | Approved requirement |
| REC-04 | Freeze receipt content, source payment, allocations, tenant, room, invoice number, issue timestamp, and actor in an immutable snapshot. | Approved requirement |
| REC-05 | Render a Thai-language A4 receipt for print and PDF download from that snapshot. | Approved requirement |
| REC-06 | Do not edit or delete a confirmed payment or issued receipt. Correct an error through a reasoned reversal and, when needed, a new payment. | Approved requirement |
| REC-07 | Cancel a receipt only through a recorded cancellation action linked to its payment reversal. Keep the original receipt readable and visibly cancelled. | Recommended assumption |

## Actors and access

ADMIN and STAFF are authenticated system roles. The detailed proposed matrix is in the technical design. The most important unresolved permission is whether STAFF can confirm a payment. The proposed safer default is that STAFF may create a pending payment and attach evidence, while ADMIN confirms it and issues its receipt. The Owner may approve a different split.

## Nonfunctional and integrity requirements

- Use `DECIMAL(14,2)` for baht amounts. Parse and return decimal strings. Do not use JavaScript floating-point arithmetic for money.
- Write payment state, allocations, receipt snapshot/number, audit row, and idempotency result in one database transaction where the action requires them together.
- Lock all affected invoice rows in deterministic UUID order before checking or changing allocations. Keep the existing Stage 3C period, lease, and invoice lock relationship consistent.
- Use foreign keys with restrictive deletion for payments, allocations, reversals, receipts, actors, and evidence metadata.
- Require reason, actor, and timestamp for confirmation, reversal, and receipt cancellation.
- Treat pending payments as not settled and exclude them from balances and receipts.
- Preserve all legacy payment rows and unmapped invoice relationships. Never infer a payment-to-invoice allocation from amount, date, or current tenant data.
- Keep all reads and responses scoped to persisted managed invoices. Do not present demo fixtures as accounting records.

## Exclusions

Stage 3D does not implement deposit receipts or refunds, tenant portals, automatic bank verification, bank reconciliation, general-ledger posting, tax/VAT, late fees, payment reminders, payment plans, currency conversion, or live historical-data mapping. Each requires separate approved scope and business rules.

## Implementation acceptance gate

Implementation may start after the Owner approves the decisions marked open and Stage 3C payment/void dependencies have an accepted design. Live processing remains blocked until the readiness gates in [STAGE_3D_READINESS_REPORT.md](STAGE_3D_READINESS_REPORT.md) are independently cleared.
