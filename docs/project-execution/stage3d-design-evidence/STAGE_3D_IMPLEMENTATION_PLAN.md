# Stage 3D implementation plan

**Status:** Proposed milestones. Start only after the Owner approves the blocking business decisions in [STAGE_3D_BUSINESS_RULE_DECISIONS.md](STAGE_3D_BUSINESS_RULE_DECISIONS.md). Effort is an engineering estimate, not a schedule commitment.

## Sequencing checkpoint

- **Blocking first steps:** Obtain Owner decisions. Inventory the intended database read-only. Confirm legacy payment and invoice links, attachment storage, and Stage 3C void/revision behavior. Do not start migration design against assumed records.
- **Independent workstreams:** After the schema contract is approved, the domain/migration implementation and receipt layout prototype can proceed independently. API and UI work depend on the committed domain contract. Invoice lifecycle integration shares payment state and must be serialized with payment-domain changes.
- **Shared mutable state:** Payment confirmation, reversal, receipt numbering, invoice void, and invoice revision all share invoices and balances. Use one domain owner and a single documented lock order. Do not split those writes across branches without a named integration owner.
- **Smallest safe decomposition:** Four milestones keep the financial transaction model intact: payment storage and guards; payment recording and balance reads; receipt issuance and print/PDF; integration and regression closure. Estimate assumes one engineer familiar with Prisma/PostgreSQL plus focused review and QA support.

## Milestones

| Milestone | Scope and acceptance criteria | Dependencies | Estimate | Main risks |
|---|---|---|---:|---|
| **3D-1: Payment domain and database** | Owner-approved schema contract; additive migration preserves all representative legacy rows; typed method and actor provenance; PaymentCommand idempotency; reversal/cancellation records; positive amount and restrictive-FK checks; duplicate-reference index policy; transaction service for draft, confirmation, and reversal; service/database guards prevent allocation to non-ISSUED invoices; Stage 3C void and revise block active allocations using the shared lock order; rollback rehearsal leaves financial schema/data intact. | Owner decisions D3D-01 through D3D-18 as applicable; read-only legacy inventory; agreed treatment of legacy `Payment.reference`; Stage 3C base. | 4–6 engineer-days | Existing required globally unique reference may not map to bank reference; database trigger and Prisma shape drift; migration lock/recovery risk. |
| **3D-2: Payment entry and balances** | ADMIN/STAFF endpoints match approved matrix; pending entries remain outside balances; full/partial/multiple payments work under policy; allocation cap holds under concurrent submissions; duplicate submissions return prior result; transfer duplicate policy works; tenant balances group on frozen tenant identity; historical ledger includes confirmations and reversals; `/payments` uses persisted APIs and removes demo-data claims from operational views. | 3D-1; accepted confirmation and allocation rules; evidence upload decision if evidence is in this milestone. | 4–6 engineer-days | Concurrent invoice void/revise race; ambiguous legacy payment mappings; stale UI balances. |
| **3D-3: Receipts and PDF** | Receipt number is unique and reserved through cancellation; confirmation creates exactly one immutable snapshot and receipt; Thai A4 print/download uses frozen labels and allocation values; receipt cancellation follows the approved reversal policy; PDF/print regression covers Thai glyphs, page breaks, and browser output. | 3D-1 and 3D-2; approved receipt timing, numbering, legal text, language and PDF strategy. | 3–5 engineer-days for print-to-PDF; 5–8 if server PDF generation and retained binary are required | Font/rendering differences; legal receipt content unknown; browser-generated PDF cannot guarantee byte-identical reprints. |
| **3D-4: Integration and regression closure** | Full role matrix and transaction failures pass; repeated and concurrent confirmations cannot over-allocate; both confirmation/void and confirmation/revision race orders pass; reversal restores balances and cancels receipt atomically; all invoice void/revise paths honor active allocations; exception handling matches the approved policy; audit and immutable snapshot checks pass; responsive UI and A4 output verified; fresh and legacy migration rehearsals pass; operational runbook and readiness gates updated; Owner UAT sign-off recorded separately from development completion. | 3D-1 through 3D-3; test database; reviewer availability; deployment/restore owner. | 3–5 engineer-days | Stage 3C operational blockers can prevent real-money release even after development tests pass. |

**Total estimate:** 14–22 engineer-days for print-to-PDF. Add 2–3 engineer-days if a new server-side PDF engine is approved, excluding production commissioning, real legacy mapping, and Owner UAT time.

## Release gates by milestone

1. Do not apply a schema migration to a live or shared database during design or development verification.
2. Use a fresh isolated PostgreSQL database for migration and concurrency checks. Verify database name and role before every database command.
3. Preserve existing migration files. Fix applied migrations only through a new additive migration.
4. Do not report development completion from unit tests alone. Require database, API, browser, migration, authorization, and financial invariant evidence.
5. Keep Stage 3D development complete separate from production financial readiness. The readiness report's target-data, backup/recovery, deployment, and UAT gates remain mandatory.

## Definition of done

Stage 3D is development-complete only when all milestone criteria pass on the actual persisted application, the independent review has no unresolved critical financial or security finding, the report records the real verification results, and the Owner accepts the workflow. It is implementation-ready only after the pre-implementation business decisions and Stage 3C integration contract are approved. It is not production-ready until every operational gate is cleared.
