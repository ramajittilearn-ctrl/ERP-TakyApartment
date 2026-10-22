# Stage 3C-2 test report

Date: 2026-10-20. Stage 3C-2 verification is complete for development. Results use synthetic data only. Production billing remains NO-GO.

## Isolated targets and data protection

The existing PostgreSQL 17 test container `taky-stage3c2-db` uses database `taky_phase2_test`, role `stage3c_test`, and loopback-only port 55432. `.local/run-stage3c2.mjs` verifies the URL hostname/port/database/role, then queries the actual database and role before executing child commands.

A fresh PostgreSQL 17.11 container, `taky-stage3c2-final-db`, uses the same synthetic database/role names on loopback-only port 55433. `.local/run-stage3c2-final.mjs` enforces that exact target and queries its identity. It was created after an existing Stage 3B fixture collision prevented a complete rerun on the reused test database. The original database was preserved. Both test containers use the dedicated `taky-stage3c2-verify` network.

Only these isolated targets received migrations and synthetic fixtures. No normal deployment or production database was reset, recreated, migrated, seeded, billed or backfilled. Test credentials and runner settings are ignored under `.local`; no secrets are committed or printed. Existing deployment containers were left untouched.

## Final source evidence

The unchanged local checks from the completed implementation are retained here; they were not repeated during closure. The database checks below executed during closure against the final allocation implementation and occupancy guard.

| Check | Executed command/result |
|---|---|
| Prisma validation | `npx --no-install prisma validate`: PASS on the final model schema. |
| TypeScript | `npm run typecheck`: PASS, exit 0. |
| Unit tests | `npm test`: PASS, 111/111 in 7 files, comprising 61 billing calculation tests, 10 allocation helper tests and 40 existing tests. |
| ESLint | `npm run lint`: PASS, exit 0. |
| Formatting | Scoped milestone source and the baseline plus intended source copy passed repository Prettier patterns. Whole-workspace formatting encountered unrelated concurrent globals.css/login.tsx warnings; those edits were preserved. |
| Pending migration | Original isolated target: `npx prisma migrate deploy`: PASS, applied `202610200002_phase3c2_lease_allocations`. |
| Focused PostgreSQL | Original isolated target: `npx vitest run --config vitest.integration.config.ts tests/integration/billing-preview.test.ts`: PASS, 23/23. Includes tenant turnover with evidence, concurrent aggregate allocation limits and rejection/no writes for usage measured entirely after tenancy. |
| Fresh migration chain | Fresh isolated target: `npx prisma migrate deploy`: PASS, all 10 migrations applied from an empty test database. |
| Synthetic fixtures | Fresh isolated target: `npx tsx prisma/seed.ts` and `npx tsx scripts/test-users.ts`: PASS after database identity verification. |
| Full PostgreSQL regressions | Fresh isolated target: `npm run test:integration`: PASS, 62/62 in 5 files, including 39 existing Stage 3A/3B/foundation tests and 23 billing tests. |
| Migration status | Both isolated targets: `npx prisma migrate status`: PASS, all 10 migrations applied and up to date. |
| Schema drift | Both isolated targets: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`: PASS, no difference, exit 0. |
| Final production build | `docker build --progress=plain -f .local/stage3c2-build/Dockerfile.verify -t taky-stage3c2-verify:stage3c2-final .local/stage3c2-build`: PASS, exit 0. Prisma generation, Next compile, TypeScript, page generation and runnable image export all completed. |
| Focused HTTP/API | Original isolated guard prefix plus `node scripts/verify-billing-api.mjs`: PASS, 11 checks against the final production image on loopback port 3800. |
| Independent review | Read-only engine/service review and follow-up occupancy-guard review found no further actionable defects. Closure manifest review confirmed all 24 intended milestone files and no Stage 3C-3 implementation or unrelated UI files. |

The original guard prefix was `node --env-file=.local/stage3c2-test.env .local/run-stage3c2.mjs`. The fresh-target prefix was `node --env-file=.local/stage3c2-final-test.env .local/run-stage3c2-final.mjs`. The command column lists the child commands after these prefixes. Every migration, fixture and integration command was guarded.

Approval rollback tests create a temporary failure trigger on the isolated AuditLog and remove it in finally. Tests verify atomic audit/approval rollback, STAFF denial, immutable revision history, closed-period protection, canonical source staleness and read-only preview counts. Existing finance/meter implementations and tests were preserved.

## Production artifact and HTTP verification

The final image is `taky-stage3c2-verify:stage3c2-final`, image ID `sha256:17899e1aea6ea4f1ad9b4d09c03522f4bbd777284f5663e8f9c5534f8d92ddc1`. The temporary Dockerfile differs from the repository Dockerfile only by applying `NODE_OPTIONS=--max-old-space-size=1024` to generation and build commands. No Dockerfile or dependency changes are part of the milestone. The final build was slow during generation and image unpacking but completed with exit 0; no cause is asserted.

The build context used the Stage 3C-1 baseline plus the intended milestone files. A byte comparison confirmed all 17 implementation/schema/migration/test files match the final working-tree sources exactly. Later changes are verification documentation only. Build logs and source hashes are retained under ignored `.local`.

The dedicated API was started with:

```sh
docker run --detach --name taky-stage3c2-api --network taky-stage3c2-verify --env-file .local/stage3c2-app.env --publish 127.0.0.1:3800:3000 --memory 512m --cpus 1 taky-stage3c2-verify:stage3c2-final node server.js
curl --silent --show-error --max-time 10 --fail http://127.0.0.1:3800/api/health/
node --env-file=.local/stage3c2-test.env .local/run-stage3c2.mjs node scripts/verify-billing-api.mjs
```

The explicit `node server.js` command starts the server without running the image's default automatic migration/seed startup. Its settings were checked to reference only `taky-stage3c2-db`, the synthetic database and the loopback test origin. Health returned `{"status":"ok"}`. The 11 checks passed: unauthenticated preview denial, STAFF/ADMIN login, read-only/no-store preview, STAFF denial of both approval commands, invalid Origin denial, invalid quantity rejection, malformed period ID rejection, ADMIN rate approval with audit, and ADMIN estimate approval with audit. Denied/read-only requests left the checked financial/reading/approval/audit counts unchanged.

The fresh regression database was stopped after verification with its data retained. The dedicated API was stopped after the HTTP checks. The original isolated database remains available; no existing deployment container was stopped or changed.

## Closure failures investigated

- A full rerun on the reused 55432 test target failed in the existing Stage 3B meter suite before its tests initialized. Its fixture creates fixed months on seeded property TAKY, and an earlier run already created them. PostgreSQL reported `BillingPeriod_propertyId_startsOn_key`; 48 tests passed and 14 were skipped, with one failed suite. No production or billing calculation failure was inferred. The complete suite subsequently passed 62/62 on the fresh isolated target without changing application or existing test code.
- An initial fresh-target readiness probe reported no response while PostgreSQL initialized. The identity guard then exited with `Connection terminated unexpectedly` before executing any migration or fixture child command. After Docker reported healthy and PostgreSQL logged readiness, the guarded migration/fixture/full-suite chain passed.
- PostgreSQL integration emits the existing pg concurrent-query deprecation warning. Tests passed; the warning was retained.

## Earlier implementation failures and corrections

- Initial in-progress typecheck exposed test fixture discriminator/indexing mistakes; corrected before passing checks.
- Initial drift returned exit 2 for a PostgreSQL-truncated long index name. Explicit Prisma mapping corrected it without modifying an applied migration or altering financial records; final drift is empty.
- An unrestricted earlier Docker build compiled, then stalled in TypeScript while the original isolated PostgreSQL server entered recovery. It was cancelled with exit 130. Database logs showed a backend exit and recovery; memory causation was not established. A focused test attempt during recovery failed before initialization, then passed after recovery.
- A 512 MiB Node heap build compiled but failed during TypeScript with an explicit heap allocation error. A later 1 GiB intermediate-source build succeeded. Neither result substitutes for the final production build.
- Review found an allocation could assign February 20–28 usage to a lease ending February 10. The symmetric occupancy guard fixed this. Both the unit and final PostgreSQL rejection/no-writes regressions now pass.
- Earlier automatic approval review reached its account usage limit, so the attempted final build at that time did not execute. This was review unavailability, not an unsafe-action rejection. Closure resumed after the environment permissions changed; no review control was bypassed.

## Limits and continuing gates

The production build uses the Stage 3C-1 baseline plus the 24 intended milestone files. Concurrent login/style/generated declaration edits are excluded from that context and from the milestone commit. They remain in the working tree.

No rendered UI changed in this milestone, so no broad Playwright suite was run. Historical Stage 3B full browser remains 14/15. Operations/backup suites were not rerun because their implementation is unchanged. Stage 3C-4 owns full browser/UAT and comprehensive release closure.

F-04/F-08 remain rollout/pre-release gates; F-05 remains the history timestamp follow-up. F-06 remains mandatory before actual billing because the intended production target and legacy meter inventory remain unverified. Candidate source sets remain PREVIEW_ONLY and ineligible for issuance. Validated close/freeze, invoices, numbering, lifecycle, payments and production deployment are outside this milestone.

No Stage 3C-2 functional verification finding remains open. The reused-database fixture collision remains a test repeatability limitation documented above. Stage 3C-3 development may begin with these limits and the design handoff. Stage 3C as a whole is not closed.
