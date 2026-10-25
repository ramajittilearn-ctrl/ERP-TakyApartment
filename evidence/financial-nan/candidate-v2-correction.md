# Candidate v2 atomic prerequisite reporting

Main's actual candidate-v1 integration passed nine cases and its preservation rehearsal passed. Both blocker runs failed their expected-message assertions because Prisma surfaced the explicit transaction's aborted-state error instead of the original prerequisite SQLSTATE. Those runs remain failed verification attempts. Their databases and logs are retained and are not reset, repaired, migration-resolved, or reused.

Independent review approved placing the two prerequisite checks and both validated ALTER statements inside a single DO statement, with no outer BEGIN/COMMIT and no exception handler. The SQL statement remains atomic and now allows the original failure to propagate to Prisma. Financial policy, row classification, constraint predicates and names, and the fifteen prior applied migrations remain unchanged. Candidate sixteen has not been integrated or published. Its earlier SQL is archived in `candidate-v1/migration.sql` with SHA-256 `9cf72f8a4fbf372b2e6e692d12553e4d3a7092248ba1bd14f69b50bd11b798e3`.

Helper v3 and the rehearsal now target four separate fresh suffix-2 databases. Helper v1/v2 and prior evidence remain intact. The fresh runs must independently establish integration, legacy preservation, original managed Payment prerequisite 23514, and original historical PaymentAllocation prerequisite 23514. Successful old integration/preservation results are historical evidence, not replacements for candidate-v2 verification.

The optional forced second-ALTER collision probe was omitted at Main's clarification. A savepoint rollback would itself erase prior DDL and would not independently prove statement atomicity. The four accepted scenarios remain the required runtime gates. No additional database, trigger bypass, silent repair, or broad change was introduced.

Focused syntax, formatting, TypeScript transpilation diagnostics and local plan validation passed. No database/Docker/build/browser execution or repeated full unit suite occurred in this correction. Actual candidate-v2 verification remains pending Main execution and independent review.
