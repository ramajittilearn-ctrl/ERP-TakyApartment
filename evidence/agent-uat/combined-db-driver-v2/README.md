# Combined integration QA driver

Main reviews and executes this temporary driver. The author executed only syntax checking, local Vitest help, and `validate-plan`; no database connection, mutation, container command, application edit, or commit was performed.

```
node /private/tmp/taky-combined-db-qa/runner.cjs validate-plan
node /private/tmp/taky-combined-db-qa/runner.cjs preflight
node /private/tmp/taky-combined-db-qa/runner.cjs setup
node /private/tmp/taky-combined-db-qa/runner.cjs integration
```

The v2 runner is pinned to integrated worktree `/private/tmp/taky-development` and integration plan `d7fd72f9c44a489094ca94e7`, the reviewed 39-model expense backend baseline. It requires exact private env fields, owner-only regular private files owned by the current user, exact Compose configuration, matching public identity, role `int_d7fd72f9c44a489094ca94e7`, database `taky_phase2_test`, endpoint `127.0.0.1:55451`, and subnet `10.253.244.0/28`. The safe `validate-plan` mode checks those files without connecting to PostgreSQL. Other modes then attest actual database/current role over that exact connection before any child command runs. The previous helper and README were archived exclusively as `runner.cjs.v1` and `README.md.v1` before changing the pins. Previous logs and database volumes remain intact.

`setup` refuses any public tables and executes migrate deploy, synthetic room seed, and synthetic user setup sequentially with 120-second stage timeouts. Failure stops subsequent stages; no reset or retry is supplied. Do not rerun setup against partially initialized state.

`integration` passes exactly these seven files as explicit Vitest filters and records their names in its evidence log:

- `tests/integration/auth-throttle.test.ts`
- `tests/integration/billing-preview.test.ts`
- `tests/integration/finance-foundation.test.ts`
- `tests/integration/foundation.test.ts`
- `tests/integration/invoices.test.ts`
- `tests/integration/meter-reading.test.ts`
- `tests/integration/room-assignment.test.ts`

It also explicitly excludes `payments.test.ts`, `payment-routes.test.ts`, `receipt-pdf.test.ts`, and `expenses.test.ts`, all under `tests/integration/`. Those suites have dedicated prefix guards and separate actual proofs. Their guards are unchanged. This combined run covers baseline regression against the expanded schema, not a repeat of the four dedicated suites or migration rehearsals. Installed Vitest 4.1.12 supports explicit filename filters and `--exclude <glob>`. Suite timeout is 600 seconds.

Child environment uses an explicit allowlist of runtime path/home/temp/language plus the validated private plan. Ambient DATABASE_URL, PG variables, NODE_OPTIONS, Prisma overrides, and dotenv overrides are not inherited. The dotenv config path is `/dev/null`. Passwords and secrets are never copied into the repository; log output redacts all private credential values and PostgreSQL URLs.

Every attempted mode writes a sanitized timestamp/UUID log under `evidence/agent-uat` with exclusive creation. No convenience alias overwrites earlier evidence. An exclusive temporary lock prevents concurrent operations through this driver; a lock left by abnormal termination requires Main to inspect active processes before deciding how to recover.

Verified: `node --check` and safe `validate-plan` passed. Database/test outcomes remain unverified until Main executes them. Pstack adapter and prove-it-works guidance inform this separation of artifact checks from real execution evidence.
