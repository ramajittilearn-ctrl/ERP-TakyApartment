# Browser acceptance corrections after run 6b12

Main ran the guarded suite on fresh plan `6b12a4f60acb471aa2e09183`. The retained browser log records three passed and two failed, exit 1. Full genuine money/evidence/document flow, STAFF/wrong-lease denial and exact lost-response recovery passed. Missing-page status and native-select keyboard interaction failed. This report does not relabel the run as passed.

## Missing pages and streamed status

DUI01 requires valid missing entities to reach the not-found UI rather than the generic SSR failure page. The source correction maps only expected service AppError 404 into Next `notFound()`, and its focused unit tests passed. The authored browser test additionally required HTTP 404 on the page response.

Independent inspection of the retained missing-lease trace found HTTP 200 with the Thai not-found heading, `NEXT_HTTP_ERROR_FALLBACK;404` and `<meta name="robots" content="noindex"/>`. Generic-error text was absent from the captured HTML. The installed `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md` explicitly documents HTTP 404 before streaming and retained HTTP 200 after streaming starts, with noindex in both cases. The existing root loading boundary makes that distinction relevant.

The strict SSR HTTP 404 assertion added an assumption beyond the required error handling. The corrected browser case permits only 200 or 404 for these SSR pages, requires visible not-found UI and a robots noindex meta tag, and rejects the generic-error heading. It also requires exact HTTP 404, no-store and the matching error code from both missing-lease and missing-document APIs. This preserves strict API semantics without changing global loading/layout or inventing another rendering architecture for an authenticated ERP page. Main must run both paths; the first failed attempt stopped at the lease page and did not establish the document-page result.

## Native evidence select

The retained mobile trace shows Tab reaching the evidence select, the expected accepted-file option present, and Home followed by ArrowDown. The assertion then observed the placeholder value for ten seconds. The screenshot and error context confirm the placeholder remained selected. The failure occurred after the initial mobile Axe scan and Escape/focus-return assertions had completed.

The test had not explicitly opened and committed the native selection. The corrected sequence retains keyboard-only focus traversal, asserts focus, confirms the fixture has exactly the placeholder and its single accepted file, then presses Space to open, Home, ArrowDown and Enter to commit. It continues to assert the exact evidence UUID before toggling the verification checkbox and submitting by keyboard. No selectOption, click, value assignment, event injection or alternative posting path replaces the keyboard exercise. No application source changed.

This is a proposed portable native-control interaction correction based on retained evidence, not an independently executed browser proof. Main must rerun a fresh guarded plan and inspect keyboard selection, actual posting, focus and Axe results before acceptance. The original failed raw log, screenshots and traces remain unchanged.
