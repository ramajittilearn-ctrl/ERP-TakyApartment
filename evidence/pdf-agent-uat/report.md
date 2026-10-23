# Independent invoice PDF Agent UAT

Result: **FAILED visual acceptance; numerical snapshot checks passed.** No app code, database, schema, branch or environment was changed by this review. This is agent verification of synthetic artifacts, not human acceptance or Go-Live approval.

## Baseline and method

Reviewed actual `src/server/invoices/pdf.ts` SHA256 `e12df89951c6c6e99aacb05aee340abebc22f40da869b44c1eba388ca898cf03` and existing PDF tests SHA256 `b4d547b677ba265dad64edfc2c2fe6f3186b8413fa3bd8983086e9aab10474f2` in `/private/tmp/taky-development`. Followed installed Pstack adapter/prove-it-works and PDF skill. Read AGENTS.md. Renderer is pure PDFKit; no Next application code was authored.

Existing command `node_modules/.bin/vitest run tests/invoice-pdf.test.ts` passed 4/4 (552ms; existing-tests.log). These checks did not detect the actual visible defects.

`generate.ts` directly invokes the production `renderInvoicePdf` with four committed-to-evidence synthetic fixtures. Successful command: `node --import tsx evidence/pdf-agent-uat/generate.ts`. Initial tsx CLI command was blocked by sandbox IPC EPERM; an escalation remained pending until interrupted. The Node import loader subsequently completed without escalation. No packages were installed. PDF artifact-start marker ran successfully once before generation.

Actual rendering commands: `pdftoppm -scale-to 1200 -png evidence/pdf-agent-uat/{issued,void,long,precision}.pdf evidence/pdf-agent-uat/{issued,void,long,precision}` (run separately for each name). All four resulting PNGs were inspected with view_image. Bundled Python pypdf6.10.0 extracted actual PDF text; rerunnable `verify.py` produced checks.json and verification.log. `verify.py` exits1 deliberately while defects remain: 27/39 checks passed, 12 failed.

## Findings returned to orchestration

**PDF-UAT-01, material visual defect:** Every baht currency glyph is an empty square, including total, all three line amounts and both rates. In issued-1.png the total visibly reads square9,439.75 rather than ฿9,439.75. Extracted text contains U+0000 for those glyphs. `runsFor` chooses Thai font only for Script=Thai, while ฿ is Script=Common; it therefore routes the baht sign to a Latin font that lacks this glyph. Route by actual font coverage or explicitly support the baht symbol. Preserve money strings and arithmetic.

**PDF-UAT-02, visible water-unit defect:** `3.500 m³` renders as `3.500 m` followed by an empty square. Actual invoice mapping in service.ts supplies m³, so this is not only a synthetic fixture issue. pypdf extracts U+0000 for superscript3. Use a font with coverage, or an explicitly chosen text representation consistent with the approved unit. Do not silently reinterpret water units.

Both defects recur in issued, VOID, long-name and precision artifacts. These are current production renderer outputs, not inferred failures. No fixes were made by reviewer. Main was notified immediately after visual inspection.

**Stress observation, not a valid-domain blocker:** precision.pdf preserves 9007199254740993.01 and total9007199254740993.14 exactly without JavaScript Number loss, but the line and total cross the right content margin. These are intentionally beyond Decimal(14,2) storage capacity; do not present this as a reachable persisted invoice defect without a valid-domain reproduction.

## What passed and practical limits

- All four outputs are actual one-page A4 PDFs595.28×841.89.
- Issued/VOID/long snapshots preserve rent8,500.00, water63.00, electricity876.75, total9,439.75 exactly. Independent decimal checks:3.500×18.00=63.00;125.250×7.00=876.75;8500+63+876.75=9439.75.
- Thai heading, tenant/property labels, due date29Oct2026 and billing period1–31Oct2026 remain readable in inspected images.
- VOID status, red cancellation date23Oct2026, Thai reason and watermark are visible; original amounts remain unchanged.
- Existing long-name/address stress fixture wraps without overlapping its invoice box, tenant/table/total; Revision1 remains visible. All four examples remain one page. **Multi-page pagination/repeated headers were not verified.** No requirement to assert a page-number footer was discovered; current renderer has only Revision1.
- No actual issuer/legal identity was invented: all content is fictional and marked sample. The renderer was tested directly; these artifacts do not prove authenticated endpoint delivery, DB snapshot mapping, mobile print or an actual owner's physical printer.

## Retest required

Implementation owner must correct PDF-UAT-01/02, then this independent reviewer must regenerate the same artifacts, rerun actual PDF extraction assertions and visually inspect all images. Existing4tests alone cannot close these findings.
