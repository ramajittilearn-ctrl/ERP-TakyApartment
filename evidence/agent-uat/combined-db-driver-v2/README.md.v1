# Combined integration QA driver

Main reviews and executes this temporary driver. The author executed only syntax checking, local Vitest help, and `validate-plan`; no database connection, mutation, container command, application edit, or commit was performed.

```
node /private/tmp/taky-combined-db-qa/runner.cjs validate-plan
node /private/tmp/taky-combined-db-qa/runner.cjs preflight
node /private/tmp/taky-combined-db-qa/runner.cjs setup
node /private/tmp/taky-combined-db-qa/runner.cjs integration
```

The runner is pinned to integrated worktree `/private/tmp/taky-development` and integration plan `4896c4d1e00a0ca6939fd8bc`. It requires exact private env fields, owner-only regular private files, exact Compose configuration, matching public identity, role `int_4896c4d1e00a0ca6939fd8bc`, database `taky_phase2_test`, endpoint `127.0.0.1:55451`, and subnet `10.253.244.0/28`. The safe `validate-plan` mode checks those files without connecting to PostgreSQL. Other modes then attest actual database/current role over that exact connection before any child command runs.

`setup` refuses any public tables and executes migrate deploy, synthetic room seed, and synthetic user setup sequentially with 120-second stage timeouts. Failure stops subsequent stages; no reset or retry is supplied. Do not rerun setup against partially initialized state.

`integration` runs the current integration config with two additional exclusions: payments.test.ts and payment-routes.test.ts. Their dedicated database-prefix guards remain untouched. The seven baseline files selected by the config cover auth throttle, billing preview, finance foundation, foundation, invoices, meter readings, and room assignments. Installed Vitest 4.1.12 local CLI help confirms `--exclude <glob>` support. Suite timeout is 600 seconds.

Child environment uses an explicit allowlist of runtime path/home/temp/language plus the validated private plan. Ambient DATABASE_URL, PG variables, NODE_OPTIONS, Prisma overrides, and dotenv overrides are not inherited. The dotenv config path is `/dev/null`. Passwords and secrets are never copied into the repository; log output redacts all private credential values and PostgreSQL URLs.

Every attempted mode writes a sanitized timestamp/UUID log under `evidence/agent-uat` with exclusive creation. No convenience alias overwrites earlier evidence. An exclusive temporary lock prevents concurrent operations through this driver; a lock left by abnormal termination requires Main to inspect active processes before deciding how to recover.

Verified: `node --check` and safe `validate-plan` passed. Database/test outcomes remain unverified until Main executes them. Pstack adapter and prove-it-works guidance inform this separation of artifact checks from real execution evidence.
