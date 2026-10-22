# F-10 Invoice PDF implementation report

**Baseline:** `78f6269ff1597cfbea8888a2bba9ffc9a353c336`

**Branch:** `codex/f10-invoice-pdf`

**Owner disposition:** Option A, supplied in the task prompt (2026-10-22)

**Scope:** Stage 3C invoice PDFs only. No Payments & Receipts or Stage 3D implementation.

## Result

Implemented an authenticated PDF download route for managed ISSUED and VOID invoices. The route calls the existing invoice-read authorization and UUID validation, builds the document from the persisted invoice snapshot and immutable freeze labels, and returns a private, non-cacheable PDF attachment. DRAFT and legacy unmanaged invoices return `PDF_UNAVAILABLE`; download does not write invoice state, recompute charges, or allocate an invoice number. VOID documents retain their original financial amounts and show VOID status, date, reason when present, and a VOID mark.

Financial line amounts and total come directly from `snapshot.lines[].displayAmount` and `snapshot.totals.finalTotal`. Rent quantity and rate and utility quantities and selected rates come from the same persisted snapshot. Utility rates retain their persisted precision; amounts use two decimal places and grouping. Dates use a deterministic Gregorian Thai-language format with Latin digits. Water is displayed in m³ and electricity in kWh.

## Historical display fields

The existing immutable freeze labels held property, room, and tenant names but omitted the property address and lease reference. Freeze creation now stores `Property.address` and `Lease.number` in those labels. This changes no table shape: the labels are JSON, so no migration is needed. New optional schema keys preserve compatibility with old snapshots. PDF download never joins mutable property, tenant, lease, room, or rate records. Older invoices lacking the new labels show an em dash for the lease reference and omit the unavailable address.

The approved schema has no property phone/contact field, legal entity/tax registration fields, or configurable invoice footer; these were not invented. VAT, taxes, discounts, and optional fees were not added. The existing invoice snapshot and billing rules are unchanged.

## Rendering and dependencies

The implementation uses PDFKit with the existing `@fontsource/noto-sans-thai` package, which is OFL-licensed. Thai and Latin WOFF faces are embedded with Unicode `ToUnicode` maps. The package’s WOFF2 faces fail under the installed PDFKit/fontkit combination during font subsetting, so the renderer uses the package’s WOFF files. The font is loaded from the installed package at runtime; no font binary is copied into the repository. PDFKit documents embedded font registration and Unicode text handling in its [text documentation](https://pdfkit.org/docs/text.html); [fontkit](https://github.com/foliojs/fontkit) supplies font shaping and subsetting.

The layout is A4 with wrapped property/name/address and line details. `docs/samples/Invoice_INV-202610-0042.pdf` is generated from fictional data. Automated checks confirmed PDF 1.3 structure, A4 MediaBox, embedded fonts, Unicode maps, Thai code points, long mixed Thai/English wrapping, and VOID output. A visual screenshot inspection was not completed: the available browser policy blocked opening local `file:` URLs. The generated PDF was identified as a one-page PDF with the `file` utility; no visual verification is claimed.

## Security and lifecycle

- Existing ADMIN/STAFF invoice-read authorization is reused; there is no tenant-role surface in the current application model.
- Unauthenticated HTTP access is checked by the isolated browser test. Invalid UUID and fake unauthorized role are checked at the service boundary.
- Response headers set `application/pdf`, attachment disposition using a sanitized invoice number, `private, no-store`, content length, and `nosniff`.
- The client shows an accessible Thai download action, disables it for DRAFT/loading/ongoing operations, retains VOID availability, and surfaces fetch errors.
- No invoice writes or charge calculations occur in the PDF request path.

## Schema and scope review

No migration or database schema change was required. The only added persisted facts are JSON freeze labels written when a new billing freeze is created. Existing immutable freeze records are not updated. Financial calculations, issue/void/reissue rules, and payment features were not changed.

## Participating agents

The Main Engineering Agent coordinated the implementation and integration. Actual specialists used: `f10_architecture` (architecture/data and runtime discovery), `f10_design_native_pdf` (native renderer design), `f10_design_html_pdf` (browser-renderer alternative), `f10_design_judge` (independent design comparison), and `f10_pdf_renderer` (PDFKit renderer, sample generator, and focused tests). The judge recommended the native Node approach contingent on proving Thai font output; the WOFF path passed programmatic checks. No specialist modified the active Owner UAT environment.

## Closure recommendation

Recommend **implementation complete; F-10 remains OPEN pending Owner UAT/visual acceptance**. Automated and programmatic gates pass, but the requested visual print inspection could not be performed in this environment. Do not mark F-10 CLOSED until the Owner checks the sample/actual issued invoice in the guide and accepts Thai glyph rendering, wrapping, and print layout. The acceptance gate does not expand into Stage 3D.
