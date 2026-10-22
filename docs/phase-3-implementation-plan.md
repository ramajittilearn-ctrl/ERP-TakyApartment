# Phase 3 implementation plan

Status: Stage 3A approved for implementation. Stages 3B through 3F require a later owner review.

## Current architecture and reuse

The application uses Next.js 16.4 App Router, React 19, TypeScript, Prisma 7, and PostgreSQL 17. Route Handlers authenticate requests and parse input. Services own authorization, serializable transactions, row locks, and audit writes. Repositories own read queries. The browser receives decimal strings.

Phase 2 already created the main finance tables: `UtilityRate`, `UtilityMeter`, `MeterReading`, `Invoice`, `InvoiceItem`, `Payment`, `PaymentAllocation`, and `SecurityDeposit`. Existing migrations enforce positive amounts, unique meter readings, unique invoice periods, unique payment references, restrictive foreign keys, and append-only audit rows. Phase 3 extends these models. It does not replace them.

Reusable code includes the authentication helpers in `src/server/http.ts`, the `Actor` and transaction pattern in `src/server/services.ts`, the private Prisma client in `src/server/db.ts`, and the Thai-first UI components. Demo finance code remains test inspiration only. Production calculations must not use JavaScript `number` or `Math.round`.

## Functional scope

### Stage 3A: financial foundation

- Add canonical monthly billing periods and an open or closed lifecycle.
- Keep utility rates as append-only effective-date change points for each property and meter kind.
- Add exact decimal utilities for money rounding, rent proration, and utility charges.
- Add finance-specific ADMIN and STAFF permissions, audited writes, API routes, constraints, and indexes.
- Keep the existing financial screens in demo mode.

### Stage 3B: meter readings

- Add room and floor filtering, previous and current readings, consumption, correction history, and meter replacement.
- Reject duplicate periods, decreasing readings without an approved replacement, and invalid chronology.

### Stage 3C: billing and invoices

- Generate draft invoices from leases, readings, rates, and approved charges.
- Store calculation inputs and rate snapshots, issue immutable invoices, and support void or adjustment records.
- Generate bilingual Thai-English PDFs with an installed Thai font and configurable legal fields.

### Stage 3D: payments and receipts

- Record cash or bank-transfer payments as pending, confirm them explicitly, allocate them, and generate receipts.
- Add idempotency, locking, reversal records, private slip storage, and over-allocation protection.

### Stage 3E: deposits

- Replace the rudimentary deposit record with an audited liability ledger for receipts, additions, deductions, and refunds.
- Prevent negative balances under concurrent writes and attach evidence to deductions.

### Stage 3F: final verification

- Run static, unit, integration, browser, production-build, migration, backup, restore, PDF, RBAC, and reconciliation checks in isolated environments.

## Business rules

- Money uses exact decimal arithmetic. Final monetary values use two decimal places and `ROUND_HALF_UP`.
- Rent proration divides monthly rent by all calendar days in the billing period. Occupied days are the inclusive intersection of the lease dates and period dates.
- A full-period lease receives the full monthly rent. No-overlap returns no charge. Billing code must not extend a lease date.
- A billing period is one full Gregorian calendar month for one property. The database prevents duplicate months.
- A utility rate applies from `effectiveFrom` until the next rate starts. Lookup chooses the latest rate whose date is not after the charge date. The database prevents duplicate change points.
- Issued financial documents keep their stored values. Later configuration changes do not rewrite them.
- Payments require explicit confirmation. Uploading a slip does not confirm settlement.
- Deposits remain liabilities and do not enter rental revenue.

## Stage 3A database changes

- Add `BillingPeriodStatus` with `OPEN` and `CLOSED`.
- Add `BillingPeriod` with property, month boundaries, lifecycle timestamps, actors, indexes, and restrictive foreign keys.
- Add nullable legacy provenance to `UtilityRate`. New service writes always record the actor.
- Add PostgreSQL checks for canonical month boundaries and valid open or closed field combinations.
- Keep `(propertyId, kind, effectiveFrom)` as the utility-rate identity. Do not add `effectiveTo` or an extension-backed exclusion constraint.
- Keep all existing migrations. Add one additive migration and test it over representative existing rate rows.

Later stages may add invoice, meter, payment, attachment, and deposit constraints. Stage 3A must not guess those workflows.

## Stage 3A API design

The finance API uses dedicated services because generic CRUD permits update and delete operations that do not fit append-only rates or closed periods.

| Route | Roles | Purpose |
| --- | --- | --- |
| `GET /api/v1/billing-periods/` | ADMIN, STAFF | List canonical periods. |
| `POST /api/v1/billing-periods/` | ADMIN, STAFF | Create one monthly period. |
| `POST /api/v1/billing-periods/{id}/close/` | ADMIN | Close an open period. A repeated close returns the same closed record. |
| `GET /api/v1/utility-rates/` | ADMIN, STAFF | List rate history and resolve an effective rate. |
| `POST /api/v1/utility-rates/` | ADMIN | Append a rate change point. |

Every mutation uses the existing origin, session, JSON-size, validation, no-store response, and error helpers. The service repeats authorization and writes the audit row in the same serializable transaction.

## UI routes and components

Stage 3A adds no production finance screen. Existing Billing and Payment routes remain clearly marked demonstrations. Later stages will add Meter Reading, Billing Periods, Invoice List, Invoice Detail, Payment Entry, Receipt Detail, Deposit Ledger, and Outstanding Balance pages with the current shell and responsive design system.

## Testing strategy

Pure unit tests cover canonical decimal parsing, half-up boundaries, full-month rent, inclusive partial occupancy, 28-, 29-, 30-, and 31-day months, year boundaries, no overlap, and exact utility multiplication.

PostgreSQL integration tests use only the isolated `taky_phase2_test` database. They cover migration presence, database checks, duplicate periods and rates, concurrent creation, authorization, effective-rate lookup, lifecycle transitions, and audit atomicity. A migration rehearsal inserts legacy utility-rate history before `migrate deploy` and compares effective-date lookup results before and after the migration.

Repository checks include Prisma validation and generation, TypeScript, ESLint, Prettier, unit tests, isolated integration tests, migration status, schema drift, a Docker production build, route security checks, and a focused backup and restore check when the isolated environment is available.

## Dependencies and risks

- Prisma's bundled Decimal implementation supplies exact arithmetic and `ROUND_HALF_UP`. No new runtime package is planned.
- PostgreSQL `DATE` and UTC component arithmetic avoid local timezone shifts.
- Legacy utility rates might lack a creator. The migration keeps their actor nullable instead of inventing provenance.
- The owner has not decided which date selects the rate during invoice generation. Stage 3A supports deterministic lookup for any supplied date. Stage 3C must select the policy.
- The owner has not decided whether a rate may start inside a billing month or whether a closed period may ever reopen. Stage 3A does not split consumption or expose reopen.
- A seeded room may have zero rent. Stage 3C must refuse silent zero-rent billing or require explicit approval.
- Phase 2.5 commissioning remains incomplete. Live finance stays disabled until the owner proves off-device encrypted backup recovery, key escrow, intended-device HTTPS, normal admin setup, host reliability, and a controlled recovery drill.

## Stage acceptance criteria

### Stage 3A

- The additive migration deploys on a fresh isolated database and one with representative legacy rates.
- PostgreSQL rejects noncanonical and duplicate periods, invalid lifecycle fields, negative rates, and duplicate rate change points.
- Exact calculation tests prove inclusive proration and `ROUND_HALF_UP` without JavaScript floating-point arithmetic.
- ADMIN and STAFF permissions match the route table. Every accepted mutation has one audit row in the same transaction.
- Prisma validation, TypeScript, ESLint, formatting, unit tests, integration tests, migration status, schema drift, and the Docker production build pass.
- The implementation report records actual commands and results. Development completion and production readiness are separate decisions.

### Stage 3B

- Reading chronology, uniqueness, consumption, correction audit, replacement history, and UI/API results pass focused tests.

### Stage 3C

- Proration, leap-year dates, rounding, rate snapshots, duplicate prevention, immutable issue state, numbering, and bilingual PDFs pass focused tests.

### Stage 3D

- Idempotency, double submission, concurrent allocation, overpayment rejection, slip authorization, reversal history, and receipt integrity pass focused tests.

### Stage 3E

- The ledger prevents negative balances under concurrent deductions or refunds and reconciles deposits separately from revenue.

### Stage 3F

- All requested automated checks pass in isolated environments. The owner completes the remaining physical-device, backup-custody, and production recovery checks before production GO.

## Pstack execution record

The feature workflow used `how` for schema and service discovery, then compared two architecture candidates. The selected design keeps change-point rates and canonical monthly periods. It avoids synchronized end-date updates and the `btree_gist` extension. The implementation follows small verified units: calculations, migration and services, routes and integration tests, then repository-wide verification and documentation.
