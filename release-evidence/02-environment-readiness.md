# Stage 2 — Environment Readiness

**Result: NOT VERIFIED for production.** The inspected machine is the current development Mac; the intended production target has not been identified. These local readings must not be treated as target evidence.

## Current development host inspection

Read-only commands on 2026-10-26 reported macOS 26.5.2, Darwin 25.5.0 arm64, 6 CPU cores, 8 GiB RAM, 13 GiB free on `/`, Docker context `desktop-linux`, Docker Engine 29.5.2, and Docker Compose v5.1.3.

The current `taky-erp` Compose containers were inspected without reading their environment variables or logs. App, PostgreSQL, Caddy, and operations reported healthy. App, database, and Caddy have no host-published ports in Docker's current network inspection. The running PostgreSQL service is `postgres:17-bookworm`; its database and attachment named volumes are `taky-erp_database` and `taky-erp_attachments`. Caddy reports no host-published HTTPS port, so a client HTTPS endpoint was not verified. A direct read-only app health request from inside the app container returned HTTP 200.

A `BEGIN READ ONLY` database inspection followed by `ROLLBACK` found 23 public tables including `_prisma_migrations`, 3 successfully applied migrations (`202610160001_foundation`, `202610160002_constraints`, `202610170001_backup_operations`), and zero rows in Tenant, Lease, Invoice, Payment, and Expense. This confirms only the current local `taky-erp` database state; it does not prove that this context is the owner-designated target. The RC1 manifest expects 44 Prisma models and 17 migrations, so the gap requires a rehearsal against a separately attested target clone. No schema or data was changed.

No existing UAT/production Compose project, database, or volume was modified. The isolated browser runner used a unique project identity and retained its synthetic database volume; it did not connect to an existing ERP database.

## Production target facts still required

- Exact machine/host identity and Docker context.
- Canonical private HTTPS origin, reserved LAN interface/DNS, and client certificate trust.
- Existing Compose project, app and PostgreSQL image digests, database identity, migration history/checksums, and database/attachment/backup/CA volume identities.
- Target CPU/RAM/disk capacity and registry image availability.
- Existing attachment volume ownership and permissions, secrets/config custody, backup encryption/off-device storage, and recovery-device access.

The Phase 4 runbook explicitly says its previous synthetic configuration check did not contact or verify an actual target. The current `taky-erp` stack is an inspected local candidate target only; exact deployment host/origin and production designation remain unresolved. No service, schema, database, or volume was changed during this inspection.
