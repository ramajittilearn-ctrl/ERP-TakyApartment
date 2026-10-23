# OPS04 independent review

Reviewer: `restore_v3_review`. Baseline: `0e4e302`. Scope: the five operations and inventory-test files assigned by the orchestrator. The reviewer did not edit application code, run Docker, or change a database.

The reviewer read the actual `AGENTS.md`, installed Pstack Codex adapter, poteto-mode feature guidance, unslop guidance, and the version 3 design contract. Review uses the available Codex reviewer role, without a claim of cross-provider model review.

## Finding corrected and verified

VR-01, medium, verification gap. `roundTrip(2)` writes `Room.notes='independent transaction after snapshot'` into the migrated source database. `roundTrip(3)` then writes the same value. Its asserted post-snapshot transaction makes no data change, so the version 3 round trip does not prove that `pg_dump --snapshot` excludes a concurrent change. Give each round trip a distinct value and assert that the live inventory differs from the exported snapshot before dumping. Rerun the real isolated compatibility check after this correction.

The reviewer sent this finding to Main and, on a successful retry, directly to the implementer. The owner corrected each round trip to write label- and version-specific notes. Before dumping, the code reads the live same-version inventory, asserts an unchanged Room count and changed Room fingerprint, and requires comparison with the exported snapshot to fail. The reviewer inspected this exact correction. VR-01 is closed.

## Checks executed by reviewer

- `node --test tests/ops/*.test.mjs`: exit 0, 36 passed, 0 failed.
- `npx eslint operations/inventory.mjs operations/database.mjs operations/production-restore.mjs operations/verify-inventory-isolated.mjs tests/ops/inventory.test.mjs`: exit 0.
- Executed a Node comparison importing the original inventory module from `git show 0e4e302:operations/inventory.mjs`. Both legacy SQL and version 2 SQL match the original exported strings byte for byte. Version dispatch returns those same strings. Exit 0.
- After the correction, `node --check operations/verify-inventory-isolated.mjs` and the same scoped ESLint command both exited 0.

## Source and evidence assessment

The immutable version 2 registry retains all 33 names. Version 3 appends exactly the five payment models, covers all 38 current Prisma models, and supplies the default backup snapshot query. Both versions use PostgreSQL full-row JSON hashing, C collation, text counts, UTC and ISO date formatting. Version-specific validation rejects unknown versions and malformed registries before SQL execution.

`verifyDatabase` validates before temporary cluster creation. Archive verification validates immediately after authenticated unpacking. Isolated restoration validates before querying or restoring its destination. Production restoration validates both the rollback archive and the selected archive before `pg_restore --clean` or attachment deletion. The production test executes rejection through the rollback archive validator; the selected-archive ordering was independently inspected in source. No production restore was executed.

The reviewer inspected the complete fresh `qa-v3-runtime-attempt2.log`. It records explicit live-versus-snapshot divergence for both versions before dumping, then successful historical version 2, historical absent-version legacy, and migrated version 3 dump/restore checks. All five added tables produce the expected equal-count mutation failures. The Compose configuration has no network or published ports, uses temporary PostgreSQL data, and mounts operations and migration sources read-only. Main executed the actual Docker command and attested exit 0; the reviewer independently inspected the source and complete output. The initial `qa-v3-runtime.log` retains the pre-correction coverage gap for traceability. Main's fresh `qa-v3-all-ops.log` also records 36 passed and 0 failed.

The migrated fixture applies all 14 actual migration SQL files and retains their checksums in its synthetic migration history. It deliberately inserts inventory-only payment rows under transaction-local `session_replication_role=replica`; these rows do not certify a valid financial lifecycle. The bypass also bypasses foreign-key triggers, although the particular synthetic references are consistent on source inspection. It ends before snapshots and dump/restore. The check verifies origin session state, no persistently disabled triggers, and all 13 named payment lifecycle triggers before and after restore. Same-count mutations cover each of the five added tables. Separate payment integration evidence remains necessary for financial validity.

## Decision

Accepted for this OPS04 development and integration scope. No material product-code defect or open review finding remains. The correction and successful fresh compatibility run satisfy VR-01. This review does not certify Owner UAT, offsite recovery, key custody, production deployment, or Go-Live.

## Reviewed file fingerprints

SHA-256 of the frozen reviewed files:

```text
0385d57b6abbeb516c85f49b04ff8e43129d09d90460ec3b2d29a14c797dab8a  operations/inventory.mjs
f4fbf1dce4d4af5f010ea0bf37516b0f6adb8d348dd08e1c2215e12fb4c8c1f1  operations/database.mjs
69be2713041a1ccdb4c9e5caa276292f1c54e1f2a010c53ffdab65c064deba48  operations/production-restore.mjs
31e696e6f1270b258ab6226ed9926e4e497460560625f0c119b215d700e6b9db  operations/verify-inventory-isolated.mjs
a7f3c22f33a5ddd2571bc9aa10897d8bc51f08f2ad9d83a0e795f1e7606791f9  tests/ops/inventory.test.mjs
0ad7d898dd2deecd1355ed9925a64ac0f0fe2b2aea17ce4f6fbcbcc32bc416de  evidence/operations-inventory/qa-v3-runtime-attempt2.log
```
