# Cross-stream bank snapshot correction

Main actual Core3 matrix passed44of46 cases. Payment-first service and direct-SQL-first bank races each reported both operations committed, violating their unchanged one-active-claim assertions. The failed target remains preserved; no financial row is repaired.

Source inspection identified mixed isolation. Payment and supported direct SQL use READ COMMITTED. Deposit command SERIALIZABLE establishes its transaction snapshot during source admission/authorization before waiting for the bank gate. A Payment writer can commit while the queued deposit retains its older snapshot. Serializable guarantees for a set of Serializable transactions do not turn a READ COMMITTED writer into part of that set. The gate serialized execution but did not refresh the waiting transaction snapshot.

Root independently accepted the narrow correction: deposit command transactions now use READ COMMITTED, matching the existing Payment writer, so queries after obtaining bank admission see the committed winner. Mandatory source-before-bank admission, account versions, actor-command idempotency, SQL checks and the same bounded retry allowance remain. Read-only ledger/document transactions remain REPEATABLE READ. No SQL, business rule, test timeout, retry count or one-claim assertion changed.

Primary semantics reference: PostgreSQL17 transaction isolation documentation, https://www.postgresql.org/docs/17/transaction-iso.html . The documented command snapshots and transaction-fixed snapshots support this source explanation; actual controlled rerun is required before accepting the correction.

Four additional same-bank cross-lease cases now exercise both service and direct-SQL directions. The normal acceptance matrix is50 cases across the three existing files. Local type/lint proof is separate from Main actual fresh-fixture database proof. No database operation ran in this implementation agent.
