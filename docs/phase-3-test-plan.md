# Phase 3 test plan

## Isolation

Database tests may run only when `DATABASE_URL` ends in `/taky_phase2_test`. Use the existing isolated Compose project and never point tests or migration-development commands at the normal database. Do not reset production or normal volumes.

## Stage 3A suites

Focused unit tests cover 28/29/30/31-day full months, inclusive move-in proration, one final `ROUND_HALF_UP`, invalid/no-overlap dates, exact usage charges, negative usage, and excess input scale.

PostgreSQL integration tests cover migration presence, calendar-month checks, concurrent duplicate periods, ADMIN/STAFF permissions, deterministic close retries, close-state immutability, exact fixed-string rate output, effective-date boundary lookup without a future fallback, uniqueness, append-only rate triggers, atomic audit creation, and pre-database rate-scale rejection.

## Verification sequence

1. `npx vitest run tests/finance-foundation.test.ts`
2. `npx prisma format && npx prisma validate && npm run db:generate`
3. Apply migrations only to the isolated test project with its documented Compose command.
4. `npm run test:integration`
5. `npm run typecheck`
6. `npm run lint`
7. `npm run format:check`
8. `npm test`
9. Docker production build, migration status, schema drift, and isolated backup/restore verification.

Record exact commands, exit status, and counts in the implementation report. A skipped or environment-blocked command is not a pass.
