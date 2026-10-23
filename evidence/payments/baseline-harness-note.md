# Isolated baseline regression harness

Temporary files: `/private/tmp/taky-payment-qa2/runner.cjs` and `baseline-setup.cjs`.

The runner preserves payment rehearsal and integration commands and adds:

- `baseline-setup`: requires exact `taky_phase2_test`, configured endpoint and attested database role, zero public tables, and private synthetic session/test credentials. Runs Prisma migrate deploy, room seed, and synthetic test-account setup sequentially; any failed stage stops setup. No reset command exists.
- `baseline-integration`: runs the existing integration configuration with `--exclude tests/integration/payments.test.ts`. Vitest 4.1.12 local CLI help confirms this flag. The separate payment suite guard is unchanged.

All modes retain exact database/role preflight and now also check host/port. Each attempt, including rejected preflight, writes a timestamp/UUID evidence file using exclusive creation. Stable filenames are convenience copies. URLs and private password/secret values are sanitized before recording. Setup commands have two-minute timeouts; suites have a ten-minute timeout. Connection and queries have ten-second limits.

Only syntax checks were executed by the harness author: `node --check` passed for both files. No database, container, application, or test execution was performed. Main owns private environment values, identity attestation, database creation, code review, and execution. Syntax checks do not establish successful migrations or regression tests.

Pstack guidance read: Codex adapter, poteto-mode entry point, and prove-it-works guidance. This scoped artifact is handed to Main for independent review and real execution evidence.
