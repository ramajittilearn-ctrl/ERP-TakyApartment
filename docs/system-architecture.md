# System architecture

## Usage

An operator opens `/billing`, enters readings, previews and issues a fictional invoice, then opens `/payments` and records a partial payment. Dashboard and reports read the same records and show the same balance. Reload restores the seed. No backend, authentication or backup runs in Phase 1.

```tsx
export default function Page() { return <PaymentsScreen />; }
const { state, recordPayment } = useDemo();
const result = recordPayment(validatedDraft);
const totals = summarizeMonth(state, month);
```

## Shape

Next.js App Router, strict TypeScript, Tailwind CSS, Lucide and accessible Radix dialogs/tabs. Static export proves Phase 1 needs no application backend. Ten explicit route files own screen imports. One navigation list owns labels/icons/URLs. Each feature retains its PDF-specific layout rather than a generic CRUD template.

Root layout statically renders metadata, bundled Thai fonts, DemoProvider and AppShell. The client provider is the sole writer and survives client navigation. Screens own filters, form drafts, tabs and dialogs. Pure finance functions derive all totals; only formatting converts integer satang to baht. Commands validate input and return success or a Thai validation error. Pending/reversed payments do not count as receipts. Deposits remain outside rental revenue.

```ts
type RoomStatus = 'occupied' | 'vacant' | 'maintenance';
type PaymentStatus = 'confirmed' | 'pending' | 'reversed';
type ExpenseKind = 'OPEX' | 'CAPEX';
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
function calculateBill(draft: MeterDraft): Result<InvoiceLine[]>;
function invoiceBalance(state: DemoState, invoice: Invoice): number;
function summarizeMonth(state: DemoState, month: string): FinanceSummary;
function useDemo(): DemoWorkspace;
```

Invoice lines snapshot descriptions, quantities and integer unit prices. Payment allocations refer to invoices. Commands reject invalid readings, duplicate room/period bills, non-positive payment amounts and over-allocation. Tariffs have one owner in demo settings; changes affect future drafts only. Inputs validate at the form/command boundary. Session data never enters localStorage.

## Module map

| Location | Responsibility |
| --- | --- |
| `src/app/` | Ten routes, root layout, loading/error/not-found, global reference tokens and responsive/print CSS. |
| `src/components/` | Shell, cards, badge, dialogs/tabs, table, charts and invoice preview. |
| `src/features/` | Screen-specific view state, forms and composition. |
| `src/demo/` | Domain types, coherent fixtures, sole data owner, commands and financial selectors. |
| `src/lib/` | Thai money/date formatting and navigation. |
| `tests/` | Calculation and browser behavior, accessibility and screenshots. |
| `docs/` | Review, phases, architecture and verification. |

## Responsive contract

At 1440px use a 235px sidebar, 32px gutters, four KPIs, paired panels and five rooms per floor. At 768px show a menu, two KPIs per row and stack editors. At 390px use 16px gutters, a focus-managed navigation dialog, two room columns and single-column forms/charts. Semantic tables sit inside named horizontal scroll regions. Dialog close returns focus; active links expose aria-current; labels accompany every status color.

## Synthesis decision

Both candidates converged on explicit routes and one session owner. Candidate B is the base: result-returning commands hide validation and ownership from screens. Adapt candidate A's integer-satang validation and distinct payment allocations. The independent judge scored A/B respectively: fidelity 5/5, state consistency 5/5, frontend honesty 5/5, accessibility 4/5, backend replacement 4/4, simplicity/verifiability 4/5. Parent review agrees. Reject route-local ledger copies, fake API endpoints and repository wrappers because they add synchronization or transport concerns before a backend exists.

## Tradeoffs and alternatives

- Session reset provides repeatable evidence and a clear frontend-only boundary.
- Context-wide rerenders are sufficient for fifteen rooms and avoid a query/cache framework.
- SVG charts preserve local operation and provide text equivalents.
- Legible Thai and mobile adaptations take priority over the PDF contact sheet's tiny text.
- Independent page fixtures would hide cross-page inconsistency. A universal CRUD engine would force exceptions for profile tabs and invoice layout. Neither alternative is chosen.

## Future database contract, not implemented

Use UUID keys, UTC timestamps, Asia/Bangkok display and NUMERIC(14,2) currency. Room 1:N Lease and Tenant 1:N Lease; a partial unique index enforces one active lease per room. Lease 1:N Invoice; Invoice 1:N InvoiceLine; Payment N:M Invoice through transactional PaymentAllocation. DepositTransaction is a separate liability ledger. UtilityMeter 1:N MeterReading and effective-dated Tariff snapshot into invoice lines. Expense references ExpenseCategory and optional Attachment. MaintenanceTicket references Room and actor/history. User/Session owns local auth/roles. AuditLog, BackupRun and AppSetting support operations. Financial records use reversal/void semantics.

## Future API contract, not implemented

Version `/api/v1`. JSON money uses decimal strings, UUID identifiers, ISO dates and UTC instants. Zod validates input; sessions, role checks and audits are server-owned. Lists accept period/filter/pagination. Validation returns `{ error: { code, message, fields } }`.

| Endpoint | Contract |
| --- | --- |
| `POST /setup`, `POST /sessions`, `DELETE /sessions/current` | First admin only, then secure local auth; no default password. |
| `GET/POST /rooms`, `/tenants`, `/leases` | Authorized CRUD and exclusive active room occupancy. |
| `POST /meter-readings`, `POST /invoices` | Effective tariffs, unique period issuance, frozen lines. |
| `POST /payments`, `POST /payments/:id/reverse` | Idempotency key, transactional allocations and audited reversals. |
| `GET/POST /expenses`, `/maintenance-tickets` | Audited classification, approvals and transitions. |
| `GET /reports/finance?month=YYYY-MM` | Reconciled revenue/cash/deposit breakdown and CSV. |
| `POST /backups`, `POST /restore/dry-run`, `POST /restore` | Admin, encryption, integrity, confirmation and safety snapshot. |

Phase 2 replaces the demo owner. Pure presentation/calculation tests remain; server integration tests must prove durable transactions and authorization.
