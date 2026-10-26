# Agent-run Phase 4 UAT

**Result:** PASS for the isolated synthetic browser suite, with the limits below.
**Owner UAT:** Not performed. The Owner delegated UAT execution and requested a report.

## Run evidence

- Run ID: `2f9b8c0f424d8cb9a8152443`.
- Command: `node scripts/run-remediation-browser.mjs`.
- Result: 89 passed, 0 failed, 0 skipped, one Playwright worker, 5m 16s.
- Target: fresh isolated PostgreSQL database `taky_phase2_test`, unique role and Compose project, 17 release-source migrations, 15 synthetic room identities. No real tenant, financial, or UAT records were used.
- Cleanup: the runner stopped and removed only this run's containers and networks. It retained its new database and validator volumes for diagnosis.
- Machine-readable result: ignored local `evidence/remediation/browser-2f9b8c0f424d8cb9a8152443/results.json`; environment identity is in `database-identity.json`. Raw logs and traces are private and are not release assets.

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
