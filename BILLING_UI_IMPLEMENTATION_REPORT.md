# Monthly Billing UI Implementation Report

## Result

Implemented the missing ADMIN-facing period and utility-rate setup in the dedicated `codex/billing-ui` worktree based on candidate commit `ce1837525672664b7414aa2583207d0b2800b982`. The work adds the controls to the existing database-backed `/billing/` invoice screen and uses the existing period, rate, and rate-selection write APIs. Period selection now clears the dependent room/lease selection to prevent a stale invoice context.

Billing setup supports selecting an existing period, displaying its dates and OPEN/CLOSED status, creating a monthly period, viewing effective-dated rates, appending water/electricity rates, choosing applicable rates for a selected period, and recording a reasoned rate-selection revision. Persisted selection history is readable after refresh. Server-side validation remains authoritative for duplicate/overlap and lifecycle constraints. A server authorization check was added to period creation because the pre-existing endpoint allowed STAFF despite this workflow's ADMIN-only requirement. Rate creation, approval/selection, and period closure continue to use their existing ADMIN-only authorization.

The workflow is presented as period → rates → meters → review/close → invoices. The UI shows Thai labels, units, currency, accessible errors/status messages, and separates historical rate values from append-only rate creation. Closed periods have no editable setup controls. The underlying calculation engine, billing schemas, invoice snapshots, migrations, payment scope, and original UAT environment were not changed.

## API and data behavior

- Existing `POST /api/v1/billing-periods`, `POST /api/v1/utility-rates`, and `POST /api/v1/billing/rate-selections` are reused.
- Added authenticated `GET /api/v1/billing/rate-selections?billingPeriodId=...` for selection audit history, including revision, actor, timestamp, reason, and linked immutable rate values.
- ADMIN authorization is enforced by the server for period creation; STAFF cannot mutate periods, rates, or selections.
- Utility rates remain append-only. The existing effective-date and overlap validation and calculation logic are unchanged.
- No database schema change or migration was needed.

## Verification summary

See [BILLING_UI_TEST_REPORT.md](BILLING_UI_TEST_REPORT.md) for commands and results. The isolated browser workflow used fictional fixture data and completed period creation, duplicate rejection, rate creation/selection, meter readings, calculation, closure, invoice issuance, PDF download, refresh persistence, and STAFF denial. Tests ran only against the isolated remediation database/browser environment.

## Scope and remaining release action

In the tested source branch, an ADMIN completed the monthly billing workflow through the ERP UI without manual API, SQL, or terminal actions in a dedicated isolated browser test. The broader browser regression remains a blocker: two full runs completed with failures (see the test report). The branch has not been deployed to the candidate or Owner UAT; deployment was expressly out of scope. Therefore the existing candidate URL will not contain these changes until an authorized promotion. The repository's other pre-existing UAT observations (demo badge, meter correction review, VOID/reissue review) are outside this remediation and were not changed.

F-10 PDF and Stage 3C snapshot behavior remain as present in the verified candidate baseline. No Stage 3D Payments functionality was added.

## Agent execution

Pstack architecture selection used `billing_design_single_panel` and `billing_design_workflow_tabs`, with `billing_design_judge` making the independent design decision. The selected single-panel implementation was performed by `billing_design_single_panel`. The Main Agent performed integration, tests, final review, and reporting. No financial-data or PDF-rendering code delegation was necessary for this UI scope.

## Handoff

The local branch and commit are recorded in the final task handoff. No push, merge, deployment, or mutation of either UAT environment was performed.
