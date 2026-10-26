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

## Separate evidence acceptance reconciliation

Read `../deposit-qa-candidate/evidence/deposit-core/database-qa-2026-10-25T16-08-24.131Z-6c68b5bc-6b08-4454-9690-424667aaf6a6.log`, SHA256 `709ede7dfc5571666c3a38d76f2d88a802f55e92a43bdda2dba8777d691a8104`. Actual two-file suite passes9/9 with child exit0: the original six real-validator evidence cases and three new failure cases. The latter establish accepted-metadata rollback after scoped acceptance-audit failure with retained orphan/hash preservation, fail-closed real actor-admission backend loss, and real upload-service exclusion by the publication session lock followed by healthy retry. Main independently reviewed and ran these authored cases; this reconciliation does not replace that independent approval.

These results close the specified evidence failure-test gap. Stage3E/Phase4 final UI/PDF and complete integration acceptance remain Main's separate responsibility; no production or Go-Live conclusion is made.
