# Monthly Billing UI Test Report

## Environment and safety

All automated integration and browser checks used the dedicated remediation test database and fictional records. The browser runner used an isolated Compose project, database role, volume, network, and loopback ports. The test target guard confirmed `http://127.0.0.1:3820`; Owner UAT at port 3700 and candidate at port 3701 were not used as test targets. No real tenant data was copied or modified.

The remediation harness was assigned explicit private subnets for its integration and browser networks because the host's Docker default address pools were exhausted. This is limited to the local test harness and does not change application runtime or any existing UAT network.

## Automated results

| Check | Result |
|---|---:|
| TypeScript typecheck | PASS |
| ESLint | PASS |
| Prettier format check | PASS |
| Unit suite | PASS — 141 tests across 10 files |
| Integration suite | PASS — 92 tests across 7 files |
| Production build | PASS — Next.js 16.4.1; all routes generated |
| Targeted billing setup browser test | PASS — 1/1 (final run `7bf3b01158a9671b4d31d6d9`) |
| Full isolated browser regression | **FAIL — 24/50 passed** on the final retry |

Commands run: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and `npm run test:integration` with the isolated integration environment. Browser checks used `node scripts/run-remediation-browser.mjs --billing-setup` and `node scripts/run-remediation-browser.mjs` (full suite).

## Billing behavior exercised

The new browser test signs in as ADMIN and uses fictional tenant and lease fixtures. It exercises the UI to:

1. Create a monthly billing period and verify the selected period and dates/status.
2. Reject a duplicate period while retaining the existing period.
3. Add effective-dated water and electricity rates and select those rates for the period.
4. Reload and verify the period and persisted selection history remain visible.
5. Enter and confirm water/electricity meter readings through the meter UI.
6. Calculate the invoice values using the selected approved rates, then close the period through the existing workflow.
7. Set the existing due-date policy, prepare a draft, issue the invoice, and download its PDF.
8. Sign in as STAFF, verify the ADMIN-only forms are absent, and verify direct requests to create a period, rate, or selection receive HTTP 403.

Integration tests verify period creation authorization, duplicate-period handling, and persisted rate-selection history with immutable linked rate values. Existing unit and integration suites cover unchanged calculations and lifecycle behavior. No change was made to the calculation engine or invoice snapshot.

## Limits

The full browser suite was run twice. The first run completed 36/50 tests (14 failed). The final retry used a fresh isolated browser database after stopping the separate integration-test container; it completed 24/50 tests (26 failed), including unrelated tenant, responsive smoke, meter, invoice accessibility, and browser-target health/timeouts. The billing workflow passed in its dedicated isolated run twice, most recently as 1/1 on the final run above; it also failed once under full-suite load while the UI was saving the initial meter setup. One subsequent isolated setup attempt was blocked by a lingering Docker port/schema-engine error, then a freshly provisioned retry passed. Therefore full browser regression is not green and remains a verification blocker. An isolated pass does not replace the full suite.

The dedicated pass proves the workflow, including invoice PDF download, is callable in isolation. It does not claim a new visual inspection of PDF pages; the inherited candidate baseline already includes the separately inspected F-10 PDF implementation. Automated browser success alone is not owner acceptance of PDF print appearance.
