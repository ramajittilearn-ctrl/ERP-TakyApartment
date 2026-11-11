# Taky Apartment ERP

Local-first apartment ERP for a MacBook or Mac mini. Phase 2 adds PostgreSQL, Prisma, local login and persistent room/tenant/lease management to the approved Thai frontend. The navy sidebar, pale-blue background, white cards, room grid and responsive layouts are retained.

Phase 2.5 adds encrypted, restore-verified backups and Caddy HTTPS for the private LAN. Follow [backup and recovery](docs/backup-restore.md) and [secure LAN commissioning](docs/secure-lan-deployment.md) before entering sensitive data. Google Drive OAuth and certificate trust on other devices require owner setup. See [the Phase 2.5 review report](PHASE_2_5_IMPLEMENTATION_REPORT.md) for actual verification results.

## Quick start on macOS

Prerequisites: Docker Desktop with Compose running, Node.js 22.13+ / npm, and free disk space for images and persistent volumes. Initial installation needs internet; normal use does not.

```sh
npm ci
node scripts/configure.mjs
node scripts/ops.mjs init
node scripts/ops.mjs up
node scripts/ops.mjs export-ca
node scripts/ops.mjs ps
```

Complete the public CA trust steps in the secure LAN guide, then open `https://<LAN_HOST>/login/` using the exact private host configured in `.local/operations.env`. Run first-admin setup with the full Compose command in that guide. Setup asks for your own username/email and a hidden password of at least 12 characters. There is no default password or public registration. It works only before the first user exists. Generated `.env`, `.local` keys/configuration and backups are private and ignored. Initializers preserve existing files. If Docker is not on PATH, enable Docker Desktop CLI tools or add `/Applications/Docker.app/Contents/Resources/bin` to PATH.

Fresh installations seed exactly 15 rooms: 101–105, 201–205 and 301–305, across three floors. Rent starts at zero and must be configured. No sample tenants, financial transactions or users are inserted. Existing data is preserved on startup. Initializing an already configured property does not recreate intentionally deleted rooms.

## What works

- Local username/email/password login, Argon2id hashing, ADMIN/STAFF permissions, expiring opaque sessions, logout revocation, origin validation and persistent login throttling.
- Protected pages and authenticated APIs. Sensitive mutations produce append-only audit records in the same transaction.
- Room management reads PostgreSQL, with floor/status/search filters, linked profiles and ADMIN edits. The UI preserves the 15 seeded room identities instead of creating or deleting them.
- Tenant and lease create/read/update flows; ADMIN can delete unreferenced tenants and draft leases. Constraints enforce one active lease per room and preserve referenced history.
- Validated property/floor CRUD APIs and ADMIN account-creation API.
- Docker app/database with health checks, restart policies, private attachment storage and persistent database volume. PostgreSQL has no published port.

The application also includes persisted workflows for billing periods, utility rates and readings, invoices, payments and receipts, deposits, OPEX/CAPEX expenses, dashboard summaries, and monthly financial reports. Dashboard and reports are read-only. Maintenance and Settings remain explicitly labeled demonstrations; their figures and actions are not live operational records. Backup/status/recovery are operator commands, not a Settings screen. An ADMIN account-creation API exists, but there is no account-management UI or password-recovery flow.

## Environment and LAN access

See [`.env.example`](.env.example). `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `DATABASE_URL` configure the database; inside Compose use hostname `db`. `SESSION_SECRET` must be at least 32 random characters. `APP_ORIGIN` is the exact canonical browser origin; `APP_BIND_IP` and `APP_PORT` bind the web listener. `COOKIE_SECURE=true` is required behind HTTPS. `ATTACHMENT_DIR` is private and never served as static content.

Default access is loopback only. For trusted local Wi-Fi, reserve the Mac's private IP in your router, set `APP_BIND_IP` to it and `APP_ORIGIN` to its matching URL, then run `docker compose up -d app`. Find the IP in System Settings → Wi-Fi → Details → TCP/IP, or `ipconfig getifaddr en0` for the Wi-Fi interface. Keep macOS Firewall enabled and allow Docker Desktop incoming connections as needed. Do not add router port forwarding, public tunnels or a PostgreSQL port mapping.

The base Compose file retains the Phase 2 development HTTP configuration. For normal use, run `scripts/ops.mjs up` or `reload`, which applies the HTTPS overlay, removes that HTTP mapping and enforces Secure cookies and the exact HTTPS origin. [The secure LAN guide](docs/secure-lan-deployment.md) covers certificate trust, firewall and IP changes. Physical second-device verification requires owner commissioning.

## Commands

```sh
docker compose exec app node node_modules/prisma/build/index.js migrate deploy
docker compose exec app node node_modules/prisma/build/index.js migrate status
docker compose exec app node node_modules/tsx/dist/cli.mjs prisma/seed.ts
docker compose logs --tail=100 app
docker compose down                        # keeps named volumes
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
```

Never use `docker compose down -v`, volume prune or `prisma migrate reset` on operational data. Create new migrations only on a separate development database with `npx prisma migrate dev --name ...`; inspect SQL before deployment. Startup uses `migrate deploy`, not reset. A restart is not a backup.

For host development, configure a separate PostgreSQL database reachable on loopback and set DATABASE_URL / APP_ORIGIN before `npm run dev`. The normal Compose database intentionally cannot be reached from the host. Details are in the operations guide.

## Verification

Integration and browser tests use a separate Compose project and database:

```sh
node scripts/configure.mjs .env.test
docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml up -d --build
docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml exec -T app node node_modules/tsx/dist/cli.mjs scripts/test-users.ts
docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml exec -T app node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
npm run test:e2e
```

Run database tests before browser tests, not concurrently. Browser checks target the Docker app at `127.0.0.1:3300`, use Chrome on macOS, and save screenshots at 1440/768/390 to `docs/phase-2-screenshots/`. Elsewhere install Chromium with `npx playwright install chromium`. Test users and records are explicitly Demo and only permitted in `taky_phase2_test`. Test passwords are generated into ignored `.env.test`; none are in source.

After browser tests, run `node scripts/verify-persistence.mjs` with Docker on PATH to verify test database records, authenticated sessions and attachment storage survive container restarts. Only the isolated test project is restarted. Review the [Phase 2 screenshots](docs/phase-2-screenshots/index.html).

## Documents and source layout

- [Verified gap analysis and Phase 2 plan](docs/phase-2-plan.md)
- [Database relationships, architecture and API contract](docs/phase-2-architecture.md)
- [Mac deployment and troubleshooting](docs/phase-2-operations.md)
- [Phase 2.5 plan](docs/phase-2.5-plan.md), [backup/recovery](docs/backup-restore.md) and [secure LAN](docs/secure-lan-deployment.md)
- [Final implementation and verification report](IMPLEMENTATION_REVIEW_REPORT.md)
- [Original phased plan](docs/implementation-plan.md) and [Phase 1 evidence](docs/verification.md)

`src/server` owns authentication, validation, services and repositories. `prisma` owns schema/migrations/seed. `src/features/live` owns persistent UI; `src/demo` retains the separate fictional frontend. Protected pages live under `src/app/(erp)` without changing URLs. This workspace originally had no Git metadata. The original three upstream commits have now been imported and their object hashes verified. Phase 1 and Phase 2 are integrated on `main` as a descendant of `7f4652837b89b1b35af5d3cbb4de9d7146ac78f8`, preserving the private repository's history. No public deployment or Phase 3 implementation is included. The original implementation prompt, HTML prototype and UX/UI PDF are preserved.
# Phase 2.6 room and tenant integration

Tenant creation can optionally assign an existing room and create a complete ACTIVE lease in the same transaction. Choose a floor, then an available room. Enter the lease number, dates, monthly rent and contractual deposit. Tenants can also be saved without a room.

Tenant, room and lease profiles have links in both directions. Editing the current assignment updates that lease. Moving rooms requires a new lease number, an explicit end date for the previous lease and confirmation. The previous contract remains in history. To remove an assignment, end the lease in Lease Management. Clearing a selection or setting a room to operationally available does not end a lease.

Room occupancy comes from ACTIVE leases. AVAILABLE, RESERVED and MAINTENANCE describe operational availability; Occupied is not a separately stored room status. Reserved and maintenance rooms cannot receive an ACTIVE lease. Payment status remains `Not Available — Phase 3`. Lease dates do not automatically activate or end contracts; operators manage their lifecycle explicitly.

The UI edits existing room inventory instead of offering duplicate room creation. Seeded room numbers/floors are fixed and the 15 principal rooms cannot be deleted through the service. Existing admin configuration APIs remain available for integrations and retain unique room constraints.

## Isolated Phase 2.6 verification

Use an existing private `.env.test` generated through the test setup documented above. Never point these tests at the normal database. The project name below creates separate database and attachment volumes, preserving the original demo on port 3300.

```sh
APP_PORT=3400 APP_ORIGIN=http://127.0.0.1:3400 docker compose --env-file .env.test -p taky-phase26-test -f docker-compose.yml -f docker-compose.test.yml up -d --build --wait
docker compose --env-file .env.test -p taky-phase26-test -f docker-compose.yml -f docker-compose.test.yml exec -T app node --import tsx scripts/test-users.ts
docker compose --env-file .env.test -p taky-phase26-test -f docker-compose.yml -f docker-compose.test.yml exec -T app node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3400 SCREENSHOT_DIR=tmp/phase26/screenshots npm run test:e2e
APP_PORT=3400 APP_ORIGIN=http://127.0.0.1:3400 TEST_PROJECT=taky-phase26-test PLAYWRIGHT_BASE_URL=http://127.0.0.1:3400 node scripts/verify-persistence.mjs
node scripts/verify-phase26.mjs
```

The last command switches only that isolated project to HTTPS on localhost:3543, checks its Caddy CA, secure cookies and exact origin, and verifies an encrypted backup with an automatic temporary PostgreSQL restore. It creates private test keys and archives under ignored `.local/phase26/`. It does not authorize Google Drive or install certificates on other devices. Run the HTTP browser tests before this HTTPS switch; rerunning the first command restores the HTTP test configuration. The two additional migrations apply through the existing `npm run db:migrate` startup process. No reset, destructive migration or normal-deployment restore is required.

See `PHASE_2_6_IMPLEMENTATION_REPORT.md` for executed results, screenshots and limitations.
