# Stage 3B test plan

## Isolation

Database and browser tests must use `taky_phase2_test` on loopback through a dedicated Compose project. Do not run them against the normal deployment database. Apply migrations with `prisma migrate deploy`. Never reset or delete the normal volume.

## Unit tests

- Parse and preserve zero to three decimal places.
- Reject negative, malformed, exponent, comma, excess-scale, and oversized readings.
- Calculate normal consumption exactly.
- Reject decreasing values and a normal reading without a confirmed predecessor.
- Keep old-meter usage separate from a new meter's opening value.

## PostgreSQL integration tests

- Apply the additive migration over the Stage 3A schema and confirm no drift.
- Return 15 rooms and 30 expected slots from the overview.
- Register a physical meter only as ADMIN and preserve its explicit opening value.
- Upsert a draft, confirm it once, and return the same confirmed result on retry.
- Reject duplicate canonical readings, dates outside the period or lifecycle, and writes to a closed period.
- Confirm only one result under concurrent submissions.
- Roll back every domain record when a transaction step fails.
- Reject STAFF correction, registration, and replacement.
- Append correction and replacement provenance and one atomic audit row.
- Correct a non-latest reading and recalculate the next reading without violating confirmed-history guards.
- Reject direct update or deletion of correction and replacement history.

## Browser tests

- At 390 px, select a period and floor, open a room, enter both readings, save a draft, and confirm it.
- Default both utility dates to today, then save water and electricity with different historical dates and verify both persist after reload.
- Show exact previous values and calculated consumption without silent rounding.
- Show validation for decreasing or malformed values.
- Filter to five rooms on each floor and retain a usable no-horizontal-scroll layout.
- Open room history and show operator and timestamps.
- As ADMIN, register, correct, and replace a meter with a required reason.
- As STAFF, hide ADMIN controls and verify the server also returns 403.
- Run an accessibility scan over the main workflow and dialogs.

## Regression and release gates

Run `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:ops`, Prisma validation/generation, migration status, schema drift, the Docker production build, and existing Phase 1/2/2.6 browser tests. Record the exact command and result in `PHASE_3B_IMPLEMENTATION_REPORT.md`. A check is not PASS unless it ran.
