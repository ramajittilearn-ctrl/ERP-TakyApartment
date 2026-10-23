# Independent PDF correction retest

**Accepted for PDF-UAT-01 and PDF-UAT-02.** The original findings are closed by actual independent regeneration, extraction and visual inspection. This acceptance covers this renderer/font correction, not whole-project Go-Live readiness.

Original before artifacts remain untouched in parent directory. After artifacts are in this directory, separate from the failed originals. Source renderer SHA256: `3a78e95915ce0a26bd77f2bd94bd100dfa54bba8b6cd664b3c70a98315f8a74c`; tests SHA256: `91913fac5adf302bfcf7c3b4717b0d36d5bd913792f222fcd20dc48b90e0d2ab`.

Independent source diff inspection confirmed only font-run selection and shared measurement/writing font usage changed. Baht now routes to embedded Thai font; superscript3 uses built-in Helvetica; monetary formatting, unit text, snapshot values and formulas are unchanged. The regression test checks actual encoding for both glyphs. Reviewer did not edit app source or tests.

Executed `node --import tsx evidence/pdf-agent-uat/after/generate.ts` using the production renderer. Original four fixtures are retained; fifth fixture `validmax` uses rent/total999999999999.99, zero water/electricity amounts and actual m³/kWh units. This is the Decimal(14,2) maximum, distinct from intentionally out-of-domain precision stress fixture9007199254740993.14.

Rendered all five PDFs with bundled Poppler, inspected all five PNGs with view_image, extracted actual content with bundled Python/pypdf. `verify.py` exited0: **48/48 checks passed**, compared with before27/39. All missing glyph checks now report zero U+0000; both ฿ and m³ extract correctly and are visibly correct. Normal total฿9,439.75 and every line amount remain unchanged; VOID watermark/reason/date and original total remain readable. Thai headings and long tenant/address wrapping remain readable with Revision1 and no overlap. The valid schema maximum fits within the row amount column and total content margin in validmax-1.png. The out-of-domain stress total still exceeds the right content margin and is excluded from valid-domain acceptance.

Independently executed `node_modules/.bin/vitest run tests/invoice-pdf.test.ts`: **5/5 passed**,510ms (existing-tests.log).

## Rendering environment and repeatability

The first attempt to render the new built-in Helvetica glyph hit the bundled Poppler fontconfig's nonexistent default configuration/cache paths and repeated errors. It was interrupted promptly; no application change was needed. `fonts.conf` explicitly points to installed `/System/Library/Fonts` with a cache owned by this evidence directory. All five subsequent rendering commands completed successfully and render.log is empty. Reproduce each name with:

`FONTCONFIG_FILE=/private/tmp/taky-development/evidence/pdf-agent-uat/after/fonts.conf pdftoppm -scale-to 1200 -png evidence/pdf-agent-uat/after/issued.pdf evidence/pdf-agent-uat/after/issued`

Replace issued with void, long, precision or validmax. Python verification command:

`/Users/ramajittipasutanavin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 evidence/pdf-agent-uat/after/verify.py`

## Limits

All five outputs remain single-page A4. Multi-page repeated headers/pagination, physical printer output, actual issuer/legal identity and authenticated DB-backed PDF endpoint were not verified by this pure renderer retest. Built-in Helvetica is a standard PDF font; actual PDF viewers may substitute its implementation. The inspected supported Poppler rendering produced a correct superscript3 baseline. No arbitrary Unicode font-coverage guarantee is made.
