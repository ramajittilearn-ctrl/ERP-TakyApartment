# Stage 3C-4 approved plan and design

Date: 2026-10-22, Asia/Bangkok. Baseline `0530eddac1d1e07a578b8715c92884c320ed8baa`. Owner approved the proposed F-04, F-05 and F-08 scope with "ok" after the preflight recommendation. Production billing remains NO-GO.

## Approved outcome

Fix stale meter overview responses and protect unsaved form input. Show recorded, confirmed and replacement event timestamps using Asia/Bangkok. Close the broader automated browser and integration verification gap with actual evidence. Human operator acceptance remains a separate pending sign-off.

Payments, receipts, deposits, tax, optional charges, ledger, bank reconciliation, delivery, future-period reconciliation, operational mapping, commissioning and deployment are excluded. No push or merge is authorized.

## Grounding and design

The meter screen owns filter state and loads overview data through authenticated APIs. Each current load replaces every meter value/date without checking request identity. Inputs from the previous overview remain actionable during loading. Saving one utility calls the same loader and discards another utility's unsaved input. History and admin completion also need captured context. Server reading DTOs already return createdAt and confirmedAt; frontend parsing currently drops createdAt. No database schema change is needed.

| Candidate                                        | Effect                                                                         | Decision                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Keyed workspace per period/floor                 | Unmount invalidates requests but destroys drafts unless ownership moves upward | Rejected because preserving draft state splits ownership across components. |
| Query-bound requests and separate draft overlays | Retains component ownership and preserves edits across refresh/filter changes  | Selected as the smaller change with explicit request and mutation guards.   |

Overview state binds loading/ready/error to the active query. Each read request has cancellation and generation identity. Only current results can update state. Draft overlays use period plus physical meter identity and contain value/date. Save captures its exact context, removes only the saved draft and preserves other edits. Mutation locks prevent duplicate requests and disable context changes until the write and refresh finish. History reads also reject stale context. Timestamp markup uses time datetime values with explicit Bangkok presentation.

Verification configuration has an explicit Stage 3C-4 mode pinned to app 127.0.0.1:3800, PostgreSQL 127.0.0.1:55440 and role stage3c4_test. Database name taky_phase2_test remains for existing suite safety guards, inside a new dedicated container, volume and network. Evidence is worktree-local. Existing Stage 3C-3 defaults remain guarded.

## Throughput checkpoint

- Blocking first steps: scope approved, baseline verified, Next.js local client guide read, dependencies installed independently. Dedicated runtime identity must pass before test writes.
- Independent workstreams: meter UI/contracts, browser tests, and invoice verification configuration have separate delegated owners. Root owns runtime, reports and final verification.
- Shared mutable state: each source file has one writer. Root runs database and browser verification serially. UAT has separate services, data, secrets and directory.
- Smallest safe decomposition: no additional business layers or financial changes. Browser fixture conflicts are addressed only when reproduced.

## Milestones and checks

- [x] A: Scope and preflight approved. Record design and test acceptance before functional implementation.
- [x] B: Implement F-04/F-05 and explicit verification target configuration. Run static and unit checks and review the diff.
- [x] C: Run full existing browser suite plus deterministic F-04/F-05 and expanded meter scenarios on desktop/mobile. Record the historical failure disposition and actual failures, screenshots and console health. Browser plugin is not available; use the installed Playwright with Chrome.
- [x] D: Run isolated PostgreSQL regression, invoice API/browser checks, schema/migration status and build. Report exact results and remaining human/operational gates.

No applied migration files will change. Dedicated verification databases are synthetic. No UAT fixture, secret, file or service is an execution target.

Final results and retained limits are recorded in STAGE_3C4_CLOSURE.md and STAGE_3C4_TEST_REPORT.md. All gates above mean development and automated verification only. Human operator acceptance remains pending.
