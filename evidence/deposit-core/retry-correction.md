# Deposit serialization retry correction

Main actual Core2 integration passed six cases and failed its concurrency/idempotency case with PostgreSQL40001 during account locking. The previous handler inspected only Prisma P2034 or P2010 with meta.code.

Main then ran the deterministic independent-transaction probe. It reported a genuine Prisma known-request error with code P2010, absent direct meta.code, and meta.driverAdapterError.name DriverAdapterError, cause.kind TransactionWriteConflict, cause.originalCode40001. The diagnostic returns only those allowlisted fields and class membership, never message, query, stack, credentials or request values.

The new helper parses exactly that observed nested shape while retaining existing P2034 and direct40001/40P01 handling. Other kinds, business/constraint/timeout SQL states, textual error messages and objects that are not Prisma known-request errors do not trigger retry. The existing attempt<2 bound and transaction timeout are unchanged. Every retry starts a new transaction under the same original command body/key; no financial error is swallowed and no timeout or attempt allowance increased.

Fresh local verification passed: six focused tests in two files, full typecheck, scoped lint and source whitespace. Earlier failed probe typing-check evidence is retained separately. Actual full financial concurrency acceptance remains Main-owned. Payment and Expense currently use the same direct-meta-only pattern at service lines161-163 and186-188 respectively; this implementation does not alter them without a separate scoped Main decision.
