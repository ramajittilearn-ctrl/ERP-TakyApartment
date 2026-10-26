# Phase 4 closeout

Phase 4 Expense Management and its Stage 3E deposit dependency are complete in the reviewed development integration baseline. The implementation and acceptance evidence were pushed to the private repository `ramajittilearn-ctrl/ERP-TakyApartment`, branch `codex/project-integration-snapshot`, at source/evidence commit `ffc1e7030b692dffeff063c536bf135de52e7d1f`. The connected GitHub API independently returned that exact ref. Later closeout-document commits can advance the branch without changing accepted features.

The Owner requested work through Phase 4 and then a stop. This boundary is reached. No next implementation task is scheduled. The original mission lists Phase 4 Expense Management before Dashboard and Reporting, so those later modules and the existing maintenance/report demo screens are not claimed complete.

## Acceptance status

| Gate | Result | Evidence |
| --- | --- | --- |
| Development | Complete for Stage 3E and Phase 4 expense scope | Deposit contracts, implementation sketches and expense closure audit |
| Local integration | Complete in `codex/phase4-recovery-integration` | `evidence/phase4/integration-source-identity.json` |
| Automated verification | Complete for the scoped milestone | Checks below |
| Independent review | Accepted; no open P1/P2 findings in the reviewed scope | `evidence/deposit-core/operations-peer-review.md`, `pdf-packaging-peer-review.md`, `evidence/phase4/closure-audit-20261025.md` |
| Agent UAT | Accepted, delegated by Owner | Fresh35-case browser run, all passed once |
| Human Owner UAT | Delegated to agents, not reported as a human pass | Owner instruction retained in standing orders |
| Production readiness and Go-Live | Outside this closure | Operational facts, remaining modules and deployment are later work |

## Verification actually executed

| Check | Result | Artifact |
| --- | --- | --- |
| Integrated application unit tests | 409/409 | `evidence/phase4/integrated-unit.log` |
| Integrated typecheck, lint and Webpack build | Exit0 each | `evidence/phase4/integrated-{typecheck,lint,build}.log` |
| Integrated PDF assets | Both PDF routes contain both regular copied fonts, exact bytes and SHA256 | `evidence/phase4/integrated-pdf-assets.json` |
| Combined browser acceptance | 35/35, zero retries, skips, unexpected or flaky results | `evidence/phase4/raw/browser-summary-8f40.json`, `8f40b1e18daa4bbab16f1f09-browser.log` |
| Deposit financial PostgreSQL matrix | 50/50 | `evidence/deposit-core/database-qa-2026-10-25T12-26-52.878Z-06b5e7c6-2127-4cd2-8a27-108f3cb33273.log` |
| Real retained evidence and failure injection | 9/9 | `evidence/deposit-core/database-qa-2026-10-25T16-08-24.131Z-6c68b5bc-6b08-4454-9690-424667aaf6a6.log` |
| Payment, route, receipt PDF and finite-number PostgreSQL regression | 39/39 | `evidence/payment-regression17/database-qa-2026-10-25T15-45-58.062Z-c9be9cb1-6ff9-4dce-96f3-66b75a43eca0.log` |
| Historical migration rehearsal | 3 payments, 3 allocations and 7 constraints preserved | Matching `15-44-10` setup log and preserved fresh artifacts |
| Expense export PostgreSQL gate | 5/5 including the 10,000 and 10,001 all-or-error boundary | `evidence/expense-export17/database-qa-2026-10-25T15-46-45.911Z-2d664614-e559-4da9-b902-c6920bfe431d.log` |
| Operations and artifact-checker tests | 68/68 | `evidence/phase4/final-ops.log` |
| Validator native tests and final Linux image HTTP fixtures | 28/28 and12/12 | `operations/evidence-validator/evidence/native-final-lint-corrected.log`, `image-runtime-23a6b730-3231-40d4-9e54-2eddc1e76d63.json` |
| Actual isolated dump, encrypted backup and restore | All 17 migrations, 44 models, guards, retained files, orphan and partial preserved | `evidence/deposit-operations/runtime-attempt3.log` |
| Actual migration and lock failures | Late003 P0001 leaves prior data/schema intact; lost publication owner aborts work | Same attempt3 log |

The 35 browser cases cover one full billing flow, five deposit flows, eight expense flows, fourteen payment flows, three receipt PDF flows and four tenant-rent regressions. They verify the reported tenant rent after selection, immediate save and reload. They also verify PDF downloads, current-role denial, exact command replay after a lost response and mobile accessibility checks.

## Corrections and limits

The standalone PDF failure was reproduced as an exact missing Thai WOFF file. Only the two font assets were added to invoice and receipt route tracing. The copied assets are hash-identical, and the real receipt response changed from500 to200 before the full browser pass. No PDF layout or financial rule changed.

The keyboard diagnostic found that neither the React select nor a plain native reference committed either tested key sequence. The acceptance case uses the supported native select operation and still exercises keyboard focus, checkbox, submission, focus return and Axe. Native-popup option navigation with the keyboard is not established by this Chrome runner. The fixed-fixture census is archived outside default acceptance discovery.

Financial write acceptance covers the current READ COMMITTED mutation protocol, source/bank admission, versions and database guards. Arbitrary manual-isolation writes or privileged database-owner operations are not certified. Existing legacy financial rows remain separate and are not automatically reclassified. The export concurrency case checks a real concurrent operation, without forcing a specific mid-SELECT interleaving.

Earlier failed browser, migration and restore attempts remain beside the corrected evidence. Private plans, credentials, cookies, uploaded files and browser traces were excluded from Git publication. Generated QA values and private-key content were checked before the source publication.

## Method and continuation

Actual specialists were `recover_deposit_core`, `recover_finite` and `evidence_review`, with Main orchestration and independent acceptance. Bounded worktrees, shared interfaces, returned findings and rechecks are recorded in the review reports. Completed feature code was frozen before local integration. The accepted source trees and build inputs match across the merge.

Pstack 0.15.32+codex.1 was found installed during closeout. Its Codex adapter and shipping guidance were used for verdict-to-source identity, publication and handoff. Newly available workflows were not applied to rewrite completed features.

Resume only after the Owner requests further work. Later work includes Dashboard and Reporting, maintenance-demo replacement, remaining security and operational commissioning, deployment-target reconciliation and authorized Go-Live. Original protected/UAT branches and the dirty original checkout remain separate. The independent snapshot ancestry is disclosed in the historical checkpoint. Synthetic QA volumes and raw local traces are retained for audit; production was not migrated or deployed by this run.

The current stack is Next.js 16.4.1, React 19.3.1, TypeScript 5.9, Tailwind 4.3 with CSS Modules and Radix, Node.js 22, Prisma 7.10, PostgreSQL 17, Zod, database sessions and Argon2, PDFKit with Noto Sans Thai, private qpdf/Sharp validation, Vitest, Playwright/Axe and Docker Compose. Pstack is the development methodology, not an ERP runtime dependency.
