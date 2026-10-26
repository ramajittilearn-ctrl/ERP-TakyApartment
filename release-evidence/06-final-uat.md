# Agent-run Phase 4 UAT

**Latest code validation:** PASS on PR source head `d607b6cf720931d684aed2c9ebabef4a19364b36`; current PR head `9831c0783865008303f253a26b75f7866a2a96d3` adds documentation only. Run [40335249346](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40335249346) completed successfully with all three jobs, including Agent UAT. The workflow's report gate requires at least 89 expected tests and zero unexpected, skipped, or flaky tests. Its artifact is listed on GitHub, but could not be retrieved in this session because GitHub's artifact API returned HTTP 403 rate-limit errors; therefore the exact test count and source merge-checkout hash are not recorded here. The preceding failed run and test-only timing correction are retained below.
**Owner UAT:** Not performed. The Owner delegated UAT execution and requested a report.

## Latest PR CI run

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

## Limits

- Invoice and receipt browser tests verify successful PDF downloads, filenames, PDF structure, access rules, and frozen receipt facts. This run did not extract Thai text or inspect rendered glyphs from the downloaded files. Historical Phase 4 evidence records 48 invoice glyph extraction checks, visual PDF reviews, copied font hashes, and browser invoice/receipt downloads; that evidence predates this run and is not production-runtime proof.
- The latest browser run asserts monthly report CSV download and exact totals from its intercepted synthetic response. CSV browser checks cover expense, lease, and monthly reports; separate unit/service tests cover report calculations and API behavior. This CSV browser case does not prove database aggregation end to end.
- Maintenance and Settings remain demo-only pages, outside the accepted Phase 4 feature scope. The application visibly labels them as demos. Settings does not provide an enabled backup UI; operations remain command-line based.
- The suite used a local source build and synthetic data. It does not verify a production host, target schema, off-device key recovery, HTTPS certificate trust on owner devices, or post-deployment behavior.

This report records delegated agent UAT and automated evidence. It does not claim Owner UAT acceptance, production deployment, or Go-Live.
