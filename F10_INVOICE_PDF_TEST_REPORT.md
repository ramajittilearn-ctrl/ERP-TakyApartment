# F-10 Invoice PDF test report

**Branch:** `codex/f10-invoice-pdf`

**Baseline:** `78f6269ff1597cfbea8888a2bba9ffc9a353c336`

**Database isolation:** Fresh synthetic PostgreSQL 17 Compose project, role, and database `taky_phase2_test`; no Owner UAT connection or data.

## Results

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 10 files, 141 tests |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm run build` | PASS — Next.js 16.4.1; dynamic PDF route included |
| `npm run test:integration` on isolated synthetic DB | PASS — 7 files, 91 tests |
| `node scripts/run-remediation-browser.mjs` | PASS — 49/49 browser tests |
| `node scripts/run-remediation-browser.mjs --target-check` | PASS — 5/5 tests, including unauthenticated PDF-route rejection |
| Focused PDF tests (`tests/invoice-pdf.test.ts`) | PASS — 4/4 |
| Sample artifact | PASS — `file` identifies PDF 1.3, one page |
| Database migrations/schema | PASS — no migration required; no schema edits |

The integration suite verifies DRAFT rejection, unauthorized role rejection, invalid identifiers, ISSUED and VOID document behavior, repeat-download equality after live property/tenant/rent/lease/rate changes, persisted line amounts and total, and invoice row non-mutation. Freeze tests verify address and lease reference are captured in immutable labels.

PDF tests verify A4 dimensions, embedded Thai and Latin Noto Sans Thai faces, Unicode maps, Thai glyph mappings, long mixed Thai/English address/name wrapping, VOID output, and safe filename handling. The browser suite includes a direct unauthenticated GET check for `/api/v1/invoices/{id}/pdf/`.

## Visual verification limitation

I did not visually inspect a rendered screenshot. The local PDF preview attempt was rejected by the browser’s `file:` URL security policy. No claim of visual verification is made. The Owner UAT guide includes a print/layout acceptance check. This is why F-10 is recommended to remain OPEN pending Owner acceptance.

The first integration attempt exposed an overlong synthetic lease-number fixture; the fixture was corrected to stay within the existing 40-character schema limit and the full suite then passed. An initial build attempt left a stale generated Next lock after the process exited; the lock was cleared and the clean production build passed. No product defect remains from either attempt.

## Evidence and isolation

The integration test run used run ID `f6ac1ae642336ecd61f977e2`, a unique role and port 55451. The complete browser run used `4377f65e4da29180af9127d0`; the focused browser rerun used `eaaa8da1bdc40ac2a7499e43` on port 55452 through the repository proxy. Containers and networks were stopped by the repository runner; test-only named volumes were retained under its documented policy. Run logs were inspected and are not included in the feature commit. All credentials were synthetic and kept in ignored `.local/` files.
