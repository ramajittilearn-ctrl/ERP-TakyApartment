# Stage 3D readiness report

**Review date:** 2026-10-23, Asia/Bangkok

**Result:** Design completed. Implementation is **NOT READY** pending Owner decisions and Stage 3C dependency closure. Production use is **NO-GO**.

## Executive summary (ภาษาไทย)

Stage 3D ควรบันทึกการรับเงินเป็นรายการที่ตรวจสอบย้อนหลังได้ และคำนวณยอดค้างจากการจัดสรรเงินที่ยืนยันแล้ว โดยไม่แก้ยอดหรือภาพข้อมูลใบแจ้งหนี้ Stage 3C ใบเสร็จควรออกหลังยืนยันการรับเงิน เก็บข้อมูลฉบับที่ออกแบบแก้ไขไม่ได้ และยกเลิกได้ผ่านรายการกลับบัญชีพร้อมเหตุผลเท่านั้น

โค้ดปัจจุบันยังไม่มีระบบรับชำระเงินจริง หน้าการชำระเงินยังใช้ข้อมูลสาธิต แม้ฐานข้อมูลจะมีตาราง Payment และ PaymentAllocation อยู่แล้วก็ตาม ก่อนเริ่มพัฒนาต้องให้เจ้าของอนุมัตินโยบายเรื่องเงินจ่ายบางส่วน การยืนยันโดย STAFF การจัดสรรหลายบิล เงินเกินกำหนด การออกและยกเลิกใบเสร็จ และกรณีรับเงินหลังใบแจ้งหนี้ถูกยกเลิก นอกจากนี้ต้องปิดช่องว่างที่คำสั่ง void/revise ใบแจ้งหนี้ยังไม่ตรวจสอบรายการชำระ และต้องคงข้อกำหนดตรวจสอบฐานข้อมูลจริง ข้อมูลเก่า การสำรองและกู้คืน รวมถึง UAT ของ Stage 3C

เอกสารนี้เป็นแบบออกแบบเท่านั้น ยังไม่มีการแก้โค้ดหรือฐานข้อมูล Stage 3D

## Decision status

| Category | Findings |
|---|---|
| **Approved requirements** | User brief requires manual cash and bank transfer payment entry, payment dates and references, attachment strategy, partial/full and multiple payments, outstanding balances, receipts with unique numbers, Thai A4 PDF, immutable receipt snapshots, download/print, reversal/correction, tenant balances, historical payment history, decimal-safe financial integrity, transactions, idempotency, concurrency control, audit, restrictive references, and reconciliation. Stage 3C invoices and calculation snapshots remain immutable. |
| **Previously approved project rules** | Stage 3C uses `Invoice.finalTotal` and the frozen invoice snapshot as authority. Stage 3C numbers are globally unique, reserved through voids, and do not use reference line amounts as the bill total. Existing demos are not accounting records. Deposits currently use a separate `SecurityDeposit` model. |
| **Recommended assumptions, not approved** | Pending-before-confirmed payment flow; ADMIN-only confirmation and reversal; partial payments allowed; explicit same-lease allocations; reject overpayments; one receipt per confirmed payment; receipt issuance at confirmation; full reversal followed by a corrected new payment; no deposit mixing; no automatic credit; receipt numbers `REC-YYYYMM-NNNN`; browser print/save-as-PDF for the first release. |
| **Open Owner decisions** | Methods and evidence rules; partial payment; STAFF confirmation; allocation priority; overpayment/credit; receipt issue timing, numbering, required text, and cancellation; payment date precision; full versus partial reversal; post-VOID funds; deposit scope; historic payment migration; file types, limits, and retention; browser PDF versus server-generated retained PDF. See the decision log for full rationale. |

## Repository baseline

The inspected baseline is commit `0530eddac1d1e07a578b8715c92884c320ed8baa`, the committed Stage 3C branch head. It is checked out in this separate worktree: `/Users/ramajittipasutanavin/.codex/worktrees/stage-3d-design-3c/ERP`. The original checkout was on `codex/stage-3c-billing-invoice` with unrelated dirty files (`next-env.d.ts`, global CSS, login UI, and `docs/uat`). Those changes were not used as design evidence or modified. The concurrent `codex/billing-ui` worktree was not used.

The source contains a demo-only `/payments` screen backed by `useDemo()`. The database already has `Payment`, `PaymentAllocation`, `PaymentStatus`, `Attachment.paymentId`, and a separate `SecurityDeposit` record, but no persisted Stage 3D payment, receipt, evidence-transfer, or balance API was found. There is no Stage 3D readiness document in the inspected branch; this report records the baseline and handoff findings available today.

## Readiness findings

| Finding | Severity | Effect | Required gate |
|---|---|---|---|
| Owner decisions affect payment states, allocations, authorization, receipt timing, and liability treatment. | Critical | A schema and workflow cannot safely be finalized without these rules. | Owner approves the blocking decisions before implementation. |
| `voidInvoice` and `reviseInvoice` do not query or block payment allocations. | Critical | A paid invoice could be voided or revised while payment and receipt history remain attached to it. | Stage 3D adds transactional service guards and database protection; test concurrent void/revise against confirmation. |
| Current payment `reference` is required and globally unique; its actual legacy meaning is not established. | High | Reusing it for bank references may reject legitimate values or corrupt historical meaning. | Read-only inventory of intended target; approve a value-preserving migration. |
| Attachment metadata exists, but upload/download API was not found. | High | Transfer slips cannot be safely attached or retrieved until private storage, validation, authorization, and backup behavior are defined. | Approve evidence policy and implement/test private attachment flow. |
| No receipt domain, number counter, A4 receipt route, or PDF endpoint was found. | High | Receipt issuance, immutable rendering, and cancellation do not exist. | Approve receipt content/numbering/PDF method and implement receipt lifecycle. |
| Stage 3C operational readiness remains open. | High | A Stage 3D code pass alone cannot authorize real payment processing. | Clear the carried-forward operational gates below independently. |

## Existing implementation dependencies

- Preserve Stage 3C invoice total, exact calculation snapshot, fingerprint, issued invoice fields, revision links, and immutable row guards.
- Extend rather than replace legacy payment tables. Existing records need read-only inventory and explicit mapping. Do not treat demo rows as production settlements.
- Coordinate payment lock order with Stage 3C invoice period/lease/invoice locks. Void and revision must reject pending and active allocations or use an approved atomic reversal flow.
- Reuse the current `requireActor`, exact-Origin checks, strict Zod contracts, `AppError`, no-store response format, actor-scoped idempotency, service authorization, restrictive foreign keys, and transactional audit style.
- Do not integrate the existing payment demo state as a persisted source. Replace the screen only after API and migration gates pass.
- Do not change billing calculations or add payment status values to `Invoice.status`.

## Pstack design review

Workflow applied: repository grounding; data-shape and ownership analysis; explicit alternatives and recommended defaults; milestone sequencing; independent review gate; artifact verification. Foundational Thinking determined that invoice balance should be a derived read model over immutable invoice totals and confirmed allocations. Sequence Verifiable Units set the migration/domain gate before APIs, UI, and receipts. Prove It Works requires artifact and invariant verification before any completion claim. Technical Writing and Unslop shaped the documents.

Design review assessed requirement coverage, consistency with Stage 3C locks and snapshots, exact-money representation, RBAC, database guards, 15-room operator burden, evidence handling, and production gates. It could not approve business policies on behalf of the Owner.

## Independent review record

| Reviewer | Scope | Result |
|---|---|---|
| `/root/stage3d_review` (independent technical reviewer) | Read all five documents against Stage 3C schema, invoice services, handoff, and audit/readiness evidence; retested findings after revisions. | Final verdict: review findings closed; no remaining substantive gap in payment/exception design or invoice concurrency. Implementation remains NOT READY because Owner decisions are open. |

The initial review raised three High findings and two Medium clarifications. The revisions define post-VOID exception creation and resolution, exclude unresolved exception funds from rent balances and receipts, specify shared locks and both confirmation/void/revision race outcomes, add explicit Prisma actor relations, and record an audited cash-duplicate override. A later review also found missing exception refund persistence, an absent pending-payment allocation path, a pending-expiry contradiction, and missing source-invoice provenance. The design now records a terminal refund event and state, allocates only during confirmation, makes pending entries non-blocking, and retains a restrictive `sourceInvoiceId`. The final retest confirmed these findings closed and confirmed that the D3D-19 PDF choice is consistent across the documents. No Stage 3D implementation behavior was verified.

## Carried-forward operational gates

The Stage 3C-4 handoff says production billing remains NO-GO until the intended operational database and deployed schema are identified; invoice, payment-reference, and meter rows are inventoried and mapped; migration and recovery are rehearsed against a verified backup; due-date and operator procedures are configured; operator acceptance and deployment/backup commissioning are complete; and F-04, F-05, and F-08 are resolved or accepted. F-06 target-data verification remains mandatory. The historical Stage 3B full browser run remains 14/15.

This design does not clear any of those gates. Read-only evidence collected from the local repository does not verify a remote or deployed database.

## Approval gate

**Implementation readiness: NOT READY.** Ask the Owner to decide the items marked open, starting with partial-payment policy, overpayment handling, confirmation permissions, receipt issuance/cancellation, allocation priority, post-VOID payments, and deposit separation. Then revise the requirements and technical design to mark only explicitly approved rules. Stage 3D can enter development after that review. Production readiness remains a separate NO-GO until the operational gates above are closed.

## Verification limits

This session changed documentation only. It did not modify application code, Prisma schema or migrations, a database, UAT instances, or concurrent Billing work. No tests, database services, Docker commands, production access, migration, push, merge, or deployment were used. Documents were reviewed against the repository and Stage 3C handoff sources; implementation behavior remains unverified for Stage 3D because no implementation exists.
