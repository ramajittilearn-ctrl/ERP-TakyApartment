# ERP-TakyApartment implementation and verification report

Review date: 17 October 2026. Scope: completed Phase 1 frontend and Phase 2 backend foundation. Phase 3 is not authorized and has not started.

## A. Executive summary

Phase 2 implements PostgreSQL persistence, Prisma migrations, local authentication, role-based authorization, room/tenant/lease management, audit logging and a local Docker deployment. The original Thai design system and ten frontend routes remain. Room, tenant and lease screens read actual database records; the other business screens remain clearly labeled demonstrations.

The final host checks passed: production build, TypeScript, ESLint, formatting and 23 unit tests. The Docker application passed 10 database integration tests and 36 browser tests. Restart verification preserved room/tenant/lease records, the authenticated session and private attachment storage. Fresh installations contain precisely 15 rooms and no people or financial transactions.

Lease Management again has four KPI cards, a 30-day expiry filter, search/status filtering, Thai status/date formatting, CSV export and persistent CRUD. Contractual deposits are explicitly distinguished from cash actually received. Screenshots cover desktop, tablet and mobile.

Phase 2 meets its functional Definition of Done. The isolated Docker environment passes the authentication, CRUD, database and persistence criteria. The final normal deployment also starts, reports readiness over the current private LAN address and contains exactly 15 rooms across three floors, with no tenants or users seeded. Operational commissioning still requires the owner to create a private admin account, configure room rents, arrange backups and use trusted local HTTPS before entering sensitive data on a shared network. Backup recovery, physical second-device access and an encrypted LAN deployment have not been tested.

## B. Scope completion matrix

| Planned feature | Status | Relevant files | Acceptance criteria and verification |
| --- | --- | --- | --- |
| Review existing work and plan | Complete | `docs/phase-2-plan.md`, `docs/phase-2-architecture.md`, original prompt/prototype/PDF | Baseline separated actual Phase 1 implementation from missing backend. Existing work retained. |
| PostgreSQL and Prisma foundation | Complete | `prisma/schema.prisma`, `prisma.config.ts`, `src/server/db.ts` | 22 tables, UUIDs, NUMERIC values, foreign keys/indexes and committed migrations. Docker connectivity and migration tests pass. |
| Fresh 15-room seed | Complete | `prisma/seed.ts` | Rooms 101–105, 201–205, 301–305. Repeated seed preserves edited records; exact room list asserted in integration and browser tests. |
| Login and first admin setup | Complete | `src/server/auth.ts`, `scripts/admin.ts`, `src/features/auth/login.tsx` | Argon2id, no default account, local-only bootstrap, second bootstrap rejected, username/email login tested. Personal deployment admin deliberately not provisioned by the agent. |
| Sessions, roles and protected routes | Complete | `src/server/http.ts`, `src/app/(erp)/layout.tsx`, auth/API routes | API authentication independent of UI, ADMIN/STAFF restrictions, expiry/revocation, origin rejection and cookie attributes tested. |
| Audit logging | Complete | `auth.ts`, `services.ts`, constraints migration | Mutations and audit entries commit together; SQL update/delete of audit rows rejected. Database owner remains privileged. |
| Property/floor/room CRUD | Complete | `src/server/{validation,services,repository}.ts`, API routes | Validation, role checks, duplicate/reference constraints and CRUD tested. Room edits persist across refresh. |
| Tenant CRUD | Complete | Same server layers; `src/features/live/tenants.tsx` | Create/read/update, profile/tabs, delete only unreferenced records; browser and DB tests pass. Future financial tabs show notices. |
| Lease CRUD and occupancy | Complete | `src/features/live/leases.tsx`, `services.ts` | Draft CRUD; lifecycle restrictions; concurrent active leases cannot occupy one room. DB and browser tests pass. |
| Restored lease summaries/export | Complete | `lease-summary.ts`, `leases.tsx`, `tests/lease-summary.test.ts` | Four KPI cards and CSV restored; exact decimal sums and 30-day boundaries tested; browser download and screenshots verified. |
| Local Docker and persistent volumes | Complete | `Dockerfile`, `docker-compose*.yml`, `scripts/verify-persistence.mjs` | Isolated Compose build/start and database/session/attachment restart persistence pass. No PostgreSQL host port. |
| Existing responsive UX/UI | Complete | `src/components`, `src/app/globals.css`, `src/features/live`, screenshot directories | 10 protected routes at 1440/768/390 px, accessibility and smoke assertions pass. Desktop/mobile lease screenshots inspected. |
| Deployment instructions | Complete | `README.md`, `.env.example`, `docs/phase-2-operations.md` | Reproducible setup, migrations, first admin, secrets, LAN/firewall, development and troubleshooting commands supplied. |
| Encrypted LAN and second physical device commissioning | Partial | Compose/environment instructions | Host LAN binding supported; local HTTPS certificates and second-device check require the deployment owner. Not claimed tested. |
| Financial, meter, expense, maintenance database foundations | Complete | `prisma/schema.prisma`, migrations | Tables/relations exist. This does not mean complete business workflows or accounting controls exist. |
| Full billing, payments, deposit settlement | Not Started | Separate Phase 1 demo UI only | Explicitly excluded from Phase 2. No operational financial API. |
| Attachment upload and backup/restore workflows | Not Started | Storage volume and metadata tables only | Private storage persistence tested; no upload handler, scheduled backup worker or restore drill. Deferred scope. |

## C. Technical architecture

Next.js 16.4.1 App Router and React 19.3.1 run on Node.js 22. TypeScript 5.9, Tailwind 4, Radix controls, Lucide icons and local Noto Sans Thai retain the approved presentation. Prisma 7.10.1 uses the PostgreSQL driver adapter against PostgreSQL 17. Zod validates API inputs and browser DTOs.

Requests pass through route handlers, authentication/origin/input checks and services before database access. Services own authorization and transactions; repositories own read projections and deletion queries. Backend logic does not depend on React. The protected route group preserves existing URLs. Public routes are login and minimal readiness status.

| Tables | Relationships |
| --- | --- |
| Property, Floor, Room | Property has floors; floor has rooms; unique property code, floor number within property and room number within floor. |
| Tenant, Lease, SecurityDeposit | Lease references tenant and room, snapshots rent/deposit; deposit ledger references lease. One ACTIVE lease per room. |
| UtilityMeter, MeterReading, UtilityRate | Meter references room, reading references meter and user, effective rate references property. Unique meter/period readings. |
| Invoice, InvoiceItem | Invoice references lease, items reference invoice. Unique invoice number and lease/period. |
| Payment, PaymentAllocation | Payment references lease; allocation references payment and invoice. Unique payment references and payment/invoice allocation pair. |
| ExpenseCategory, Expense | OPEX/CAPEX category and property linked to expense. |
| MaintenanceRequest | Room and optional assigned user. |
| User, Session, LoginThrottle | ADMIN/STAFF users, hashed sessions and persistent login attempt counters. |
| Attachment | Uploaded-by user and exactly one tenant/lease/payment/expense owner; private storage key. |
| AuditLog, BackupHistory | Actor and operation/backup metadata. Backup execution is deferred. |

All primary keys are UUIDs. Financial amounts use NUMERIC/DECIMAL, not floating-point columns. Money has two decimal places, rates four and measurements three. Foreign keys restrict deletion of referenced history. Mutable records have creation/update timestamps; immutable audit entries have creation timestamps.

Authentication uses Argon2id with 64 MiB, three iterations and one lane. Sessions are random 256-bit tokens; the database stores only keyed SHA-256 hashes. Cookies are HttpOnly and SameSite=Strict with an eight-hour absolute lifetime. HTTPS deployments enable Secure. Logout revokes the database session. Disabled users cannot authenticate or reuse sessions.

Compose runs a non-root app container and PostgreSQL on a private bridge network. Named volumes hold database files and private attachments. Health checks and restart policies are configured. Only the web listener is published, on loopback by default or an explicitly configured private LAN IP. The application runs startup migrations and an idempotent seed, never a reset. No public tunnel or router forwarding was configured.

## D. Implementation details

The private upstream previously held only the master prompt, prototype and PDF. The publication therefore adds the completed Phase 1 application as well as Phase 2. Existing source design references are retained; the HTML prototype has only an end-of-file newline difference.

| Created or modified area | Contents |
| --- | --- |
| `src/app`, `src/components`, `src/demo`, `src/features`, `src/lib` | Phase 1 routes/design system/demo calculations plus protected layout, login and live room/tenant/lease integration. |
| `src/server` | `auth.ts`, `db.ts`, `errors.ts`, `http.ts`, `repository.ts`, `services.ts`, `validation.ts`. |
| `src/features/live` | DTO contracts, shared database loader/editor, rooms, tenants, leases and exact-money/expiry summary helpers. |
| `prisma` | 22-model schema, seed, migration lock and two SQL migrations. |
| `scripts` | Environment generation, first-admin CLI, isolated test-user setup, persistence verifier and screenshot gallery generator. |
| Root build/deployment files | Package/lockfile, Next/TypeScript/ESLint/Prisma/Playwright/Vitest configs, Dockerfile, Compose files, Makefile, ignore files and environment example. |
| `tests` | Original finance/unit and frontend evidence, new lease summary tests, DB integration tests and Phase 2 browser suite. |
| `docs`, `README.md`, this report | Plans, architecture, operations, historical Phase 1 verification and both screenshot sets. |

Migration `202610160001_foundation` creates the schema. `202610160002_constraints` adds the active-room partial unique index, positive/nonnegative financial checks, valid lease dates, normalized user identifiers, attachment-owner exclusivity and append-only audit trigger. Both were applied on fresh isolated and normal databases. No reset, destructive migration or operational data overwrite was used.

API endpoints:

- `POST /api/auth/login/`, `POST /api/auth/logout/`.
- `GET /api/health/` returns readiness only.
- `GET/POST /api/v1/{properties,floors,rooms,tenants,leases}/`.
- `GET/PUT/DELETE /api/v1/{resource}/{uuid}/`.
- `POST /api/v1/users/` requires ADMIN.

PUT accepts a complete validated record. Errors have safe codes/messages, with 401/403/404/409/413/415/422/429 responses. Mutations require the exact configured Origin; JSON bodies are capped at 16 KiB. STAFF can manage tenants/leases but cannot change room configuration, delete records or create users. Only draft leases can be deleted. Started leases cannot move room/tenant or revert to draft. Demo classification must agree between tenant and lease.

Lease money summaries add integer minor units with BigInt before formatting. Expiry calculations use a Bangkok calendar date and a 30-day inclusive boundary. CSV contains filtered database records, Thai statuses and a Demo column. Deposit KPI text describes contractual amounts, not received deposits. Dashboard/accounting numbers remain separate demo fixtures.

## E. Testing and verification

Final automated runs completed on 17 October 2026. The commands below use Docker on PATH. On this Mac, execution also specified the Docker Desktop CLI directory, its Unix socket and an ignored task-local Docker CLI config. No private environment values are included in this report.

`TEST_COMPOSE` below abbreviates `docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml`.

| Test | Command executed | Result | Actual evidence |
| --- | --- | --- | --- |
| Host production build | `npm run build` | PASS | Next production build completed, all 19 listed page/API entries generated or marked dynamic. |
| TypeScript | `npm run typecheck` | PASS | `tsc --noEmit`, exit 0. |
| Lint | `npm run lint` | PASS | ESLint with zero-warning threshold, exit 0. |
| Formatting | `npm run format:check` | PASS | All matched source/test/config files use Prettier style. |
| Unit tests | `npm test` | PASS | 23 tests in two files, 21 existing finance tests plus two restored lease summary tests. |
| Docker image build/start | `TEST_COMPOSE up -d --build` | PASS | Node Linux image generated Prisma client and Next production build; app/database started. |
| Database integration and migration records | `TEST_COMPOSE exec -T app npm run test:integration` | PASS | 10/10 tests; final run took 6.25 seconds. Both migrations present, exact 15-room seed/idempotence, hashing/bootstrap, sessions/throttle, validation, role restrictions, CRUD, concurrency and immutable audits verified. |
| Browser integration/regression | `npm run test:e2e` | PASS | 36/36 tests, about 1.2 minutes. Login/protected routes, APIs, origin and role rejection, room edit/filters, tenant/lease CRUD, CSV download and 30 responsive route checks. |
| Restored lease controls and CSV contents | `npm run test:e2e -- --grep 'tenant and lease UI'` | PASS | One focused test rerun after stronger assertions: four KPI cards, draft/expiry/search filters, persistent edits, downloaded CSV containing the created lease, tenant, updated rent and Thai status, then draft/tenant deletion. Lint, TypeScript and formatting also passed after this test change. |
| Lease summary calculation | Included in `npm test` | PASS | Fractional-baht addition and large values exact; 30-day boundary included; overdue/ended leases excluded. |
| Screenshots and accessibility smoke | Included in `npm run test:e2e` | PASS | 31 PNGs, ten routes at 1440/768/390 and login. Zero reported test failures. Desktop and mobile restored lease screenshots manually inspected. |
| Restart and storage persistence | `node scripts/verify-persistence.mjs` | PASS | Room/tenant/lease data fingerprints unchanged, 15 rooms through authenticated API, pre-restart session still valid, attachment marker survives. Script removed only its own marker. |
| Normal deployment final build/start attempt | `docker compose up -d --build` | FAIL | Image built successfully, digest `sha256:e04c1ae07bf6e6f4e416fc32f02ba487cc5ad9f7f70c9e86d4a0c27c0e899e68`. Startup failed because configured LAN IP `.175` was no longer assigned to the Mac. Resolved by changing only ignored local APP_BIND_IP/APP_ORIGIN to the observed current private address `.135`. |
| Normal deployment corrected startup | `docker compose up -d --no-build` | PASS | Final app image started with the current private LAN binding; database volume preserved. |
| Normal migration and room inventory | `docker compose exec -T app npx prisma migrate status`; inventory SQL below through `docker compose exec -T db psql -U taky -d taky -Atc` | PASS | Both migrations applied; SQL returned 15 rooms, 3 floors, 0 tenants, 0 users and the exact 101–105/201–205/301–305 list. |
| Normal LAN readiness | Node fetch of configured `APP_ORIGIN + '/api/health/'` | PASS | HTTP 200, `{"status":"ok"}`, from this Mac to its private LAN address. This does not verify another physical device. |
| Git history integrity | `git log --oneline --max-count=3`; `git fsck --full` | PASS | Three original commits imported with exact SHA checks; no integrity errors. No working files reset. |
| Physical second LAN device | Manual browser login from another device | NOT RUN | Requires owner/device/network access. |
| Trusted local HTTPS | Browser TLS/Secure-cookie deployment check | NOT RUN | No certificate/proxy installed. Cookie configuration is tested, not an end-to-end encrypted deployment. |
| Backup restoration | Restore from backup into separate database | NOT RUN | Backup/restore automation is outside this phase. |

The normal database inventory query executed was:

```sql
SELECT (SELECT count(*) FROM "Room"),
       (SELECT count(*) FROM "Floor"),
       (SELECT count(*) FROM "Tenant"),
       (SELECT count(*) FROM "User"),
       (SELECT string_agg(number,chr(44) ORDER BY number) FROM "Room");
```

Evidence lives in `tests/integration/foundation.test.ts`, `tests/phase2/app.spec.ts`, the unit test files, `scripts/verify-persistence.mjs` and [the screenshot gallery](docs/phase-2-screenshots/index.html). The complete browser run reported 36 expected, zero skipped, zero unexpected and zero flaky tests in 72.743 seconds. The ignored `test-results/results.json` now reflects the later focused lease rerun. Committed screenshots contain only Demo records. Screenshots are regression evidence, not a pixel-difference assertion against every PDF element.

Earlier failures were resolved and rerun: an Argon2 test incorrectly assumed hash parameter order; an authorization path returned input validation before STAFF denial; and browser authentication used an isolated request cookie jar, which could falsely exercise login instead of protected pages. Tests now compare parameter sets, check authorization first and authenticate the actual browser context with explicit protected-page assertions. The final runs above have no known failing tests. Historical Phase 1 browser tests remain in source but are not included in the Phase 2 Playwright selection; the authenticated suite supersedes their smoke coverage.

## F. Security and data integrity

| Area | Implemented safeguards | Limits or planned safeguards |
| --- | --- | --- |
| Authentication/authorization | Argon2id, server-side role policy, random hashed sessions, expiry/logout, disabled-user checks, exact Origin, bounded JSON and persistent throttling. | No MFA, password recovery or account-management UI. Global throttle can deny legitimate login during abuse. |
| Passwords/secrets | Exclusive environment generation, private ignored files, no default credentials, hidden first-admin password input. No real personal seed. | Owner must protect Mac, Docker access and environment files; local disk encryption/host access control remain operational responsibilities. |
| Database constraints | Restrictive foreign keys, unique identifiers, one active lease per room, valid dates, positive/nonnegative checks and attachment ownership check. | Financial reconciliation and cross-ledger accounting invariants are not complete. |
| Transactions | CRUD plus audit atomicity, serializable occupancy operations, explicit room locks, bootstrap/seed advisory locks. | Serialization conflicts return 409 for a deliberate retry. |
| Financial precision | DECIMAL columns, validated decimal-string APIs, exact lease summary addition, existing finance unit tests retained. | No end-to-end real billing/payment calculation or settlement exists yet. Contract deposit totals are not liabilities received. |
| Duplicate prevention | Unique property/room/lease identifiers, active-room constraint, invoice period/number, payment reference and allocation pair foundations. | API idempotency keys and full duplicate payment/import prevention must precede Phase 3 financial posting. |
| Audit integrity | Transactional operation metadata and database trigger preventing ordinary update/delete. | App DB credentials currently own the database; an owner can bypass triggers. Not a tamper-proof external audit archive. |
| Storage/recovery | Named PostgreSQL/attachment volumes survive restarts; metadata foundations exist. | Restart persistence is not backup. No scheduled backup, encryption-at-rest verification, off-device copy or restore drill. |
| Network/browser | No database host port, explicit app bind, no public exposure, security headers, HttpOnly/SameSite cookies. | Current LAN HTTP is unencrypted; CSP allows inline scripts/styles for the current Next setup. Local HTTPS and nonce-based CSP remain hardening work. |

## G. Issues and risks

No Critical issue or unresolved automated test failure is known from this verification. This is not an independent penetration test.

| Severity | Issue | Required action or boundary |
| --- | --- | --- |
| High | Plain HTTP exposes passwords/session traffic to a compromised or untrusted LAN. | Use loopback or a trusted network for commissioning; install locally trusted HTTPS and Secure cookies before sensitive shared-LAN use. Do not expose publicly. |
| High | No tested backup/recovery workflow. | Establish protected database/attachment backups and perform a restore drill before relying on the ERP as the sole record. |
| Medium | Normal deployment has no owner-selected administrator yet. | Owner runs `docker compose exec app npm run admin:setup`; no credentials are invented or published. Test admin login passed only with explicit Demo users in the isolated DB. |
| Medium | Database owner credentials used by app; audit trigger can be bypassed by owner. | Separate migration and runtime privileges during deployment hardening. |
| Medium | CSP permits inline scripts/styles; no MFA or password reset. | Assess trusted-user risk and harden before broader access. |
| Medium | Database financial foundations are not a finished accounting system. | Keep demo billing/payment screens non-operational until approved Phase 3 transactions, idempotency and reconciliation exist. |
| Low | No second physical device or macOS firewall prompt verification. | Owner verifies access from the intended Wi-Fi device and excludes public routing. |
| Low | DHCP can change the Mac's configured private address. This caused the initial final-deployment startup failure. | Reserve the address in the router, or update both APP_BIND_IP and APP_ORIGIN after a change and recreate the app. |
| Low | Runner includes migration/test dependencies; list endpoints cap at 1,000 records. | Acceptable for current 15-room scope; split maintenance tooling and add pagination as records grow. |
| Low | Tests retain explicitly Demo ended-lease history in the isolated volume. | It does not enter the normal deployment; do not confuse the two Compose projects. |

## H. Next phase recommendation and stop point

After independent review and explicit approval, Phase 3 should implement utility rates/readings, invoice generation and item snapshots, payment allocation, deposit accounting and reconciliation. First resolve deployment HTTPS and backup/restore readiness. Then define monetary rounding and invoice identity rules; add transactional/idempotent services with database constraints; test duplicate/concurrent submissions and reversals; finally connect the existing approved financial screens. Do not treat an invoice, payment or deposit as posted merely because a demo UI shows it.

No Phase 3 implementation is included. Work stops after the verified Phase 1/2 source and this report are published.

### Repository integration record

Target is the existing private `ramajittilearn-ctrl/ERP-TakyApartment`, branch `main`. Its inspected head is `7f4652837b89b1b35af5d3cbb4de9d7146ac78f8`, preceded by `7947e1b8f0ede05a279e0e659b5117ada9337cab` and `c3508696d3bf0fc9704bd8618c4ba77bdd5b2486`. The original three Git commits and their trees/blobs were imported locally and verified against their upstream object hashes. The workspace had no prior local commits to merge.

Publication must create a direct child of that existing head and update `main` only if the expected head still matches, with force disabled. Any remote change or authentication conflict stops publication. Secrets, local environment files, database volumes, node_modules, build outputs and test traces are excluded. The final delivery message supplies the independently read-back remote commit hash; a report cannot embed its own containing commit hash.
