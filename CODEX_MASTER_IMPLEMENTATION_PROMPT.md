# Taky Apartment ERP — Codex / Claude Code Master Implementation Prompt

## Mission
Build a production-ready **local-first dormitory ERP** for **15 rooms across 3 floors**. The repository includes `prototype/index.html`, the approved visual UX reference. Recreate its visual language faithfully (navy sidebar, pale-blue background, white cards, blue CTAs, status pills, Thai-first labels, responsive layouts) as **real React components**. Do not simply embed the prototype in an iframe or use the reference as a static screenshot.

## Workflow
1. Inspect existing repository and preserve existing work. Use `prototype/index.html` as the design specification and functional navigation baseline.
2. Draft a concise implementation plan, database schema, API contract, and acceptance tests before coding.
3. Implement in small, testable increments. Never report a feature complete without evidence from tests.
4. Use fictional seed data only. Clearly mark demonstration values. Never commit secrets or real tenant data.

## Technical architecture
- Next.js App Router + TypeScript + Tailwind CSS + accessible UI primitives + Lucide icons.
- PostgreSQL + Prisma ORM; Zod validation; server-side authorization and audit trail.
- Docker Compose for app and database; bind to host LAN only when configured; PostgreSQL must not be exposed on LAN.
- MacBook/Mac mini deployment. Provide `.env.example`, `docker-compose.yml`, Dockerfile, Makefile, scripts, README and operations guide.
- Work without internet during normal operation. Google Drive is optional only for encrypted backup sync.
- Secure local authentication (Argon2id password hashing, httpOnly secure session cookies where HTTPS available), roles ADMIN and STAFF. Protect tenant PII, uploads, and financial records. Do not ship default passwords.

## Required P0 functional modules
1. Dashboard: occupancy, billed revenue, actual receipts, outstanding balance, OPEX, CAPEX, operating cash flow, net cash flow, action queue.
2. Room management: 101–105, 201–205, 301–305; vacant/occupied/maintenance status; rent, floor and room detail.
3. Tenants and leases: contact, move-in/out, lease dates, deposits, documents, tenant-room history; one active lease per room.
4. Utility meters: prior/current water and electric readings; configurable tariff and effective dates; validation, corrections, immutable historical bills.
5. Billing: recurring rent, utilities, additional fees/discounts, due date, invoice number, itemized invoices, PDF/print, partial payments, overdue status.
6. Payments: cash/bank transfer/QR manual record, optional proof attachment, reconciliation, allocations to invoices, duplicate prevention, receipt, reversals with audit log. No unverified automatic bank confirmation.
7. Expenses: date, vendor, category, OPEX/CAPEX, amount, payment method, receipt attachment, notes, approval/status. Categorization should be editable with audit trail; do not confuse capital purchases with period operating expenses.
8. Finance reports: billed vs collected vs outstanding, OPEX, CAPEX, cash flow, occupancy, month/year filters, CSV export. Security deposits tracked as liabilities rather than rental revenue.
9. Maintenance tickets: room, issue, priority, status, assigned party, costs, history.
10. Settings and backup: room configuration, rates, users, backup status, backup/restore controls.

## Database entities
User, Session, Room, Tenant, Lease, DepositTransaction, UtilityMeter, MeterReading, Tariff, Invoice, InvoiceLine, Payment, PaymentAllocation, Expense, ExpenseCategory, MaintenanceTicket, Attachment, AuditLog, BackupRun, AppSetting.
Use UUID primary keys, explicit foreign keys, indexes, timestamps, monetary DECIMAL/NUMERIC (not float), unique invoice numbers, safe delete policies, and transactional payment allocation. Use Thai timezone Asia/Bangkok for display; store timestamps in UTC.

## Weekly backup and restore
- Weekly scheduled PostgreSQL logical dump plus required attachment files and metadata manifest.
- Encrypt locally with authenticated encryption (e.g. age) before syncing to a dedicated Google Drive folder via a securely configured mechanism (e.g. rclone).
- Retention policy configurable; verify archive integrity, log success/failure, surface failures in dashboard.
- Keep credentials out of repository. Require explicit Google OAuth setup.
- Restore requires admin confirmation, pre-restore safety snapshot, documented dry-run and tested end-to-end recovery.
- Google Drive failure must not block local operations; keep local backup until sync succeeds.

## Visual fidelity acceptance
- Match the reference's information hierarchy, proportions, sidebar, typography, card treatments, tables, status colors and responsive behavior.
- Implement every navigation destination as an actual page.
- Use reusable AppShell, Sidebar, Header, KPI cards, RoomCard, DataTable, FilterBar, StatusBadge, Modal, Form, and Chart components.
- Thai-first interface with legible currency (THB), dates, validation messages, loading/empty/error states.
- Test at desktop 1440px, tablet 768px, mobile 390px. Ensure keyboard access and contrast.
- Include screenshots of each implemented page for review; do not claim pixel-perfect equivalence without visual comparison.

## Delivery and verification
- Provide Prisma migrations and repeatable seed for 15 rooms.
- Unit tests for billing, meter deltas, deposit handling, OPEX/CAPEX classification, partial payments, balances.
- Integration tests for invoice/payment lifecycle and permissions.
- Playwright smoke tests for all pages and core workflows.
- Document `docker compose up -d --build`, first-run setup, LAN URL, database migrations, backup setup, restore test and troubleshooting.
- Never overwrite existing user data or perform destructive migrations without explicit confirmation.
- Keep repository private; no cloud app deployment required.

## Definition of done
An operator can open the ERP from another device on the same LAN, authenticate, manage rooms and tenants, enter readings, issue a bill, record partial/full payment, record an OPEX or CAPEX expense, view correct finance summaries, create maintenance tickets, and complete a tested weekly encrypted backup/restore. No mock buttons or placeholder financial workflows in the finished P0.
