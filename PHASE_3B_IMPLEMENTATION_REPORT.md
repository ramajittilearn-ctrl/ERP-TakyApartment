# Stage 3B implementation report

## Outcome

Stage 3B adds an operational water and electricity meter workflow for all 15 rooms. It remains separate from invoice generation, payments, receipts, deposits, and every Stage 3C concern.

The implementation runs on the dedicated `phase-3b-meter-reading` branch based on verified Stage 3A commit `027be75`.

## Implemented functionality

- The `/meters/` Thai-first screen shows all 15 rooms and 30 expected utility slots, period and floor filters, completion counts, previous confirmed values, current values, consumption, drafts, and confirmations.
- Water and electricity have independent actual reading dates. Each input defaults to today's Bangkok date. The UI caps manual dates at today and shows the stored date in the entry screen and history.
- ADMIN can register an initial physical meter with an explicit opening value. The system never invents a zero baseline.
- ADMIN can correct confirmed readings with a mandatory reason. The reading keeps its original `readingDate`; correction history records that date separately from the system `createdAt` timestamp.
- ADMIN can replace a meter. The transaction records the final old-meter value and the opening new-meter value without subtracting across identities.
- STAFF can view, save drafts, and confirm ordinary readings. STAFF cannot register, correct, or replace meters.

## Database migration

Migration `202610180002_phase3b_meter_reading` is additive. It adds meter lifecycle dates, reading status and type enums, canonical `BillingPeriod` linkage, actual reading dates, exact consumption, confirmation provenance, predecessor linkage, correction history, and replacement history.

PostgreSQL enforces one active meter for each room and utility kind, one reading for each meter and billing period, nonnegative values and consumption, workflow field consistency, immutable correction/replacement rows, and guarded confirmed readings. Existing meter rows remain valid where truthful provenance cannot be reconstructed.

Physical readings use `DECIMAL(14,3)`. Zod and the service reject excess precision before PostgreSQL can round it.

## API routes

| Route                                           | Purpose                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/v1/meter-readings/`                   | Period overview, completion totals, floor and room filters.                 |
| `POST /api/v1/meter-readings/drafts/`           | Create or update a draft with its actual reading date.                      |
| `POST /api/v1/meter-readings/{id}/confirm/`     | Confirm a draft idempotently.                                               |
| `GET /api/v1/meter-readings/history/`           | Read readings, dates, corrections, replacements, operators, and timestamps. |
| `POST /api/v1/meter-readings/{id}/corrections/` | ADMIN correction with immutable provenance.                                 |
| `POST /api/v1/meters/`                          | ADMIN initial meter registration and opening reading.                       |
| `POST /api/v1/meters/replacements/`             | ADMIN meter replacement.                                                    |

Mutations reuse session authentication, exact-origin validation, bounded JSON parsing, Zod validation, service authorization, database locks, transactions, and atomic `AuditLog` writes.

## Reading-date rules

- `readingDate` is a business date and remains separate from `createdAt`.
- Water and electricity in the same room and period may have different dates.
- Historical entry is allowed while the billing period is open and the date lies inside both the period and meter lifecycle.
- Dates after today's Bangkok calendar date fail before a database transaction starts.
- Previous and next confirmed readings for the same physical meter constrain both date order and value order.
- A correction changes only the value and derived consumption. It preserves the original reading date and adds immutable correction and audit records.

## Verification evidence

Verification ran on 18–19 October 2026 against the isolated `taky-phase3b-test` Compose project and `taky_phase2_test` database. The normal deployment database and volumes were not touched. One contaminated test-only volume was deleted and recreated; it contained generated fixtures only and is not recoverable or needed.

| Check                                                                     | Result                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit suite, `npm test`                                                    | PASS: 39 of 39 tests in five files.                                                                                                                                                                                                                 |
| PostgreSQL integration, `npm run test:integration` in the clean container | PASS: 33 of 33 tests in four files.                                                                                                                                                                                                                 |
| Focused 390 px meter-date browser workflow                                | PASS: separate water/electric dates persisted after reload with no horizontal overflow.                                                                                                                                                             |
| Full browser regression, `npx playwright test`                            | 14 of 15 passed in the combined run. The only failure was a 45-second timeout during Phase 2.6 fixture cleanup; its immediate focused rerun passed in 10.5 seconds. The combined suite remains recorded as 14/15, with separate focused PASS evidence for the timed-out scenario. |
| TypeScript, `npm run typecheck`                                           | PASS.                                                                                                                                                                                                                                               |
| ESLint, `npm run lint`                                                    | PASS with zero warnings.                                                                                                                                                                                                                            |
| Prettier, `npm run format:check`                                          | PASS.                                                                                                                                                                                                                                               |
| Prisma validation and generation                                          | PASS with Prisma 7.10.1.                                                                                                                                                                                                                            |
| Backup/security regression, `npm run test:ops`                            | PASS: 8 of 8 tests.                                                                                                                                                                                                                                 |
| Docker production compilation                                             | PASS: Next.js 16.4.1 compiled the Stage 3B page and seven meter routes.                                                                                                                                                                             |
| Migration status and schema drift                                         | PASS: seven migrations applied; database schema is up to date; no difference detected.                                                                                                                                                              |
| Diff hygiene, `git diff --check`                                          | PASS.                                                                                                                                                                                                                                               |

An earlier browser run exposed a refresh race that could overwrite the second utility date after saving the first. The final UI waits for the overview reload before showing success. The focused meter workflow passed against the rebuilt exact source. During the final full run, 14 tests passed and one existing Phase 2.6 scenario timed out during fixture cleanup. Its immediate focused rerun passed.

## Security and integrity findings

No Critical or High defect remains in the reviewed Stage 3B code. The service, not the UI, enforces ADMIN-only registration, correction, and replacement. Closed periods reject new readings and ordinary corrections. Future dates, property mismatches, lifecycle violations, duplicate period readings, decreasing values, and chronology violations fail without partial writes.

Concurrent confirmation originally returned a PostgreSQL serialization error to one caller. The final implementation uses a row lock at the database's normal transaction isolation for that single-record transition. Both concurrent callers now receive the same confirmed reading and only one confirmation audit record is written.

The application database role still owns the schema. An operator with owner credentials can bypass application policy. Existing database credential, HTTPS, backup custody, and host security requirements still apply.

## Known limits and owner decisions

- The existing meter precision is three decimal places. Supporting a different physical precision needs an owner-approved schema policy.
- Stage 3C must decide how replacement-period old-meter consumption enters invoice calculation. Stage 3B stores the necessary separate records only.
- Stage 3B does not decide whether meter completion is required before a billing period can close.
- Physical second-device commissioning and production recovery remain owner-operated gates.

## Recommendation

Stage 3B development recommendation: **GO**.

Production financial recommendation: **NO-GO**. Stage 3C billing and the later financial stages are intentionally not implemented.
