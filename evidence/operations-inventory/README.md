# OPS-03 inventory verification checkpoint

Implementation extends the encrypted manifest's nested database inventory to version 2. Encryption header and outer manifest version remain unchanged. The exact unversioned legacy query remains supported. Version 2 keeps legacy fields and adds a frozen registry covering all 33 current Prisma models, each with a decimal string row count and SHA-256 fingerprint of complete PostgreSQL JSONB rows. PostgreSQL performs numeric serialization, deterministic C-collation row ordering and hashing; JavaScript does not parse financial fields. Version 2 connections set UTC and ISO/YMD DateStyle; legacy connections preserve UTC-only options.

All three restore comparison paths use `assertInventory`. Unknown versions, missing version on a v2-shaped object, incomplete/extra registry entries and malformed fingerprints reject. `exportSnapshot` emits version 2 from the same exported transaction used by pg_dump.

## Executed

- `node --check operations/inventory.mjs`: exit 0.
- `node --check operations/verify-inventory-isolated.mjs`: exit 0.
- `node --test tests/ops/inventory.test.mjs`: exit 0, five tests passed; `unit.log`.
- `node --test tests/ops/inventory.test.mjs tests/ops/backup.test.mjs`: exit 0, 18 tests passed; `unit-and-backup.log`.
- `command -v psql` and `command -v initdb`: exit 1, binaries unavailable on host PATH.
- `docker image ls --format '{{.Repository}}:{{.Tag}}'`: sandbox Docker socket permission denied. Escalated retry waited 1142 seconds and was aborted; image availability is UNKNOWN. No container or database was created.

## Not yet verified against PostgreSQL

Do not label OPS-03 database verified from these unit tests. SQL hash behavior, true decimal/null/reordering mutation detection and dump/restore consistency need a real PostgreSQL run. The unit SQL structure test checks coverage only.

`operations/verify-inventory-isolated.mjs` is a runnable acceptance harness for a fresh disposable operations image. Run `node operations/verify-inventory-isolated.mjs` only inside a NEW container with `--network none`, no published ports, no volume mounts, and no application credentials. The script creates only synthetic tables and two private Unix-socket PostgreSQL clusters under temporary directories; it removes those directories after stopping the clusters. It exercises every registered table with an equal-count decimal mutation, deletion, NULL/empty distinction, large numeric values, composite keys/no-id models, physical row reorder, unchanged legacy inventory, unknown/missing version rejection, and real snapshot-bound pg_dump/pg_restore comparison. It prints pass labels and table names only; no row/private values.

This harness is currently syntax checked but NOT EXECUTED. Independent review and real database execution remain required. No production deployment, Owner UAT or financial policy approval is implied.
