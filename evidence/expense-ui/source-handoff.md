# Expense UI source handoff

Status: implementation candidate awaiting independent code review and real PostgreSQL/browser acceptance. This is not an integration, deployment or Go-Live acceptance.

The branch is `codex/expense-ui` at `/private/tmp/taky-expense-ui`, based on frozen expense backend `83d6819`. Dependencies are a separate APFS clone of the expense worktree's installed dependencies and generated Prisma client. The implementation does not change schema, migrations, operational inventory, financial commands, protected UAT or any database.

Implemented the authenticated persisted expense page with a separate explicit demo selector, pending capture, ADMIN versioned transitions, immutable detail/history/correction references, global category management, filtered full-result totals and pagination. The feature-local journal preserves original request bodies and keys across client navigation and sticky uncertain results, supports distinct expense/category DTOs, and places recovery inside active dialogs. Main explicitly transferred the single AppShell expense classification entry to this owner after design review; no other shell labels changed.

The new CSV route exports a complete filtered current ledger snapshot with a summary row, exact decimals, lifecycle metadata and formula-safe escaped text. It rejects over 10,000 records before CSV emission. List and export share predicates and strict filter schemas. Export authorization, row count, loaded rows, duplicate counts, exclusions and exact totals run in one RepeatableRead transaction. Batched duplicate-count SQL avoids one query per exported row. The existing query adapter's ordinary object assignment silently dropped `__proto__`; it now constructs own properties through Object.fromEntries and rejects that unknown key, with regressions.

## Executed local checks

- `node node_modules/vitest/vitest.mjs run`: 329 tests passed in 20 files. Raw log is `unit.log`.
- `node node_modules/typescript/bin/tsc --noEmit`: passed, including authored PG/browser drivers.
- `npm run lint`: passed across the full standard project scope. Raw log is `lint.log`.
- Installed Prettier check passed on every changed TypeScript, TSX and CSS file. Raw log is `format.log`.
- The staged source whitespace check passed before the candidate commit. Raw tool logs retain their original trailing blank lines; the whole-artifact whitespace check flags those logs.

## Main-owned gates still required

Do not run these against an existing UAT or production database. Main coordinates the existing strict isolated database/browser plans, build serialization and credentials. No real DB, Docker, application build or browser command ran in this implementation worktree.

1. Review source independently against `expense-ui-contract.md` and `expense-ui-design-review.md`. Return findings to the implementation owner and verify corrections.
2. Run `tests/integration/expense-export.test.ts` through the existing expense QA runner after selecting this worktree as its source. The test guard requires loopback, an explicit `taky_expense_test_*` database, no URL query and actual database/role attestation. It uses genuine stored sessions and real services; only Next's request-cookie boundary is replaced. Cases cover authenticated CSV/denials, exact filtered totals/history, aggregate precision, duplicates, concurrent approval consistency and the 10,000/10,001 export boundary. Bulk synthetic PENDING fixtures exercise volume only, retain every integrity trigger and establish no financial lifecycle evidence.
3. Run the existing expense service/migration regressions with the accepted backend coverage follow-up. Preserve source ownership when merging those test-only commits.
4. Build the candidate with Main's established webpack build procedure, then provision a fresh guarded browser plan and run the unique grep `expense persisted`. `tests/phase2/expense-persisted.spec.ts` has six cases. It authenticates via real sessions and uses exact synthetic property IDs rather than assuming an empty first page. It covers real downloaded CSV bytes, 105-row paging, command response loss/replay, an isolated ADMIN's real demotion, logout fencing and narrow-screen keyboard/Axe checks. It does not change shared test-admin roles.
5. Run cross-module regressions after corrections and controlled integration. Keep evidence with exact source revisions. Review app shell wording alongside the explicit local demo banner. Agent UAT acceptance and actual deployment remain separate statuses.

The concurrent export test runs a genuine approval alongside export and reconciles returned rows to totals; it does not inject a pause between individual SELECT statements. The transaction's RepeatableRead setting is explicit in the source. A reviewer may require a stronger deterministic interleaving probe before acceptance.

## Independent review corrections

EUI-01 identified inaccessible recovery when an uncertain command's action dialog closed and the user opened a selected expense detail. Recovery now belongs inside that detail Modal as well as the action Modal; the page instance renders only when neither dialog is open. A seventh guarded browser case commits capture, loses its response, closes the action, opens an already persisted row's detail and retries using keyboard focus inside that dialog. It asserts byte-identical replay, one command record and the expected two distinct expenses. Main must execute that browser case; its authorship alone is not verification.

EUI-02 identified leading C1 controls before spreadsheet formula characters. CSV formatting now skips Unicode Cc and whitespace while finding the first significant character. Parsed CSV fixtures cover U+0085 before `=` and U+009F before `+`, alongside prior ASCII/whitespace cases. Stored values remain unchanged. This proves the escaped-byte contract, not execution in a specific spreadsheet application.

Main's first real export PG attempt failed fixture-dependent cases because its 43-character property code exceeded the actual 40-character schema limit. The source correction bounds both PG and browser property codes to 32 characters with 116 bits of random identity. Schema, migration and financial guards remain unchanged. The immutable failed database log belongs to Main and is not included in this correction commit. Main owns the reviewed rerun through the dedicated helper described in `export-qa-instructions.md`.

After these corrections, the full local unit suite passed 331/331 in 20 files. Typecheck, standard full lint and changed-file Prettier passed. Logs are `review-correction-unit.log`, `review-correction-typecheck.log` and `review-correction-lint.log`. Independent correction review and Main's PG/build/browser gates remain pending.


## Remaining review coverage

A test-only follow-up adds parsed CSV assertions for all four C1-prefixed formula characters and an eighth guarded browser case that holds actual server responses for filter/detail A, selects B, releases A, and confirms B remains selected. Main requested that additional lint/typecheck/unit jobs wait while the production build runs. Those additional assertions are authored, not reported passed. App/export/PG source remains unchanged from `ef80c00`.
