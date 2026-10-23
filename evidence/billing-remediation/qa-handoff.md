# Billing remediation verification handoff

Implementation agent `billing_ui_remediation`, working tree `/private/tmp/taky-billing-remediation`, baseline `0e4e302`. Browser plugin is not available in the listed skills; the repository Playwright workflow is the supported verification route. Main owns Docker, database and browser execution. This agent has not executed those operations.

## Source scope and current verification

Imported exactly the 14 billing-specific files listed in `docs/project-execution/billing-regression-triage.md` from `/private/tmp/taky-billing-ui`. No PDF, invoice service, UAT fixture or protected worktree changes were imported. The invoice screen remains exclusively owned by this milestone.

The provisioner accepts an explicit private `REMEDIATION_SUBNET`, validates network alignment and supports `--plan-only`. Per-run credentials, Compose configuration and public identity evidence use exclusive creation. Repeating a run identifier cannot replace credentials or evidence. Plan-only does not bind a port or call Docker, so it does not attest that ports or subnets are free.

The runner supports `--prepared-run ID` for Main to inspect and start an already planned synthetic project. It accepts `--grep TITLE_EXPRESSION`, writes JSON, HTML, screenshots and traces directly into fresh run-specific paths, and keeps scoped database volumes when stopping the project. Fixed safety boundaries remain origin 3820, proxy 3822, database 55452, generated role, fresh run identity and challenged HMAC proof. No safety checks or test timeouts were weakened.

Executed locally after import: Prisma client generation passed; TypeScript check passed; Vitest 172/172 passed across 12 files; scoped ESLint passed; provisioner behavior tests 3/3 passed. These checks do not establish that the browser regressions are fixed. No runtime UI change has been invented without reproduction evidence.

## Prepared synthetic configuration

Run `b27aeb21dfc049cdbe65001a` was created with plan-only. Its Compose project is `taky-remediation-browser-b27aeb21dfc049cdbe65001a`, with generated role `e2e_b27aeb21dfc049cdbe65001a`, database `taky_phase2_test`, loopback database port `55452` and candidate subnet `10.253.243.0/28`. Credentials are in private mode-0600 files under `.local`; do not copy them into evidence. The Compose configuration has no source or host data mount, and uses a fresh project-owned database volume.

Before startup, Main must check ports 3820, 3822 and 55452 and candidate subnet occupancy. If occupied, do not stop the owner or change the guard. Wait for the owner, or generate a different run with a checked subnet. Guard-approved port changes require separate design and review.

After preflight, Main can start only this project:

```sh
docker compose -f /private/tmp/taky-billing-remediation/.local/remediation-b27aeb21dfc049cdbe65001a-compose.json up -d --wait
```

After Main completes the supported webpack build and the independent reviewer accepts BR-01 preflight corrections, run from this worktree:

```sh
node scripts/run-remediation-browser.mjs --prepared-run b27aeb21dfc049cdbe65001a --grep 'tenant and lease UI create, update and delete draft'
```

That command migrates and seeds the generated synthetic database and users, starts the guarded standalone server/proxy, executes the selected case and retains the database volume on scoped shutdown. It needs the normal environment permission for local database/browser operations. No existing UAT endpoint or database is used.

## Reproduction order

Use a fresh run identity/project for each isolated case, all with the same fixed guard-approved ports after the preceding run shuts down:

1. `tenant and lease UI create, update and delete draft`
2. `ADMIN completes a fictional monthly billing flow in the UI`
3. `invoice loading, populated ready and recoverable error states remain accessible`
4. Combined billing and meter cases, then the full suite.

Example fresh planning command:

```sh
REMEDIATION_SUBNET=10.253.243.0/28 node scripts/provision-remediation.mjs browser NEW_24_HEX_ID --plan-only
```

The three original reported failure mechanisms remain open. For each failed case preserve JSON, trace, screenshot and standalone logs under `evidence/remediation/browser-ID`, command logs under `evidence/remediation`, and sanitized PostgreSQL activity observations from the exact scoped project. Record request path, response status or pending duration, query wait type, and elapsed times. Do not print credentials, SQL parameter payloads, tenant records or connection strings. The plain health endpoint does not replace challenged identity proof.

No commit or integration is authorized until a different reviewer examines the source and retained runtime evidence. The current 90-second monthly billing timeout was inherited from the imported source and is documented as such, not claimed as a correction.

## Correction handoff after independent review

Source frozen for re-review. BR-01 now loads only a strict private run-specific environment plus matching Compose document before port probing for a prepared run. It verifies the exact generated project, role, database, published loopback endpoint, mounts, image, secrets and origin. A read-only PostgreSQL identity query then attests current database and role before any migration or seed. Cleanup runs only after successful attestation. Missing, unsafe or mismatched plans fail closed without inheriting an ambient database URL.

BR-02 filters both selected approvals and history details by the current period immediately, and tracks which period finished loading. A delayed period cannot display the preceding period's selected financial values. Added browser case `billing rate history never carries selected values into a different period`; Main must execute it after review.

BR-03 removes copying from shared legacy report directories. The runner sets the installed reporter's supported `PLAYWRIGHT_JSON_OUTPUT_FILE` and `PLAYWRIGHT_HTML_OUTPUT_DIR` before the invocation, and passes a fresh `--output` directory. Its exclusive attempt marker prevents reusing an executed run identifier. `execution.json` distinguishes whether Playwright actually started. No old green artifact is attached to setup failure.

After these corrections: new fail-closed subprocess tests 11/11 and provision tests 3/3 passed; TypeScript check passed; scoped ESLint, formatting and both script syntax checks passed. Browser cases remain unexecuted. The default Turbopack build produced no accepted build artifact; its termination tool remained pending and was aborted by the session. Main confirmed no owned build process remains and owns the subsequent webpack build. No further build, Docker, database or browser command was executed by this agent.

Main correction: the first anchored grep selected zero tests because Playwright matches the full project/file/test title. Use the unique unanchored title substring and require a nonzero executed count. The first attempt remains in Agent UAT evidence; it is not a functional pass.

## BR-04 correction ready for independent review

Main's retained monthly billing run reached the newly created selected period but lost its confirmation message. The period-change effect cleared the operation's freshly set notice. The correction in `src/features/billing/setup-panel.tsx` stores notice text with its target period. Creation targets the returned new period ID; rate and approval operations target their captured period. Rendering hides mismatched notices immediately, and the period-change effect discards only mismatched context. The original monthly confirmation assertion and timeout are unchanged.

TypeScript check and scoped ESLint passed after this correction. Only the setup panel source changed. Main must rebuild after independent review and rerun the original monthly flow plus the already-passing delayed-period case on fresh synthetic data. No build, database, Docker or browser command was executed by the implementation agent for this correction.
