# Remediation test results

Execution date: 2026-10-22. Worktree: `/private/tmp/taky-audit-remediation`. Branch: `codex/audit-remediation`. Baseline: `701acf8`. Evidence directory: `evidence/remediation/`.

## Final verification

| Check | Command | Actual result | Evidence |
| --- | --- | --- | --- |
| Dependencies | npm ci | 449 packages; exit 0 | dependencies.log |
| Prisma client | npx prisma generate | PASS, exit 0 after sandbox cache-write failure | generate.log; generate-approved.log |
| Unit/security configuration | npm test | 137/137, nine files; exit 0 | unit-complete.log |
| Authentication reproduction | vitest auth-throttle against baseline auth | 4 passed, 4 failed; exit 1 | auth-before.log |
| Authentication fixed | same eight PostgreSQL tests | 8/8; exit 0 | auth-after.log |
| Integration/authorization/financial invariants | npm run test:integration | 89/89, seven files; exit 0 | integration.log |
| Operations/proxy | npm run test:ops | 9/9; exit 0 | ops-final.log |
| TypeScript | npm run typecheck | PASS, exit 0 | typecheck-complete.log |
| ESLint | npm run lint | PASS, zero warnings; exit 0 | lint-complete.log |
| Prettier | npm run format:check | PASS, exit 0 | format-complete.log |
| Prisma schema | npx prisma validate | PASS, exit 0 | prisma-validate.log |
| Migrations | prisma migrate deploy; migrate status | 13/13 applied, up to date; exit 0 | integration-migrate.log; migration-status.log |
| Schema drift | prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code | No difference; exit 0 | drift.log |
| Production build | npm run build | PASS, 21 generated pages/routes; exit 0 | build-final.log |
| Standalone startup | HOSTNAME=127.0.0.1 PORT=3820 node .next/standalone/server.js | Health and browser workflows execute using standalone output; intentional SIGTERM on cleanup | browser-*/standalone-*.log |
| Browser repeat run 1 | node scripts/run-remediation-browser.mjs | 49/49; zero skipped, flaky or unexpected; exit 0 | 71bd7150624d59bb8fc215f0-browser.log; browser-71bd7150624d59bb8fc215f0/results.json |
| Browser repeat run 2 | same workflow, new project/role/volume | 49/49; zero skipped, flaky or unexpected; exit 0 | af964af3735651e8927f1337-browser.log; browser-af964af3735651e8927f1337/results.json |
| Early setup cleanup | runner --fail-setup | Expected exit 1 after provisioning; cleanup exit 0; following run can bind ports | setup-failure-retry.log; 47e3f9b4466e95aa7a594e6d-cleanup.log |

## Target identities

Integration used project `taky-remediation-integration-0424e3080914a8be55722f3f`, role `int_0424e3080914a8be55722f3f`, database `taky_phase2_test`, loopback port 55451 and its own volume. Browser runs use loopback DB port 55452, app 3820 and allowlist proxy 3822. Every browser run has its own `browser-<run-id>.json` manifest with project, role, volume and target identifiers. Private environment files are excluded from Git.

The health challenge binds a random nonce to the actual connected `current_database()` and `current_user`, run ID and private per-run HMAC key. Each test verifies this before fixtures. Node and browser sentinel checks reject unauthorized destinations, including through redirects and page-level fetch hooks. Effective base URL, proxy, launch and remote-browser overrides fail closed.

## Failed and superseded attempts

All outcomes below remain failures or expected negative checks. They are not counted as successful full verification.

- Initial worktree creation was blocked by sandbox metadata permissions; an approved retry completed. Dependency/client setup included a Prisma cache timestamp permission failure, followed by successful generation.
- Baseline-build and baseline-build-retry failed on newly authored test-helper types. Baseline-build-typed passed before invoice UI changes. The helper errors were corrected rather than bypassing type checking.
- The first accessibility helper used browser.newPage instead of an explicit context, which axe rejected. After correcting setup, a first interception pattern did not reliably hold the request. The final regex reproduction asserts the reload control remains disabled throughout the stable loading scan.
- Stable loading reported zero axe violations. Populated invoice metadata reported 4.14:1 against white. `invoice-accessibility-before.json` records the genuine ready-state defect. The historical audit's exact disabled-control 2.58:1 transient was not reproduced; it remains a synchronization inference supported by the missing readiness wait and stable-state results.
- Browser `a34a7521f15975da425ecea9` was interrupted after native context-request replacement broke route.fetch. Outcome: 2 passed, 6 failed, 1 interrupted, 38 did not run, exit 130. The incompatible wrapper was removed.
- Provision `21f53f1a69c665d38692b64d` failed because Docker's network address pool was exhausted. Only this remediation's prior browser container/network was removed, preserving its volume. Normal cleanup now releases the current run's network.
- Target check `d856bdcace49ed5c6908afdb`: 2/5 passed, 3 failed because Playwright's HTTP API uses CONNECT transport. The proxy now permits only the exact isolated app CONNECT destination.
- Target check `21e78d8eca641af6c6cbc395`: 4/5 passed. The new guard test incorrectly assumed /rooms returned an HTTP redirect; Next rendered its redirect through the page response. The test now uses the actual /api/health trailing-slash HTTP redirect.
- Full browser `93e8a9f8125a0ff4b50914a0`: 48/49 passed, exit 1. Its negative route.fetch test correctly blocked the destination but expected a 403 response object where Chrome reported ERR_HTTP_RESPONSE_CODE_FAILURE. The corrected test checks the denied fetch status, Chrome error and zero sentinel requests.
- An initial lint check failed on a browser-global reference in the reproduction script. It was corrected; no lint rule was disabled.

## Evidence limits

The command index `commands.jsonl` records actual commands, start/end times, environment identifiers, log paths and exit codes. Logs preserve command output with private environment values redacted. Historical audit raw logs were not retained and have not been reconstructed. Tests use Chrome on this host; Safari, physical devices, real HTTPS/LAN deployment, off-site backup and operational data are outside this verification. The pg concurrent-query deprecation warning remains; the PostgreSQL suite passed. No production GO is inferred.

## Final review and cleanup

The independent read-only reviewer checked both complete browser logs and JSON stats, distinct target manifests, standalone startup, injected-failure cleanup and all final verification logs. It supports F-11/F-12/F-13 closure, F-09 partial resolution and F-06/F-10 remaining open. The exact historical transient mechanism remains an inference. `independent-review.md` records that received review.

`environments-final.log` reports no running remediation containers. Generated volumes remain. `uat-final.log` confirms the same UAT container identities and pre-remediation start times. `active-checkout-after.log` retains the original changed paths; it is not a before/after content-hash comparison. `redaction-check.json` records a scan for generated private environment values with no matches in candidate artifacts.

The complete staged Git whitespace check exits 2 because raw Docker/Playwright logs include emitted trailing spaces. Those logs are preserved rather than edited. The source/document check excluding the evidence directory exits 0. See `staged-diff-check.log` and `source-diff-check.log`. This does not alter the passing lint/format checks or suppress any test rule.
