# Restore inventory v4 contract

Baseline: expense implementation `83d681906f2e2615d428faf41463ca7bd53ebebe`.
Owner: `restore_v4_impl`. Main owns integration and real PostgreSQL execution.

The expense migration adds `ExpenseCommand` as the thirty-ninth application table.
New backups must include its complete rows and all new columns on existing expense
tables. Inventory SQL already hashes `to_jsonb(t)`, so column coverage needs no
column list or financial policy change.

## Interface and compatibility

- Add frozen `INVENTORY_TABLES_V4 = [...INVENTORY_TABLES_V3, "ExpenseCommand"]`
  and `INVENTORY_SQL_V4`. Latest aliases select v4.
- `inventory(env, version = 4)` and `exportSnapshot(version = 4)` create v4 by
  default. Explicit versions 1, 2 and 3 keep their existing SQL bytes and registry
  order. Unversioned manifests remain legacy version 1.
- `inventoryVersion` accepts exactly 2, 3 or 4 when a version is explicit and
  validates each against its frozen registry and canonical fingerprints.
- Every restore path continues to validate inventory before any database or
  attachment mutation. No production restore logic or authorization changes are
  required.
- No schema, migration, app, payment or expense service changes belong here.

## Verification

Pure operations tests must prove exact registry coverage against the current 39
Prisma models, frozen historical registries, unchanged hashes of legacy/v2/v3 SQL,
strict per-version validation, and rejection before database access.

The isolated script keeps its existing synthetic v2 decimal and ordering tests.
It applies the first 13 real migrations for the historical 33-table v2 and legacy
round trips, the first 14 for the 38-table v3 round trip, then all 15 for the
39-table v4 round trip. Each stage uses a fresh restore database and preserves
earlier databases. Each version's exported snapshot must differ from a real
concurrent committed row update while restoring exactly the captured snapshot.

The v4 fixture contains synthetic legacy expense/category rows before migration
and one `ExpenseCommand` after migration. On its disposable restored copy,
equal-count mutations of `ExpenseCommand`, a newly added `Expense` field, and a
newly added `ExpenseCategory` field must change the expected table hash alone.
Fixture changes may use transaction-local replica mode for immutable audit rows;
all payment and expense triggers must remain installed and origin-enabled after
each restore. This proves archive integrity, not the expense lifecycle rules.

Main executes the real isolated PostgreSQL script in the existing disposable,
network-disabled operations container. This owner executes only local Node tests
and supplies the rerunnable script and evidence. Independent review and Main's
successful real run are required before integration.

## Throughput checkpoint

1. Blocking first step: independent review of this contract before code changes.
2. Independent workstreams: Main handles active application and PostgreSQL work.
3. Shared state: this isolated worktree owns only operations inventory files and
   their tests. Main serializes integration after independent review.
4. Smallest safe decomposition: one implementation owner keeps the registry,
   dispatch defaults and compatibility script consistent. A separate reviewer
   checks the diff and real evidence.
