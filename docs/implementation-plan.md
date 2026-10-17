# Phased implementation plan

## Phase 1: approved frontend

Deliver a responsive Next.js App Router application with TypeScript, Tailwind and Lucide. Preserve the three reference artifacts and the approved navy sidebar, pale-blue workspace, white cards, Thai labels and status colors. Each sidebar destination has a real URL. Bundle fonts and assets locally.

1. Review every artifact and render the complete PDF. Record source differences and create the architecture before coding.
2. Build shared navigation, header, cards, data tables, tabs, filter controls, accessible modal/forms, charts, loading/error/empty states and print styles.
3. Build dashboard, rooms, tenants/profile, leases, billing with invoice preview, payments, expenses, finance reports, maintenance and settings/backup.
4. Label fictional demo mode. Implement room filters/details, tenant tabs, meter calculations, invoice preview/print, partial-payment entry, expense entry, maintenance transitions and settings edits in session memory. Backup/restore and authentication remain explicitly unavailable.
5. Verify a production build, calculation tests, browser workflows, keyboard interactions, accessibility and screenshots of every page at 1440, 768 and 390px. Compare screenshots with the reference and document adaptations.

Exit gate: all ten routes load directly, no mobile document overflow, forms validate, financial views reconcile, dialogs restore focus, browser tests pass, screenshots are reviewable. No backend code or persistent tenant/financial storage in this phase.

## Phase 2: local platform and data

Add PostgreSQL, Prisma migrations and fictional seed, environment validation, Docker Compose and first-run administration. Implement Argon2id authentication, secure sessions, ADMIN/STAFF authorization, audits, protected uploads and room/tenant/lease CRUD. Enforce one active lease per room. Exit gate: authorized LAN CRUD survives restarts and server permission tests pass.

## Phase 3: billing and payments

Implement effective-dated tariffs, meter corrections, immutable issued invoice lines, unique invoice numbers, transactional payment allocations, reconciliation, attachments, receipts and audited reversals. Use NUMERIC money; track deposits as liabilities. Exit gate: lifecycle/concurrency tests reconcile all balances and exclude deposits from income.

## Phase 4: expenses, maintenance and reports

Persist audited OPEX/CAPEX categories and approvals, maintenance ownership/history/costs and period-based finance queries/exports. Exit gate: independent fixtures and report queries reconcile billed, collected, outstanding, OPEX, CAPEX, cash flow and deposits.

## Phase 5: operations and recovery

Implement weekly database/attachment backup manifests, authenticated encryption, opt-in Google Drive sync, configurable retention, integrity checks, retries and dashboard failure visibility. Restore requires admin confirmation and a safety snapshot. Test recovery in a disposable environment and full P0 on a second LAN device. Finish Mac operations and troubleshooting guides.

## Verification

- Unit tests cover invalid meter values, utility calculation, partial payments, pending receipts, deposits and OPEX/CAPEX totals.
- Playwright tests run against the production static export and cover direct routes, navigation, filters/empty states, forms, dialogs, keyboard focus, mobile navigation and CSV export.
- Deterministic October 2026 fictional fixtures support screenshots of all ten pages at desktop, tablet and mobile widths.
- Axe checks all routes. Manual screenshot review checks Thai legibility, layout, chart labels, invoice preview and table scrolling against the approved PDF.
- Frontend acceptance does not imply authentication, durable accounting, bank verification, encrypted backups or restore are implemented.
