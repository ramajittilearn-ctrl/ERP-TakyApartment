# Phase 1 verification

Verified on 16 October 2026, Asia/Bangkok. Tests use fictional records with a fixed demonstration date of 15 October 2026.

## Results

| Check | Evidence |
| --- | --- |
| Production build | `npm run build` passes. All ten application routes are statically prerendered. No application backend is required. |
| Strict TypeScript | `npm run typecheck` passes. |
| Unit behavior | `npm test`: 21 tests pass. Exact billing arithmetic, invalid readings/money, partial payments, duplicate references, over-allocation, frozen invoice rates, deposits, OPEX/CAPEX and contracted rent. |
| Browser acceptance | `npm run test:e2e`: 40 tests pass, zero failures. Production `out/` served on loopback, installed Google Chrome, Playwright. |
| Accessibility | Axe WCAG 2 A/AA and 2.1 A/AA tags run on all ten pages at all three widths, plus the room/payment dialogs. Zero violations in the final run. Keyboard dialog close/focus return and mobile focus containment pass. |
| Responsive layout | All ten pages at 1440 x 1000, 768 x 1000 and 390 x 844 pass document overflow checks. Tables scroll within named regions. |
| Local assets | Every responsive page capture checks for external requests and runtime page errors; neither occurs. Thai fonts, icons and charts are local. |
| Print | Invoice and receipt layouts isolate the document. Receipt checks confirm a white background, static positioning and no dialog shadow. Two print screenshots are retained. |
| Dependency audit | Patched dependencies install with zero known npm vulnerabilities. Production dependency audit also reports zero. |
| Formatting | `npm run format:check` passes. |

Browser workflows prove room filtering and empty states; tenant search, profile tabs and editing; a new invoice followed by partial payment and reconciled reporting; duplicate/overpayment validation; expense creation, classification and downloaded CSV; maintenance creation/status update; changed tariffs affecting new drafts while old invoices retain their values; and mobile navigation.

This is a Chrome verification run. It is not a claim of Safari/Firefox certification, full manual assistive-technology coverage or backend accounting/security acceptance.

## Screenshot evidence

[Open the complete gallery](screenshots/index.html). It contains 34 full-page screenshots:

- Ten routes at each of 1440, 768 and 390px.
- Desktop draft billing editor and payment dialog.
- Invoice and receipt print layouts.

Contact sheets provide an overview: [desktop](screenshots/contact-sheet-1440.png), [tablet](screenshots/contact-sheet-768.png), [mobile](screenshots/contact-sheet-390.png). The original PDF was rendered in full and reviewed before implementation. Final contact sheets and individual dashboard, rooms, billing draft and print documents were visually inspected for hierarchy, spacing, Thai text, chart labels, status colors and clipping.

Regenerate screenshots after a production build with `npm run test:screenshots`, then `npm run screenshots:gallery`. The HTML test report and failure traces live in ignored local directories. This document records the final successful run rather than intermediate failures.

## Reference comparison and intentional adaptations

The PDF's navy sidebar, bright blue active navigation, pale-blue workspace, white cards, tinted KPIs, grouped floors, profile tabs, split billing/invoice layout, finance charts, compact tables and settings tabs remain recognizable. The HTML prototype supplied supporting dimensions, tokens and the separate leases destination.

- Use fictional October 2026 fixtures rather than the PDF's older sample names and dates.
- Use twelve occupied rooms, two vacant rooms and one maintenance room, preserving the HTML's twelve active tenants while adding its missing maintenance state.
- Derive all money from one fixture ledger. Dashboard OPEX is 6,700 baht, matching the report, instead of retaining conflicting source totals. Billed revenue is 52,500 baht, confirmed receipts 48,000 baht, outstanding 4,500 baht, CAPEX 18,000 baht and net cash flow 23,300 baht.
- Slightly darken secondary text and active tabs to meet contrast checks. Preserve the original palette and hierarchy.
- Add a searchable tenant list beside the PDF profile layout and give leases its own screen in the same design language.
- October invoices are already issued. Their detail view explains immutability; selecting November opens the full editable meter form and draft invoice preview shown in the extra billing screenshot.
- Mobile uses an accessible menu and stacks wide layouts. Dense tables retain their columns inside scrolling regions.
- Clearly label demo mode and disable backend-only backup/restore controls. Do not show a successful backup, OAuth connection, authentication or bank verification.

No exact pixel-equivalence claim is made. The approved PDF is one contact sheet of nine panels; readable typography and responsive layouts require adaptation to full-size screens.

## Source preservation and boundaries

The implementation brief and PDF are byte-identical to the fetched upstream blobs. The HTML prototype's content and logic are retained, with only a final newline normalized during local retrieval. No reference was replaced by the new application.

No API route handlers, server actions, database, Prisma migration, authentication, bank integration, cloud deployment, encrypted backup or restore implementation was added. Demo changes live only in tab memory. No real tenant data, credentials or default passwords are included. No GitHub commits or pull requests were created.

The original complete P0 definition of done remains a later milestone. Phase 2 begins with the local database/authentication foundation in the phased plan.
