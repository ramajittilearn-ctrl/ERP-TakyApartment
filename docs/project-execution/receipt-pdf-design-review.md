# Receipt PDF independent design review

Status: accepted after correction retest. Recorded 2026-10-23. Reviewer: `receipt_pdf_design_review`.

## Review basis

I read repository AGENTS.md, the installed Pstack Codex adapter, architect, TypeScript best practices and type-system discipline, unslop, the PDF skill, and installed Next route-handler guidance. I reviewed `receipt-pdf-contract.md` against the actual payment contracts, `verifiedReceipt`, `getReceipt`, current receipt view and JSON route, invoice PDF route/renderer and HTTP error/session boundary. This is an independent design review. It does not claim browser, database or PDF execution by this reviewer.

The accepted invoice font correction has independent evidence in `evidence/pdf-agent-uat/after/report.md`, including 48 actual extraction checks and rendered-page inspection. I inspected that report and its source routing change. I have not re-executed those checks in this design review. The new receipt unit requires its own visual evidence.

## RPDF-DR-01: one supported font-routing policy

Priority: material maintainability correction before implementation.

The contract explicitly copies font selection and forbids helper extraction. The current invoice renderer routes graphemes in `runsFor`: Thai script and Baht use the Thai subset, superscript three uses Helvetica, and remaining supported Latin text uses the Latin subset. Baht is Script=Common, which caused the actual missing-glyph defect. Copying this repaired policy into a second renderer leaves two places where a future glyph fix can diverge. The stated concurrent-ownership reason is stale because Main reports that the invoice fix has passed independent acceptance.

Require a narrow shared `src/server/pdf/fonts.ts` module for supported PDF font paths/registration and grapheme-to-font runs. Both invoice and receipt renderers must consume the same routing function for measurement and drawing. Keep invoice and receipt wrapping, pagination, monetary formatting, layout and document metadata local. No generic document framework or new font dependency is needed.

Update the ownership section to permit this mechanical extraction and narrowly affected invoice tests, with Main assigning a single writer. Add acceptance that the existing invoice regression tests and accepted normal/VOID/long/maximum fixtures retain the same visible facts and supported glyphs. New helper coverage must exercise Thai combining graphemes, Latin, Baht and superscript three. Do not infer arbitrary Unicode support from these packaged subsets or from successful extraction alone.

Correction retest will inspect the revised module sketch, ownership and evidence gates. Source implementation remains subject to later independent review.

## Financial and document conclusions

The proposed renderer uses the verified immutable snapshot and separate cancellation. It does not reconstruct historical facts from current tenant, invoice, issuer or property records. `getReceipt` rechecks the current actor through `authorize`, excludes demo/legacy payments and calls `verifiedReceipt`, which parses and hashes the snapshot. The contract correctly preserves original amounts, allocations, receipt number and fingerprint on reversal, and adds cancellation to every page. It makes no claim that an allocation settles an invoice.

Exact decimal-string formatting, explicit Bangkok dates, maximum valid amount checks, split oversized blocks and all 100 allocations are appropriate acceptance requirements. The receipt operator identity is distinct from legal issuer identity. The record title and repeated missing-issuer notice make the export's available facts explicit without inventing legal/tax/bank verification facts. This is receipt record export engineering; legal issuer release remains a separate work item.

## Authorization and transport conclusions

The route sketch authorizes before record access and delegates to `getReceipt`. Each request repeats authorization, so a previously rendered link grants no ongoing access after revocation. Promised params and explicit no-store match installed Next guidance. Strict query rejection must inspect all URLSearchParams entries, including duplicates, before schema conversion; `Object.fromEntries` alone would lose duplicates. The proposed authenticated-session tests cover this boundary and sanitized JSON errors.

Inline by default and attachment for exactly `download=1` support real browser printing/downloading without command mutations or Blob/popup lifecycle state. Safe bounded filenames, byte length, PDF type, nosniff and private no-store are specified. Reads create no number, command, receipt, audit mutation or persisted PDF. The normal receipt view and uncertain-command recovery remain intact. A browser download does not prove physical printing, human UAT or deployment.

No other material design finding was identified. The corrected architecture is accepted for implementation. Actual route/session, immutable-facts, cancellation, standalone font packaging, rendering and browser checks remain implementation gates.

## Correction retest

I reread the corrected contract after the design owner reported RPDF-DR-01 resolved. It now declares one `src/server/pdf/fonts.ts` with `registerPdfFonts` and `pdfFontRuns`; the invoice edit is restricted to mechanical imports/registration/run calls. Receipt and invoice layout, wrapping and money/date formatting remain local. Ownership expressly permits the helper and narrow invoice extraction with one writer. Both callers must use the accepted Thai/Baht, Latin and Helvetica superscript routing.

Acceptance now requires the five invoice PDF tests, recreated accepted glyph artifacts with extracted Baht/cubic-metre values and rendered-page inspection, and focused shared-helper grapheme/merging checks. Raw query duplicates must be inspected before object conversion. These corrections address RPDF-DR-01 without introducing a document framework or new financial policy. RPDF-DR-01 is closed at the design level. No open material design findings remain. Actual implementation and executed acceptance evidence remain subject to independent review.
