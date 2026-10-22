# Stage 3C-3 requirements

Date: 2026-10-21. Authorized for development only. Production billing remains NO-GO.

## Baseline and authority

The branch is `codex/stage-3c-billing-invoice`; the verified Stage 3C-2 baseline is `4fde51836999b271d7470c465a762fa5e9aa78b7`. Its existing calculation, rate selection, estimate, physical-meter allocation and closed-period protections remain binding. The Stage 3C-3 owner brief authorizes invoice lifecycle development, protected APIs, practical UI and isolated verification. Payments, receipts, deposits, tax, optional charges, email, public deployment and production data changes remain excluded.

Unrelated changes to `next-env.d.ts`, `src/app/globals.css` and `src/features/auth/login.tsx` must be preserved and excluded from milestone commits and build verification contexts.

## Required workflow

1. ADMIN validates all eligible lease inputs and closes the canonical period with a persisted immutable source freeze.
2. STAFF or ADMIN prepares and manages drafts from that freeze.
3. ADMIN issues a validated draft with a unique number and immutable financial content.
4. ADMIN may void an issued invoice with a reason, preserving all history.
5. ADMIN may atomically approve a correction, void the original and issue a linked replacement with a new number.

A CLOSED status without a verified freeze does not authorize drafts or issuance. Historical closed periods must not be reopened or automatically frozen retrospectively. An empty eligible lease set may close as a non-billable meter period for Stage 3A/3B compatibility; no invoice can be created for an absent frozen lease.

## Financial and source integrity

- Use `calculateBillingPreview` and the canonical Stage 3C-2 resolver; no second financial engine.
- Use contractual Lease.rent and inclusive occupancy, independent approved utility rates, estimates and explicit physical-meter/per-lease allocations.
- Preserve exact raw rational amounts. Aggregate raw charges and round the final total once, HALF_UP to two decimals. Display-line sums remain reference values with visible reconciliation.
- Zero contractual rent, incomplete sources, invalid scope and duplicate consumption block issuance.
- Freeze contractual values, party/room labels required for historical display, canonical sources, approvals, raw results, rounding and fingerprints.
- Existing issued or VOID financial content and items must not be edited or deleted, including through direct database mutations.
- New draft/revision records must not conflict with unmapped historical invoices. Preserve every legacy row and payment reference; do not invent canonical mappings, totals or snapshots.

## Owner-approved invoice corrections

Owner follow-up approved a separate invoice-specific ADMIN replacement snapshot with required reason and evidence, recalculated by the existing engine from validated rent, rates and utility sources. It preserves the original freeze and closed-period records. Approval is explicit; changes in live master data never silently replace frozen values.

Keep the lease/property/period identity fixed. Validate physical source references and all shared-usage reservations, including leases without a prepared invoice. A void does not release room usage for double allocation. Record the original and replacement evidence and differences.

Later actual-versus-estimate reconciliation remains a future-period process. The revision endpoint must reject attempts to turn that reconciliation into a retroactive estimate replacement.

## Due dates and numbers

A property default due-date policy must be explicitly configured by ADMIN. Do not insert a payment term or calendar day by default. Show missing configuration and provide an explicit configuration/validation path. ADMIN alone may override an individual due date with provenance. Preserve the resolved date and policy/override evidence on issuance.

Invoice numbers use `INV-YYYYMM-0001`. YYYYMM means the canonical billing month, independent of the issue date, and the monthly sequence is global across properties. A locked transactional counter and unique number constraint must prevent duplication or reuse. At 9999, reject issuance explicitly rather than wrap or silently change the approved format. Voids retain numbers. Drafts do not need a public invoice number.

## Authorization and transactions

| Operation | STAFF | ADMIN |
|---|---|---|
| List/detail/history/preview | Allowed | Allowed |
| Prepare, refresh and edit draft metadata | Allowed | Allowed |
| Configure due policy or override a due date | Denied | Allowed |
| Validate/close period | Denied | Allowed |
| Issue, void, approve/issue revision | Denied | Allowed |

Services enforce authorization using server actors. Mutations require exact Origin checks, bounded parsed requests, state/version validation and transactional append-only audit. Idempotency keys and database uniqueness must make repeated/concurrent requests safe. Audit failure must roll back the financial mutation, number allocation and command result together.

Enforce at most one non-VOID invoice per lease and canonical period in PostgreSQL. Revisions preserve history and cannot branch. Invoice commands must not mutate closed source approvals or readings.

## UI and verification

Extend existing ERP cards, tables, typography and responsive navigation. Provide period/room/lease/status filters, draft detail, explicit due dates, source classification, exact total/reconciliation, role-appropriate controls, confirmations and reason/evidence entry, submission guards, conflict/error messages and revision history. Financial input/output remains decimal strings.

Verify unit behavior, isolated PostgreSQL migrations/constraints/races/rollback, HTTP roles/origin/validation, focused responsive browser interactions, schema status/drift, typecheck/lint/format and the production Docker build. Record every actual failure, skip and limitation. Historical Stage 3B full browser remains 14/15.

## Completion and continuing gates

Development closure requires verified lifecycle, numbering, uniqueness, immutable history, engine parity, RBAC/audit, reports and local milestone commits. No remote push is authorized. F-06 operational target/data mapping, operator acceptance, backup commissioning and deployment gates remain mandatory before actual billing. Stage 3C-4 handles broader UAT and release closure.
