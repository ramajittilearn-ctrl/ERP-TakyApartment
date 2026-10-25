# FNR-01 historical allocation coverage correction

The independent reviewer identified a missing feasible historical path. Although managed insertion guards reject a newly fabricated legacy allocation after lifecycle migration, a numeric NaN allocation can originate before those guards exist. The first rehearsal version covered only the later managed path and did not exercise the migration's historical allocation prerequisite failure.

The follow-up adds a fourth, separate pristine database, `taky_payment_test_2b5214bd52_finite_alloc_blocker1`. Its `alloc-blocker` scenario inserts the NaN allocation at migration ten through the actual historical constraints, advances unchanged to migration fifteen, and requires migration sixteen to fail with the fixed PaymentAllocation prerequisite error and SQLSTATE 23514. It verifies original payment/allocation JSON values and timestamps, all trigger definitions, absence of managed Payment NaN, absence of both new constraints, and no successfully applied migration-sixteen ledger entry.

The migration and approved storage policy are unchanged. No prior database is reset or repaired and no trigger is disabled. Guarded helper v2 adds only the exact new creation/execution modes with the same source/target attestation, permissions, environment allowlist, shared lock, pristine requirement, and immutable redacted logs. Helper v1 remains archived and versioned.

Syntax checks, TypeScript transpilation diagnostics, formatting, scoped diff checks, and local validate-plan passed. No database, Docker, build, browser, or repeated full unit suite ran for this correction. Actual historical allocation blocker acceptance remains pending Main execution and independent re-review.
