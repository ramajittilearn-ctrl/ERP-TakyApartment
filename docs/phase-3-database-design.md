# Phase 3 database design

## Stage 3A additions

`BillingPeriod` belongs to a property and stores canonical month boundaries, `OPEN`/`CLOSED` state, creator, optional closer, and timestamps. `(propertyId, startsOn)` is unique. A check constraint requires first-day start and last-day end, making duplicate or overlapping monthly periods impossible by representation. A second check keeps close status, actor, and timestamp consistent.

`UtilityRate` remains a property-wide, append-only change-point table keyed by `(propertyId, kind, effectiveFrom)`. Stage 3A adds nullable creator provenance for compatibility with legacy rows. A PostgreSQL trigger rejects updates and deletes.

`resolveUtilityRate` returns the latest matching rate whose `effectiveFrom` is not later than the requested date. It returns a not-found error before the first configured rate and never substitutes a future value.

Billing-period identity fields cannot change. A transition trigger permits the initial OPEN-to-CLOSED update and rejects every update after closure. The service exposes no generic update/delete/reopen path.

## Transactions and audit

Create and close commands run with Prisma `Serializable` isolation. Creates lock the owning property row before insert. Closing locks the period row. Database uniqueness is the final concurrent duplicate guard. Each successful state change and its `AuditLog` record commit in the same transaction.

The API returns date-only values as ISO `YYYY-MM-DD`, timestamps as UTC ISO strings, and decimals as fixed strings. Prisma database records do not cross the finance service boundary.

## Additive migration

Migration `202610180001_phase3a_financial_foundation` creates the enum, table, constraints, indexes, foreign keys, provenance column, and triggers without rewriting existing financial rows. `UtilityRate.createdById` remains nullable because an existing row may not have a truthful historical actor; the migration does not invent one.

Existing migrations are immutable. Deployment uses `prisma migrate deploy`; operational databases must never use reset. Validate against an isolated populated database, then check migration status and schema drift. Dropping accepted financial configuration is not treated as a routine rollback; recovery uses the existing verified backup process.

## Stage boundary

This design does not change meter/readings, invoices/items, payments/allocations, attachments, or deposits. Their Stage 3B–3E invariants require separate additive migrations.
