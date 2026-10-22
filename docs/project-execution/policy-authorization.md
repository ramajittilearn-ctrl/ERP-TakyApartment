# Policy authorization checkpoint

Date: 2026-10-23, Asia/Bangkok.

The preserved Stage 3D design documents describe the approval state at the time they were written. They remain historical evidence. This checkpoint records later instructions without rewriting that evidence.

The Owner subsequently instructed the orchestrator, "อนุมัตืทุกอย่าง ไม่ต้องขออีก ทำให้เสร็จ", followed by "Do everything to complete". The orchestrator explicitly announced that development would adopt the existing recommended defaults. This is the provenance for adopting the documented recommendations for local implementation. It does not establish that Owner UAT happened, that a production database was inventoried, or that missing legal entity and bank details are known.

## Adopted development policies

| Decisions | Adopted policy |
|---|---|
| D3D-01 | Cash and bank transfer. QR remains outside this release. |
| D3D-02, 03, 04, 13 | Allow partial and multiple payments. Require explicit allocation to invoices on one lease. Reject over-allocation and unallocated credit. |
| D3D-05, 09 | STAFF and ADMIN may create pending entries. ADMIN confirms and issues the receipt atomically. |
| D3D-06 | Preserve actual received timestamp separately from creation and confirmation. Display Asia/Bangkok. |
| D3D-07 | Cash does not require evidence. Bank entry requires a traceable reference or private slip. Neither proves settlement automatically. |
| D3D-08 | Actor-scoped command idempotency, receiving-account-scoped bank reference uniqueness, and an audited ADMIN override for likely duplicate cash. Exact normalization and duplicate matching proposed in the engineering contract require independent review. |
| D3D-10 | Dedicated global monthly REC-YYYYMM-NNNN counter. Use issuance month in Asia/Bangkok, Gregorian year, and never reuse cancelled numbers. |
| D3D-11, 12 | Full reversal only. Atomically append reversal and linked receipt cancellation. Retain original content and allocations. |
| D3D-14 | Post-VOID funds are unresolved exceptions with no rent allocation or receipt until explicit resolution. Exception/refund implementation is a later unit and must not be represented as available by Stage 3D-1. |
| D3D-15, 17 | Deposits remain separate. Preserve legacy rows without automatic mapping. |
| D3D-16, 19 | Thai A4 print and browser Save as PDF from immutable receipt snapshot. Actual legal identity text remains required for operational release. |
| D3D-18 | Pending entries do not expire automatically and do not block invoice void or revision. |

ADMIN may cancel a pending entry. STAFF cancellation is not enabled because the preserved recommendation explicitly made that extra privilege conditional.

## Remaining facts and release gates

Actual legal issuer name, address, tax identifiers and wording, receiving-account identifiers, evidence MIME/size/retention policy, target database identity and historical mappings, operator UAT acceptance, backup/recovery commissioning, and production rollout remain unverified. Do not substitute fixture values or broad authorization for evidence that those facts exist or gates passed.

Local implementation and synthetic migration/concurrency tests may proceed. The existing instruction against modifying Owner UAT or production environments remains in effect. This checkpoint records development policy authorization, not a production deployment or financial-data migration approval.
