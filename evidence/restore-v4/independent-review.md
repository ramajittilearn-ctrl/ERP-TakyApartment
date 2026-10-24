# Independent restore inventory v4 review

Reviewed commit `2a59899d3e4c92fd2e8f8bb734a0131b604ed073` against its parent and the accepted expense baseline. Reviewer `combined_uat_fix` did not implement the operations changes. Scope includes the contract, all four implementation/test files, related restore entry points, and the expense migration's trigger definitions.

Verdict: no blocking code findings in this diff. The implementation is ready for Main's isolated PostgreSQL verification. Integration acceptance remains conditional on the runtime gates below. This is not a production recovery certification.

## Verified locally

`node --test tests/ops/inventory.test.mjs` passed 14 of 14 tests with no skips. Syntax checks passed for the three changed operations modules. No database or Docker commands ran.

An independent import of the parent inventory module and current module confirmed exact SQL string equality, rather than relying solely on the new test's expected constants:

| SQL | SHA-256, identical to parent |
| --- | --- |
| Legacy | `50e172a8a8f7cd334850584a63a5d883f7243107ea167786774cf91bbb2ca42c` |
| v2 | `7d1844a4bc13e06bf2befb700d2d323cc8193c4653d8b5f11ea7919402fa0ca5` |
| v3 | `8aaa7d4186ba2012dd1949ecbbf6a06cbb15cb504f0c0be76995ec08cc27146b` |

The frozen registries contain 33, 38, and 39 tables respectively. V4 appends only `ExpenseCommand`. The schema coverage test confirms all 39 current Prisma models appear exactly once. Historical dispatch uses its version's registry and SQL, while default inventory, default exported snapshots, and latest aliases select v4.

Strict canonical count/hash validation includes v4. The rejection tests run with an unusable command path and prove malformed manifests fail before database commands. Restore entry points continue to validate inventory before database restoration or attachment replacement. No production authorization or restore mutation sequence changed.

## Runtime checks reviewed in source

The harness pins fifteen migrations and the final payment and expense migration names. It applies thirteen migrations for v2 and unversioned legacy compatibility, fourteen for v3, and fifteen for v4. Restored copies have distinct names. V4's legacy expense/category comparison preserves every pre-existing column value before inserting the managed fixture.

Each versioned snapshot round trip commits a different room note after snapshot acquisition and requires both a different live hash and a failed comparison with the exported inventory. It then dumps using the exported snapshot and requires the restored database to match it. The unique note includes the version label, avoiding the earlier no-op concurrent-update risk.

On the v4 disposable restored copy, `ExpenseCommand.result`, the new `Expense.note`, and the new `ExpenseCategory.active` each receive a real equal-count mutation. Each mutation must fail the old inventory comparison, change the targeted hash, preserve its count, and leave every other table fingerprint unchanged. These checks cover new columns through complete-row hashing rather than a hand-maintained column list.

Mutations of immutable rows use transaction-local replica mode. The harness checks session mode returns to origin and all restored triggers remain origin-enabled. It separately requires the existing thirteen payment lifecycle triggers and three expense integrity triggers to remain installed. The fixture's managed expense and command satisfy the migration's insertion rules; the corruption checks intentionally bypass those rules only in restored disposable copies.

## Remaining gates

Main must execute the reviewed harness in the approved disposable operations container and preserve its fresh exit status and complete output. That run must prove historical legacy/v2/v3 restore compatibility, v4 default inventory, exported-snapshot consistency, all equal-count corruption checks, and trigger installation/state after restore.

Main must also run the complete operations suite in an environment with dependencies and permitted loopback binding. The owner's broader log records 42 passes and two environment failures, so it is not a complete suite pass. This review independently reran only the fourteen focused tests.

After a successful real run, a reviewer should reconcile the actual output against these planned assertions before Main integrates the commit. A runtime failure must return to the owner for correction and focused re-review.

## Final runtime evidence review

Main supplied the fresh real PostgreSQL output in `real-pg-attempt1.log`. I independently read the complete output and reconciled it with the reviewed harness. It contains exactly **60 lines beginning with `PASS`**, followed by Main's recorded process exit 0. These are 60 reporting checkpoints, not a count of distinct test cases or individual assertions.

The output includes all 33 synthetic equal-count decimal mutations, deletion and NULL/empty distinction, large numeric precision, row-order stability, unknown/missing version rejection, and private-socket exported-snapshot restore. It separately records actual thirteen-migration historical v2 with 33 tables and unversioned legacy restore, fourteen-migration v3 with 38 tables, and fifteen-migration v4 with 39 tables. All three versioned round trips record a live row hash that differs from the exported snapshot before dumping, then a successful restore comparison.

The five payment-table corruption checks appear for both v3 and v4. The additional v4 lines confirm equal-count corruption detection for `ExpenseCommand.result`, `Expense.note`, and `ExpenseCategory.active`. The final v4 completion line is reached only after the harness's session-origin and installed/origin-enabled trigger assertions, including all thirteen payment lifecycle and three expense integrity triggers. Historical expense/category preservation and default-v4 coverage also have explicit success lines. No planned assertion was skipped or bypassed in the reviewed harness.

The preserved first broader Main run is `full-ops-main.log`, with 43 passes, one failed file caused by missing `zod`, and recorded exit 1. It remains a failed attempt. After Main supplied the pinned private runtime dependency closure, `full-ops-main-attempt2.log` records **54 tests passed, zero failures, zero skips, zero cancellations**, and recorded exit 0. The test count grew because the previously unloadable preflight file's individual tests could execute. The earlier implementation attempt of 42 passes and two environment failures also remains preserved in `all-ops-unit.log`.

Final scoped verdict: the code review and supplied runtime evidence satisfy this restore-inventory v4 milestone's acceptance criteria. No blocking findings remain, and Main may integrate commit `2a59899`. This reviewer executed only the earlier pure local checks and reviewed Main's runtime logs; Main performed PostgreSQL and container execution. The reported container isolation is network-disabled with read-only operations/schema mounts and a retained stopped container. This acceptance covers archive inventory integrity and version compatibility. It does not claim production recovery, off-site backup custody, deployment, or financial lifecycle acceptance beyond their separate evidence.
