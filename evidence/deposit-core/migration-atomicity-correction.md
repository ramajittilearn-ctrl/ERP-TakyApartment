# Deposit migration syntax and atomicity correction

Main actual core1 migration attempt failed with PostgreSQL42601 while compiling deposit_version_check. The IF expression combined arithmetic with an unparenthesized CASE ending immediately before THEN. That conditional now parenthesizes the complete arithmetic expression and its CASE operand explicitly. The remaining CASE uses occur in assignments or SQL aggregate expressions and have no adjacent PL/pgSQL IF/THEN delimiter.

The entire candidate003 migration now runs as one DO $deposit_migration$ statement, including the schema-generated DDL prefix and every function, trigger, index and constraint. Inner stored-function dollar delimiters remain distinct. There is no outer BEGIN/COMMIT transaction and no exception handler. A failure propagates to Prisma and PostgreSQL rolls back the one statement, preventing partial installation. No concurrent-index statement occurs.

The previous partially installed core1 target and its failed migration ledger must remain untouched. Main will use a fresh core2 target for the corrected unpublished candidate and run an intentional late-failure probe to verify no deposit objects survive and old rows/guards remain unchanged. Existing migrations001 through016 and existing financial values are not repaired or modified.

Static source checks passed. PostgreSQL installation and atomicity behavior have not been executed by this agent; Main owns those actual gates.
