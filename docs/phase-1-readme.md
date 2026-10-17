# Taky Apartment ERP — Phase 1 historical README

Phase 1 frontend for a Thai apartment with 15 rooms across three floors. Built with Next.js App Router, React, strict TypeScript, Tailwind CSS, Lucide and accessible Radix dialogs/tabs. The application exports static files; this phase has no application backend.

## Run locally

Use Node.js 20.9 or newer. Verified with Node.js 22.22.3.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. To review the production export, stop the development process first, then run:

```sh
npm run build
npm start
```

`out/` contains the complete frontend. Fonts and icons are bundled locally; normal use does not fetch Google Fonts, a CDN or an external API. Dependency installation needs internet. `npm start` serves static assets on loopback and is a local review tool, not the future LAN production deployment.

## Phase 1 scope

| Route | Implemented frontend behavior |
| --- | --- |
| `/` | Reconciled KPIs, occupancy, cash flow, action queue and six-month chart. |
| `/rooms/` | All floors, search/status/floor filters, room details and empty states. |
| `/tenants/` | Searchable tenant selection, editable fictional contact data and six profile tabs. |
| `/leases/` | Lease filters/details, deposit display and CSV export. |
| `/billing/` | Meter validation, draft calculation, invoice preview, duplicate-safe demo issuance and A4 print. October fixtures are already issued; choose November to create a demo bill. |
| `/payments/` | Search/filter, partial-payment entry, duplicate/overpayment checks, receipt preview/print and CSV. |
| `/expenses/` | OPEX/CAPEX/category filters, expense creation/details and CSV. |
| `/reports/` | Six report tabs, period filters, cash flow, chart, outstanding balances and CSV. |
| `/maintenance/` | Ticket filters, creation, assignment display and status updates. |
| `/settings/` | Property/room/rate edits, sample user roles, honest backup/restore placeholders and explicit demo reset. |

Data is fictional and stays in this tab's memory. Client navigation preserves edits; refresh restores fixtures. The reference date is fixed at 15 October 2026 for repeatable screenshots. Pending transfers are excluded from receipts. Deposits are liabilities and stay outside rental revenue. All monetary calculations use integer satang.

Authentication, database persistence, file uploads, bank integration, audited financial transactions, scheduled backup, Google Drive sync and restore are deferred. Backup/restore controls are disabled and explain their dependency. Do not enter real tenant or financial records into this demo.

## Plan, architecture and review

- [Repository review](docs/repository-review.md)
- [Phased implementation plan](docs/implementation-plan.md)
- [System architecture and future schema/API contract](docs/system-architecture.md)
- [Verification evidence](docs/verification.md)
- [Screenshot gallery](docs/screenshots/index.html)

The upstream tree at `7f4652837b89b1b35af5d3cbb4de9d7146ac78f8` contained exactly the implementation brief, HTML prototype and one-page UX/UI PDF. Those reference contents are retained at their original paths. This workspace was initially empty; source files were retrieved through the connected GitHub account. No Git history or remote changes were created by this implementation.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright tests target the production export on http://127.0.0.1:3100 and start/stop their own static server. macOS tests use installed Google Chrome. On other platforms, install Chromium once with `npx playwright install chromium`. Browser workflows, axe WCAG A/AA checks, console/external-request checks and page-overflow checks accompany screenshots at 1440, 768 and 390px. Screenshots are saved in `docs/screenshots/`. Traces and the HTML runner report are temporary ignored files.

```sh
npm run test:screenshots
npx playwright show-report
npm run format:check
```

`.npmrc` enables the legacy peer resolver because npm 10's standard resolver crashes on Vitest's unused optional browser integrations. Dependencies remain locked in `package-lock.json`. The patched compression override applies only to the local static review server.

## Layout and visual decisions

The PDF supplies page composition; the HTML supplies supporting colors, proportions and interaction destinations. The navy gradient sidebar, pale-blue workspace, white cards, tinted financial KPIs, compact tables and colored status pills are preserved. Thai text is locally bundled. Mobile uses a focus-managed menu and scrolling table regions. Small text colors are slightly darker to pass automated contrast checks. The separate leases page follows the shared language because the PDF has no dedicated leases panel.

Shared visual components live in `src/components/`; screen-specific composition lives in `src/features/`. `src/demo/` owns the fictional records, command validation and calculations. Every feature reads that single state. Later phases replace the demo owner with authorized server operations; no mock API layer was added in Phase 1.
