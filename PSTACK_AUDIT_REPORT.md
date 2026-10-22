# Pstack audit report

Audit date: 17 October 2026. Branch: `main`. Commit: `4b4e7dbed8b57f1e5c1227a53b40ba827705e88c`.

## Executive summary

The code and deployment checks support a **CONDITIONAL GO** for Phase 3 development in an isolated, non-production environment. Do not use Phase 3 for live financial records until the Phase 2.5 owner commissioning gates are complete.

No Critical or High code defect was confirmed. TypeScript, ESLint, formatting, 28 unit tests, eight backup/security tests, 19 PostgreSQL integration tests, the Docker production build, five migrations, schema drift, HTTPS/authentication, private-port checks, and encrypted isolated restore passed.

The initial browser audit completed 39 of 41 tests. Both failures came from a reused test database where room 102 already had an ACTIVE Demo lease. The verification addendum records the test-isolation fix and the final repeatable results.

The host `npm run build` was BLOCKED because Turbopack could not bind an internal port in the execution environment. The same source completed the production build inside the project Dockerfile. No application source, migration, production data, Git commit, or remote branch changed during this audit.

## Pstack workflow used

This audit used the installed `pstack-codex` package version `0.15.17+codex.1`.

- `poteto-mode` selected the read-only Investigation playbook.
- `how` divided the review into frontend/backend, backup/security, and Room/Tenant/Lease evidence traces.
- `principle-sequence-verifiable-units` ordered static checks, the Docker build, database tests, browser tests, migrations, and operational verification so each unit had an observable result.
- `principle-test-behavior-not-implementation` treated browser, API, database, and restore outcomes as stronger evidence than source inspection alone.
- `principle-prove-it-works` required fresh runtime checks against the Docker artifact and isolated PostgreSQL restore.
- `technical-writing` and `unslop` shaped this report.

The throughput checkpoint was `n/a, read-only investigation`. Repository history does not prove that earlier implementation work followed Pstack. That missing historical evidence is not a code defect.

## Phase verification matrix

| Phase | Status | Evidence | Gaps |
| --- | --- | --- | --- |
| Phase 1 frontend | Partial pass | Thirty responsive route checks passed across 1440, 768, and 390 pixel viewports. Navigation, shell rendering, horizontal overflow, and axe checks passed. | The current `playwright.config.ts` runs only `tests/phase2/**/*.spec.ts`. It excludes the detailed workflows in `tests/frontend.spec.ts` and print/screenshot checks in `tests/screenshots.spec.ts`. |
| Phase 2 backend | Pass | Authentication, STAFF/ADMIN authorization, origin checks, CRUD validation, audit logging, SERIALIZABLE transactions, Argon2id, sessions, and database constraints have source and integration evidence. All 19 database tests passed. | No focused test covers malformed JSON, wrong content type, the 16 KB body limit, disabled-user sessions, or every dormant Phase 3 table constraint. |
| Phase 2.5 backup/security | Conditional pass | Eight backup/security tests passed. Fresh runtime verification passed HTTPS login, Secure/HttpOnly/SameSite cookies, exact-origin rejection, private app/database ports, encryption, integrity, and a real isolated PostgreSQL restore. | Google Drive, independent key escrow, owner admin commissioning, physical second-device CA trust, and a production recovery drill remain unverified. |
| Phase 2.6 integration | Pass | The Lease model remains the only Room/Tenant relation. Atomic tenant/lease writes, rollback, overlaps, concurrency, occupancy triggers, dropdown rules, profile links, history, and the Phase 3 payment placeholder have source and integration evidence. The addendum records two consecutive full browser passes on the same reused database. | HTTP handling for the losing concurrent request and simultaneous cross-room transfer races lack direct coverage. |

## Commands and results

| Check | Command | Result | Actual result |
| --- | --- | --- | --- |
| Git baseline | `git status --short --branch`; `git log -5 --oneline --decorate` | PASS | `main` matched `origin/main` at `4b4e7db`; the tree was clean before testing. |
| TypeScript | `npm run typecheck` | PASS | Exit 0. |
| ESLint | `npm run lint` | PASS | Exit 0 with zero warnings. |
| Formatting | `npm run format:check` | PASS | All configured files matched Prettier. |
| Unit tests | `npm test` | PASS | 28 of 28 passed in three files. |
| Backup/security unit tests | `npm run test:ops` | PASS | Eight of eight passed. |
| Host production build | `npm run build` | BLOCKED | Turbopack failed while creating a process that binds a port with OS error 1. A second approved run produced the same environment error. |
| Docker production build | `docker compose --env-file .env.test -p taky-pstack-audit -f docker-compose.yml -f docker-compose.test.yml build app` | PASS | Prisma Client generated. Next.js compiled in 9.5 seconds, ran TypeScript, generated seven static pages, and exported `taky-pstack-audit-app:latest`. |
| PostgreSQL integration | `docker exec taky-phase26-test-app-1 npm run test:integration` | PASS | 19 of 19 passed. The suite ran sequentially against `taky_phase2_test`. |
| Initial browser regression | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3400 SCREENSHOT_DIR=tmp/pstack-audit/screenshots npm run test:e2e` | FAIL | 39 passed and two failed. Room 102 was already occupied by an ACTIVE Demo lease, so one fixed-room selector timed out and one fixture creation returned 409. The addendum records the fix and final passing reruns. |
| Migration status | `docker exec taky-phase26-test-app-1 npx prisma migrate status` | PASS | Five migrations found. The database schema was up to date. |
| Schema drift | `docker exec taky-phase26-test-app-1 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | PASS | No difference detected. Exit 0. |
| HTTPS, auth, ports, and restore | `node scripts/verify-phase26.mjs` with the isolated Docker environment | PASS | Five of five checks passed, including encrypted backup and automatic isolated PostgreSQL restore. |
| Real Google Drive | Not run | NOT RUN | OAuth and owner access are not available in this audit. |
| Physical LAN device | Not run | NOT RUN | CA trust and login on a second device require owner commissioning. |
| Production restore | Not run | NOT RUN | The audit restriction correctly excludes destructive production restore and rollback. |

## Findings

### Critical

None.

### High

No confirmed code defect. The following operational gates remain High before live financial use.

- Upload an encrypted backup to the real owner-controlled Google Drive and restore the downloaded ciphertext.
- Store a matching encryption key outside the Mac and prove that the owner can recover it.

### Medium

- **Resolved in the addendum.** The initial browser suite was not isolated from prior Demo data. It selected room 102 by label and assumed that the room was free. The final tests select available rooms from the API and passed twice on the same reused database.
- **Owner and device commissioning is incomplete.** Create the normal owner admin, trust the Caddy CA on the intended device, and verify authorized and unauthorized access over the intended LAN address.
- **Production recovery remains unproved.** The database and attachment restore cannot be atomic together. A controlled drill and rollback procedure remain owner operations.
- **Host reliability needs monitoring.** Confirm Docker startup after reboot, Mac sleep behavior, free disk alerts, and the earlier unexplained Docker replacement stall before live use.

### Low

- `playwright.config.ts:6` excludes the detailed Phase 1 workflows in `tests/frontend.spec.ts` and the print/screenshot suite from the default E2E command.
- `scripts/verify-phase25.mjs:527-574` removes its Demo tenant, lease, and attachment only on the success path. An interrupted isolated verification can leave Demo fixtures behind.
- The API has no focused tests for malformed JSON, wrong content type, the 16 KB body limit, disabled-user sessions, or global throttle window edges.
- Phase 2.6 lacks direct HTTP and UI assertions for the losing concurrent assignment, simultaneous cross-room transfer races, and invalid-date UI feedback.
- A real Sunday 02:00 scheduler occurrence, hostile archive resource exhaustion, and a third-party dependency security scan were not tested.

## Relevant source references

- `src/app/(erp)/layout.tsx:7-17` protects ERP pages and supplies the shared shell.
- `src/components/app-shell.tsx:17-20` distinguishes live and Demo screens.
- `src/server/auth.ts:8-139` owns Argon2id, session hashing, throttling, bootstrap, login, and logout.
- `src/server/http.ts:8-91` owns origin, body, authentication error, and HTTP status handling.
- `src/server/services.ts:28-192` owns SERIALIZABLE tenant and lease transactions.
- `src/server/lease-service.ts:5-73` locks rooms and enforces assignment rules.
- `src/server/repository.ts:5-82` owns live Room/Tenant/Lease reads.
- `prisma/schema.prisma:92-149` defines Room, Tenant, and Lease relationships and indexes.
- `prisma/migrations/202610160002_constraints/migration.sql:1-16` adds active-room and financial constraints.
- `prisma/migrations/202610170003_occupancy_integrity/migration.sql:1-28` adds occupancy consistency triggers.
- `operations/archive.mjs:37-198` owns AES-256-GCM and archive integrity checks.
- `operations/database.mjs:26-196` owns snapshot and isolated restore safety.
- `operations/backup.mjs:110-329` owns verification, off-device upload, and retention.
- `docker-compose.https.yml:1-30` removes the direct app port and publishes private HTTPS.
- `tests/integration/foundation.test.ts:34-262` covers the Phase 2 foundation.
- `tests/integration/room-assignment.test.ts:64-353` covers Phase 2.6 transactions and concurrency.
- `tests/phase2/app.spec.ts:19-333` covers auth, CRUD, accessibility, and responsive smoke tests.
- `tests/phase2/phase26.spec.ts:48-301` covers dropdowns, linked profiles, transfers, and payment placeholders.

## Phase 2.5 commissioning tasks

Complete these tasks before live financial processing.

1. Authorize the real Google Drive destination. Upload an encrypted archive. Download it and restore it into an isolated PostgreSQL instance.
2. Escrow the exact 32-byte encryption key outside the Mac. Prove recovery by decrypting and restoring a downloaded archive.
3. Create the owner admin in the normal deployment. Do not reuse a Demo account.
4. Trust the internal CA on each intended device. Test login and access over the reserved private LAN address.
5. Confirm firewall rules, the absence of router port forwarding, Docker startup after reboot, sleep behavior, and free-disk monitoring.
6. Plan and observe a controlled production recovery drill with a verified rollback backup. Account for the non-atomic database and attachment restore boundary.

## Phase 3 recommendation

**CONDITIONAL GO** for Phase 3 code development only. Use a fresh isolated test project and make the browser suite provision or reserve its own rooms before relying on it as a release gate.

**NO-GO** for live Phase 3 financial use. Complete the High Phase 2.5 Google Drive and key-escrow gates first. Then complete owner, LAN-device, and recovery commissioning. Phase 3 must also define invoice immutability, decimal calculation rules, idempotent payment posting, allocation limits, reversals, and audit requirements before accepting real money records.

## Verification addendum: browser test isolation fix

Verification date: 17 October 2026.

The Medium browser test-isolation finding is resolved for Room, Tenant, and Lease fixtures. The tests no longer assume that rooms 102, 103, 201, or 301 are free. They now parse the live test API response with the existing Zod schemas and select rooms that have operational status `AVAILABLE` and no ACTIVE lease.

The fix changes test code only:

- `tests/phase2/fixtures.ts` owns typed room, tenant, and lease collection reads. It refuses to manage fixtures unless `POSTGRES_DB=taky_phase2_test` and the browser target is loopback.
- `tests/phase2/app.spec.ts` selects a real available room for the DRAFT lease flow. Its `finally` block deletes only the generated DRAFT lease and Demo tenant by their exact identifiers.
- `tests/phase2/phase26.spec.ts` computes each floor's expected options from PostgreSQL records. It selects available rooms on different floors for transfers. It ends only ACTIVE leases owned by the generated tenant, restores the reserved room's prior status, and uses ADMIN only for the cleanup that STAFF cannot authorize.

Application source, migrations, UX/UI, and production data did not change.

Phase 2.6 cleanup releases fixture rooms by ending only the exact generated tenant's ACTIVE leases. It intentionally retains the resulting historical Demo tenant, lease, and audit rows because the application forbids deleting non-DRAFT lease history. Use a disposable isolated Compose volume when a test run must leave no historical residue.

### Addendum verification results

| Check | Command | Result | Actual result |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` | PASS | Exit 0 after the final fixture changes. |
| ESLint | `npm run lint` | PASS | Exit 0 with zero warnings. |
| Formatting | `npm run format:check` | PASS | All configured files matched Prettier. |
| Patch whitespace | `git diff --check` | PASS | No whitespace errors. |
| Unit tests | `npm test` | PASS | 28 of 28 passed in three files. |
| PostgreSQL integration | `docker exec taky-phase26-test-app-1 npm run test:integration` | PASS | 19 of 19 passed in two files. |
| Targeted browser regression | Five affected Room/Tenant/Lease tests against `http://127.0.0.1:3400` | PASS | Five of five passed after dynamic room selection. |
| Full browser regression | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3400 SCREENSHOT_DIR=tmp/pstack-isolation/final-run-1 npm run test:e2e` | PASS | 14 of 14 tests passed in 54.6 seconds. Three responsive tests retain all 30 route and viewport combinations as named `test.step` checks. |
| Immediate second full run | The same command with `SCREENSHOT_DIR=tmp/pstack-isolation/final-run-2` and no database reset | PASS | 14 of 14 passed in 53.7 seconds on the same reused database. |

One intermediate full run passed 40 of 41 tests. The new cleanup initially attempted to delete a tenant with its STAFF session and correctly received HTTP 403. The final fix authenticates as ADMIN only after the STAFF behavior assertions.

An intermediate immediate rerun passed seven tests and then produced 34 HTTP 429 failures. `src/server/auth.ts:80` limits the global login key to 100 attempts per 15-minute window. The fix groups the 30 responsive route and viewport checks into three tests with named steps, which reduces logins without reducing coverage or changing the application rate limit. After clearing only the exhausted throttle row in `taky_phase2_test`, two consecutive full runs passed.

The recommendation remains **CONDITIONAL GO** for isolated Phase 3 development and **NO-GO** for live financial use until the Phase 2.5 commissioning gates are complete.
