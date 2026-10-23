# Receipt PDF database QA runner

This driver runs only `tests/integration/receipt-pdf.test.ts` from the frozen `/private/tmp/taky-receipt-pdf` worktree. It never sets up a database, deploys migrations, resets data, or runs Docker.

The target is pinned to the existing synthetic QA2 database `taky_payment_test_2b5214bd52_routes1`, role `taky_qa_2b5214bd52`, project `taky-payment-qa2-isolated`, and endpoint `127.0.0.1:55489`. It reads only the specified QA2 `identity.json` and owner-only `private.env`. Metadata and URL must match the pins. A PostgreSQL query must verify the actual database and role before Vitest starts.

Run `node /private/tmp/taky-receipt-qa/runner.cjs preflight` for that read-only identity check. Run `node /private/tmp/taky-receipt-qa/runner.cjs integration` to verify identity and execute the receipt PDF integration file. The test creates fictional records and retains them. The integration run can take up to ten minutes.

The child receives an explicit environment allowlist, the pinned private database URL, and a private session secret. An existing synthetic secret is reused or a fresh random secret is generated in memory. The child does not inherit ambient PostgreSQL variables, `NODE_OPTIONS`, or application credentials. `DOTENV_CONFIG_PATH=/dev/null` prevents dotenv's configured path from falling back to a project environment file. The selected Vitest configuration and database module do not load dotenv.

Each attempt writes a new exclusive log under `evidence/receipt-pdf/database-qa-TIMESTAMP-UUID.log` in the receipt worktree. Credentials and database URLs are redacted. No previous log is overwritten. The integration test also writes its PDF and JSON fixtures to `evidence/receipt-pdf/database-artifacts/`; those fixture paths are managed by the test and can be replaced on a later run.

Preparation validation is limited to `node --check`. The Main Agent must review the driver and run the actual database test. Syntax validation does not establish that database tests passed.
