# Agent-run Phase 4 UAT

**Result:** PASS for the isolated synthetic browser suite, with the limits below.
**Owner UAT:** Not performed. The Owner delegated UAT execution and requested a report.

## Run evidence

- Exact source: commit `3d5db3cbae5f16532a3f1e37c7dfe33026c6a966`, tree `aa5cf57c5d1fb90c5eedbdfc9775d494176123bb`. Tracked application/test source was unchanged during the run.
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
- Browser checks cover expense and lease CSV downloads. The monthly report test selects and loads a month but does not assert a report CSV download.
- Maintenance and Settings remain demo-only pages, outside the accepted Phase 4 feature scope. The application visibly labels them as demos. Settings does not provide an enabled backup UI; operations remain command-line based.
- The suite used a local source build and synthetic data. It does not verify a production host, target schema, off-device key recovery, HTTPS certificate trust on owner devices, or post-deployment behavior.

This report records delegated agent UAT and automated evidence. It does not claim Owner UAT acceptance, production deployment, or Go-Live.
