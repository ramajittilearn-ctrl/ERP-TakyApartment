# Receipt PDF engineering contract

Status: proposed for independent review. Recorded 2026-10-23. This document defines the next bounded Stage 3D unit. It does not claim implementation, rendering verification, legal document approval or deployment.

## Grounding and scope

The accepted payment transaction already creates one immutable `receipt.v1` snapshot and its SHA-256 fingerprint. Reversal retains that snapshot and appends a linked cancellation. `getReceipt` rechecks the authenticated actor against the current user record, excludes demo and legacy-unmapped payments, parses the snapshot, and verifies its canonical fingerprint. Enabled STAFF and ADMIN can read. This unit must call that service rather than reading Prisma directly or reconstructing a receipt from current tenant, property, invoice or payment rows.

The current JSON route is `src/app/api/v1/receipts/[id]/route.ts`. `src/features/payments/receipt.tsx` displays the verified record and separate cancellation. Its current notice says printing awaits legal issuer details. The invoice PDF route demonstrates authenticated PDF response headers. Its renderer uses PDFKit and packaged Thai/Latin Noto Sans Thai subsets. Main accepted the invoice glyph fix in `020cb14`. The reviewed Baht and superscript-three routing must have one shared implementation before receipt rendering is added.

Apply the installed Pstack Codex adapter, architect, TypeScript/type-system discipline and unslop guidance. Read the installed Next route-handler documentation before code. Next's current docs specify promised route params and uncached-by-default GET handlers; still send explicit private no-store headers. The PDF skill requires rendered-page inspection in addition to text checks. This architecture task only writes Markdown and creates no PDF. The parent explicitly forbids further delegation, so alternatives below are compared in this document rather than spawning arena candidates. Independent design review remains Main's responsibility.

The Owner delegated UAT execution to agents and asked for reports, as recorded in `policy-authorization.md`. Report actual agent acceptance; do not substitute a claim of human execution. Missing issuer facts do not block development or synthetic acceptance of the record export.

## Facts available for export

| Source | Available fact and permitted presentation |
|---|---|
| `snapshot.number`, `reference`, `paymentId` | Original receipt number and internal payment reference/identity. Never allocate a new number on read. |
| `snapshot.amount`, `method`, `receivedAt` | Exact recorded amount, CASH or BANK_TRANSFER, and recorded receipt-of-funds time. A bank reference does not establish independent bank verification. |
| `snapshot.externalReference` | Optional recorded external reference. Label it as a reference, never verified settlement. |
| `snapshot.issuedAt`, `issuedBy` | Original issuance timestamp and the issuing application user's frozen ID/display name. This is an operator identity, not a legal entity. |
| Each frozen invoice entry | Invoice number/ID, frozen tenant/room/property labels, optional property address and lease number, frozen lease/tenant IDs, original invoice final total and this receipt's allocated amount. Keep these per invoice even when labels differ. |
| `ReceiptDto.fingerprint` | Integrity fingerprint of the original snapshot. It is not a signature or legal certification. |
| `ReceiptDto.cancellation` | Separately appended cancellation reason, actor ID, time and reversal ID. No frozen actor display name is available here. |

`receipt.v1` has no legal issuer entity, verified issuer address, tax identifier, tax registration status, bank account identity, authorized signature, settlement-verification result, invoice line-item breakdown, prior paid amount or current remaining balance. The optional frozen property address is a property label; it is not proof of legal issuer identity. Do not pull missing facts from live Settings, issuer user name, demo fixtures or environment variables. Do not infer rent/tax/VAT/deposit/refund components from an allocated total. Do not label an invoice as settled merely because one allocation appears on a receipt.

Render a visible, fixed notice on every exported record: `สำเนาข้อมูลใบเสร็จจากระบบ ข้อมูลผู้ออกเอกสารตามกฎหมายยังไม่ได้กำหนด`. Use the title `ข้อมูลใบเสร็จรับเงิน / RECEIPT RECORD`. This delivers print/download engineering while explicitly identifying the current fact boundary. Operational legal-receipt release still needs actual issuer facts and reviewed wording. A later legally configured document needs an explicit versioned immutable issuer snapshot design; changing ambient configuration must never silently restyle historical records as if those facts were present at issuance. No schema or numbering changes belong to this unit.

## Compared approaches and decision

| Approach | Concrete benefit | Cost or conflict |
|---|---|---|
| New authenticated HTML print page with print CSS | Native browser print and Save as PDF, little binary generation code | Adds a page/template and CSS plus separate layout testing; no stable direct PDF download; another copy of receipt layout can drift from the existing view. |
| Receipt-specific PDFKit renderer and read route | Reuses installed dependencies and authenticated binary-response convention; one A4 artifact for view, print and download; no schema changes | Needs explicit wrapping, pagination, glyph and rendered-page tests. |
| Extract a generic invoice/receipt document framework | Centralizes fonts, wrapping and layouts for both document kinds | Broadens regression scope before the receipt layout is proven. A narrow font helper gives shared glyph correctness without a framework. |

Choose the receipt-specific PDFKit renderer. Keep its API small and receive the existing verified `ReceiptDto`. Do not add a second receipt snapshot shape, presentation DTO, new service forwarding layer, generic document engine, browser PDF library or new font dependency. Extract only packaged font registration and grapheme font-run selection into `src/server/pdf/fonts.ts`. Both invoice and receipt renderers use that one helper. Preserve the accepted routing exactly: Thai graphemes and Baht use Thai, superscript three uses Helvetica, other graphemes use Latin, and adjacent same-font runs combine. This avoids a second copy of the policy that caused the actual glyph defect. Keep measuring, writing, wrapping, pagination and layout local to each renderer. The invoice edit is a mechanical import/call replacement with no layout, financial-value or date-format changes. If a receipt block exceeds a page, receipt pagination must split it rather than assuming the existing invoice layout algorithm is sufficient.

## Caller and module sketch

```ts
// The HTTP boundary authorizes and verifies the stored snapshot first.
const receipt = await getReceipt(await requireActor(), parsedReceiptId);
const bytes = await renderReceiptPdf(receipt);
// Return PDF bytes with inline or attachment disposition.

// src/server/payments/pdf.ts
import type { ReceiptDto } from "./contracts";
export function receiptPdfFilename(number: string): string;
export function renderReceiptPdf(receipt: ReceiptDto): Promise<Uint8Array>;

// src/server/pdf/fonts.ts
import type PDFDocument from "pdfkit";
export function registerPdfFonts(doc: PDFDocument): void;
export function pdfFontRuns(text: string): Array<{
  text: string;
  font: "Thai" | "Latin" | "Helvetica";
}>;
```

The renderer is deterministic in displayed facts and independent of DB, session, ambient clock and legal issuer settings. PDFKit may emit nonsemantic creation metadata or document IDs; do not promise byte identity between renders. Use the frozen issuance time for any explicit PDF creation timestamp. Derive all original text from `receipt.snapshot`. Use receipt cancellation only for the appended status. No `Number`, `parseFloat` or floating arithmetic for money; group canonical decimal digit strings and retain exactly two digits. Sum allocation amounts with exact minor-unit BigInt only if needed for a displayed allocation total. Do not recompute invoice totals. Show Bangkok timestamps with an explicit timezone and Gregorian year, including the day when UTC crosses midnight.

No application writes are performed. A read does not create an audit mutation, change receipt state, consume a counter or persist PDF bytes. Read-side snapshot/fingerprint failures propagate as failures; never fall back to current data or a blank document.

## Endpoint and UI behavior

Add `GET /api/v1/receipts/[id]/pdf/` in `src/app/api/v1/receipts/[id]/pdf/route.ts` with `runtime = "nodejs"`. The ID is the receipt ID, not the payment ID. Await promised params and validate UUID. Default to `Content-Disposition: inline`; the sole optional query `download=1` selects `attachment`. Reject unknown, duplicate or invalid query fields with 422. Inspect raw URLSearchParams entries for duplicate keys before any object conversion can discard them. Authenticate before loading any protected record. `getReceipt` remains the sole database read/authorization/integrity boundary. Use the existing `handle` wrapper, so 401, 403, 404 and snapshot-integrity 409 remain sanitized JSON errors with no-store. Unexpected renderer failure is generic 500, with no partial PDF body or financial payload log.

Success headers mirror the invoice route: `Content-Type: application/pdf`, `Cache-Control: private, no-store, max-age=0`, `X-Content-Type-Options: nosniff`, correct byte Content-Length, and a header-safe filename `Receipt_<sanitized frozen number>.pdf`. Strip unsafe filename characters and bound its length even though current receipt numbers are constrained. No CDN, public URL, external renderer, service-worker cache, ETag or persistent client storage. A GET is read-only and does not require a forged browser Origin.

In the existing ReceiptView add two accessible same-origin links: `เปิด PDF / พิมพ์` opens the inline URL in a new tab with `rel="noopener noreferrer"`; `ดาวน์โหลด PDF` uses `?download=1`. Explain that print/Save as PDF uses the browser PDF viewer. Native new-tab links avoid a blocked asynchronous popup, iframe/CSP exceptions and Blob lifecycle state. A rejected server request shows its actual error response in the new tab rather than a success notice in Payments. The download action may also use a new tab so an error cannot replace the financial work screen. Do not assert that a printer job completed or programmatically access the native PDF viewer. Retain the existing screen record and cancellation metadata. Replace the blanket printing-unavailable notice with the explicit missing-issuer notice above, since engineering export is now available.

Both roles can export the same record they are authorized to read. Revocation between opening a receipt and clicking its PDF link must reject the new request. Exporting or printing creates no new financial command, idempotency key or payment journal entry. It must not interfere with the existing uncertain-command recovery panel.

## A4 layout and cancellation

Use embedded Thai and Latin fonts with tested Baht support. Document body uses readable text, restrained table borders and a visible record-only notice. Metadata lists receipt number, payment reference, original issuing operator and original issue/received times. The allocation table shows every invoice's frozen number, tenant/room/property/lease labels, invoice total and allocated amount. Optional address/reference is omitted or clearly marked unavailable when absent; never invent a value. The received total and allocated amounts remain separate from invoice final totals.

Keep original facts identical after reversal. Add a prominent `ยกเลิก / CANCELLED` banner to every page of a cancelled receipt, plus a separate section for cancellation reason, time, actor ID and reversal identity. Do not strike out, zero, hide, subtract or replace the original amount/allocations/number. No new receipt is issued. Cancellation changes the presentation status and appends facts; it does not alter the original snapshot fingerprint. Display the full original fingerprint in a wrapped integrity section if included. No live outstanding balance appears in this historical artifact.

Wrap labels, references and cancellation reasons by grapheme/word boundaries; break long unspaced strings safely. A row or cancellation reason can exceed one page, so split long blocks across pages rather than merely moving an oversized block to a fresh page. Repeat table headings on continuation pages, preserve all rows in stored order, reserve footer space and include page numbers. Do not silently truncate schema-valid labels or the 100-invoice maximum. Do not shrink an entire document to unreadable text. Financial values must not clip at the supported maximum `999999999999.99`.

## Ownership and acceptance

Implementation owner may write the new payment PDF renderer and PDF route, `src/features/payments/receipt.tsx`, focused PDF/route tests and assigned browser evidence/spec. Main also authorizes the bounded `src/server/pdf/fonts.ts` extraction, mechanical invoice renderer imports/registration/run calls, and related invoice/font tests now that `020cb14` is accepted. No other invoice renderer behavior changes belong to this unit. Domain services, contracts, migrations, invoice financial guards, auth/http, shared shell and deployment remain read-only. Main serializes shared browser-spec edits with the active payment UI owner. Independent review must verify the extraction preserves the accepted glyph rules and original invoice output facts.

An independent reviewer must inspect implementation and verify corrections. Required executed evidence before integration:

1. Renderer tests inspect actual PDF output and extracted text for exact original and allocation totals, frozen labels, bank reference, both times and fingerprint. Confirm generated A4 pages, embedded fonts and safe filenames. Include Thai combining marks, Latin text, Baht and mixed-script labels. Check exact maximum amounts and `0.10`/`0.20`; a PDF signature or glyph-map existence alone does not prove correct visible values.
2. Render pages to PNG and inspect every page of representative normal, cancelled, long-name/address/reference/reason and 100-allocation fixtures. Require no missing glyphs, clipping, overlapping columns, unreadable font sizes or omitted totals/rows. Preserve the PDFs, PNGs and inspection report. Fixture identity must visibly say synthetic.
3. Real authenticated route tests on an isolated synthetic database exercise enabled STAFF and ADMIN, no session, disabled actor, demotion/stale role, missing ID, malformed UUID/query and corrupt snapshot. Confirm success headers, safe disposition/filename and JSON error status/no-store. Do not claim mocked `requireActor` proves real session or disabled-user behavior. Header CR/LF/path injection cannot enter Content-Disposition.
4. Confirm a real payment with multiple invoices and partial allocations. Fetch the PDF, then rename live tenant/property/issuer user records and fetch again. Assert the original text facts and fingerprint remain unchanged. Fully reverse payment, refetch the same receipt ID, and verify original values plus cancellation. Observe database count/number/snapshot unchanged by all reads. Compare semantic text, not random binary metadata.
5. In a built app, STAFF and ADMIN reach PDF links by keyboard from the persisted receipt, open a real inline PDF response and download the real attachment. Verify downloaded bytes/content and a usable narrow-screen action layout. Exercise revoked session and reversed receipt. Browser print invocation can be tested manually or by a print event where supported; do not claim an actual printer or human acceptance from headless download checks. A PDF text-extraction check complements, rather than replaces, rendered-page inspection.
6. Run focused tests, typecheck, lint/format, full unit regression and supported production build. Rerun affected payment route/browser checks and all five existing invoice PDF tests. Recreate and inspect the accepted invoice glyph artifact after the mechanical extraction, including exact Baht and cubic-metre text/glyph checks and rendered-page review. Add a focused shared-helper check for Thai combining graphemes, Baht, superscript three and adjacent-run merging, so either caller cannot silently acquire a divergent policy. Record exact revision, commands, counts and any tool limitations in the agent UAT report. Font availability must be verified in the actual standalone/container execution path; Docker currently copies node_modules, but a source-tree test does not prove deployed packaging.

This closes receipt record export engineering when verified. It does not close missing legal issuer configuration, private evidence upload policy, post-VOID exceptions/refunds, operational migration/recovery or whole-project Go-Live readiness.
