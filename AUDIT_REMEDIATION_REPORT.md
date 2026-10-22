# Audit remediation report

Date: 2026-10-22. Audit reference: `codex/full-project-audit` at `01a5233f5626193ec65bcdcc6a17782c59c84733`. Verified baseline: `701acf8cc751a9197bb83b548ef91483b7082ed3`. Dedicated branch: `codex/audit-remediation`. Worktree: `/private/tmp/taky-audit-remediation`. The local commit containing this report is the remediation handoff commit; its exact hash is supplied in the final Owner summary.

## Outcome

The verified local remediation run is complete. F-11, F-12 and F-13 are CLOSED after two full passing browser runs and independent evidence review. F-09 remains PARTIALLY RESOLVED, F-06 remains OPEN for actual-target verification and F-10 remains OPEN for an explicit Owner decision. Production billing is NO-GO.

| Finding | Root cause | Changes | Tests | Final status |
| --- | --- | --- | --- | --- |
| F-09 | Shared global login bucket consumed successful and failed attempts | Remove shared bucket; retain atomic per-identifier limit, uniform generic errors and dummy verification; expire rows and saturate counters | Four baseline failures reproduced; fixed 8/8; full integration 89/89 | PARTIALLY RESOLVED. Shared lockout corrected; trusted source admission and active row/work bounds remain deployment dependencies |
| F-11 | Loopback/env guard did not prove the connected destination/database; page hooks and redirects bypassed initial approach | Exact run/origin/database/role checks; nonce HMAC proof of actual DB/current role; effective options guard; network proxy restricts every HTTP/CONNECT destination | Unit negatives/proof tests; browser attestation and zero-request sentinel checks across navigation/API/route.fetch | CLOSED |
| F-12 | Scan could run while invoice state changed; populated invoice metadata also failed contrast | Ready-state synchronization, separate loading/error/recovery coverage, invoice metadata color correction | Stable loading before: zero; populated before: 4.14:1 violation; state regression uses unchanged WCAG scans | CLOSED |
| F-13 | Retained fixtures consumed finite rooms and conflicted with fixed state | Fresh project/role/volume/credentials each full workflow; migrations/seed/users; cleanup includes setup failures and releases only its own network | Injected failure then successful reprovision; two complete repeated browser workflows | CLOSED |
| F-06 | Actual operational identity and legacy lineage unverified | Read-only procedure and illustrative SELECT-only inventory | Not executed against actual target | OPEN |
| F-10 | PDF roadmap item lacks accepted scope/deferral | Owner options and milestone effects | Requirements comparison; no PDF implementation | OPEN |

## Investigation and implementation

AGENTS.md and installed Pstack instructions were read before code changes. The audit register, regression results, security/financial report, readiness assessment, full report and decision trail at 01a5233 were inspected. Git merge-base confirmed that audit descends from baseline 701acf8. The calling checkout was at 0530edd on a different branch with existing edits and untracked UAT work. The dedicated remediation worktree starts at 701acf8 and contains no copied UAT environment or fixture files.

F-09 was reproduced with a PostgreSQL regression before implementation. A seeded exhausted global bucket prevented unrelated correct ADMIN/STAFF logins. Additional tests demonstrated overflow, exact-window boundary and retained expired rows. Removing the shared bucket fixes that mechanism. Normalized identifier protection and authorization remain. Username/email remain separate allowances, as before. No arbitrary forwarding header becomes a trusted source identity. A verified ingress contract and active load/storage admission remain necessary before untrusted-network exposure; a global row admission ceiling or collision buckets would recreate unrelated lockouts.

F-11's actual connected identity is proven by an app-side health challenge that reads PostgreSQL current_database/current_user and signs a fresh nonce with a private per-run key. Normal health requests remain unchanged. The test config pins loopback app 3820 and database 55452 with a unique run role. Each fixture checks effective base URL, proxy, launch arguments, context overrides and remote-browser configuration. The allowlist proxy on 3822 forwards only the exact isolated app, including exact-only CONNECT used by Playwright's API transport. It does not follow redirects. Every redirected destination must pass the same network check, including traffic initiated by page routing hooks.

F-13 uses a fresh environment per suite rather than mutating retained test state. Each workflow creates its own Compose project and named volume, migrates, seeds the same room identities, and generates private synthetic users. Cleanup spans provisioning through browser completion and only downs the captured immutable project configuration. Volumes are retained, never reset or reused. An injected setup failure confirms early cleanup; later full workflows establish repeatability.

The exact historical F-12 transient contrast was not reproduced. A deterministic held-loading scan passed with zero violations. The general test lacked a readiness wait, so it could observe a transition. A populated synthetic invoice list independently revealed a genuine metadata contrast failure at 4.14:1. The narrow CSS correction changes that text to #52675a, while the general scan waits for readiness. Separate held-loading, populated, error and recovery scans retain all WCAG rules. The regression response fixture is captured synthetic data, not operational records.

## Verification and evidence

REMEDIATION_TEST_RESULTS.md records commands, actual counts, failed/superseded attempts and exit codes. `evidence/remediation/commands.jsonl` is the command index. Per-run manifests identify database roles, ports, projects and volumes. Standalone logs show direct `node .next/standalone/server.js` startup with copied static assets, independent of npm start. Historical missing audit raw logs remain missing.

Final checks passed 137 unit, 89 integration and nine operations tests. Browser runs 71bd7150624d59bb8fc215f0 and af964af3735651e8927f1337 passed 49/49 each with zero skipped, unexpected or flaky results. Typecheck, lint, formatting, schema validation, migrations, zero drift and the final production build passed. Independent final review supports closure of F-11/F-12/F-13. Ignored traces can contain synthetic credentials and are excluded. Private environment and Compose files remain ignored. Reports and committed logs are checked against private values before staging.

## Independent review and agents actually used

- Main agent: evidence, plan, browser isolation/proxy, fixtures, accessibility investigation, verification, reports and handoff.
- `auth_remediation`: bounded authentication implementation, tests and source/proxy/storage assessment. The Main agent executed the DB tests. No operational connection or independent DB run was claimed by this specialist.
- `independent_review`: read-only security/correctness/data-safety review. Its first attempt failed on a usage limit. A later retry completed and identified page-route redirect bypass and setup cleanup gaps. Both were accepted and corrected. Re-review found no additional demonstrated material code defect and requested remote-browser rejection, which was added with a unit test. Final evidence review in evidence/remediation/independent-review.md supports CLOSED for F-11/F-12/F-13 and the retained partial/open findings.

No other agents were used. No cross-family model review is claimed; the available independent reviewer inherited the session model. Token/cost totals were not exposed.

## Safety, remaining risks and Stage 3D impact

No UAT or operational DB credentials were read, no UAT fixture was run, and no UAT/operational database was queried or changed. Commands target only generated remediation projects/ports. Read-only container metadata confirms UAT app/database remain running with start times from 2026-10-21. The calling checkout still lists the original modified paths and untracked UAT items. No write targeted those files; a before/after content hash comparison was not captured, so byte-for-byte identity is not independently claimed. No push, merge, deployment or UAT baseline change occurred.

F-09 retains residual spray/storage/CPU exposure without a trustworthy per-source admission boundary. F-06 needs Owner-approved actual-target inventory and legacy mapping review. F-10 needs an explicit PDF scope/milestone decision. Owner UAT, due-date/operator commissioning, off-site backup, independent key custody, restore rehearsal and deployment approval remain production gates. The existing pg concurrent-query deprecation warning did not fail tests and remains outside this targeted change.

Stage 3D requirements/design has a conditional GO. Business-code implementation remains NOT READY pending detailed requirements, permissions, allocation/idempotency/concurrency/reversal rules, receipt/proof contracts and F-10 disposition. Financial calculations, source freezing, invoice numbering, immutability and role boundaries were not extended. No new ERP feature is introduced.

## Files changed

The precise inventory is `evidence/remediation/changed-files.txt`. Product changes are limited to authentication, conditional test-target health proof, and invoice metadata contrast. Test/config changes add actual-target validation, request isolation, fresh environment provisioning and regression cases. Documentation adds the five requested deliverables, decision trail, browser isolation instructions, authentication assessment and F-06 read-only procedure. Raw logs and synthetic screenshots/fixtures are included as evidence; private environment files and browser traces are excluded.

## Attention

Reviewed by the independent_review agent using the inherited session model. F-09 remains partial; F-06 and F-10 remain open. Final review found no remaining material code issue preventing F-11/F-12/F-13 closure. F-09 production source/storage controls and the Owner/data decisions remain the outstanding attention items.
