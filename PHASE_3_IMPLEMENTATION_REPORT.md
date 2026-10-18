# Phase 3 implementation report

## Stage 3A implementation facts

- Added exact decimal rent-proration and utility-charge calculations with inclusive date spans, fixed decimal-string outputs, pre-database scale validation, and one final `ROUND_HALF_UP`.
- Added canonical monthly `BillingPeriod` storage with OPEN-to-CLOSED lifecycle, actor provenance, uniqueness, PostgreSQL shape checks, identity protection, and deterministic idempotent close behavior.
- Kept property-wide `UtilityRate` history as append-only change points and added nullable creator provenance plus database immutability enforcement.
- Added finance-owned service/repository/validation modules. Mutations use Serializable transactions, row locks, database uniqueness, service RBAC, and atomic audit writes.
- Added thin authenticated Next.js route handlers for period list/create/close and utility-rate list/create, using the existing HTTP helpers.
- Added focused unit and isolated PostgreSQL integration coverage. The existing Demo UI was not changed.

## Permissions

ADMIN and STAFF can list periods/rates and create periods. Only ADMIN can close a period or add a utility rate. Stage 3A exposes no update, delete, or reopen operations.

## Explicitly not implemented

Meter entry/correction/replacement (3B), billing/invoice issuance/PDFs (3C), payments/receipts (3D), deposits (3E), and production enablement are not implemented.

## Database migration

Migration `202610180001_phase3a_financial_foundation` is additive. It creates `BillingPeriod`, its status enum, foreign keys, indexes, calendar and lifecycle checks, and transition guard. It adds nullable `UtilityRate.createdById` for truthful legacy compatibility and makes utility-rate rows append-only. The migration does not rewrite existing rates, invoices, payments, deposits, or meter records.

## API and server changes

- `src/server/finance/calculations.ts` owns exact proration and usage-charge arithmetic.
- `src/server/finance/service.ts` owns billing-period and utility-rate authorization, transactions, audit writes, fixed-string DTOs, and effective-date rate resolution.
- `GET` and `POST /api/v1/billing-periods/` list and create periods.
- `POST /api/v1/billing-periods/{id}/close/` closes a period once and returns the existing record on retry.
- `GET` and `POST /api/v1/utility-rates/` list and append utility-rate history.
- `resolveUtilityRate` returns the latest matching rate on or before a supplied date. It returns 404 before the first configured rate and never uses a future rate.

No Stage 3A UI was added. Billing and Payment screens remain demonstrations.

## Verification evidence

Verification ran on 18 October 2026. Database and route checks used only isolated projects with database name `taky_phase2_test`. No normal deployment record or volume was changed.

| Check | Command | Result |
| --- | --- | --- |
| Unit tests | `npm test` | PASS: 35 of 35 tests in four files. |
| Focused financial calculations | `npx vitest run tests/finance-foundation.test.ts` | PASS: 7 of 7 tests. |
| PostgreSQL integration | `docker exec taky-phase26-test-app-1 npm run test:integration` after copying the reviewed source into that isolated container | PASS: 25 of 25 tests. |
| TypeScript | `npm run typecheck` | PASS. |
| ESLint | `npm run lint` | PASS with zero warnings. |
| Formatting | `npm run format:check` | PASS. |
| Prisma schema | `npx prisma validate`; `npx prisma generate` | PASS with Prisma 7.10.1. |
| Additive migration | Fresh `taky-phase3a-build` Compose project startup | PASS: all six migrations applied and both containers became healthy. |
| Migration status | `docker exec taky-phase3a-build-app-1 npx prisma migrate status` | PASS: database schema is up to date. |
| Schema drift | `docker exec taky-phase3a-build-app-1 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | PASS: no difference detected. |
| Docker production build | `docker compose --env-file .env.test -p taky-phase3a-build -f docker-compose.yml -f docker-compose.test.yml build app` | PASS: Next.js 16.4.1 compiled in 9.5 seconds, ran TypeScript, generated nine static entries, and registered the new finance routes. |
| Route security | Requests against the fresh isolated app on port 3500 | PASS: unauthenticated period GET returned 401, STAFF rate create returned 403, and cross-origin period create returned 403. |
| Backup/security regression | `npm run test:ops` | PASS: 8 of 8 tests. |
| Diff hygiene | `git diff --check` | PASS. |
| Host production build | `npm run build` | BLOCKED by the known sandbox `EPERM` when Turbopack tries to bind an internal localhost port. The Docker production build passed the same application source. |
| Browser E2E | Not run | No production UI changed in Stage 3A. Route authorization received focused runtime checks. |
| Physical device, Google Drive, and production restore | Not run | These owner-operated Phase 2.5 commissioning gates remain outside this development run. |

## Financial integrity checks

- Unit tests cover 28-, 29-, 30-, and 31-day months, inclusive move-in proration, no-overlap rejection, invalid dates, exact usage, decreasing readings, excess scales, and `25.005` rounding to `25.01`.
- PostgreSQL tests prove canonical month checks, one period per property and month under concurrent requests, OPEN-to-CLOSED lifecycle, one close audit event under retries, immutable closed periods, exact four-decimal rate output, unique change points, append-only rate rows, and rejection before numeric-scale coercion.
- Effective-date tests prove the first-rate boundary, later change-point boundary, prior-rate selection, and no future fallback.
- Existing room, lease, authentication, audit, and backup test suites remained green.

## Security findings

No new Critical or High code defect was found. The finance routes reuse exact-origin checks, session authentication, JSON size limits, no-store responses, service authorization, restrictive foreign keys, and atomic audit writes. Utility-rate history and closed billing periods have database guards even if a caller bypasses the UI.

The application database role still owns the database, so an operator with owner credentials can bypass application policy or alter triggers. Existing HTTPS, backup custody, key escrow, physical-device trust, and recovery-drill requirements remain production gates.

## Remaining limitations and owner decisions

- Stage 3C must choose the date that selects a utility rate for an invoice.
- The owner must decide whether rates may start mid-month or be backdated after invoice issue.
- Stage 3C must define the conditions that permit closing a billing period.
- The owner must decide whether zero contractual rent is billable. Seeded rooms start at zero until configured.
- Stage 3A does not link invoices or readings to `BillingPeriod`; those relations belong to their workflow stages.
- Stage 3A has no production finance UI and does not make the demonstration screens operational.

## Status

Stage 3A development status: **COMPLETE**. Its scoped code, migration, API, tests, and documents passed the checks above. Work stops before Stage 3B for owner review.

Production financial GO/NO-GO: **NO-GO**. Stages 3B through 3F are incomplete. Phase 2.5 also still requires owner-controlled off-device backup recovery, key escrow, normal admin commissioning, intended-device HTTPS trust, host reliability checks, and a controlled production recovery drill.
