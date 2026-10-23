# First migration fixture failure

This note is reconstructed from recorded tool output, not a preserved raw log. The original runner overwrote its phase log on retry; immutable per-attempt log creation is now enforced by qa-runner.cjs using exclusive creation and a UUID. The old database is retained.

Attempt1 used synthetic database taky_payment_test_2b5214bd52. It exited1 before the payment migration because legacy Invoice fixture INSERT omitted required dueDate. PostgreSQL code23502 and message `null value in column "dueDate" of relation "Invoice" violates not-null constraint` were reported at tests/integration/payments-migration-rehearsal.ts:95. The developer inspected the old foundation schema and added explicit dueDate to the fixture. No production payment logic changed for this correction.

Attempt2 used new pristine database taky_payment_test_2b5214bd52_r2. It passed and preserved3payments,3allocations,7constraints,7indexes and original3status values. See qa-rehearsal-attempt2-pass.log and legacy-migration-rehearsal.json. Neither failed nor passing database was reset or dropped.
