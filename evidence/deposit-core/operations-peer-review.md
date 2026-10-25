# Independent deposit operations review

Reviewer: recover_deposit_core. Implementation owner: recover_finite. Reviewed in the separate deposit-operations worktree; reviewer made no operations source changes and ran no PostgreSQL, Docker, production, or UAT commands.

## Reviewed source

- fa7f068: publication session, backup coordination, abortable copy/hash/inventory, inventory v5, isolated acceptance harness, fresh attachment-directory permissions.
- d0dcd42: diagnostic guard differences; assertions remain unchanged.
- 1c87185: late migration003 atomicity proof.

The dedicated publication session acquires73422195 before file inventory and snapshot creation without holding source admission73422193. Same-backend acknowledgments, heartbeat, server lock timeout, client acquisition/check deadlines and maximum hold time bound session ownership. Session loss propagates cancellation through dump, inventory, hash and file-copy work. Snapshot close is awaited before the outer session unlock. Encryption and restore verification use the completed independent set afterward.

The first and final file inventories, copied-file fingerprints and Attachment metadata checks cover all regular retained files. Unreferenced files and destination partials remain separately reported rather than becoming accepted evidence. Source bytes are not removed. Explicit v1–v4 registry behavior and SQL byte hashes remain frozen; v5 appends exactly the five deposit tables.

Fresh independent command `node --test tests/ops/inventory.test.mjs tests/ops/publication.test.mjs` completed with exit0:24 tests passed,0 failed. These tests establish local behavior only; they do not establish real database session ownership or successful backup restoration.

## Atomicity proof source acceptance

1c87185 injects a fixed P0001 failure immediately before the final END of the exact candidate003 outer DO statement. It requires the sentinel and SQLSTATE in actual psql stderr, then compares the populated v4 full-row/schema inventory and complete guard document. All five new tables and deposit functions must be absent. There is no enclosing transaction rollback, reset or replica mode masking partial DDL. The unchanged003 is applied only after those checks. Source accepted for Main's isolated runtime execution; runtime outcome remains pending.

## Remaining acceptance

The actual v5 restore comparison reported five CHECK deparser differences. Indexes, triggers and functions were identical according to Main's observed diagnostics. A native typed CHECK canonicalization candidate and semantic negative controls are still being implemented and have not yet been approved by this reviewer. No text-based removal of casts, parentheses or grouping has been accepted.

Real nonsuperuser session-lock exclusion, backend-loss cancellation, encrypted backup/restore, retained-orphan/partial preservation, late003 atomicity and corrected v5 guard comparison require Main's successful isolated runtime log. No overall operations or milestone completion is claimed here.
