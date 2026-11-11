# Agent-run Phase 4 UAT

## Latest Agent UAT — PR head 95ee8de (2026-10-27)

Push run [40463274079](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40463274079), artifact [12716045150](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40463274079/artifacts/12716045150), and PR run [40463280614](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40463280614), artifact [12715447543](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40463280614/artifacts/12715447543), both report 90 passed, 0 failed, 0 skipped and 0 flaky. The PR report uses merge checkout c77b5bc against head 95ee8de. UAT is synthetic browser testing of the standalone application on an isolated runner; the Bookworm candidate image build failed separately before package installation. No Owner or production acceptance is claimed.

## Latest exact-head Agent UAT — commit b9db3ed (2026-10-27)

Push run [40461557545](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40461557545), artifact [12714853094](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40461557545/artifacts/12714853094), and PR run [40461562660](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40461562660), artifact [12715246791](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40461562660/artifacts/12715246791), both report 90 passed, 0 failed, 0 skipped and 0 flaky. The PR artifact binds to head b9db3ed4e188a49ebe938dde204c35d20fe4134b. This used synthetic data in an isolated runner and does not represent Owner acceptance or production UAT. It verifies the documentation-only head; the subsequent Bookworm candidate refresh commit 32727aa still requires its own hosted CI run.

**Latest Agent UAT:** PASS on PR head `ecc73a79007e0d818ab467d5c0949210ccbcf732`. PR run [40460083297](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40460083297), artifact [12714595893](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40460083297/artifacts/12714595893), and push run [40460077762](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40460077762), artifact [12714511122](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40460077762/artifacts/12714511122), each report 90 passed, 0 failed, 0 skipped, 0 flaky. The PR report uses merge checkout `dce9f362c7c102627a0dd67e4f4bbbd6a1cee6ab` against the same tested source tree; the push report binds directly to the head. Browser UAT uses synthetic data on an isolated runner; this is not Owner acceptance or production UAT. Stage 5 and container checks are separate and also passed in these runs.

**Latest Agent UAT:** PASS on PR head `a29731d971839668b8236715bb4805236fe346cf` in PR run [40458409951](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40458409951), artifact [12713736801](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40458409951/artifacts/12713736801); push run [40458404988](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40458404988), artifact [12713991658](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40458404988/artifacts/12713991658). Both reports confirm 90 passed, 0 failed/skipped/flaky. PR artifact uses merge checkout `b1b12eaefa4b51d047fd99af49b033c91eb3af3a` with the same source tree as PR head; push report is checked out at the head. Synthetic browser UAT only; no Owner acceptance or production data. Required container verification remains failed independently of UAT.

**Latest exact-head Agent UAT:** commit `5bcf9f9ca12bc225f1e884d82519aee084e69111`, push run [40456489750](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40456489750), artifact [12712334185](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40456489750/artifacts/12712334185); matching PR run [40456493951](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40456493951), artifact [12713525754](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40456493951/artifacts/12713525754). Both report 90 passed, 0 failed, 0 skipped, 0 flaky, and 0 retries. Independent `uat_scope_review` verified the push report's commit/head binding, synthetic scope and counts. Four tenant-rent persistence cases passed, including save/reload after room selection, no invented rent without a room, explicit zero handling, and rent entered after room selection. The UAT job passed; the overall workflow remains failed because required container verification found collation incompatibility. This is agent-run synthetic UAT, not Owner acceptance or production verification.

**Latest completed exact-head Agent UAT:** PASS on `70ae6569c136d1b93f9f56bdcf92db823832471a` in push [run 40450966334](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40450966334), artifact [12709979361](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40450966334/artifacts/12709979361). It reports 90 passed, 0 failed, 0 skipped, 0 flaky, with checkout commit equal to PR head. PR workflow [40450971948](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40450971948) also passed. This is isolated synthetic browser UAT, not Owner acceptance or production verification.

The latest run includes the rent-after-room-selection/save/reload test, the 4100.75 rent-through-reselection test, and checks that unassigned tenants do not gain a rent and explicit zero remains zero. Independent review verified exact source binding, 90 passed with 0 failures/skips/flakes/retries, and those regression cases. See the coverage matrix and limits below; backup/restore and Thai PDF verification are separate CI evidence, not part of the 90 browser tests.

Prior completed UAT artifact [12709477425](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40447771982/artifacts/12709477425) reports 90 passed, 0 failed, 0 skipped, and 0 flaky; browser run `6be217e71b87a3c68942d88f`. It includes both `tenant rent entered after room selection survives immediate save and reload` and `tenant contract rent survives room selection, save, reload and reselect`. Run scope is an isolated Ubuntu synthetic-data browser suite against the source-built standalone app. The container images are exercised separately in the same workflow's container-verification job. This is not Owner acceptance or production verification.

**Prior Agent UAT:** PASS on PR head `f3b357fec95dd1765e68e1b72410a718f1297efc` in [run 40435165878](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40435165878). Artifact [12703927527](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40435165878/artifacts/12703927527) reports 90 passed, 0 failed, 0 skipped, 0 flaky (browser run `5f5555f3b013905e1e6aff8d`). It includes `tenant rent entered after room selection survives immediate save and reload`. This is isolated synthetic Agent UAT, not Owner acceptance or production verification.

**Prior code validation:** PASS on application/test source unchanged at PR head `87c3ec827da110afb3cf547398708b408556fff6` in [run 40401983977, attempt 2](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40401983977). All four required checks passed. Agent UAT artifact [12692774142](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40401983977/artifacts/12692774142) reports 90 passed, zero failed, skipped, or flaky on merge checkout `df63cab9244bf4464156e9aa1afe6159bd372e8a` (browser run `96c9e04dd766d9072c80a0da`). This synthetic run is not Owner acceptance or production verification.

**Owner UAT:** Not performed. The Owner delegated UAT execution and requested a report.

## Prior PR CI run — 40401983977

- Workflow: [Phase 4 CI run 40401983977, attempt 2](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40401983977); PR head `87c3ec827da110afb3cf547398708b408556fff6`; merge checkout `df63cab9244bf4464156e9aa1afe6159bd372e8a`.
- Result: `required-quality`, `container-verification`, `stage5-runtime-verification`, and `agent-uat` all passed. Agent UAT artifact [12692774142](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40401983977/artifacts/12692774142) records 90 passed, 0 failed, 0 skipped, 0 flaky (browser run `96c9e04dd766d9072c80a0da`). The scenario `tenant rent entered after room selection survives immediate save and reload` passed.
- This is synthetic agent-run UAT, not Owner acceptance or production verification.

- Workflow: [Phase 4 CI run 40365071119](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40365071119); PR head `54ecf19a89f03b403c46466e2f3247c14d2cf22c`; merge checkout `b4a9edc18aac982bf5d01f800236dc90b9e1f871`.
- Result: `required-quality`, `container-verification`, and `agent-uat` all passed. Agent UAT artifact [12671305690](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40365071119/artifacts/12671305690) records 90 passed, 0 failed, 0 skipped, 0 flaky (browser run `adc50bd465c55dc50566454b`).
- This is synthetic agent-run UAT, not Owner acceptance or production verification.

- Workflow: [Phase 4 CI run 40362968827](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40362968827); PR head `aa171b8e0273e86e77212bf56972d0a2bab89b6e`; merge checkout `08eaa89ed5258b1c1c22a80f649db882afe574aa`.
- Result: `required-quality`, `container-verification`, and `agent-uat` all passed. Agent UAT artifact [12668289110](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40362968827/artifacts/12668289110) records 90 passed, 0 failed, 0 skipped, 0 flaky.
- This is synthetic agent-run UAT, not Owner acceptance or production verification.

- Workflow: [Phase 4 CI run 40360707470](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40360707470); PR head `76860a474faf49fbcc5292284df4c274619ed4e7`; merge checkout `01fa4f15872f33293987c251bb4c5265297894a7`.
- Result: all three required branch-protection checks passed: `required-quality`, `container-verification`, and `agent-uat`. Agent UAT artifact [12667957853](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40360707470/artifacts/12667957853) records 90 passed, 0 failed, 0 skipped, 0 flaky.
- This is synthetic agent-run UAT, not Owner acceptance or production verification.

- Workflow: [Phase 4 CI run 40356454371](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40356454371); PR source head `8ca7f4fff329fa15bc9095208911120ea2074088`; merge checkout `a3268cc17ca2f59f641548dec5bdc41998c42662`.
- Result: `required-quality`, `container-verification`, and `agent-uat` all passed. Agent UAT report [artifact 12667808269](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40356454371/artifacts/12667808269) records 90 passed, 0 failed, 0 skipped, 0 flaky (browser run `efe99f1fa79dd0a1ea04c356`).
- This remains synthetic agent-run UAT, not Owner acceptance or production verification. See the prior-run details below for test coverage and boundaries.

- Workflow: [Phase 4 CI run 40335249346](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40335249346), status Success; all three jobs (`required-quality`, `container-verification`, and `agent-uat`) completed successfully.
- PR head: `d607b6cf720931d684aed2c9ebabef4a19364b36`.
- Agent UAT succeeded after the test began waiting for the initial monthly-report API response before editing the month. Workflow success requires the suite threshold (at least 89) and zero unexpected, skipped, or flaky tests. Exact artifact report unavailable during this session due GitHub API rate limiting.
- This is synthetic agent-run UAT, not Owner acceptance or production verification.

### Prior UAT attempt and correction

- Run [40333071309](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40333071309) passed quality and container verification but failed Agent UAT 89/90: the month input remained `2026-10` after filling `2027-03`. Independent review found this likely a test timing race against Client Component hydration, not a confirmed product defect.
- The test now waits for a successful initial monthly-report response and verifies its month matches the input before changing it. The cross-review found no blocking issues. Run `40335249346` then passed all three workflow jobs.
- Report from the failed attempt: [Agent UAT artifact 12657011314](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40333071309/artifacts/12657011314).

### Prior fully green exact-head run

- [Phase 4 CI run 40331167063](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40331167063) passed all three jobs on PR head `69f7ca0a12e6d154d3c6629900ef2790ae39843e`; its UAT artifact [12654694063](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40331167063/artifacts/12654694063) reports 90 passed, zero failed/skipped/flaky. It used merge checkout `17dbc7323db48be1214521bab8a7d9a67cbaf428`.
- This synthetic run is agent-run UAT, not Owner acceptance or production verification.

### Prior exact-head run

- Workflow: [Phase 4 CI run 40327186679](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40327186679), all three jobs passed (`required-quality`, `container-verification`, and `agent-uat`).
- PR head: `6363f2248cd986ebbb980e7b7dddcb28c941b674`. Agent UAT checked out merge commit `c4fa83fa182a4fd60c7d0c140769f9d451be8363`; the generated report records both hashes.
- Mode and scope: source-built app, synthetic browser UAT on an isolated Ubuntu runner; no Owner UAT and no production data. The separate container-verification job built pinned images and passed current-checkout synthetic encrypted backup and isolated restore.
- Result: 90 passed, 0 failed, 0 skipped, 0 flaky; the Playwright result records 90 expected and 0 unexpected. Browser execution run ID: `d3cafc6d6a84495590b01ec7` (155.1 seconds).
- Report, `results.json`, and `execution.json`: [Agent UAT artifact 12654990734](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40327186679/artifacts/12654990734).
- This suite includes the monthly report CSV UI download and exact-total assertion against a synthetic monthly report response intercepted by the browser test. The separate month-selection/loading test calls the actual API; the CSV case does not independently prove persisted database aggregation. It also includes tenant contract rent save/reload/reselection cases.
- This synthetic source-build run does not verify production data, deployment-host configuration, Owner acceptance, or production recovery.

Run [40325482014](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40325482014) on prior head `cc5e1ab` is a failed historical attempt: 89 passed and one monthly report CSV browser assertion failed because the test helper rejected a valid final record without a line terminator. Commit `6363f22` corrected that test helper, added edge-case tests, and the then-latest 90-case run above passed.

Earlier run [40317435858](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40317435858), PR head `573bbed`, also passed all three jobs and 89/89 browser tests. It is retained as historical evidence for that earlier head.

## Historical local run evidence

- The following records local Agent UAT run `f12e112e99231c0a470e3171` on older source commit `3d5db3cbae5f16532a3f1e37c7dfe33026c6a966`, tree `aa5cf57c5d1fb90c5eedbdfc9775d494176123bb`; it is retained as historical evidence and is not the current PR-head run.
- Preparation: `npm ci` (467 packages, 0 vulnerabilities), `npx prisma generate`, and `npm run build` all passed on Node `v22.22.3` and Next.js `16.4.1`.
- Run ID: `f12e112e99231c0a470e3171`.
- Command: `node scripts/run-remediation-browser.mjs` from the exact-head checkout.
- Result: 89 passed, 0 failed, 0 skipped, 0 retries/flaky, one Playwright worker, 198.4 seconds.
- Target: fresh isolated PostgreSQL database `taky_phase2_test`, unique role `e2e_f12e112e99231c0a470e3171`, and Compose project `taky-remediation-browser-f12e112e99231c0a470e3171`; all 17 release-source migrations and 15 synthetic room identities. No real tenant, financial, or UAT records were used.
- Cleanup: the runner stopped and removed only this run's three containers and three networks. It retained one new run-specific database volume for diagnosis. Post-run checks found no run-owned container/network or listener on ports 3820, 3822, or 55452. The pre-existing `taky-erp-*` stack was not modified.
- Machine-readable result: ignored local `evidence/remediation/browser-f12e112e99231c0a470e3171/results.json` (`expected=89`, `unexpected=0`, `skipped=0`, `flaky=0`; every test ran once). Raw browser log and cleanup log are under ignored `evidence/remediation/` and are private, not release assets.

## Workflows covered

The browser suite exercised room, property, floor, tenant, and lease workflows, including rent persistence after selection, save, reload, and reselection. It covered billing periods, effective-dated utility rates, meter readings, invoice issue and download, payment allocation and reversal, immutable receipts, deposits and retained evidence, OPEX/CAPEX expense workflows, CSV downloads, dashboard and monthly report loading, authentication, CSRF checks, staff authorization, and failure/replay cases.

The shell-mode test verified that Dashboard and Reports are labeled read-only, database-backed pages are labeled persisted, and Maintenance and Settings are labeled demo-only. It also covered Deposits and a Deposit Entry detail route. An independent reviewer verified the final test and confirmed the run used the current built bundle.

The separate Stage 3 rehearsal restored a synthetic encrypted backup with the Phase 4 operations image. It reported 44 tables, 17 migration checksums matching release source, and six attachments. See [Backup and Restore Validation](03-backup-restore.md). This is not production database recovery evidence.

## Current UAT coverage map — source head `70ae656`

| Area | Browser UAT evidence | Boundary of the evidence |
|---|---|---|
| Rooms, tenants, leases | `app.spec.ts`, `phase26.spec.ts`, and `tenant-rent-persisted.spec.ts`; rent `1000.00` is checked in the submitted payload, saved profile/API lease, and after reload. Rent `4100.75`, room reselection, unassigned tenant, and explicit zero are also covered. | Covers key create/assignment/persistence workflows, not production records or every lease lifecycle. |
| Billing periods, rates, meters | `billing-setup.spec.ts`, `meter-reading.spec.ts`, `meter-stage3c4.spec.ts`. | Browser scenarios cover core setup, effective dates, readings, corrections and staff restrictions. Stage 5 separately checks a synthetic bill and 17 migrations. |
| Invoices, payments, receipts | `invoice-accessibility.spec.ts`, `payment-persisted.spec.ts`, `receipt-pdf.spec.ts`. Payment cases cover allocation, reversal, immutable receipt, duplicates/replay, stale state, concurrency, precision, role changes and logout. | Browser PDF tests cover downloads/access/frozen facts; Thai glyph and invoice/receipt layout checks are separate Stage 5 evidence, not counted in 90. |
| Deposits and evidence | `deposit-persisted.spec.ts`: zero/positive movement, immutable totals, wrong-lease evidence denial, staff read-only, replay and mobile accessibility. | Stage 5 separately tests synthetic evidence upload/read/download and hash consistency. Production attachment storage and authorization are not proven. |
| Expenses | `expense-persisted.spec.ts`: OPEX/CAPEX capture, approval/post/cancel/reversal/correction, role enforcement, replay, paging, CSV and race cases. | Synthetic test data only; no production export or live records. |
| Dashboard and reports | `dashboard-live.spec.ts`, `reports-month.spec.ts`; monthly report load and CSV totals. | The monthly CSV browser test intercepts a synthetic response; it does not prove end-to-end database aggregation. Service/API tests are separate evidence. |
| Authentication and authorization | `app.spec.ts`, `target-safety.spec.ts` and payment/deposit/expense role/session cases. | Covers app sessions, CSRF, staff restrictions and unsafe redirects; not production identity-provider or deployment configuration. |
| Backup and restore | Not counted in Agent UAT. Current exact-head container verification separately exercises synthetic encrypted backup/restore; historical rehearsal details are in `03-backup-restore.md`. | Does not prove production target recovery, off-device delivery/key recovery, or rollback. |

The `90/90` result is the number of Playwright cases in this run, not a claim of 90 requirements covered. Agent UAT is isolated, source-built and synthetic; the Owner delegated agent execution and no Owner acceptance or production behavior is claimed.

## Limits

- Invoice and receipt browser tests verify successful PDF downloads, filenames, PDF structure, access rules, and frozen receipt facts. This run did not extract Thai text or inspect rendered glyphs from the downloaded files. Historical Phase 4 evidence records 48 invoice glyph extraction checks, visual PDF reviews, copied font hashes, and browser invoice/receipt downloads; that evidence predates this run and is not production-runtime proof.
- The latest browser run asserts monthly report CSV download and exact totals from its intercepted synthetic response. CSV browser checks cover expense, lease, and monthly reports; separate unit/service tests cover report calculations and API behavior. This CSV browser case does not prove database aggregation end to end.
- Maintenance and Settings remain demo-only pages, outside the accepted Phase 4 feature scope. The application visibly labels them as demos. Settings does not provide an enabled backup UI; operations remain command-line based.
- The suite used a local source build and synthetic data. It does not verify a production host, target schema, off-device key recovery, HTTPS certificate trust on owner devices, or post-deployment behavior.

This report records delegated agent UAT and automated evidence. It does not claim Owner UAT acceptance, production deployment, or Go-Live.

## Latest exact PR-head Agent UAT — run 40436826101

Agent UAT artifact [12705320122](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40436826101/artifacts/12705320122) is bound to PR head `8ba32bc3d2171b8d77536d6c748d56eca8e84693` and reports 90 passed, 0 failed, 0 skipped, and 0 flaky. It ran on isolated synthetic data and includes tenant rent persistence after save/reload. No Owner acceptance or production behavior is claimed.

## Latest exact PR-head Agent UAT — run 40439455111

Artifact [12706197568](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40439455111/artifacts/12706197568) is bound to PR head `e11ef962d0934bf1fd603cd5d15293667fb235f2` and reports 90 passed, 0 failed, 0 skipped, and 0 flaky (browser run `c68e2120e5007c6b1fdb76b3`). It ran on isolated synthetic data and includes tenant rent persistence after save/reload. No Owner acceptance or production behavior is claimed.
