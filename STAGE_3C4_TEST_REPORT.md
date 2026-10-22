# Stage 3C-4 verification report

Date: 2026-10-22, Asia/Bangkok. Final result: automated verification PASS. Owner UAT and production readiness remain pending.

## Targets and invocation

Commands run from the Stage 3C-4 worktree. The current app is the production Next.js standalone build on 127.0.0.1:3800, connected only to the task-owned 55440 database. Integration tests use a different container/volume on 55441. Database identities were checked before fixture writes. UAT port 3700 is never a test target.

Private environment is loaded with `node --env-file=.local/stage3c4/.env`. Child Node commands run through `.local/stage3c4/run.mjs`, which spawns Node without inherited execArgv. This avoids Next forwarding the --env-file CLI argument into NODE_OPTIONS, where Node rejects it. The integration lane uses `.integration.env` instead. No secret values belong in reports or Git.

## Final evidence

All paths below are relative to this worktree and ignored evidence is retained locally.

| Check                         | Command or method                                                                                                   | Result / evidence                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Unit                          | npm test                                                                                                            | 120/120, eight files; `.local/stage3c4/unit-final.log`              |
| Configuration guards          | node --test scripts/invoice-verification-config.test.mjs                                                            | 7/7; `.local/stage3c4/config-final.log`                             |
| PostgreSQL                    | isolated runner, node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts                           | 81/81, six files, no skips; `.local/stage3c4/integration-clean.log` |
| Full configured browser suite | isolated runner, node_modules/@playwright/test/cli.js test --reporter=list                                          | 46/46; `.local/stage3c4/browser-verified.log`                       |
| Invoice HTTP                  | isolated runner, scripts/verify-invoices-api.mjs                                                                    | 46 checks; `.local/stage3c4/invoice-api.log`                        |
| Invoice browser               | isolated runner, scripts/verify-invoices-browser.mjs                                                                | nine groups; `.local/stage3c4/invoice-browser.log`                  |
| Operations                    | npm run test:ops                                                                                                    | 8/8; `.local/stage3c4/ops.log`                                      |
| Production build              | isolated runner, node_modules/next/dist/bin/next build                                                              | PASS; `.local/stage3c4/build-final.log`                             |
| Static                        | npm run typecheck; npm run lint; scoped Prettier; git diff --check                                                  | PASS                                                                |
| Schema and migrations         | prisma validate; migrate status; migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code | Valid, 13 applied migrations, zero drift, exit 0                    |

The production launch copies `.next/static` into `.next/standalone/.next/static` and runs `.next/standalone/server.js` with NODE_ENV=production, HOSTNAME=127.0.0.1 and PORT=3800. The task-private `.local/stage3c4/start.mjs` records that launch. The repository Dockerfile was not modified or rebuilt in this milestone; this result verifies the host production standalone build, not a new container image.

## Browser evidence

Browser plugin is not available. Verification used installed Playwright with Chrome, locale th-TH and timezone Asia/Bangkok. Route/accessibility checks cover 1440, 768 and 390px. Meter workflows cover 1440 and 390px. Existing transfer workflows also cover 834px. Invoice QA uses 1440x1000 and 390x844.

The meter flow is entry -> filter/room selection -> rejected decreasing input -> confirmation -> evidenced ADMIN correction -> replacement -> history -> STAFF confirmation and denied ADMIN command. It verifies backend values and rendered timestamps. Expected validation and authorization failures are checked explicitly.

The deterministic race scenario delays real overview responses, releases them out of order, verifies no stale actionable form, preserves the other utility's unsaved input through save/filter/period changes, and prevents a stale history dialog. A delayed draft command proves all relevant controls stay locked and repeated clicks send only one POST. Server-rendered selector markup is checked as disabled, then hydrated selection is checked against the form's billing-period date bounds.

The full configured suite passed with no relevant page errors in its asserted flows, meaningful titles/headings, no framework overlay, accessibility/viewport assertions and actual screenshots. Invoice QA additionally asserts no captured browser console or page errors and unchanged frozen sources. Root visually inspected `screenshots/3c4-history-1440.png` and `screenshots/3c4-history-390.png` beneath `.local/stage3c4`; no clipping or overlap finding remained.

Meter screenshots are under `.local/stage3c4/screenshots`. Invoice screenshots are under `.local/stage3c4/invoices`. They contain synthetic test data. Historical unconfigured Phase 1 demo specs remain excluded: they expect unauthenticated demo tenants/invoice/payment behavior that current live screens replaced. Their route/accessibility coverage is represented by the current authenticated route suite; their deferred demo financial scenarios are not claimed as production acceptance.

## Failed or superseded runs

- Directly launching Next with Node --env-file failed because Next forwarded it through NODE_OPTIONS. The private spawn wrapper corrected the launch. No application or database behavior passed in that failed start.
- Initial dev-runtime browser run finished 3/16 with 13 failures. It included React dev eval errors under the production CSP, request timeouts and browser-launch timeouts. Initial integration run passed 65 cases, failed seven and skipped nine on timeouts. These are retained as failed evidence in `browser-existing.log` and `integration.log`, not counted as passes. The exact environmental cause of every timeout is not established.
- First production browser aggregate passed 15/19. The room-edit test reloaded before the save response, one ten-route smoke test exceeded its shared timeout, and two new meter cases initially expected the wrong status. `browser-production.log` retains the failures. The save now awaits PUT, and route checks each retain the existing timeout.
- Clean integration replay passed 78/81. The meter suite shared TAKY with other suites' leases, so validated closure correctly rejected incomplete billing inputs. The meter suite now owns a dedicated property, with M-prefixed room numbers to avoid unscoped numeric room lookups elsewhere. A repeat run also exposed a too-long temporary fixture label and reused-target interference. `integration-r2.log` and `integration-verified.log` retain those failures; `integration-final.log` has an intermediate 81/81 pass. The final bounded-label run on a fresh target passed 81/81 in `integration-clean.log`.
- Next production browser aggregate passed 44/46. Desktop trace showed an August reading date sent against October after an early pre-hydration selector change was lost. The selector now stays disabled until handlers attach. Another failure matched both the application error and Next route announcer; the test now targets the application error. `browser-final.log` retains this failed aggregate. The final rebuilt production run passed 46/46 in `browser-verified.log`.
- Existing node-pg concurrent-client-query deprecation warnings occurred during integration and invoice work. Final assertions passed with installed versions; no claim is made about a future pg major version.

The historical Stage 3B 14/15 aggregate is unchanged. Its known fixture-cleanup timeout was not fully reconstructable; all current Phase 2.6 transfer scenarios passed in the final complete aggregate. Human operator acceptance, Safari/other browser engines, operational legacy data, production backup/restore and deployment are not established by these synthetic Chrome checks.
