# Isolated browser verification

The supported complete-suite workflow creates a fresh synthetic database for each run. Retained meter fixtures are not reused or deleted.

```sh
npm ci
npx prisma generate
npm run build
node scripts/run-remediation-browser.mjs
node scripts/run-remediation-browser.mjs
```

Prerequisites: Node 22.13 or later, Docker with the existing PostgreSQL 17 image, and installed Chrome on macOS. Ports 3820, 3822 and 55452 must be unused. The runner refuses occupied ports. It never stops the process holding an occupied port.

Each run creates a unique `taky-remediation-browser-<run-id>` Compose project, database role and named volume. The database name is `taky_phase2_test`. New private credentials and session/proof secrets are generated. Environment and Compose files are mode 0600 under ignored `.local/`. Migrations, idempotent room seeding and private synthetic users run only against that new target.

The application runs with `node .next/standalone/server.js`, HOSTNAME=127.0.0.1 and PORT=3820 after static assets are copied. The health challenge signs a fresh nonce plus the actual PostgreSQL database/current role with this run's private proof key. Each test verifies the proof before using its fixtures. Normal health responses do not expose this metadata.

The effective base URL must be exactly `http://127.0.0.1:3820`. The database must use loopback port 55452 and the fresh role derived from the run ID. Effective proxy and launch overrides are checked. All browser and browser-context API traffic uses the local allowlist proxy on port 3822. It forwards only the exact app origin, does not follow redirects itself, and rejects unauthorized next destinations and CONNECT destinations. Chrome loopback bypass is explicitly disabled. This also protects page-level request interception hooks.

Setup, tests and cleanup share one lifecycle. On failure or success, the runner stops its standalone process and proxy and removes only its captured Compose project's containers/network. Named test volumes remain for diagnosis. No UAT volumes, credentials, fixtures or services are read or changed. To test early cleanup, `node scripts/run-remediation-browser.mjs --fail-setup` intentionally exits nonzero after provisioning; a subsequent complete workflow must still succeed. Do not use `--reproduce` for normal verification. It is a historical repro helper for the separately verified remediation integration target.

`npm run test:e2e` directly now fails closed without the complete verified environment/proxy. Use the runner. Playwright retains synthetic screenshots and JSON results under `evidence/remediation/browser-<run-id>/`. Raw command logs and exit codes are indexed by `evidence/remediation/commands.jsonl`. Ignored traces may contain synthetic credentials and are not committed. No historical audit log is reconstructed by this workflow.
