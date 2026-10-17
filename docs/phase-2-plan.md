# Phase 2 — verified gaps and implementation plan

## Baseline inspected 16 October 2026

The workspace contains the completed Phase 1 application and the original master prompt, HTML prototype and PDF. It is not a Git checkout. Next 16.4.1 / React 19.3.1 / TypeScript / Tailwind 4, Zod, Radix and Lucide are installed. Ten explicit App Router pages share AppShell, Card, Field, Modal, DataTable and Thai CSS tokens. `src/demo` owns fictional fixtures and tab-local state; refreshing loses changes. Room, tenant and lease screens currently read those fixtures. The build is a static export, served with `serve`.

No Prisma schema, database driver, authentication, API route, Dockerfile, Compose file or persistent storage exists. Previous tests exercise demo behavior only and cannot establish backend correctness. Docker Desktop is installed but its engine was initially stopped and its CLI is not on PATH.

## Incremental implementation

1. Replace static export with a Node server. Preserve existing demo modules and visual components. Protect the application through a server layout; leave login and health separate. Keep future financial screens explicitly labeled demonstrations so they cannot masquerade as persisted accounts.
2. Add Prisma/PostgreSQL schema and initial additive migration. Model property/floor/room, tenants/leases/deposits, meters/rates/readings, invoices/items, payments/allocations, expenses/categories, maintenance, users/sessions, attachments, audits and backup history. UUID keys, NUMERIC money, restrictive FKs, UTC timestamps, unique and check constraints. Active-room lease exclusivity is enforced by PostgreSQL.
3. Seed only one property, three floors and exactly fifteen rooms, idempotently without overwriting edits. No tenant, financial or user seed. Add a first-admin CLI with hidden password input; no public setup endpoint or default password.
4. Implement Argon2id, random opaque sessions stored as hashes, expiry/revocation, ADMIN/STAFF policies, origin checks and persistent login throttling. Audit mutations transactionally without logging credentials or tenant contact contents.
5. Add validated `/api/v1` CRUD for properties/floors/rooms/tenants/leases through services and repositories. Restrict configuration and deletion to ADMIN; STAFF can manage tenants/leases. Reject deletion of referenced records and overlapping active room leases.
6. Connect the approved room grid to real database data. Provide tenant and lease create/edit/delete flows using existing visual primitives. Keep unimplemented financial state separate from live records.
7. Add Docker app/PostgreSQL, named database and attachment volumes, health checks, restart policies, environment generation and startup migrations. Default to loopback; document explicit private LAN binding and HTTPS configuration. Never publish the database port.
8. Execute fresh database migrations, seed idempotence/15-room checks, constraints, authentication/authorization, CRUD, restart persistence, Docker build/startup, responsive smoke/accessibility tests and screenshots. Retain Phase 1 finance unit tests. Record actual results and remaining limits.

## Security and data boundary

Route handlers validate JSON and origin, authenticate each request, authorize each operation, then call services. Services own transactions and domain rules; repositories own Prisma queries. The browser receives DTOs with decimal strings, never password hashes or session rows. Login cookies are HttpOnly and SameSite=Strict; HTTPS deployments require Secure. Plain LAN HTTP is only for explicitly trusted networks and is not encrypted. Initial administrator creation requires local container shell access.

Attachments and backup tables/volumes are foundations only; upload, backup and restore workflows are deferred. No billing or payment API will be added. Tests use isolated disposable databases, never reset a production volume.

## Acceptance gate

Compose healthy; migration deployed; admin login and server authorization verified; 15 seeded rooms returned by the application; tenant and lease CRUD persists; invalid and concurrent operations rejected; restart retains data; approved room layout remains consistent at 1440/768/390; reproducible README and implementation report.
