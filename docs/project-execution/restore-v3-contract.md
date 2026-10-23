# Restore inventory version 3 contract

Status: design contract, pending schema integration and independent implementation review. This document does not approve payment business rules or certify restore compatibility.

## Baseline and dependency

The reviewed operations baseline in `/private/tmp/taky-development` has 33 Prisma models and inventory version 2. The payment candidate in `/private/tmp/taky-payment-development/prisma/schema.prisma` has 38 models. The five additions are `PaymentReversal`, `Receipt`, `ReceiptCancellation`, `PaymentCommand`, and `ReceiptMonthCounter`.

Implement this extension after the orchestrator integrates the independently reviewed payment domain, schema, and migrations. An isolated dependent branch may implement earlier against that exact candidate. Do not change the current 33-model main schema to satisfy an inventory test. Exporting version 3 against that schema would fail because five tables are absent.

## Registry and version contract

Preserve the exact ordered 33-name version 2 registry in `operations/inventory.mjs`. It remains immutable and independently testable. Create an immutable version 3 registry by appending the five names listed above. Preserve the legacy SQL text and existing version 2 SQL semantics.

Prefer explicit version registries over a mutable registry shared by every version. Expanding the existing version 2 registry would invalidate historical archives. Dynamic discovery from a restored database would trust incomplete schemas and cannot establish an expected table set.

The proposed interfaces are:

```js
// Illustrative signatures, not implementation.
INVENTORY_TABLES_V2 // frozen, exact historical 33 names
INVENTORY_TABLES_V3 // frozen, 38 names
INVENTORY_TABLES    // alias for latest registry if existing callers require it
INVENTORY_SQL      // latest export SQL, version 3
inventoryVersion(expected) // validates manifest and returns internal version 1, 2, or 3
inventory(env = process.env, version = 3) // runs only a trusted version-specific query
assertInventory(expected, env = process.env) // validates, computes matching version, compares exactly
exportSnapshot() // exports version 3 inventory in the existing PostgreSQL snapshot transaction
```

An absent `version` selects the existing legacy path only when `tables` is also absent. Explicit `version: 1` remains rejected. Numeric versions 2 and 3 select their exact registries. All other values fail before database access, including strings, null, and an explicitly present undefined value. An unversioned `tables` object fails.

The shared strict validator requires the selected registry's exact keys. Every entry has exactly `count` and `sha256`. Counts remain canonical nonnegative decimal strings and hashes remain 64 lowercase hexadecimal characters. Missing tables, extra tables, malformed entries, and prototype-like unexpected keys fail validation. No archive-provided table name enters SQL.

Version 3 preserves the existing PostgreSQL full-row JSON serialization, deterministic `COLLATE "C"` row ordering, SHA-256 computation, and text counts. Both version 2 and version 3 use UTC and ISO,YMD session options. The absent-version legacy path retains its existing session options. Do not parse decimal money or large counts into JavaScript numbers.

## Module ownership and integration

| Owner | Files and responsibility | Boundary |
| --- | --- | --- |
| Payment implementer | Payment domain, `prisma/schema.prisma`, payment migrations | Supplies the reviewed 38-model baseline and migration evidence. Does not alter inventory code. |
| Operations implementer | `operations/inventory.mjs`, `operations/database.mjs`, `operations/verify-inventory-isolated.mjs`, `tests/ops/inventory.test.mjs` | Adds explicit version selection, latest export, schema coverage, and compatibility tests. Does not edit payment schema or business rules. |
| Operations implementer | `operations/production-restore.mjs`, only if a caller change is necessary | Keeps restore comparison delegated to `assertInventory`. Does not execute production restore. |
| Independent reviewer | Read-only review of integrated schema and operations changes | Reviews version isolation, validation, snapshot consistency, and evidence. Returns findings to operations implementer and verifies corrections. |
| Main orchestrator | Integration baseline and project execution records | Assigns actual agents, serializes integration, records commits and evidence, and reconciles findings. |

All restore routes retain the same validator and version dispatch through `assertInventory`: `verifyDatabase`, `verifyArchive`, `restoreIsolated`, and `restoreProduction`. Reject an unsupported manifest before a restore mutation, not merely after `pg_restore`. Audit callers for this ordering. Do not duplicate registry checks in each restore route.

Keep `exportSnapshot` inventory and `pg_dump --snapshot` on the existing shared repeatable-read snapshot. A version 2 archive restores its historical schema first and verifies using version 2. Schema upgrades are a separate controlled step after verification. Do not compare a restored 33-table archive against version 3 expectations or silently migrate before comparison.

## Acceptance criteria and required evidence

1. Registry tests freeze all 33 historical version 2 names and prove that version 3 contains exactly 38 distinct names. Version 3 covers every model in the integrated Prisma schema. Unexpected mapped table names require explicit review.
2. Validator tests exercise both versions, missing and extra table names, malformed entries, unsupported versions, and unversioned legacy manifests. An invalid manifest fails with a deliberately unusable database environment, proving rejection before database access.
3. The isolated PostgreSQL test creates a genuine historical 33-table schema, writes synthetic rows, captures a version 2 snapshot, runs real `pg_dump`, restores into a separate empty database, and verifies the restored inventory using the new implementation. No version 3 table exists in this fixture.
4. A second isolated test applies the integrated 38-model schema and migrations. It captures a version 3 snapshot, runs real `pg_dump`, restores into another empty database, and verifies the restored inventory. The archive records version 3 and all 38 table fingerprints.
5. Seed synthetic payment, reversal, receipt, receipt cancellation, payment command, and receipt month counter data. After restore, mutate each added table in turn and prove comparison fails. Test meaningful same-count row changes so detection cannot rely on counts alone.
6. Preserve the absent-version legacy archive test. Exercise snapshot consistency while an independent transaction writes data. Preserve exact decimal serialization and arbitrarily large count strings.
7. Cover every restore route's version dispatch and early rejection. Any production-route test uses injected or isolated dependencies and never a production database.
8. Run the operations test suite and the real compatibility tests. Record commands, exit codes, schema identities, archive versions, and synthetic fixture descriptions without secrets or tenant information.
9. An independent reviewer accepts the integrated diff and verifies any corrections. Main records development, integration, automated verification, and Owner UAT separately. Production readiness requires its own acceptance.

## Pstack method and limits

This contract uses the installed Pstack Codex adapter and architect guidance, grounded in the actual operations callers and candidate schema. The bounded design compared an explicit frozen registry per version with dynamic or mutable registry expansion. The explicit registry preserves the historical format and keeps validation in one module. The parent assignment limits this task to a document, so implementation, additional design agents, PostgreSQL execution, and Git mutations are outside this task. Compatibility checks above are required future evidence, not tests executed by this author.
