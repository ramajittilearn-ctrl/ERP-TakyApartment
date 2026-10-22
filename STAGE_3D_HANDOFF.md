# Stage 3D handoff

This handoff starts from Stage 3C-4 `701acf8` and audit `01a5233`. Remediation lives on `codex/audit-remediation` in `/private/tmp/taky-audit-remediation`. No push, merge or deployment is authorized by this handoff.

## Readiness decisions

| Decision | Current state | Dependency |
| --- | --- | --- |
| Remediation complete | Verified local remediation complete: F-11/F-12/F-13 closed; F-09 partial; F-06 open; F-10 implementation complete, Owner acceptance pending | F-09 remains partially resolved pending trusted ingress source protection and active-load/storage control; F-10 awaits Thai rendering and print-layout acceptance |
| Stage 3D requirements/design | Conditional GO for requirements and design | Owner must approve the payments/receipts scope; F-10 Option A is recorded and its implementation awaits Owner UAT acceptance |
| Stage 3D implementation | NOT READY for business-code implementation | Approved state transitions, permissions, allocation and balance rules, concurrency/idempotency, reversals, receipts, private proof storage, migration expectations and acceptance scenarios |
| Production billing | NO-GO | F-06 actual target/legacy inventory; Owner UAT; due-date/operator commissioning; off-site backup, key custody and restore rehearsal; trusted ingress; deployment approval |

## F-10 decision and implementation record

**Decision:** Option A — implement the Stage 3C invoice PDF now. This Owner decision was supplied in the F-10 task prompt on 2026-10-22. Implementation is on `codex/f10-invoice-pdf`; the PDF is rendered from persisted issued snapshots and freeze labels. See `F10_INVOICE_PDF_IMPLEMENTATION_REPORT.md`, `F10_INVOICE_PDF_TEST_REPORT.md`, and `F10_INVOICE_PDF_OWNER_UAT_GUIDE.md`.

| Option | Scope | Milestone implication |
| --- | --- | --- |
| A: dedicated Stage 3C document milestone | Invoice PDFs from immutable issued snapshots, Thai font embedding, supported fields, correct totals/revisions and print output, authorized access | Implemented; Owner must accept Thai rendering and print layout before F-10 closure and dependent Stage 3D document behavior |
| B: combined Stage 3D document milestone | Approve invoice and receipt document requirements together with separate acceptance scenarios | Explicitly defer the Stage 3C roadmap PDF item into the approved Stage 3D milestone |
| C: later document milestone | Approve an explicit PDF deferral with an identified future milestone and interim operator document procedure | Lifecycle development may proceed only after the Owner approves the deferral and detailed Stage 3D requirements; full roadmap closure remains qualified |

The chosen option and decision date are recorded above. The current schema does not define contact phone, legal/tax registration fields or a configurable legal footer; these were not invented. Owner UAT must record font/print acceptance in the F-10 guide. F-10 remains OPEN until that acceptance is complete.

## Engineering entry guidance

Use the verified fresh-target browser workflow in `docs/BROWSER_TEST_ISOLATION.md`. Do not run write-enabled tests against retained UAT. Keep `docs/F06_READ_ONLY_VERIFICATION.md` as a separate actual-target verification gate. The example SQL has not been executed against operational data.

The shared authentication lockout is removed and identifier throttling remains. Forwarding headers are not trusted as source identity. Production ingress needs a proven peer/proxy contract, per-source admission protection and active throttle/password-work monitoring. These are deployment dependencies rather than permission to alter the active UAT or operational stack.

Financial calculation, immutable issued snapshots, source freeze, invoice numbering and role permissions retain their baseline behavior. Stage 3D must preserve those invariants. Receipt numbering and payment allocation must receive their own approved contracts and tests.
