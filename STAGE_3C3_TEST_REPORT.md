# Stage 3C-3 verification report

Date: 2026-10-21, Asia/Bangkok. Status: DEVELOPMENT COMPLETE after local closure commit. Production billing remains NO-GO.

## Final result

PASS: 120 unit tests; 71 related PostgreSQL tests across five files; 46 HTTP/API checks; nine focused browser groups on desktop/mobile; all 13 migrations; zero schema drift; typecheck, lint, scoped formatting and Prisma validation; production Docker image with the documented fresh dependency installation. No unresolved Stage 3C-3 defect remains from the review and executed checks. Earlier failed and skipped attempts are retained below. This is focused development verification, not a full historical browser/UAT or production readiness claim.

## Baseline and isolation

The implementation starts from Stage 3C-2 commit `4fde51836999b271d7470c465a762fa5e9aa78b7` on `codex/stage-3c-billing-invoice`. The requirements/design gate is committed as `59538b8`. Existing unrelated edits to `next-env.d.ts`, `src/app/globals.css` and `src/features/auth/login.tsx` are preserved and excluded from milestone commits and the verification image.

All Stage 3C-3 database commands use the new PostgreSQL 17.11 container `taky-stage3c3-db`, loopback port `55434`, database `taky_phase2_test`, role `stage3c3_test`. The ignored runner checks the exact connection URL and queries `current_database()` and `current_user` before executing a child command. Credentials remain in ignored mode-600 files under `.local`. No production database, existing deployment container or volume has been reset, recreated or removed.

In commands below, `ISOLATED` means:

```sh
node --env-file=.local/stage3c3-test.env .local/run-stage3c3.mjs
```

## Executed checks

| Check                                            | Command or evidence                                                                                                                   | Actual result                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline database                                | `ISOLATED npx prisma migrate deploy --config .local/stage3c3-baseline/prisma.config.ts`                                               | PASS. Applied the original 10 migrations to the new isolated database.                                                                                                                                      |
| Synthetic seed and accounts                      | `ISOLATED npx tsx prisma/seed.ts`; `ISOLATED npx tsx scripts/test-users.ts`                                                           | PASS. Synthetic test target only.                                                                                                                                                                           |
| Migration preflight                              | Identity-checked `.local/stage3c3-legacy-setup.mjs`                                                                                   | PASS. One legacy issued invoice and one item, zero payment links, zero duplicate active slots, zero noncanonical dates or malformed numbers in this synthetic sample.                                       |
| Initial new migration attempt                    | `ISOLATED npx prisma migrate deploy`                                                                                                  | FAIL. Generic schema engine error. Direct inspection showed 10 existing migrations, no new migration records and no freeze table. Cause was not established. No reset or resolve was used.                  |
| Schema validation during migration investigation | `ISOLATED npx prisma validate`                                                                                                        | PASS at that checkpoint. Final validation remains pending.                                                                                                                                                  |
| New migrations                                   | `ISOLATED node node_modules/prisma/build/index.js migrate deploy`                                                                     | PASS. Applied invoice lifecycle and reference capacity migrations. 12 migrations total at this checkpoint.                                                                                                  |
| Legacy retention                                 | Parameterized queries compared every original invoice/item field with saved pre-migration JSON                                        | PASS. Original fields retained; canonical/freeze/snapshot fields remain unmapped. Existing `INV-202602-0042` seeds February counter 42. No inferred legacy billing source.                                  |
| Migration status                                 | `ISOLATED node node_modules/prisma/build/index.js migrate status`                                                                     | PASS. All 12 migrations current at this checkpoint.                                                                                                                                                         |
| Schema drift                                     | `ISOLATED node node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | PASS. No difference, exit 0 at this checkpoint.                                                                                                                                                             |
| First focused PostgreSQL run                     | `ISOLATED npx vitest run --config vitest.integration.config.ts tests/integration/invoices.test.ts`                                    | FAIL. 18/18 fixtures failed because Prisma cannot deserialize PostgreSQL `void` from advisory-lock `$queryRaw`. Shared/exclusive/command-key lock calls changed to `$executeRaw`; SQL migrations unchanged. |
| Second focused PostgreSQL run                    | Same command                                                                                                                          | FAIL. 17/18 passed. Remaining failure was a serialization conflict while concurrently preparing rate-approval fixtures, before simultaneous numbering assertions. Investigation and rerun pending.          |

## SQL review and migration risks

The first applied migration SHA-256 is `ecad786fab9df0119c278242e0f488b58bf22e03b0e33d84d0c84fdf2f154497`. The reference-capacity migration SHA-256 is `a7ebc421c236dd04049e973e7088321e579874bf986765cb698b0f28b4f2d98a`.

The design replaces all-status lease/date uniqueness with active-slot uniqueness, adds canonical provenance, immutable source/history guards, a monthly counter and restrictive actor/source references. The second migration widens reference quantity/unit-price columns without changing stored values. Constraint/index/trigger installation and numeric column alteration can lock tables. These changes have only been applied to the isolated synthetic database. Actual operational legacy inventory, date/number shapes, mapping, backup and migration rehearsal remain mandatory before production use.

Independent review identified SQL NULL handling, historical issuer deactivation, actor references, freeze membership, snapshot binding, zero-quantity utility lines and reference column capacity issues. The implementation addresses these findings. Final regression evidence is still being collected.

## Final service and migration results

| Check                            | Actual command/result                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final invoice PostgreSQL         | `ISOLATED npx vitest run --config vitest.integration.config.ts tests/integration/invoices.test.ts`: PASS, 19/19 after the third migration and no-op fix.                                                                                                                                                                                                                  |
| Combined related PostgreSQL      | `ISOLATED npx vitest run --config vitest.integration.config.ts tests/integration/invoices.test.ts tests/integration/billing-preview.test.ts tests/integration/finance-foundation.test.ts tests/integration/room-assignment.test.ts`: PASS, 57/57 in four files. This is 19 invoice, 23 billing and 15 finance/lease cases.                                                |
| Meter regression                 | Fresh isolated port 55436: `node --env-file=.local/stage3c3-legacy.env .local/run-stage3c3-legacy.mjs npx vitest run --config vitest.integration.config.ts tests/integration/meter-reading.test.ts`: PASS, 14/14.                                                                                                                                                         |
| Unit tests                       | Final `npm run typecheck && npm run lint && npm test`: PASS, exit 0; 120/120 unit tests in eight files.                                                                                                                                                                                                                                                                   |
| Formatting                       | Scoped `npx prettier --check` over all changed/new milestone TypeScript, TSX, CSS and both verification scripts: PASS. Unrelated global/login edits excluded.                                                                                                                                                                                                             |
| Final Prisma schema/status/drift | `ISOLATED node node_modules/prisma/build/index.js validate`; `migrate status`; `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`: PASS, valid schema, all 13 migrations current, no difference, exit 0.                                                                                                                                |
| Third migration                  | Identity-checked deploy on 55434: PASS. SHA-256 `8e26a7e619b091707029c7446944e8b7bc922cf217fd82bd1761990e6d9dcf54`. Independent and mechanical comparison retained every previous guard and changed only the legacy date predicate.                                                                                                                                       |
| Mid-month legacy migration proof | New PostgreSQL 17.11 container `taky-stage3c3-legacy-range-db`, loopback 55436, same isolated database/role. Applied baseline 10 migrations, inserted synthetic `INV-202602-0042` with period February 15, then applied all three new migrations: PASS.                                                                                                                   |
| Mid-month service/DB barriers    | `node --env-file=.local/stage3c3-legacy.env .local/run-stage3c3-legacy.mjs npx tsx .local/stage3c3-legacy-range-verify.ts`: PASS. Original invoice/item fields unchanged, provenance unmapped, counter 42, service rejects with LEGACY_MAPPING_REQUIRED and direct managed insertion raises the legacy mapping guard. Rejections create no invoice, command or audit row. |

The invoice cases cover incomplete/forged closure, complete frozen membership and labels, exact engine parity, missing due policy and explicit refresh, STAFF restrictions, overrides/stale versions, zero utility reference lines, draft/key races, simultaneous global issuance, immutable snapshots/items, active-slot uniqueness, retained void history, atomic corrections, non-branching revisions, audit rollback, number exhaustion/reset/delete protection, empty/historical periods, source-writer cutoff, disabled historical issuer, unprepared/VOID room reservations, numeric capacity and unchanged corrections.

### Failed or superseded verification attempts

- Related suites initially failed while another active user chat was writing the same isolated database. Observed failures included changing whole-database counts during read-only checks and serialization conflicts. After explicit owner authorization, cross-chat coordination stopped the second writer. The runner now holds a separate verification advisory lock throughout child commands. The later isolated runs above provide pass evidence. The overlapping failures are not represented as financial behavior passes.
- The old meter suite cannot reuse its fixed TAKY property/month fixture. A reused-target attempt passed 15 finance/lease tests but skipped all 14 meter cases after setup hit the existing unique period constraint. It did not pass meter verification. A new isolated target preserved the original database and passed all 14 meter cases.
- An attempted fresh container on port 55435 failed to start because the second chat had already allocated that port. The created, non-running container was left intact. The primary chat used the separately checked free port 55436. No container or volume was deleted.
- The standalone legacy proof initially failed before execution because TSX used CommonJS and rejected top-level await. After an async entry was added, a direct-insert assertion used a date string rather than a Prisma Date and failed at client validation. The next retention comparison mixed node-pg local DATE parsing with Prisma UTC parsing. The final proof uses the same node-pg parser as its pre-migration evidence and passed; none of these harness failures proved a database guard passed. The original date values did not change.
- The first mechanical SQL comparison used a CREATE OR REPLACE-only regex against the original CREATE FUNCTION and failed. Manual review had already inspected the complete SQL; the corrected mechanical comparison and independent reviewer confirmed the sole predicate change.
- node-pg emits an existing concurrent-client-query deprecation warning during Prisma integration operations. All final assertions passed with the installed versions. This report does not claim compatibility with a future pg major version.

## Production image and API verification

The source copy `.local/stage3c3-final-source-20261021` combines committed baseline files and intended milestone changes. The three unrelated user files use their HEAD contents. A SHA-256 manifest records the copy. No environment/credential file enters the Docker context.

The first production image attempt reached Next build but failed because its cached npm install layer lacked the Linux ARM64 GNU SWC binding. WASM fallback cannot run Turbopack. The retry installed the same lockfile dependencies afresh with optional packages included and explicitly required the native binding before generation/build. It passed Prisma generation, production Turbopack compilation, TypeScript, page generation, image export and unpacking, exit 0. No dependency version or repository Dockerfile changed.

```sh
docker build --progress=plain \
  -f .local/stage3c3-final-source-20261021/Dockerfile.verify \
  -t taky-stage3c3-verify:final .local/stage3c3-final-source-20261021
```

The verification Dockerfile differs from the repository Dockerfile by `npm ci --include=optional` plus an explicit `require('@next/swc-linux-arm64-gnu')` installation assertion, and `NODE_OPTIONS=--max-old-space-size=1024` on generation/build. This verifies the production application on this Linux ARM64 image; it does not prove a broken cached install layer is usable. The earlier parallel chat's Docker attempts timed out fetching Node metadata and are not passing evidence.

Image: `taky-stage3c3-verify:final`, ID `sha256:1ef9d948e73a1cadcded82fd3fc11cc3016435c55889fb5b065e375e2105cb14`. Build log: ignored `.local/stage3c3-final-build-retry.log`.

The dedicated `taky-stage3c3-api` container maps loopback `3900` to 3000 on the isolated verification network and connects only to the 55434 target through its Docker hostname. Its command is explicitly `node server.js`, so the normal automatic migrate/seed startup is not run. The first health probe arrived before startup and returned an empty reply; the later health response was `{"status":"ok"}`.

`ISOLATED node scripts/verify-invoices-api.mjs`: PASS, 46 checks against the production image. The repeat after the first browser harness fix also passed 46/46 with fresh synthetic fixtures. Checks cover identity/login, no-store/read-only behavior, validated close, unauthorized roles with unchanged financial state, missing due configuration, explicit policy/refresh/override, draft and issue replay, exact 1050.01 total with 1050.02 reference sum and -0.01 reconciliation, Origin/body validation, atomic evidenced estimate correction to 1070.02, new number/history, void retention, audit and unchanged closed inputs. These are synthetic requests, not real invoices.

## Focused browser QA

`ISOLATED node scripts/verify-invoices-browser.mjs`: PASS, nine groups, exit 0. Browser plugin not available; the installed Playwright with Chrome was used. Target was exactly `http://127.0.0.1:3900/billing/`, locale th-TH, timezone Asia/Bangkok, desktop 1440x1000 and mobile 390x844.

The flow under test was billing entry, STAFF frozen-lease draft preparation and notes, ADMIN confirmation/issuance, evidenced estimate revision, retained original/chain, required-reason void, mobile filters and policy dialog. The script verifies real request payloads, optimistic versions, command keys, statuses, exact totals, due dates and frozen input retention. It rejects a previously consumed browser fixture rather than clearing data.

| Browser check                        | Result                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Page identity and meaningful content | PASS. Exact origin/path, Taky Apartment ERP title and invoice heading.                                                                        |
| Framework overlay                    | PASS. No Next/Vite/Webpack error overlay or application error text.                                                                           |
| Console health                       | PASS. No captured browser console errors or page errors.                                                                                      |
| STAFF restrictions and drafts        | PASS. Financial ADMIN controls absent; preparation and notes succeed without financial/due changes.                                           |
| ADMIN lifecycle                      | PASS. Issue confirmation, evidenced replacement with new number/linked VOID predecessor, required void reason and retained immutable content. |
| Mobile                               | PASS. Filters/detail and policy dialog usable; document/body and dialog horizontal bounds verified.                                           |
| Screenshots                          | PASS. Actual desktop and mobile captures inspected manually; no clipping/overlap finding requiring a fix.                                     |
| Frozen evidence                      | PASS. Before/after frozen lease records identical.                                                                                            |

Screenshots are outside the repository under `/private/tmp/taky-stage3c3-qa/`: `desktop-staff-draft.png`, `desktop-admin-revision.png`, `mobile-invoice-detail.png`, `mobile-policy-dialog.png`. They contain synthetic data only. The desktop revision and mobile policy captures were visually inspected. The earlier failure capture remains separate.

The first browser attempt passed fixture identity and STAFF page/permission groups, then failed on an ambiguous amount locator matching both the main total and revision-history total. The locator now targets the main strong total explicitly; application code was unchanged and a fresh HTTP fixture was created. The later complete nine-group run is the pass evidence. The host verification script contains this locator correction; production runtime source hashes still match the image manifest.

## Review, commits and limits

Independent read-only review confirmed the final no-op correction and full-month legacy guards, with no remaining blocking finding. Review is separate from root-executed runtime evidence.

- Gate A: `59538b8`, requirements/design/decisions.
- Gate B: `0271ea05371a7781a89041731047bb5816e62934`, immutable lifecycle, freeze, migrations and service regressions.
- Gate C: `3d6cc8c07aa2a1de6344fbda0d7db4e423317a92`, protected APIs, operator UI and reproducible HTTP/browser verification scripts.
- Gate D: documentation closure commit is the latest commit touching this report. Resolve with `git log -1 --format=%H -- STAGE_3C3_TEST_REPORT.md`.

No remote push, production migration, real billing or deployment occurred. The three unrelated working-tree changes remain preserved outside milestone commits. The temporary verification containers/data are retained; only this chat's completed running verification services are stopped during closure, without deleting containers or volumes. Automatic approval review did not block the executed isolated checks; no security control was bypassed.

Limitations: one Chrome version, two viewports, synthetic tenants/sources and focused interactions. The broader historical Stage 3B browser suite was not rerun. Other browser engines, operator acceptance, actual production legacy data and commissioning remain unverified. Optional future Browser plugin installation would provide in-app browser inspection; its absence did not prevent the recorded Playwright checks.

The historical Stage 3B full browser result remains 14/15. This milestone does not establish operator acceptance, real legacy mapping, backup/restore commissioning, deployment readiness or permission to issue real invoices.
