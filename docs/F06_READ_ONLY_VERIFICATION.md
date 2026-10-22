# F-06 operational database verification

Status: OPEN. This procedure was prepared during remediation and was not run against an operational target. Synthetic test results do not close F-06.

## Preconditions

The Owner identifies the intended deployment, database host/port/name, current application commit and migration state. An operator verifies that identity through an approved connection path. Use a dedicated SELECT-only role and a private service file or secret manager. Do not put a connection URI or password in command logs. Do not reuse remediation credentials.

Record the approved target identifier, operator, timestamp, application commit, schema version and a hash of the redacted inventory. Keep tenant names, contact details, passwords, session tokens and payment attachments outside the repository and reports. Obtain a consistent approved snapshot or a repeatable-read inventory during an agreed observation window.

## Procedure

1. Connect with the read-only role and open a repeatable-read, read-only transaction. Set a statement timeout. Confirm `transaction_read_only=on`, `current_database()`, `current_user`, `inet_server_addr()` and `inet_server_port()` against the Owner-approved identity. Abort on mismatch.
2. List schema tables and columns and read applied migration names/checksums. Compare with the deployment's committed migrations. If the schema predates the audited schema, adapt SELECT statements to that catalog. Do not run migrations or infer columns exist.
3. Inventory invoice counts by status, period and managed/legacy classification. Identify missing billing-period links, frozen leases, immutable snapshots, fingerprints, issued timestamps, due dates and document numbers. Review duplicate non-void lease/month slots and number/date formats.
4. Inventory meter counts by status/type, missing billing-period/reading-date/predecessor links, duplicate meter/month slots, replacements and corrections. Identify whether legacy cumulative readings or consumption values have been interpreted as authoritative inputs.
5. Inventory payments and allocations by status, date and method. Reconcile allocation totals to payments and invoice final totals with the approved lifecycle rules. Identify orphan or legacy references and outstanding balances. Display line items are reference values and may differ from the final rounded amount. Do not invent invoice final totals by summing display lines.
6. Roll back the read-only transaction. Record totals and sanitized exceptions. Store any row-level mapping proposal in an access-controlled location, independently reviewed by finance and engineering.

Illustrative SELECT-only inventory for the current schema is in `F06_inventory_read_only.sql`. Its transaction must be stopped after the identity result if the approved identity differs. It is not an automated authorization or migration script.

## Closure evidence

F-06 closes only with the approved actual target identity and application/schema versions, read-only query transcript and exit code, consistent inventory totals, explicit exceptions, independently reviewed invoice/meter/payment lineage, and Owner approval of every required mapping. Record any unresolved discrepancy as a blocker. Actual mapping or backfill needs a separate approved plan, backup, rehearsal, rollback strategy and authorization. This remediation authorizes no operational data change.
