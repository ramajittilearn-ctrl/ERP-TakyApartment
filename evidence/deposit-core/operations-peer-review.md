# Independent deposit operations review

Reviewer: recover_deposit_core. Implementation owner: recover_finite. Reviewed in the separate deposit-operations worktree; reviewer made no operations source changes and ran no PostgreSQL, Docker, production, or UAT commands.

## Reviewed source

- fa7f068: publication session, backup coordination, abortable copy/hash/inventory, inventory v5, isolated acceptance harness, fresh attachment-directory permissions.
- d0dcd42: diagnostic guard differences; assertions remain unchanged.
- 1c87185: late migration003 atomicity proof.
- f865de4: native typed CHECK canonicalization and semantic controls.

The dedicated publication session acquires73422195 before file inventory and snapshot creation without holding source admission73422193. Same-backend acknowledgments, heartbeat, server lock timeout, client acquisition/check deadlines and maximum hold time bound session ownership. Session loss propagates cancellation through dump, inventory, hash and file-copy work. Snapshot close is awaited before the outer session unlock. Encryption and restore verification use the completed independent set afterward.

The first and final file inventories, copied-file fingerprints and Attachment metadata checks cover all regular retained files. Unreferenced files and destination partials remain separately reported rather than becoming accepted evidence. Source bytes are not removed. Explicit v1–v4 registry behavior and SQL byte hashes remain frozen; v5 appends exactly the five deposit tables.

Fresh independent command `node --test tests/ops/inventory.test.mjs tests/ops/publication.test.mjs` completed with exit0:24 tests passed,0 failed. These tests establish local behavior only; they do not establish real database session ownership or successful backup restoration.

## Atomicity proof source acceptance

1c87185 injects a fixed P0001 failure immediately before the final END of the exact candidate003 outer DO statement. It requires the sentinel and SQLSTATE in actual psql stderr, then compares the populated v4 full-row/schema inventory and complete guard document. All five new tables and deposit functions must be absent. There is no enclosing transaction rollback, reset or replica mode masking partial DDL. The unchanged003 is applied only after those checks. Source accepted; Main's actual attempt3 now establishes the passing rollback outcome.

## CHECK comparison and actual acceptance

The actual v5 restore comparison reported five CHECK deparser differences. Indexes, triggers and functions were identical according to Main's observed diagnostics. Frozen correction f865de4 is accepted at source level: CHECK expressions are reparsed by PostgreSQL on empty temporary LIKE tables preserving source column types and collations. At most four parse/deparse passes must converge; otherwise the comparison fails. Fresh temporary relation lookup avoids retaining a dropped relation OID. Constraint identities, types, validation and NO INHERIT metadata remain in the fingerprint; other constraint types, indexes, triggers and functions remain exact. Raw guard documents and difference diagnostics are retained. No text-based removal of casts, parentheses or grouping is used.

The native controls distinguish greater-than from greater-or-equal, removed NaN protection, changed AND/OR grouping, NO INHERIT and a changed array member. Associative AND formatting and the observed array-cast versus element-cast pair converge equally. Main's actual attempt3 passes these controls and the complete v5 restore comparison.

Read and reconciled the complete raw log `../deposit-operations/evidence/deposit-operations/runtime-attempt3.log`, SHA256 `410da03f7ae7717e66d403ca0240265a186525fb2505f306ce3438ba73ab32c0`. It reaches successful real nonsuperuser session-lock exclusion/release, callback-failure cleanup, backend-loss cancellation without a verified result, late003 atomicity, all seventeen migrations, corrected v5 guard comparison, full44-table exported-snapshot dump/restore and real encrypted backup retaining referenced/orphan/partial files without source deletion. Historical unversioned/v2/v3/v4 restoration and same-count mutation detection also pass. Main reports container exit0. These scoped operations gates are accepted; no database or test was rerun by this reviewer during reconciliation.

## Financial review reconciliation

Read actual deposit matrix log `../deposit-qa-candidate/evidence/deposit-core/database-qa-2026-10-25T12-26-52.878Z-06b5e7c6-2127-4cd2-8a27-108f3cb33273.log`, SHA256 `35851147d4bd2586dca2696986201f2a812525f9578a061f83d553bd6e222601`. All50 cases pass with child exit0:13 lifecycle/eligibility,24 integrity and13 concurrency cases. Source coverage maps to the original independent findings:

- DCR-02: raw and service DRAFT/demo-lease/demo-tenant zero reviews reject without partial financial state; valid ACTIVE/ENDED/CANCELLED reviews remain allowed.
- DCR-03: both arrival orders for same/cross-lease service/direct bank claims, identity release, reversal/spend and duplicate reversal, command replay and deterministic source-close ordering are exercised. The corrected command uses READ COMMITTED so queries after bank admission see the preceding writer's committed identity. Read-only ledger/document transactions remain REPEATABLE READ.
- DCR-04: injected audit/counter/command/entry failures preserve full financial state and retained bytes; exact-key retry and replay create one result. Current disabled/demoted actors cannot replay. Raw finite positive control, non-finite/sign failures, evidence/actor/sequence/snapshot/hash/version/duplicate-reversal guards and all original reversal buckets are exercised. Separate attempt3 supplies migration late-failure atomicity.

Read payment historical setup log `../deposit-qa-candidate/evidence/payment-regression17/database-qa-2026-10-25T15-44-10.652Z-794ddcfa-b85b-45d9-b4b1-7190c597f81a.log`, SHA256 `e007199e6dec7a7dc48dd71092c709a4d6ac777aaaa6de2d217fc3ae2f41a75d`. It attests the fresh integrated17_history target and preserves three original payments, three allocations and seven original constraints, child exit0. Subsequent integration log `database-qa-2026-10-25T15-45-58.062Z-c9be9cb1-6ff9-4dce-96f3-66b75a43eca0.log`, SHA256 `bc71e87781c8293a0e996fea7639817bf4a2d4ebec64e09bdbc7c3e9e3b13040`, passes39/39 across payments, finite boundaries, receipt PDF and payment routes, child exit0. The shared Payment gate regression requirement is therefore established on the seventeen-migration schema.

No enumerated DCR-02/03/04 acceptance item remains unresolved within the supported READ COMMITTED mutation protocol. This is an implementation-owner reconciliation supporting Main's independent finding closure, not self-approval of the financial implementation. The untouched original independent review is retained as historical evidence.

## Limits

The concurrency evidence covers the supported application and READ COMMITTED direct-writer protocol; snapshot ledger/document reads use REPEATABLE READ and are exercised by the lifecycle/document cases. All supported Payment/deposit mutations use READ COMMITTED with source-before-bank admission. Manually selected REPEATABLE READ/SERIALIZABLE writers with pre-admission snapshots are not proven safe; do not extend the claim to arbitrary SQL isolation, database-owner actions or reverse/manual entity-lock sequences. Main explicitly acknowledged this scope boundary and classified rejection of unsupported manual write isolation as optional future hardening, outside the present Phase4 closure. No new runtime failure was established and no additional SQL change was made here.

Core matrix fixtures use a retained-byte test verifier and do not establish production upload/parser behavior. The operations harness uses inventory-only financial fixtures, not a second proof of ledger correctness. Deployment commissioning, production-volume restore, Owner acceptance and Go-Live are not established by these isolated tests. Stage3E/Phase4 final integration, complete project checks and UI acceptance remain Main's separate reconciliation scope.
