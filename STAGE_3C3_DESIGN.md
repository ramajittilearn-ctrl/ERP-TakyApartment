# Stage 3C-3 design

Date: 2026-10-21. Development only. Production billing remains NO-GO.

## Grounding and completion gates

The authenticated Next route layer owns sessions, exact mutation Origin checks, bounded JSON and no-store responses. Existing services own authorization, Prisma transactions and append-only audit. The Stage 3C-2 billing module collects canonical lease/rate/meter inputs, validates source allocation, and calls the pure exact calculation engine. It currently exposes only a read-only preview transaction. Stage 3A close currently locks and marks a period CLOSED without financial validation; no existing meter-completeness check was found in that close service or database trigger. Stage 3B writers lock physical meters and affected periods to prevent closed-history mutation. Lease and billing identity master records can change later.

The new invoice layer must reuse the canonical collector inside its transaction, persist the approved point-in-time source set, and consume it for all managed invoices. Existing Stage 3C-2 PREVIEW_ONLY contracts and financial arithmetic remain unchanged. A versioned invoice/freeze envelope supplies issuance authority.

Pstack phases are ground, compare sketches, synthesize, implement and verify. Gate 3C-3A completes with these reviewed requirements/design/decisions. Gate 3C-3B requires verified persistence and domain behavior. Gate 3C-3C adds protected APIs and practical UI. Gate 3C-3D records actual tests and commits verified work.

### Throughput checkpoint

- Blocking first steps: baseline/working-tree inspection, owner correction policy and design comparison precede implementation. These are complete.
- Independent workstreams: one domain owner controls schema, source collector, freeze/lifecycle and database tests; API/UI implementation may follow the agreed contracts in disjoint files. The lead owns documentation, isolated test infrastructure, verification, review and Git finalization.
- Shared mutable state: one schema/migration writer, one owner per source file, one database orchestration path and one Git committer. Source writers and close share the explicit database gate described below.
- Smallest safe decomposition: keep the financial code coupled under one owner; delegate UI only after public contracts exist. No independent competing implementations of the calculation engine or lifecycle.

## Architecture comparison and synthesis

Two independent sketches and a read-only cross-judge are retained under ignored `.local`. Candidate A used a period-wide JSON freeze and invoice-local corrections; candidate B used relational frozen-lease and correction rows. The judge scored A 19/25 and B 16/25 across source-cutoff safety, immutable provenance, lifecycle/numbering, correction reservations and maintainability.

Use A's command behavior as the base, with B's restrictive frozen-lease and correction references. Root review agrees. Grafts are relational per-lease freeze rows, explicit immutable correction rows, and persistent invoice provenance. Strengthen A with one global shared/exclusive writer gate and fresh post-gate reads. Reject B's active-invoice-only quantity cap: unprepared and VOID leases must retain their reserved usage. Reject SSI-only freeze coordination, a second invoice ledger, arbitrary financial line editing, live recalculation at issue and separate void/create revision calls.

## Persistence sketch

- `BillingPeriodFreeze`: unique canonical period, schema version, closed actor/time, eligible lease count and aggregate fingerprint. Insert-only.
- `BillingFreezeLease`: unique freeze/lease, restrictive lease/room/tenant references, detached billing labels, canonical 3C-2 source/result and fingerprint. Insert-only. The set retains every billable lease, including leases without an invoice.
- `InvoiceCorrection`: original invoice/frozen lease reference, ADMIN identity/time, reason/evidence, typed replacement sources/result/fingerprint and before/after differences. Insert-only; created and consumed in the atomic revision transaction.
- Existing `Invoice`: nullable managed canonical/freeze/correction references for legacy preservation, nullable public number for drafts, revision/predecessor, optimistic version, authoritative final total, immutable financial envelope, due-policy/override evidence, notes and lifecycle actor/time/reason fields.
- Existing `InvoiceItem`: reference display lines derived from the authoritative engine result. Retain exact fractions and reconciliation in the immutable envelope; never calculate the invoice total by summing rounded items.
- `InvoiceMonthCounter`: global canonical YYYYMM key and high-water value 0..9999, protected against reset/deletion.
- `PropertyDuePolicy`: explicit property configuration, version and audited ADMIN changes. Support a concrete period-end calendar-day offset with no inserted default value; broader policy kinds are unnecessary for this milestone.
- `InvoiceCommand`: unique actor/command key, operation, request fingerprint and committed result reference. Append-only and transactional with the mutation.

Existing legacy invoice/item/payment-reference rows remain untouched, unmapped and read-only. New managed rows require canonical freeze provenance. Keep globally unique invoice numbers. Replace the all-status lease/date index with PostgreSQL partial non-VOID uniqueness, retaining a date-level guard across legacy and managed rows plus canonical lease/period uniqueness. Enforce canonical period/date identity, revision/predecessor uniqueness and legal row shapes. A managed command encountering any unmapped legacy invoice for its lease/month stops with an explicit mapping gate.

Before migration, inventory invoice counts/statuses, duplicate active slots, number/date shapes and linked rows on an identity-verified isolated target. Review SQL and retain evidence. One-time counter high-water initialization may inspect existing reserved numbers; live issuance always increments a locked counter and never derives a next number with MAX(number)+1. Counter exhaustion rejects issuance. No production migration or automatic legacy mapping is authorized.

## Freeze cutoff and lock order

Use one global transaction advisory gate for this 15-room ERP. Every relevant source-writing application transaction acquires the gate shared before entity locks. Validated close acquires it exclusive before source reads or entity locks. Cover lease membership/rent/dates/status and assignment, tenant billing labels, property/floor/room identity, rates, physical meters, readings/corrections/replacements, billing approvals and period creation. Add BEFORE STATEMENT shared-gate triggers as direct-DML defense; row-level fallback acquisition can invert row/gate order.

Close uses READ COMMITTED and reads only after acquiring the exclusive gate, so a wait does not retain an earlier SERIALIZABLE snapshot. Then lock the canonical period, collect the complete eligible lease set with the transaction-scoped Stage 3C-2 resolver, and require every billable result to be complete. Persist immutable freeze/header/children, close the period and append audit atomically. Any failure leaves it OPEN. No eligible leases means an explicit empty, non-billable frozen set; no invoice candidate is invented. A previously CLOSED period without a freeze remains historical/unissuable, and an already frozen close retry is deterministic.

Other invoice commands use a documented stable order: source gate where required, period, lease, invoice and monthly counter. Bounded retries handle serialization/deadlock conflicts; validation and genuine lifecycle conflicts are not retried. PostgreSQL uniqueness is the final concurrency guard.

## Caller and service sketch

Commands parse unknown input with Zod; types derive from those schemas. Actor identity comes from the authenticated server session and is checked in services. The existing `closeBillingPeriod(actor, id)` remains the public entry, delegating to validated freeze closure. State-based close retries preserve its existing signature and single-audit behavior.

```text
configureDuePolicy(actor, { propertyId, offsetDays, expectedVersion, commandKey })
prepareDraft(actor, { billingPeriodId, leaseId, commandKey })
refreshDraft(actor, { invoiceId, expectedVersion, commandKey })
updateDraft(actor, { invoiceId, expectedVersion, notes?, dueOverride?, commandKey })
issueInvoice(actor, { invoiceId, expectedVersion, commandKey })
voidInvoice(actor, { invoiceId, expectedVersion, reason, commandKey })
reviseInvoice(actor, { invoiceId, expectedVersion, correction, reason, evidence, commandKey })
listInvoices(actor, { billingPeriodId?, roomId?, leaseId?, status? })
getInvoice(actor, id)
getInvoiceHistory(actor, id)
```

The public read DTO/schema is shared with API/UI consumers rather than redeclared by each layer. All financial values cross the boundary as decimal strings. UI formatting must not recalculate amounts with floating-point arithmetic.

## Draft, due-date and lifecycle behavior

Drafts come only from a closed, frozen eligible lease. They have no public invoice number. STAFF may change notes and explicitly refresh a draft against its immutable frozen source and current explicit due-policy configuration; STAFF cannot replace financial sources or override a due date. Missing configuration is visible on the draft and blocks issue. ADMIN can configure a period-end offset or enter an individual due-date override with reason. Preserve the resolved policy version/anchor or override actor/reason in the issued document. No due value changes silently during issue.

Issue verifies the persisted freeze and snapshot fingerprint, recalculates the frozen explicit input with the same pure engine, checks exact result agreement, positive contractual rent, due provenance and expected draft version, then atomically allocates the number, materializes derived display lines, records the immutable snapshot, changes status and appends audit/command result.

ISSUED may transition only to VOID with required ADMIN/reason metadata. Financial values, number, due date, source, items and issued identity remain immutable. VOID and legacy rows reject updates/deletes. A revision validates and approves replacement inputs, voids the old invoice, creates/issues the linked child with a new number, and records immutable correction/audit/idempotency evidence in one transaction. A unique predecessor prevents branches. Failure preserves the original active invoice. Retrying a committed key returns the same result; reusing a key for a different operation/body conflicts.

## Invoice-specific correction boundary

Keep lease/property/period identity fixed. Use a bounded correction schema rather than caller-supplied totals or arbitrary engine JSON. Preserve unchanged frozen sources. Contract changes must be backed by the current canonical Lease.rent/dates and explicit ADMIN evidence; do not invent an independent rent schedule. Rate changes must reference existing eligible immutable rates. Quantity changes retain verified same-meter sources, supported physical replacement segments or identifiable estimates with invoice-local approval provenance.

Recalculate with Stage 3C-2, preserve both original and new snapshots and a structured diff, and never mutate closed approvals/readings. The strict correction contract rejects caller-supplied actual-reading replacement fields with validation errors. It retains the original estimate classification. Later actual-versus-estimate reconciliation requires a future period and remains outside this endpoint.

For room quantities, start with every frozen lease's reserved sources and overlay that lease's latest committed correction regardless of invoice status. Compare the entire compatible physical source set under the period lock. Unprepared and VOID invoices retain reservations; a standalone void never frees usage. Recheck occupancy/source compatibility and exact aggregate caps. Do not implement a new charge or future-period reconciliation valuation.

## API, UI and verification sketch

Versioned invoice list/detail/history/drafts/refresh/issue/void/revise endpoints and due-policy configuration use existing Origin/session/JSON/no-store helpers. PATCH supports authorized draft metadata/override, never issued values. Reuse the existing period-close endpoint. Return explicit validation, stale version, missing freeze/configuration, lifecycle and idempotency conflicts.

Replace the `/billing` demo with a live invoice screen using existing design components, role-aware server identity, frozen details, period/room/lease/status filters, configuration and validation states, confirmation dialogs and required correction evidence/reasons. Show source classifications, due dates, raw/reference reconciliation and revision links. Prevent repeated submission, retain command keys for safe retries and guard stale asynchronous responses.

Verification must cover migration/legacy retention, direct SQL guards, source-writer/close races including wait-before-read, empty closure, closed-unfrozen rejection, number/active-slot/revision races, exhaustion, all-reservation correction caps, audit rollback, exact engine parity, HTTP roles/origin/validation, idempotency and focused desktop/mobile Thai UI. Preserve historical Stage 3B 14/15 and record actual failures/limitations. No production data, reset, volume deletion or remote push.
