# Receipt PDF independent code and visual review

Status: code and preserved synthetic visual artifacts accepted. Recorded 2026-10-24. Reviewer: `receipt_pdf_design_review`. Real PostgreSQL/session export and built-app browser gates remain Main's responsibility and are not accepted by this report.

## Baseline and method

Reviewed `/private/tmp/taky-receipt-pdf`, branch `codex/receipt-pdf`, base `c622374` with uncommitted implementation. All nine source/test SHA-256 values match `source-sha256.txt`. I read AGENTS.md, the accepted contract/design review, handoff, renderer, shared font helper, route, receipt view changes, mechanical invoice diff, fixtures, unit/boundary tests and authored PostgreSQL driver. The installed Pstack adapter, architect, TypeScript/type-system, unslop, PDF and installed Next route-handler guidance were read during this review assignment's design phase and apply here. No additional subagents were spawned.

Only this report was written by the reviewer. No app, test, database, Docker, deployment or Git mutations were performed. Focused tests were executed directly and reported in tool output, without modifying implementation evidence logs.

## Executed independent checks

`node_modules/.bin/vitest run tests/receipt-pdf.test.ts tests/receipt-pdf-route.test.ts tests/invoice-pdf.test.ts` exited 0. Three files and 26 tests passed in 4.59 seconds. These include actual renderer output, shared Thai/Baht/superscript routing, safe filename behavior and boundary response behavior. Boundary authentication and receipt lookup are mocked in these unit tests and do not prove persisted sessions.

A separate read-only Python/pypdf check loaded every preserved receipt PDF and its fixture. All five fixtures passed exact invoice-identifier occurrence checks, page numbering, record notice on every page, cancellation banner presence matching the DTO on every page and absence of NUL glyphs. Page counts were normal 1, cancelled 1, long 3, hundred 19 and maximum 1. The first check incorrectly assumed extraction inserts a newline immediately after each invoice number and failed for normal. I corrected the checker to match the exact identifier with a negative numeric suffix boundary, then all five passed. No source or PDF change was involved. This checker correction is not an application defect.

I inspected every one of the 25 receipt page PNGs with `view_image`: normal-1, cancelled-1, maximum-1, long-1 through long-3, and hundred-01 through hundred-19. I also inspected invoice-issued-1, invoice-void-1, invoice-long-1 and invoice-validmax-1. Thai labels/combining characters, Baht and superscript three are visible; supported maximum amounts fit their columns; 0.10 and 0.20 remain distinct; totals remain unchanged after cancellation. No clipped amounts, overlapping columns, missing glyphs, lost oversized-text end markers or footer collisions were observed. All 100 allocations continue in stored order with repeated table headings and visible page counts. Long rows legitimately continue across pages under the accepted split-block design.

The implementer's 289-unit/typecheck/lint/build, 74 semantic PDF checks and 48 invoice glyph checks are recorded in its preserved logs. I inspected those claims and relevant scripts but did not rerun the complete build/full suite or write over the original verification artifacts. My independent executed results are the focused 26 tests and the additional read-only artifact checks above.

## Code conclusions

The renderer consumes the existing verified ReceiptDto, uses original snapshot facts and separately appends cancellation. It never reads a database or ambient issuer settings. Decimal strings are formatted without Number/parseFloat or financial arithmetic. Original amount/allocations/number/fingerprint remain unchanged. Bangkok timestamps explicitly use Gregorian calendar and the stored issuance date supplies PDF CreationDate. Read operations allocate no financial number, command or persisted PDF.

The new shared helper preserves the accepted font-routing rules exactly. Invoice changes remove the duplicated paths/runs function and replace registration/run calls mechanically. Invoice layout, monetary/date formatting and financial source remain unchanged. Both renderers measure and draw with the shared runs policy.

The PDF route resolves an authenticated actor before loading the receipt and calls getReceipt rather than Prisma. UUID validation, rejection of unknown/duplicate/invalid query fields before lookup, explicit inline/attachment selection, safe bounded filename, nosniff, byte length and private no-store are correct. Existing handle sanitizes failures and returns JSON without partially streamed financial output. UI links use the receipt ID, same origin and noopener/noreferrer. They add no financial command and leave uncertain-payment recovery ownership unchanged.

Record-only title, repeated missing-legal-issuer notice and operator wording preserve the available fact boundary. The export does not claim a digital signature, verified bank settlement, tax invoice, current outstanding balance or complete invoice settlement.

## Findings and integration conditions

No material source or visual defect was identified in the reviewed frozen implementation.

Evidence preservation condition: the working tree shows five modified historical PDFs under `evidence/pdf-agent-uat/after/`. The implementer regenerated them while reusing the older invoice generator. Main should preserve the previously accepted historical files unchanged and integrate only the new receipt evidence and invoice regression PNG/log artifacts. Exclude those five historical PDF modifications. Fresh rerun evidence must not replace its accepted predecessor. This was relayed to Main and does not require an application change.

Acceptance is limited to code and the inspected synthetic artifacts. Before integration, Main must execute and assess real PostgreSQL/session export evidence, compare original/live-renamed/cancelled persisted output, prove no read-side count/counter mutations, and exercise built-app STAFF/ADMIN inline/download, revoked sessions, cancellation and narrow-screen actions. Font availability must be proved in that actual built execution path. The authored two-case driver mocks only Next cookie transport; it does not constitute browser-cookie verification. Corrupt snapshot behavior is covered at the domain error boundary; no protected database constraint should be weakened merely to fabricate a stored corrupt receipt.

No human UAT, physical printer, legal issuer release, production deployment or whole-project Go-Live acceptance is claimed.

## Actual PostgreSQL export artifact retest

Main supplied `database-qa-2026-10-23T23-04-42.623Z-89b85387-777e-4e4a-a8b5-43ae5df35ae9.log`. I inspected its attested isolated PostgreSQL identity and actual 2/2 integration pass, exit 0, with 21.83 seconds total. The driver uses real stored sessions, real financial services and renderer, replacing only Next cookie transport. Its assertions cover missing/expired/disabled sessions, allowed ADMIN-to-STAFF demotion, invalid/missing identity/query, unchanged read-side receipt count/counter, unchanged snapshot/fingerprint after reversal and appended cancellation. I did not rerun any database operation.

I independently loaded `database-artifacts/receipts.json` and the three actual route PDFs with pypdf. The original and live-renamed PDF semantic text is exactly identical. All three retain exact 0.10 and 0.20 allocations, 0.30 received total, original 1,040.00 invoice totals, original property/tenant/address/issuing operator, bank reference, receipt number and fingerprint. No CURRENT renamed value or NUL glyph appears. Original received Bangkok time is 23/10/2026 01:01:02; frozen issuance is 24/10/2026 06:05:01. Cancellation adds its separate reason, actor and reversal identity and Bangkok timestamp 24/10/2026 06:05:04 while retaining original financial facts.

I independently canonicalized the snapshot JSON using sorted keys, UTF-8 and compact separators and recomputed SHA-256. It equals the recorded fingerprint before and after reversal. The before/after snapshot objects are equal, and only the separately appended cancellation changes the receipt record status.

I rendered original.pdf, live-renamed.pdf and cancelled.pdf with Poppler at 1100 pixels using the existing explicit fonts.conf. Each command exited 0 with no stderr. The newly rendered `review-original-1.png`, `review-live-renamed-1.png` and `review-cancelled-1.png` were each inspected with view_image. The two original-fact pages visibly agree, and the cancelled page clearly shows the separate red cancellation banner/section with original values intact. Amounts, Thai text and fingerprint are readable, within margins and without overlap.

Verdict: actual persisted-session PostgreSQL export evidence and its three rendered route artifacts are accepted. The log contains a pg client concurrent-query deprecation warning; the current run exits successfully, and this warning does not establish a receipt defect. Built-app browser cookie transport, inline/download actions, narrow-screen access and actual packaged-font execution remain separate Main acceptance gates. No physical printer, human UAT, legal issuer release or Go-Live claim is added.

## Browser acceptance specification review

Reviewed the frozen new `tests/phase2/receipt-pdf.spec.ts` with three cases before Main execution. The test imports the existing guarded fixture. Its auto nonce challenge and target proof, dedicated origin/role/database rules, fixed proxy and redirect protections are unchanged. Fixture setup additionally queries actual database and role before creating synthetic records. No test guard or application authorization is weakened.

ADMIN and STAFF cases log in through the real HTTP login endpoint using page.request, whose cookies share the browser context. They load the persisted receipt UI, Tab to the actual inline link and press Enter, observe a real native popup and authenticated PDF response, then click the actual download link. They assert exact PDF headers/disposition/filename and save actual downloaded bytes, checking PDF signature/EOF/content length and attaching bytes plus frozen expected facts. At 390 pixels, keyboard focus, viewport and receipt-region bounds are asserted, scoped WCAG checks run, and a screenshot is retained. The original snapshot and one-receipt count remain unchanged. These assertions test user-visible behavior rather than merely the href string.

The cancellation case reverses the persisted payment, refreshes the actual receipt UI, verifies the cancellation message and unchanged original snapshot/fingerprint, and downloads the same receipt's actual cancelled PDF. Logout and disabled STAFF checks use the real context cookie transport and require JSON 401 with no-store. STAFF is restored in finally so the synthetic shared fixture is not left disabled. No physical printer completion is claimed.

No blocking test-source finding was identified. Browser acceptance still requires the actual run and independent inspection of the downloaded documents against their attached frozen facts. PDF signature/EOF checks alone do not establish amount/cancellation correctness; those saved artifacts supply the complementary semantic/visual check. This specification review does not claim a browser pass.

Reviewed browser specification SHA-256: `186ec9f7dac95b1ccb875c8157116b4078d79619c468936a858a48afd143bc01`.

## Final built-browser acceptance review

Main executed guarded run `4e1991d6a0b74c56ad49160f`, recorded in `browser-acceptance.log`. I inspected that log and the actual browser results JSON. All three receipt cases passed, with 28.9, 15.5 and 3.4 seconds reported for ADMIN, STAFF and cancellation/session cases. Setup applied all 14 migrations and seeded a fresh synthetic database. Target proof identifies the dedicated origin, unique run role and fixed proxy; the standalone server started successfully. Cleanup exited 0 and retained its owned volume. I did not execute browser, Docker or database operations myself in this retest.

I loaded each actual saved browser-download PDF and its attached expected frozen receipt JSON from this run's preserved test-results. Exact receipt/payment/bank references, operator, tenant/property/room labels, invoice number, received amount 0.30, allocation 0.30, original invoice total 1,000.00 and fingerprint agree. The cancelled download preserves the original snapshot and adds the separate cancellation reason, actor and reversal identity. No missing NUL glyph appears, and actual downloaded documents contain embedded FontFile2 data. Because these bytes came through the running built standalone route, the evidence proves font availability in this tested standalone execution path. It does not establish an untested future Docker image's packaging.

The first text comparison assumed a long synthetic property label remains contiguous in extraction and failed at a legitimate wrapped line. I changed only the independent checker to compare whitespace-normalized strings and the documented Thai SARA AM extraction representation. All three actual downloaded PDFs then passed. No PDF, test or application change was involved.

I rendered all three downloads with Poppler using explicit fonts.conf; each exited 0 without stderr. I independently inspected `browser-reviewed/admin-1.png`, `staff-1.png` and `cancelled-1.png`. Amounts and labels are readable, all content stays within margins, and the cancelled original amount remains clearly visible beside the separate red status/section. I decoded and inspected the two actual 390-pixel screenshots as `browser-reviewed/admin-mobile.png` and `staff-mobile.png`. Both receipt PDF links are visible within the receipt panel, long frozen values wrap, the legal-issuer notice is present, and the test's keyboard/viewport/Axe assertions passed. This confirms the scoped controls in the tested narrow layout.

Final verdict: the bounded receipt record PDF implementation is independently accepted across code review, focused tests, all 25 synthetic pages, invoice extraction regression images, actual PostgreSQL route artifacts and the three passing built-browser cases with inspected saved downloads. There are no open material findings for this scoped unit. Main may integrate after preserving the selected synthetic evidence and excluding changed historical invoice PDFs, caches, private authentication state and unrelated traces. This acceptance does not close deposits, expenses, reports, legal issuer configuration, physical printing, other operational/security findings or project Go-Live. Agent UAT is recorded as agent execution; no human UAT or production deployment is claimed.
