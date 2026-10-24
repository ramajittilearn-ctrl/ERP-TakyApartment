# Run the frozen expense export acceptance suite

Main owns execution. The implementation agent read the helper but did not execute database commands. Main has already adapted the accepted helper at `/private/tmp/taky-expense-export-qa/runner.cjs`; no further adaptation or relaxed guard is necessary.

The helper pins these values:

- Source and working directory: `/private/tmp/taky-expense-ui`.
- Test file: `tests/integration/expense-export.test.ts` through the installed `vitest.integration.config.ts`.
- Existing isolated target: `taky_expense_test_2b5214bd52_integration1`.
- Loopback host/port and role: `127.0.0.1:55489`, `taky_qa_2b5214bd52`.
- Read-only plan identity source: the existing private QA2 plan. Credentials stay private and never appear in this instruction.
- Only supported modes: `validate-plan`, `preflight`, `integration`. It does not expose setup, database creation, reset or drop.
- Integration precondition: exactly fifteen applied migrations, including `202610240001_phase4_expenses`, and matching actual database/role attestation.
- Child environment: the existing allowlist with an explicit target URL and synthetic session secret. It excludes ambient database options and uses `/dev/null` for dotenv configuration.

To run the suite, Main serializes database users first, verifies that the implementation owner has frozen export source and the PG test, and runs these commands in order:

```sh
node /private/tmp/taky-expense-export-qa/runner.cjs validate-plan
node /private/tmp/taky-expense-export-qa/runner.cjs preflight
node /private/tmp/taky-expense-export-qa/runner.cjs integration
```

Inspect the immutable `database-qa-<attempt>.log` returned by each invocation under `evidence/expense-ui/`. Require the actual child exit code and QA outcome to be zero, all five cases to pass, and no skipped cases. A plan/preflight pass establishes no functional acceptance. Do not bypass an identity, migration, lock or private-file failure; reconcile the environment first.

The first actual integration attempt failed four fixture-dependent cases because the fixture's prefixed full UUID exceeded Property.code's 32-character limit. The fifth authorization/query case passed. Keep that failed log unchanged. The correction uses `EX-` followed by 29 hexadecimal UUID characters, exactly 32 characters with 116 bits of random identity. The browser fixture uses the same bound with `EU-`. No schema or validation rule changed.

The suite uses isolated synthetic users/properties and leaves test records in this owned QA database. The export-bound fixture inserts synthetic managed PENDING entries with all integrity triggers enabled to test the volume limit. It does not replace service lifecycle tests. The concurrent test checks consistency while real approval races export; it does not force a pause between SELECT statements. Main and the independent reviewer reconcile these limits with the source's explicit RepeatableRead transaction and additional evidence before acceptance.
