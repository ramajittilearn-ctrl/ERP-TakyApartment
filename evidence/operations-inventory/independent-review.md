# OPS-03 independent review

Reviewer: restore_inventory_review, separate from the implementation owner.
Reviewed on 2026-10-23 in `/private/tmp/taky-development` against baseline `4ad8652` and current working changes. Code was read only. This review wrote only this report.

## Verdict

No blocking code defect found in the reviewed change. Accept code review conditionally. Database verification remains pending and OPS-03 must not be marked automated database verification complete until the isolated PostgreSQL acceptance script succeeds.

## Scope and findings

- `operations/inventory.mjs:1` freezes the current 33-table registry. Every current Prisma model is present exactly once. SQL identifiers come exclusively from this registry, never from a manifest.
- `operations/inventory.mjs:2` preserves the legacy SQL byte for byte against `4ad8652:operations/database.mjs`. An independent executable string-equality assertion passed.
- `operations/inventory.mjs:12` performs full-row JSONB serialization, C-collation ordering, numeric hashing and count conversion inside PostgreSQL. JavaScript handles decimal string counts and hashes only. Arbitrary-precision row values therefore do not cross JavaScript numeric parsing during v2 hashing.
- `operations/inventory.mjs:17` rejects unknown explicit versions, absent versions with a v2 table object, extra or missing identifiers, malformed counts and noncanonical hashes. Version-absent legacy input still selects the original comparison. Malformed inputs are rejected before database access by `assertInventory`.
- All three restore comparison sites call `assertInventory`. UTC-only legacy options remain intact; v2 and exported snapshots explicitly select UTC and ISO/YMD. The exported snapshot still binds the manifest inventory and `pg_dump` to the same transaction. Production restore retains its prior rollback and owner-confirmation guards.
- The outer encrypted archive format and manifest version are unchanged. This does not authorize modification of version 2's registry when Stage 3D adds models. A later registry must have a new inventory version, with v2 retained for old backups.

## Checks actually run

1. `node --test tests/ops/*.test.mjs`: exit 0, 31 passed, 0 failed, 0 skipped.
2. `./node_modules/.bin/eslint operations/inventory.mjs operations/database.mjs operations/production-restore.mjs operations/verify-inventory-isolated.mjs tests/ops/inventory.test.mjs --max-warnings 0`: exit 0.
3. Executable equality assertion importing `LEGACY_INVENTORY_SQL` and comparing it with the literal extracted using `git show 4ad8652:operations/database.mjs`: exit 0.

The unit SQL checks inspect query structure. They do not execute PostgreSQL or prove decimal mutation detection, order independence, snapshot consistency or restore correctness.

## Remaining verification gate

`operations/verify-inventory-isolated.mjs:10` creates fresh synthetic tables in a temporary private Unix-socket PostgreSQL cluster, with no TCP listener. It exercises all 33 table hashes, large decimals, composite keys, deletion, null versus empty text, physical row order, legacy comparison, bad versions and a real snapshot-bound dump/restore. Its two clusters use separate temporary socket directories. The code review found no shared application database or attachment target in this script.

The script has not been executed by this reviewer. Run it only in the disposable environment specified in the evidence README, with no mounted application volumes or credentials. A successful run proves behavior against its synthetic schema. It does not prove migrations, foreign keys or restoration of the real application schema; preserve that distinction in the project checkpoint and subsequent integration verification.

The new registry test at `tests/ops/inventory.test.mjs:10` intentionally fails when Stage 3D adds models. Resolve that failure by introducing the next inventory version and retaining version 2 compatibility, rather than adding the new tables to the existing version 2 registry.
