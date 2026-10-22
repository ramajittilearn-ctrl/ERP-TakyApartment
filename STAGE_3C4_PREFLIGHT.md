# Stage 3C-4 preflight

Date: 2026-10-22, Asia/Bangkok.
Status: Scope approved by owner reply "ok" on 2026-10-22 after the concrete recommendation in this chat. Historical preflight observations below are retained. Current execution is recorded in STAGE_3C4_PLAN.md.

## Baseline and authority

Verified requested baseline: `0530eddac1d1e07a578b8715c92884c320ed8baa`, the Stage 3C-3 closure commit and latest commit touching `STAGE_3C4_HANDOFF.md`.
Existing checkout: `/Users/ramajittipasutanavin/Documents/ปลูกหอพัก/ERP`, branch `codex/stage-3c-billing-invoice`, HEAD at the requested baseline.
Dedicated branch `codex/stage-3c4` created at that exact commit. Managed worktree creation completed and attached successfully. The worktree is `/Users/ramajittipasutanavin/.codex/worktrees/stage-3c4/ERP`. Branch and baseline were verified after checkout; tracked files were clean before this report was added.

Inspected baseline documents: `STAGE_3C4_HANDOFF.md`, Stage 3C-3 handoff, requirements, implementation/test reports and decision log, Stage 3C requirements/test plan, Stage 3B closure and audit findings. Inspected current untracked UAT setup report, guide, checklist and defect log without modifying them.

`STAGE_3C_TEST_PLAN.md` assigns full browser/UAT and final integration closure to Stage 3C-4. `STAGE_3C3_REQUIREMENTS.md` similarly assigns broader UAT/release closure. These are milestone responsibilities, not a separately approved change list or acceptance matrix. `STAGE_3C4_HANDOFF.md` explicitly says to obtain the next milestone scope before adding deferred workflows. No Stage 3C-4 requirements/design/approval artifact was found among the 314 baseline tracked files or the inspected UAT documents.

Do not infer authorization for payments, receipts, deposits, VAT/tax, optional charges, ledger posting, bank reconciliation, delivery, deployment, historical mapping or future-period reconciliation. Preserve closed sources and invoice snapshots.

## Isolation and dependencies

The existing UAT app and database were observed healthy through read-only Docker status. Project `taky-uat-round1` publishes the app at `127.0.0.1:3700`; its database has no published host port. The UAT setup report names database `taky_erp_uat_round1`, private network/volumes and ignored private credentials. No UAT database query, login, fixture creation, migration, restart or environment change was performed.

The UAT setup report records owner-selected ADMIN setup and authenticated browser/fixture verification as blocked. This is a report observation, not a fresh verification of user accounts. UAT acceptance cannot be claimed from service health.

Stage 3C-4 runtime has not been provisioned. No secrets or environment files were copied and no new ports or database targets were used. When scope is approved, provision a separate Compose project, network, volumes, database/role, fresh private secrets, app origin and loopback port. Check availability at launch. Do not reuse an existing test database merely because its name contains test. Keep dependencies, generated clients, build output and test evidence in the new worktree.

## Risks and controls

| Risk                        | Evidence and required control                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Git metadata         | Worktrees share refs and object storage. Use only `codex/stage-3c4`; never reset, clean, switch or stash the UAT checkout.                                                                                                                                                                                                                                                                                           |
| Shared source files         | Existing edits are `next-env.d.ts`, `src/app/globals.css`, `src/features/auth/login.tsx`; UAT documents and fixture script are untracked. Do not copy them implicitly. Meter UI, auth, billing UI, test fixtures/config and global CSS are integration conflict areas. Coordinate any later promotion explicitly.                                                                                                    |
| Test target assumptions     | Playwright defaults to port 3300 and loads `.env.test`; phase2 fixtures require database `taky_phase2_test`. Invoice API/browser scripts pin app 3900, DB 55434, role `stage3c3_test`, database `taky_phase2_test` and shared `/private/tmp/taky-stage3c3-qa` output. They cannot be run unchanged as independent Stage 3C-4 verification. Design explicit isolated configuration and evidence paths after approval. |
| Migration locks and history | Baseline has 13 migrations. Index/trigger installation and numeric alterations require rehearsal. Preserve applied migration files and use new migrations only if approved scope requires them. Never migrate or reset UAT/operational targets.                                                                                                                                                                      |
| F-04                        | Known stale meter overview responses and actionable stale form can lose unsaved input. Owner must choose remediation or explicit operator-tested acceptance.                                                                                                                                                                                                                                                         |
| F-05                        | Recorded/confirmed/replacement timestamps are missing in history UI. Owner must decide inclusion or deferral.                                                                                                                                                                                                                                                                                                        |
| F-08                        | Historical full browser result is 14/15; focused Stage 3C-3 checks do not close the gap. Define full regression/browser/role coverage and owner UAT acceptance.                                                                                                                                                                                                                                                      |
| F-06 and commissioning      | Operational target identity, legacy mapping, backup/restore, migration rehearsal and due-date/operator configuration remain mandatory before actual billing. Synthetic checks cannot clear them.                                                                                                                                                                                                                     |

## Pstack gates and execution checkpoint

Preflight: baseline, branches, handoffs, current working-tree changes, UAT status and runner target assumptions inspected. No application behavior changed and no runtime tests executed.

1. Scope gate: BLOCKED. Obtain owner-approved deliverables, exclusions, acceptance criteria and defect disposition.
2. Planning/design gate: NOT STARTED. After approval, map each requirement to affected files and verification; compare designs where necessary and review source/migration contracts before implementation. Read installed Next.js guides and applicable TypeScript/React skills before code edits.
3. Implementation gate: NOT STARTED. Delegate scoped implementation under Pstack only after the blocking gates pass. Keep separate files independent and serialize shared writes. No inferred financial policies.
4. Verification gate: NOT STARTED. Prove each approved milestone with relevant unit/domain checks, isolated PostgreSQL/API checks and live browser interactions. Retain actual failures and evidence. Operator UAT sign-off is separate.
5. Milestone report/closure: NOT STARTED. Report exact branch/commit, change set, evidence and unresolved operational gates. No push or merge without explicit owner authorization.

Throughput checkpoint: blocking scope/isolation first; UAT remains an independent existing workstream; shared Git refs and test targets require explicit separation; no implementation fan-out is justified before scope approval.

## Required owner decisions

1. Provide the approved Stage 3C-4 scope artifact, or approve an explicit scope and acceptance matrix. The documents inspected support browser/UAT/integration closure as the milestone purpose, but do not approve a specific implementation.
2. Decide whether F-04 and F-05 fixes belong in this milestone, and define the F-08 acceptance boundary, including browsers/viewports, role scenarios and who signs operator acceptance.
3. Confirm whether operational F-06/mapping, backup/restore rehearsal and commissioning are Stage 3C-4 deliverables or remain separate gates. Any target access or data-changing activity needs explicit scope; no UAT or operational data is available for destructive automated tests.

No permission gate was invented by Pstack. Coding stopped because the user explicitly required a stop when scope or dependencies are unclear.

## Proposed scope awaiting owner approval

The owner asked for a suggestion after the scope question. This is not implementation approval.

Recommended Stage 3C-4 includes F-04 stale meter response and stale-form protection, F-05 history timestamps, and F-08 browser and integration closure. It also includes configuration of independent verification targets and evidence paths for those checks. It excludes new financial workflows and operational commissioning.

Proposed acceptance criteria:

- Delayed and out-of-order overview responses cannot replace the selected meter or discard unsaved input. A loading form cannot submit stale meter data. Real browser regression evidence proves both behaviors.
- Reading history displays recorded and confirmed timestamps and replacement event timestamps from existing backend records. Browser checks verify the displayed values and Thailand timezone presentation.
- The historical failing browser scenario has a recorded cause and verified disposition. The full existing suite passes on the dedicated target, with any unsupported scenario explicitly reported rather than counted as passed.
- Desktop and mobile checks cover meter validation, confirm, correction, replacement, history, navigation and ADMIN/STAFF restrictions. Existing invoice lifecycle, source immutability and financial engine contracts remain covered by focused regression checks.
- Every run records the branch/commit, target identity, command, actual result and separate evidence path. No UAT fixtures or services are touched.
- Human operator acceptance remains pending until the owner or named operator signs the agreed checklist. Automated checks cannot substitute for that sign-off.

F-06 operational target and legacy mapping, operational migration rehearsal, backup/restore commissioning and deployment remain separately gated. Actual billing stays NO-GO. These exclusions do not clear any production gate.

## Historical final preflight result

The worktree is ready at the exact Stage 3C-3 baseline on `codex/stage-3c4`. Only this preflight report is added. No dependency installation, app runtime, database, secrets, port allocation, migration, application code change, push or merge occurred.

The first managed checkout attempt stalled during Git object reads and was interrupted while clearing this task's stalled Git processes. The app cleaned up that attempt. A fresh managed creation completed successfully and was attached; the new checkout was switched to the dedicated branch and verified. No UAT process was interrupted.

Implementation remains blocked only at scope approval. The recommendation above is concrete and reviewable, but the owner's request to suggest scope does not approve it. Runtime dependencies and verification environment will need independent provisioning after approval.

## Approval and execution follow-up

The owner approved the proposed scope with "ok" and later requested continuation until complete. Implementation and automated verification are complete. See STAGE_3C4_CLOSURE.md for the current status; earlier stop statements above describe the pre-approval snapshot.
