# Billing UI regression triage

2026-10-23. Investigator `billing_regression_triage`. Read-only investigation of `/private/tmp/taky-billing-ui`, reported commit `fabca4d9588a5848d7a68e7ca088b04803ef1550`, based on candidate `ce1837525672664b7414aa2583207d0b2800b982`. No browser, build, Docker operation, source edit, or UAT access was performed by this investigation.

throughput checkpoint: n/a, read-only investigation

## Decision

Do not promote this branch while its full browser regression is red. A useful billing implementation exists, but the evidence does not establish that all failures are infrastructure failures. Preserve the changes for isolated integration and investigation. Do not weaken the isolated-target guard or increase every timeout to make the suite pass.

Applied the installed Pstack Codex adapter, poteto-mode investigation and bug-fix guidance, how, TypeScript guidance, and unslop. The parent already owns orchestration and other independent work; no duplicate investigation agents were spawned. Frontend testing guidance was read. No live browser validation was authorized in this bounded assignment.

## Evidence and findings

1. **High: new regression evidence was deleted before handoff.** `BILLING_UI_TEST_REPORT.md` reports 36/50 followed by 24/50, and targeted run `7bf3b01158a9671b4d31d6d9`. These new run directories are absent. The relevant owner thread `01a16416-63c1-7c80-947e-7b809d48e025`, latest completed turn `01a16609-629b-7d62-9a9a-8d5e82bf6d8e`, records successful `git clean -fd evidence/remediation/` and restoration of `commands.jsonl`. The preceding turn also records cleanup of full-suite artifacts. Existing evidence directories are inherited audit-remediation runs, not this billing change. Current `test-results/results.json` records only one passing billing test, started `2026-10-22T23:54:49.450Z`, duration 25,215.801 ms. Full-suite traces and server logs cannot now be inspected directly. Future runs must retain their evidence before cleanup.

2. **High: actual failures have several different mechanisms.** Relevant thread history recovered these excerpts before deletion:

| Run or case | Observed failure | Classification and next discriminator |
| --- | --- | --- |
| `e8a19619ad0a35b1b0da6256`, 36/50 | Browser log excerpts show multiple failures at `tests/phase2/guarded-test.ts:68`, plus page setup and navigation timeouts | Guard fails when `/api/health/` returns non-2xx. This is a database/app health failure before the test interaction, not a visual assertion. Capture HTTP status and timestamp, query latency, application error class, and PostgreSQL wait state in the next isolated run. |
| Same run, `tests/phase2/app.spec.ts:211` | `Demo persisted contact` absent after tenant edit and reload, 10-second assertion | Could be selected-profile/UI behavior, save persistence, or failed data reload. Reproduce this case alone; capture tenant PUT response and subsequent GET. Do not classify it as infrastructure without those values. |
| Same run, billing case | 45-second timeout at `billing-setup.spec.ts:199` on period select after meter work | This older test timeout was later changed to 90 seconds. No proof the underlying delay was fixed. |
| `dc3ebd5d9cfe39e8cd135288`, 24/50 | Billing case expects `.success-message` containing `ตั้งค่ามิเตอร์`; none appears in 10 seconds. Snapshot shows initial water meter dialog for room 305 with all inputs and both save/cancel buttons disabled | A meter-save request remained pending. The evidence does not distinguish database wait, request/network stall, or a UI promise that never settles. Capture POST `/api/v1/meters/`, response or pending duration, and matching transaction wait state. |
| Full suite invoice accessibility | Reported navigation timeout; first run log excerpt shows `page.goto` timeout | Existing invoice API interception does not intercept health or billing options. Isolate this test with the new setup panel and inspect all pending requests. No demonstrated accessibility defect is established by this timeout alone. |
| Provisioning attempt `6114672ec4775fd12a21f8b9` | Prisma schema engine error before browser launch | Separate setup failure, not a failed application workflow. |
| Provisioning attempt `5411f03ec6bbb48c85791dfd` | Docker rejected overlapping IP pool | Proven setup conflict. Current provisioner hardcodes browser `10.250.241.0/24` and integration `10.250.240.0/24`; unique project names alone do not isolate overlapping networks. |

The owner thread reports that a plain health request still returned `{status:"ok"}` during a stalled run. That does not prove the challenged identity query was healthy. `src/app/api/health/route.ts` runs `SELECT 1`, then a second database/user query for challenged checks, and catches every exception as HTTP 503. Current diagnostics discard the exception class. `src/server/db.ts` configures pool maximum 10. Pool exhaustion, transaction locks, Docker pressure, and per-request connectivity remain hypotheses; no retained wait-state or resource measurements establish one.

3. **Medium: shared fixture assumptions deserve a controlled order test.** Playwright uses one worker, so 50 tests are not running concurrently. Tests still mutate one shared database across the suite. The new billing case permanently creates an ACTIVE lease and meters for fixed room 305 and period 2020-01, without cleanup. Stage 3C4 chooses an unused floor-three room with no meters. This creates order dependence and reduces available fixture capacity, but it does not explain an already-pending first meter save without runtime evidence. Use a dedicated synthetic property/room or per-case database with the test's required month/rate invariants. Do not delete historical financial rows as cleanup.

4. Session expiry is not supported by current evidence. Sessions last eight hours, each test signs in, and recovered snapshots show authenticated dialogs rather than the login page. Guard health runs before login. Failed authentication, 401s, or unexpected redirect evidence would reopen this hypothesis. The proxy guard is a safety boundary and must remain enabled.

## Changed-file inventory

Two original-object Git reads were bounded to five seconds and timed out. No further original Git retries were made. The following is a byte comparison against the independent repository's root snapshot `4ad8652`, recorded by the parent as source `e13b005`. It is not represented as a verified original Git diff. Current operations/auth changes were excluded by comparing with the root snapshot, rather than current working files.

Changed existing files:

```
scripts/provision-remediation.mjs
scripts/run-remediation-browser.mjs
src/app/api/v1/billing/rate-selections/route.ts
src/features/invoices/screen.tsx
src/server/billing/index.ts
src/server/billing/service.ts
src/server/finance/service.ts
src/server/invoices/pdf.ts
src/server/invoices/service.ts
tests/integration/finance-foundation.test.ts
tests/invoice-pdf.test.ts
```

Additional source/test/docs files absent from the root snapshot:

```
BILLING_UI_IMPLEMENTATION_REPORT.md
BILLING_UI_TEST_REPORT.md
BILLING_UI_OWNER_UAT_GUIDE_TH.md
src/features/billing/setup-panel.tsx
src/features/billing/setup-panel.module.css
tests/phase2/billing-setup.spec.ts
scripts/owner-uat-candidate-fixtures.mjs
docs/uat/owner-candidate/F10_OWNER_ACCEPTANCE_CHECKLIST.md
docs/uat/owner-candidate/MONTHLY_BILLING_E2E_TEST_REPORT.md
docs/uat/owner-candidate/OWNER_UAT_CANDIDATE_REPORT.md
docs/uat/owner-candidate/OWNER_UAT_STEP_BY_STEP_TH.md
docs/uat/owner-candidate/UAT_BLOCKER_REGISTER.md
```

Generated `tsconfig.tsbuildinfo` was excluded. The owner thread's final staging command identifies the billing-specific set as the three BILLING_UI documents, two runner/provisioner scripts, rate-selections route, two setup-panel files, invoice screen, billing index/service, finance service, finance integration test, and billing browser test. PDF/service/test differences and candidate UAT documents predate the billing commit. For example the invoice service difference changes PDF water unit from `m³` to `m3`; it must not be silently attributed to the new billing UI.

## Next bounded implementation and verification

1. Parent creates a dedicated isolated integration copy of the 14 billing-specific files only after reviewing the UI/API diff. Keep PDF/candidate differences separate. Assign one implementation owner and a different reviewer. Do not copy `.env`, `.local`, build output, or dependencies from the handoff.
2. Fix evidence retention in the test orchestration, and give each new QA run noncolliding loopback ports and a checked subnet or dedicated network strategy. Log only sanitized status/error classes, no connection strings, credentials, or tenant payloads. Do not modify the original billing worktree.
3. Run the tenant edit, billing flow, and invoice accessibility cases separately against fresh synthetic data. Then run billing plus meter cases together with one worker. Save JSON results, trace, server log, meter response timing, and non-sensitive database wait/resource observations. This separates deterministic UI/fixture defects from test-host degradation.
4. Correct only the mechanism supported by those observations. Reviewers rerun the original failing case. Finally run the full 50-test suite on the integrated baseline. An isolated 1/1 pass, unit/integration pass, or healthy plain endpoint is insufficient to close the browser blocker.

## Integration dependencies

Payments is independent of reproducing these failures, but both branches touch `src/features/invoices/screen.tsx` and may touch `src/server/invoices/service.ts`. Coordinate explicit file ownership and integrate sequentially. Billing also changes rate-selection API/service and period creation authorization in finance service. Payments must consume the reviewed invoice status and immutable snapshots without restoring stale authorization or PDF code. Compare imports and exact hunks, then run combined billing/payment financial and authorization tests. Protect the parent's current operations inventory and HTTPS-login corrections, which are absent from this older billing branch.

The original worktrees, protected UAT ports 3700/3701, other QA projects, and data were untouched. No completion, root-cause fix, or passing full regression is claimed.
