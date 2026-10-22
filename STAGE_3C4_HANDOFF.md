# Stage 3C-4 handoff

Date: 2026-10-21. Stage 3C-3 is DEVELOPMENT COMPLETE after its local closure commit. Production billing remains NO-GO.

## Available foundation

Stage 3C-3 provides canonical validated close/freeze, exact Stage 3C-2 calculation snapshots, STAFF drafts, explicit due policy, ADMIN issue/void/atomic revisions, retained source evidence, monthly numbering, database uniqueness, idempotency, audit and a live invoice UI. See the Stage 3C-3 design, implementation and test reports for exact contracts and verified limits. Domain commit is `0271ea05371a7781a89041731047bb5816e62934`; API/UI commit is `3d6cc8c07aa2a1de6344fbda0d7db4e423317a92`. Resolve the final closure commit with `git log -1 --format=%H -- STAGE_3C4_HANDOFF.md`.

Verified development baseline: 120 unit tests, 71 related PostgreSQL cases, 46 HTTP/API checks, nine focused browser groups, all 13 migrations, zero drift, static checks and the documented production Docker image. No push occurred. Synthetic verification containers and data are retained without reset or volume deletion.

## Retained boundaries

Closed source inputs and historical invoice content remain immutable. Existing CLOSED periods without a validated freeze and unmapped legacy invoices are read-only. Legacy invoices on any date in the canonical month block managed preparation for that lease/month. No automatic retroactive mapping or reopening is available.

Numbers use canonical billing YYYYMM, are global across properties, remain reserved through voids and stop at 9999. Reference item amounts do not define the financial total. Read the authoritative final total and preserved exact raw snapshot.

Invoice-local corrections require ADMIN approval, reason and evidence and use the same calculation engine. Actual room caps retain reservations from unprepared and VOID leases. Later actual-versus-estimate reconciliation requires an approved future-period allocation and valuation contract. Do not implement it by replacing closed estimates with current readings.

Payments, receipts, deposits, VAT/tax, optional charges, ledger posting, bank reconciliation, delivery and public deployment are not implemented or authorized here. Obtain the next milestone's scope before adding them.

## Operational gates before actual billing

1. Identify and independently verify the intended operational database and deployed schema.
2. Inventory legacy invoices, date/number shapes, linked payment records and physical meters. Approve explicit mapping without inventing historical sources.
3. Rehearse migrations and recovery with a tested backup/restore process. Review table locks and counter high-water values.
4. Configure the owner's due-date values explicitly and validate operator procedures for close, issue, void and revision.
5. Complete operator acceptance and deployment/backup commissioning.
6. Resolve or explicitly accept carried-forward F-04 stale meter overview/form behavior, F-05 history timestamps and F-08 broader browser/UAT coverage. F-06 target-data verification remains mandatory. The historical full Stage 3B browser result is 14/15.

Stage 3C-3 focused synthetic tests cannot clear these operational gates. Do not issue real invoices until they are independently verified.
