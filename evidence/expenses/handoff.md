# Expense backend handoff

Source worktree `/private/tmp/taky-expenses-development`, branch `codex/expense-domain`, based on main snapshot `c622374`. Source commits are `29de0ba`, managed-only NaN correction `0037511`, canonical note correction `c7b1a9a` and lint-equivalent text validation `ac2efd3`. Independent review and actual PostgreSQL execution remain open. This report is an implementer handoff, not approval.

The isolated worktree has a real APFS-cloned node_modules and its own generated 39-model Prisma client. No shared dependency symlink or original application checkout was modified. No database or Docker operation ran by this implementer.

## Main-owned PostgreSQL execution

Use an entirely new loopback synthetic database named `taky_expense_test_<unique suffix>` with the isolated generated QA role. Both drivers reject missing URLs, non-loopback hosts, URL query strings and other database names. The rehearsal additionally attests current_database and requires zero public tables before any migration. It never resets/drops a database or removes prior attempt evidence.

From this worktree, with the synthetic connection supplied privately by Main:

1. `node_modules/.bin/tsx tests/integration/expenses-migration-rehearsal.ts`
2. `node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/expenses.test.ts`

The rehearsal stages all prior migrations in a unique temporary directory, deploys the old 38-model baseline and inserts wholly fictional legacy Expense/Category/Attachment rows. It captures their original JSONB text, including maximum-precision numeric and timestamps, upgrades through the new additive migration and verifies original values, constraints and indexes remain. It confirms explicit/omitted new legacy INSERTs and legacy UPDATE reject. It writes attempt-specific migration logs and a JSON report without connection credentials.

The integration suite creates synthetic users/properties/categories. It covers exact fields, ADMIN/STAFF/current-role checks, canonical actor-scoped replay, duplicates warning, stale versions, category deactivation and historical snapshots, terminal corrections, full-filter exact totals despite pagination, all conflicting command races, both deterministic category/post lock orders, direct SQL immutability/actor/classification/legacy fences, raw numeric NaN INSERT-SELECT and transition attempts, posting provenance, audit/command/deferred-commit rollback, immutable command/category history and global invariant queries.

The deterministic category races use a separate actual `pg.Client` holding a test advisory latch. A temporary trigger pauses the first command only after its category row lock has been acquired. The suite observes the advisory wait in pg_locks, then starts the competing real service command and releases the latch. Test triggers/functions are removed in finally. PostgreSQL test DDL applies only to the attested disposable database.

The NaN test intentionally uses raw SQL copying a valid managed row and replacing only amount with `'NaN'::numeric`, so Prisma/Zod rejection cannot stand in for the database constraint. Final real database results must be supplied by Main and independently reviewed.

## Executed local checks

- `prisma format` and `prisma generate` succeeded against own dependencies.
- `npm run typecheck` passed, including both PostgreSQL drivers, final log `typecheck-final.log`.
- `npm test` passed 292/292 in 17 files, final log `unit-all-final.log`. This baseline predates separate receipt PDF additions on main; it is not a substitute for combined regression after integration.
- Full `npm run lint` and focused expense lint passed after replacing an intentionally control-character regex that ESLint disallowed. Logs `lint-final.log` and `lint-focused-final.log`.
- The default `npm run build` remains at optimized Turbopack compilation without a reported result. Do not mark build passed. Main was notified so this attempt can be bounded and retried safely if necessary.

## Integration ownership

Exactly one new Prisma model, ExpenseCommand, requires the next frozen restore registry, plus additive Expense/ExpenseCategory columns and User backrelations. Enums ExpenseStatus and ExpenseMethod are new. Migration is `202610240001_phase4_expenses`. Category provenance uses createdById/changedById and User relations expenseCategoriesCreated/Changed. Existing rows retain null managed/category provenance; a post-migration legacy INSERT is forbidden.

No expense UI, CSV endpoint or restore-registry changes belong to this backend handoff. The accepted full Phase4 unit still requires those later components and browser agent UAT. Possible-duplicate warnings use exact property/vendor/date/amount matching and never reject legitimate repeated entries. DTOs expose possibleDuplicateCount on fresh create/detail/list reads. Command replay preserves the original result snapshot. Deposits remain separate.

## ER-03 / ER-04 verification coverage correction

The Main Agent reported that the original 21-case PostgreSQL run and first pristine migration rehearsal passed. Their existing attempt logs and JSON reports remain unchanged. The following source-only additions need new actual execution by Main and independent review:

- The migration rehearsal now calls actual `listExpenses` against its preserved legacy fixture after upgrade. It requires managed-only scope, excludedLegacyCount exactly 2, managed count 0, no returned items and exact OPEX/CAPEX/total zero. It includes that observed response in the attempt JSON as managedReadProof. Main must run this enhanced rehearsal on a new pristine database; never reset or rerun pristine setup against the first upgraded database.
- The integration suite adds two separately created and posted maximum amounts on one synthetic property and category. Its actual service query uses limit 1 but must return full-filter totals of 1999999999999.98 and total count 2, proving aggregate precision beyond the single-row NUMERIC ceiling.
- The NaN regression now uses one identical parameterized raw SQL INSERT for both a finite 1.00 positive control and NaN. The positive control must insert one PENDING row and expose amount 1.00, then its explicit test transaction rolls back. The NaN call must report SQLSTATE 23514 and constraint Expense_lifecycle_shape, not just an arbitrary rejection. The separate original-row NaN UPDATE must report P0001 with the exact immutability guard message. The original row and totals must remain unchanged.

Only tests and this handoff/evidence changed. Cached `tsc --noEmit --incremental` and ESLint on both changed test files exited 0; logs are typecheck-er03-er04.log and lint-er03-er04.log. No database, Docker, build, full-suite or browser command ran for this correction.

The earlier sandbox termination request for the stuck default build was aborted after waiting. Main subsequently confirmed the old owned build PID was absent. There is no observed successful build exit and no webpack retry by this implementer. Main owns serialized heavy verification.
