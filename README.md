# Taky Apartment ERP

Local-first apartment ERP for a MacBook or Mac mini. Phase 2 adds PostgreSQL, Prisma, local login and persistent room/tenant/lease management to the approved Thai frontend. The navy sidebar, pale-blue background, white cards, room grid and responsive layouts are retained.

## Quick start on macOS

Prerequisites: Docker Desktop with Compose running, Node.js 22.13+ / npm, and free disk space for images and persistent volumes. Initial installation needs internet; normal use does not.

```sh
npm ci
node scripts/configure.mjs
docker compose up -d --build
docker compose ps
docker compose exec app npm run admin:setup
```

Open [local login](http://127.0.0.1:3000/login/). Setup asks for your own username/email and a hidden password of at least 12 characters. There is no default password or public registration. It works only before the first user exists. Generated `.env` is private, ignored and never overwritten. If Docker is not on PATH, enable Docker Desktop CLI tools or add `/Applications/Docker.app/Contents/Resources/bin` to PATH.

Fresh installations seed exactly 15 rooms: 101–105, 201–205 and 301–305, across three floors. Rent starts at zero and must be configured. No sample tenants, financial transactions or users are inserted. Existing data is preserved on startup. Initializing an already configured property does not recreate intentionally deleted rooms.

## What works

- Local username/email/password login, Argon2id hashing, ADMIN/STAFF permissions, expiring opaque sessions, logout revocation, origin validation and persistent login throttling.
- Protected pages and authenticated APIs. Sensitive mutations produce append-only audit records in the same transaction.
- Room management reads PostgreSQL, with floor/status/search filters, details and ADMIN create/edit/delete.
- Tenant and lease create/read/update flows; ADMIN can delete unreferenced tenants and draft leases. Constraints enforce one active lease per room and preserve referenced history.
- Validated property/floor CRUD APIs and ADMIN account-creation API.
- Docker app/database with health checks, restart policies, private attachment storage and persistent database volume. PostgreSQL has no published port.

Dashboard, billing, payments, expenses, reports, maintenance and settings retain explicitly labeled Phase 1 demonstrations. They are separate from live tenant/lease records; their figures are not operational accounting. Full billing/payment workflows, file upload, account-management UI, password recovery and automated backup/restore are deferred.

## Environment and LAN access

See [`.env.example`](.env.example). `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `DATABASE_URL` configure the database; inside Compose use hostname `db`. `SESSION_SECRET` must be at least 32 random characters. `APP_ORIGIN` is the exact canonical browser origin; `APP_BIND_IP` and `APP_PORT` bind the web listener. `COOKIE_SECURE=true` is required behind HTTPS. `ATTACHMENT_DIR` is private and never served as static content.

Default access is loopback only. For trusted local Wi-Fi, reserve the Mac's private IP in your router, set `APP_BIND_IP` to it and `APP_ORIGIN` to its matching URL, then run `docker compose up -d app`. Find the IP in System Settings → Wi-Fi → Details → TCP/IP, or `ipconfig getifaddr en0` for the Wi-Fi interface. Keep macOS Firewall enabled and allow Docker Desktop incoming connections as needed. Do not add router port forwarding, public tunnels or a PostgreSQL port mapping.

Plain HTTP is not encrypted. Use a locally trusted HTTPS reverse proxy and Secure cookies for sensitive records on shared LANs. [The operations guide](docs/phase-2-operations.md) covers private IP configuration, firewall, certificate considerations, secrets, development and troubleshooting. Physical second-device verification depends on the deployment network.

## Commands

```sh
docker compose exec app npm run db:migrate
docker compose exec app npx prisma migrate status
docker compose exec app npm run db:seed
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
docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml exec -T app npx tsx scripts/test-users.ts
docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml exec -T app npm run test:integration
npm run test:e2e
```

Run database tests before browser tests, not concurrently. Browser checks target the Docker app at `127.0.0.1:3300`, use Chrome on macOS, and save screenshots at 1440/768/390 to `docs/phase-2-screenshots/`. Elsewhere install Chromium with `npx playwright install chromium`. Test users and records are explicitly Demo and only permitted in `taky_phase2_test`. Test passwords are generated into ignored `.env.test`; none are in source.

After browser tests, run `node scripts/verify-persistence.mjs` with Docker on PATH to verify test database records, authenticated sessions and attachment storage survive container restarts. Only the isolated test project is restarted. Review the [Phase 2 screenshots](docs/phase-2-screenshots/index.html).

## Documents and source layout

- [Verified gap analysis and Phase 2 plan](docs/phase-2-plan.md)
- [Database relationships, architecture and API contract](docs/phase-2-architecture.md)
- [Mac deployment and troubleshooting](docs/phase-2-operations.md)
- [Final implementation and verification report](IMPLEMENTATION_REVIEW_REPORT.md)
- [Original phased plan](docs/implementation-plan.md) and [Phase 1 evidence](docs/verification.md)

`src/server` owns authentication, validation, services and repositories. `prisma` owns schema/migrations/seed. `src/features/live` owns persistent UI; `src/demo` retains the separate fictional frontend. Protected pages live under `src/app/(erp)` without changing URLs. This workspace originally had no Git metadata. The original three upstream commits have now been imported and their object hashes verified. Phase 1 and Phase 2 are integrated on `main` as a descendant of `7f4652837b89b1b35af5d3cbb4de9d7146ac78f8`, preserving the private repository's history. No public deployment or Phase 3 implementation is included. The original implementation prompt, HTML prototype and UX/UI PDF are preserved.
