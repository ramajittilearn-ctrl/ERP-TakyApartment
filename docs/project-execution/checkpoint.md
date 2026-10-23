# Current execution checkpoint

Recorded 2026-10-24, Asia/Bangkok. Main thread 01a164a6-91ca-7913-ad0f-9a5d343652a6. Continue the authorized Pstack project mission without a new routine approval request.

## Controlled baseline

`/private/tmp/taky-development`, branch `codex/project-integration-snapshot`, HEAD `5093da9`. This independent source snapshot is readable and supports local commits. It does not preserve original repository ancestry. Original Git object reads stalled; do not reset, prune, remove locks or retry expensive reads without new evidence. Original dirty application files and UAT ports 3700/3701 remain untouched. Main owns integration and execution records. Specialists own bounded files and material work receives independent review.

Reviewed integrated milestones include payment domain 0e4e302, inventory v3 bf71f9c, payment API 6da96b7, billing period/rate UI d068f40, tenant rent fix 7944594, persisted payment UI a9496e0, invoice PDF glyph fix 020cb14 and normal-order tenant regression c622374. Earlier backup/heartbeat/auth fixes remain included. Stage 3D is not complete until receipt PDF verification and integration finish.

## Verified evidence

- Integrated source unit suite 268/268 in 15 files and Webpack production build passed before receipt integration. Evidence: `evidence/agent-uat/final-integration-{unit,build}.log`.
- Operations suite 50/50 passed, `evidence/agent-uat/integrated-ops.log`. Real isolated restore v3 harness passed 48 checks, including unchanged historical v2/legacy registries. This is not operational recovery certification.
- Fresh combined PostgreSQL regression passed 92/92 in seven files. Log `evidence/agent-uat/combined-db-integration-2026-10-23T11-58-03.174Z-07d03db8-dc65-4922-a68b-07164fc1a280.log`. Dedicated payment domain 22 and actual-session API six cases passed separately.
- Billing branch Agent UAT 51/51, payment UI 14/14, tenant rent three cases plus clarified normal-order one case passed independently and are committed.
- Full combined browser run 8a6f2e8f5b3166f805353e53 finished 68 passed, one failed. The failure was an ambiguous loading-status test locator matching both billing history and invoices. Agent combined_uat_fix narrowed it to the actual invoice loading message; Main independently inspected the source and unchanged assertions. Fresh full run 2cb9d14d699644c6a08f83e0 finished 68 passed and one failed before a test because target health returned a non-2xx response. The corrected invoice case passed. Guard and timeouts remain intact. combined_uat_fix investigates the unavailable-health cause, log `evidence/agent-uat/combined-full-browser-corrected.log`. No full-suite success claimed. Test correction committed 5093da9.
- Invoice PDF five fixtures passed 48 extraction checks and visual review after Baht/superscript-three font correction. Receipt extraction uses the same supported font helper, pending independent regression review.

## Active assignments

Receipt owner receipt_pdf_design froze WIP in `/private/tmp/taky-receipt-pdf`, branch codex/receipt-pdf at c622374. Handoff `evidence/receipt-pdf/handoff.md` includes source SHA256 manifest. New renderer, authenticated GET PDF route, receipt links and shared font helper. Owner reports 289/289 unit, typecheck, lint, Webpack build, 74 receipt semantic/page checks and 48 invoice glyph checks. Five receipt PDFs have 25 total rendered pages. These owner checks are not independent acceptance. receipt_pdf_design_review independently examines code and visual artifacts. Main executed genuine-session PostgreSQL cases: 2/2 passed. Reviewer independently checked actual three route PDFs and unchanged snapshot/fingerprint. Owner prepares actual browser link/download cases; Main executes them serially. No schema change.

Expense owner expense_architecture delivered `expense-contract.md`; expense_design_review reviews before code. Expense implementation began in isolated /private/tmp/taky-expenses-development, branch codex/expense-domain from c622374. Design independently accepted after three corrections, defaults explicitly adopted. Owner owns schema/backend/API/tests; no DB/Docker execution. Proposed new ExpenseCommand model makes 39 total models, requiring frozen v4 inventory after integration. Deposit design review has three open contract corrections for reversal targets, cross-stream transfer identity and total equations. Main can adopt documented development defaults under broad authorization; missing actual facts must not be invented.

## Tenant rent incident limits

The reproduced failure was explicit rent entered before selecting/reselecting a zero-default room. The fixed client preserves explicit rent including intentional zero; untouched drafts still get room defaults. A separate actual browser test proved room first, rent last, immediate save persisted 4100.75 in POST, stored lease and profile before/after reload. Original deployed-UAT normal-order failure has not been reproduced there. The user has not supplied URL/room/amount. No historical rent or invoice data was guessed or repaired. Candidate fixes are not deployed to original UAT.

## Isolated environments

Combined regression project taky-remediation-integration-4896c4d1e00a0ca6939fd8bc uses 127.0.0.1:55451, role int_4896c4d1e00a0ca6939fd8bc, DB taky_phase2_test, subnet 10.253.244.0/28. Setup completed 14 migrations; do not rerun setup. Guarded driver `/private/tmp/taky-combined-db-qa/runner.cjs` and README retain exact plan and actual role/database checks.

Payment QA2 project taky-payment-qa2-isolated uses 127.0.0.1:55489 and role taky_qa_2b5214bd52. Current private identity points to DB taky_payment_test_2b5214bd52_routes1, already migrated. All earlier databases remain preserved. Receipt tests may add synthetic fixtures here after exact attestation; no reset/drop/setup.

Completed browser run 2cb9d14d699644c6a08f83e0 used its immutable per-run private plan, DB port55452, app3820, proxy3822, subnet10.253.243.0/28. Runner validates exact generated plan and actual role/database before migrations, retains fresh evidence and only removes its own container/network. Volumes stay. Do not use ambient database credentials or convenience env as identity.

## Release facts and limits

Owner delegated UAT execution/reporting to agents and authorized proceeding toward Go-Live. No human UAT pass is claimed. Existing configured taky-erp operational target is healthy but has only 22 application tables and three migrations. Read-only aggregate inventory found zero Tenant/Lease/Invoice/Payment/PaymentAllocation/SecurityDeposit/Expense rows. Configured LAN IP192.168.1.177 differed observed en0 IP192.168.1.135. Reconcile target/network before deployment. No production mutation, migration, backup, deployment or recovery certification performed.

Actual legal issuer/account/evidence-retention facts remain unverified. Deposits, expenses, persisted reports, remaining security admission controls, non-destructive migration rehearsal and operational backup/recovery remain unfinished. Broad authorization permits engineering defaults; it does not supply missing operational facts or certify implementation.

## Next executable work

1. Finish corrected full browser run, independently reconcile result and commit the bounded test correction/evidence.
2. Close receipt code/visual findings, execute genuine-session PostgreSQL tests and real browser PDF links/download, integrate only after acceptance and regression checks.
3. Resolve expense/deposit contract findings, adopt explicit conservative defaults, then assign isolated implementation with schema/restore-registry ownership coordinated by Main.
4. Update backlog and append decisions, preserve sanitized evidence/QA drivers, copy owned execution records to original workspace, refresh and verify snapshot bundle.
5. Continue through persisted reports, security/operations and actual release gates. Never stop merely because one milestone finished. No self-restarting process or recurring automation is configured.
