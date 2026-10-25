# Deposit backup publication and inventory v5 sketch

Baseline f3c7081, isolated branch codex/deposit-operations. This owner changes operations and focused operations tests only, plus fresh-image attachment-directory mode0700 in the root Dockerfile. Root supplies its corrected migration003 before actual verification. No existing volume or running service is changed.

## Lifetime and interfaces

Add operations/publication.mjs, using a dedicated psql child session so the operations image needs no new Node dependency. `withAttachmentPublicationSession(work)` acquires SESSION advisory lock73422195 before invoking work, then closes/unlocks in an outer finally. Work receives `{ signal, assertAlive }`. Acquisition is bounded by server lock_timeout5s and a client deadline; there is no endless retry. It does not acquire source gate73422193. The independent exportSnapshot retains its existing read-only repeatable-read transaction and two-result parser.

The lock session acknowledges its actual backend PID and role. Periodic bounded pings detect a lost backend while dump/copy runs; unexpected child error, close, failed ping or protocol mismatch aborts the shared signal. `assertAlive()` requires an acknowledged round trip on that same live session, not merely an old child exit status. A lost session never reconnects and never counts as a retained lock. An injected spawn boundary supports deterministic unit proofs without pretending to be PostgreSQL.

createBackup holds this session around first retained-file inventory, snapshot startup, pg_dump, attachment copy, final source/copy inventories, metadata-to-file checks and manifest materialization. Each stage checks ownership and uses the abort signal. Exported snapshot closes before session unlock. PostgreSQL child commands use abortable exec; source/destination file walking/hash/copy checks cancellation and copy streams abort mid-file. If lock ownership is lost, temporary backup work fails and no archive is marked verified or published. Once the complete dump/file set is fixed and checked under the lock, ordinary encryption and isolated restore verification may proceed on that independent set after release.

Every retained regular file is inventoried/copied, including orphan final files and destination partials. Accepted Attachment metadata must match a retained file; files without metadata remain retained and are reported as such in manifest metadata, never as accepted evidence. No upload/evidence row is inferred, no retained source file is deleted, and restore continues to verify all bytes.

## Frozen registry and actual proof

Append DepositAccount, DepositEntry, DepositCommand, DepositEvidence and DepositDocumentCounter to a new frozen INVENTORY_TABLES_V5 only. Export default inventory/exportSnapshot version5; explicit legacy/v2/v3/v4 selection remains supported. Their SQL bytes, table order and hashes remain identical. v5 fingerprints complete44-model rows and every added field.

Keep actual historical13/14/15-migration dump/restore checkpoints. Apply reviewed16 finite checks, then Root-corrected17 deposit DDL, then v5 default snapshot/dump/restore and equal-count deposit-column corruption checks. Retain prior v4 schema checks at39 tables. A separate private PostgreSQL publication proof uses a nonsuperuser role and the real session helper, proves a second transaction cannot obtain73422195 until release, and proves backend termination aborts the protected task. All actual PostgreSQL/Docker execution belongs to Root.

Unit tests exercise bounded acquisition failure, callback failure cleanup, lock-loss cancellation, final ownership checks, source partial/orphan retention, frozen historical SQL and strict v5 validation. No runtime PostgreSQL result follows from this sketch. Independent review and Root-owned actual tests are required before integration.
