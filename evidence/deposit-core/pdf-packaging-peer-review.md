# Standalone PDF packaging peer review

Reviewer: recover_deposit_core. PDF implementation owner: evidence_review. This reviewer makes no application changes and runs no native server, network, database or build command in this review lane.

## Established failure

Read Main's actual probe `../deposit-qa-candidate/evidence/receipt-pdf/standalone-probe/2026-10-26T00-08-17.434Z.json`, SHA256 `e2e1c46b20dc71e2ec3604100d8569e22c9c325075520a9a6286f85d70b04022`. It establishes attested database, genuine login200, missing noto-sans-thai-thai-400-normal.woff with ENOENT, receipt PDF500/INTERNAL and successful owned-server shutdown. The diagnostic does not expose credentials, document contents or tenant fields.

Source registerPdfFonts resolves two exact Thai/Latin WOFF files relative to process.cwd(). Both invoice and receipt PDF renderers use this shared loader. There are exactly two API PDF routes in the reviewed source. Installed Next.js output.md documents outputFileTracingIncludes with route-glob keys and project-root-relative asset paths.

## Design acceptance

Accept adding only the two exact noto-sans-thai Thai/Latin400 WOFF assets to the invoice and receipt PDF route traces. This changes packaging rather than financial logic, authentication, snapshots, rendering layout or font selection. No package externalization or PDFKit rewrite is justified by the observed error alone.

The proposed reusable artifact check must require both assets in each exact route.js.nft.json, then compare source and standalone regular-file byte lengths and SHA256 values. Missing files, omitted per-route membership, changed bytes and symlink replacement must fail. This proves the two assets that the runtime loader needs are present; it does not prove general standalone portability or every PDFKit dynamic import.

## Frozen source review

Independently accepted3d49f25106d20962ef8c8e2139b25672150402aa in deposit-ui-candidate. The three-file change implements the agreed narrow config includes, reusable scripts/verify-pdf-assets.mjs and tests/ops/pdf-assets.test.mjs. Each route's NFT entries are resolved relative to that exact trace and must include both expected project-root font files. Both source and standalone copies must be regular files; source bytes must be nonempty and exactly equal to the standalone bytes. Returned evidence includes only asset name, byte count and SHA256. No financial/authentication/rendering source or package externalization changed.

Fresh independent command `node --test tests/ops/pdf-assets.test.mjs` passed4/4, exit0. It exercises valid traces/copies, per-route omission, changed/missing copied bytes and same-byte symlink rejection. git diff --check passed. These synthetic fixtures prove the artifact checker detects those defects; they do not establish that the current actual build has been fixed.

Main may rebuild this frozen source. Actual fresh build, actual artifact check, genuine HTTP PDFs and browser behavior remain pending. Source acceptance does not close those gates or establish general PDFKit standalone portability.

## Final actual acceptance reconciliation

The preceding pending-gate checkpoint is superseded by the following actual results. Reviewed QA source589800b, including font tracing integration867a71b. The config, verification helper and focused tests at867a71b are byte-identical to the independently accepted3d49f25 implementation. The final589800b change affects only the browser test and its census explanation; it makes no product-control, financial, authentication or rendering change.

Read the actual fresh-build output in QA evidence/deposit-ui/build-with-pdf-assets.log and the complete actual artifact result evidence/deposit-ui/pdf-assets-built.json. The artifact check reports both routes verified and both copied fonts equal to source: Thai11316 bytes/SHA256 e601a5a91e1b567fb0648ff598923aea68502b048d9e8ee995033f12a373eb09 and Latin13140 bytes/SHA25685016d5c37b7fba18ef68c595443e47997a98cd1c2ea399bda9dfec723c3ad09. The result file SHA256 is fd5048c4b382629ccda88a9072fbcdc09f2434d19e94835c4fb476eead4190ea.

Read actual post-fix native probe evidence/receipt-pdf/standalone-probe/2026-10-26T00-14-53.476Z.json, SHA25671ff6b37fb2248218ce237efdbdfe6c9f322d3a064814b37eea24b3f0226c0b5. It establishes genuine login200, receipt PDF200 with37120 bytes and successful owned-server shutdown. Together with the retained pre-fix500/WOFF ENOENT probe, this demonstrates correction of the observed deployed-artifact defect rather than only a passing synthetic checker.

Independently read the complete combined browser raw log evidence/remediation/8f40b1e18daa4bbab16f1f09-browser.log, SHA256f475306f38fb7cdee0b99d09ac629b73b379ebcb8ade0df4703ef30c858caf68. It attests the fresh synthetic run's exact database/role through the guarded target and proxy, executes35 tests and records exit0. Its execution.json reports browserStarted=true/succeeded=true; results.json reports expected35, skipped0, unexpected0, flaky0 and no global errors. Those two files have SHA256cf9a9f9e54e1d855c12ece14e97eb03a52870c069b89785d2c42aef75f379026 and4db8c3037191ff05acb8a5f7948a33c160d5146380337992374d57f88fe2edc9 respectively.

The35 cases comprise one complete monthly billing flow with actual invoice PDF download/signature, all five deposit UI cases, eight expense cases, fourteen payment cases, all three receipt PDF cases and four tenant-rent regressions. The receipt source requires actual inline/download response headers and PDF bytes for ADMIN and STAFF and checks cancellation history plus revoked/disabled session export denial. The deposit source and passing cases retain genuine upload, zero/positive verified opening, financial movements/totals, immutable document, STAFF restrictions, wrong-lease evidence rejection, uncertain-response exact replay and mobile focus/form/Axe checks. These are actual browser outcomes; no browser, database or test was rerun by this reviewer during this reconciliation.

## Native selection evidence boundary

Read the retained fixed704 keyboard diagnostic's results.json attachment deposit-keyboard-census. Its four app/reference-by-two-protocol observations all retain final value empty/index0 despite focused enabled controls. Events contain only focusin/focusout/keydown/keyup, no input/change, and no prevented event; blockedWrites is empty. The plain reference shares the dialog/form scope. The document-wide reactiveDownload field is excluded because it observes the background link rather than modal selection state.

This evidence supports correcting the test's native-popup assumption rather than changing the product control. The final test uses documented Playwright selectOption for accepted native evidence selection and still requires the exact selected UUID and selected-evidence download link inside the active modal, keyboard reach/focus, checkbox and submit behavior, Escape/focus restoration, Axe scans and actual successful financial posting/totals. All35 final combined cases pass with that explicit boundary. Native-popup key navigation itself remains unestablished by this runner; no end-to-end keyboard-only selection claim is made.

## Scoped opinion

Accept the bounded standalone-font correction and its actual PDF/UI regression gates. There are no open P1/P2 findings in this reviewed PDF packaging and evidence-based browser-test correction scope. The earlier9/9 real-validator failure suite,50/50 financial core suite,39/39 payment regression and successful real ops restore/publication gates remain reconciled in this and the separate operations review. Main retains responsibility for final project integration and Phase4 closure. This opinion does not establish arbitrary deployment portability, unsupported manual SQL isolation, human acceptance of native popup behavior, production deployment or Go-Live readiness.

## Separate evidence acceptance reconciliation

Read `../deposit-qa-candidate/evidence/deposit-core/database-qa-2026-10-25T16-08-24.131Z-6c68b5bc-6b08-4454-9690-424667aaf6a6.log`, SHA256 `709ede7dfc5571666c3a38d76f2d88a802f55e92a43bdda2dba8777d691a8104`. Actual two-file suite passes9/9 with child exit0: the original six real-validator evidence cases and three new failure cases. The latter establish accepted-metadata rollback after scoped acceptance-audit failure with retained orphan/hash preservation, fail-closed real actor-admission backend loss, and real upload-service exclusion by the publication session lock followed by healthy retry. Main independently reviewed and ran these authored cases; this reconciliation does not replace that independent approval.

These results close the specified evidence failure-test gap. Stage3E/Phase4 final UI/PDF and complete integration acceptance remain Main's separate responsibility; no production or Go-Live conclusion is made.
