# Stage 3C-3 decision log

Date: 2026-10-21. The owner brief and follow-up govern development. Production billing remains NO-GO.

| Decision | Authority | Application |
|---|---|---|
| Canonical CLOSED period and validated inputs before issuance | Owner brief; existing D-09 | Persist a validated freeze atomically with new period closure; historical CLOSED without freeze stays non-issuable. |
| DRAFT, ISSUED, VOID; STAFF drafts and ADMIN financial transitions | Owner brief; D-08 | Explicit server and database transitions; issued/VOID content immutable. |
| Atomic void plus new numbered linked revision | Owner brief; D-12 | Preserve predecessor snapshot/number and audit the replacement in one transaction. |
| Invoice-specific correction snapshot with reason/evidence | Owner follow-up, 2026-10-20 | ADMIN approves bounded validated replacement inputs; recalculate with 3C-2; preserve closed original inputs and freeze. |
| Later actual-versus-estimate differences go to a future period | Existing owner approvals, reaffirmed in follow-up | Reject retroactive reconciliation through the revision endpoint; no difference-charge valuation is invented. |
| No default due-date value | Owner brief; D-06 | Explicit ADMIN configuration and missing-policy validation; ADMIN-only individual override. |
| At most one non-VOID invoice per lease/canonical period | Owner brief; D-10 | Database partial uniqueness plus transactional active-slot protection. |
| YYYYMM uses canonical billing month | Technical interpretation expressly requested by owner brief | Global monthly counter across properties, independent of issue date; document and verify. |
| Four-digit range exhausts at 9999 | Safe technical validation of D-07 format | Explicit conflict at exhaustion; no wrap, widening or number reuse. |
| No automatic tax, optional fees, payments or deployment | Owner scope; D-05 | Only approved engine charges and lifecycle operations. |
| Preserve legacy rows without automatic mapping | Owner migration/data-safety instructions | Nullable managed provenance for existing records; read-only legacy barriers and explicit production migration risks. |
| Empty eligible set can close without billable candidates | Small compatibility decision within owner instruction to preserve Stage 3A/3B | Validate and retain an empty freeze for meter-only periods; absent frozen leases cannot issue invoices. |

## Open owner decisions

No additional owner policy is currently required for the approved core lifecycle. Due-date values remain explicit operator configuration, not an inferred default. Cross-period reconciliation valuation remains outside this milestone. Any unsupported source correction or destructive migration need must stop the affected path and be reported.

## Pstack design work

Two independent sketches are retained under ignored `.local`: a single period JSON freeze with extended invoices, and relational per-lease freeze rows with thin invoice lifecycle records. Cross-review and the selected synthesis are recorded in `STAGE_3C3_DESIGN.md` before implementation. Delegation uses available Codex agents and inherited models; unavailable upstream model names are not assumed.

## Implementation review decisions

- Preserve source approval metadata when selected rate, rent/dates or quantities do not change. Reject an unchanged correction before invoice, counter, correction, audit or command writes. Independent review found that fresh approval IDs otherwise caused false revisions; the PostgreSQL regression verifies the rejection.
- Treat retained legacy invoice dates as dates within a canonical month. Expand both service and database mapping barriers to the whole month. Apply this guard fix in a third migration because the first two had already been applied to isolated targets. A mid-month legacy fixture inserted before the new migrations verifies retention and both barriers.
- Existing Stage 3C-2 compatibility assertions now expect the reviewed partial active-slot index and reject incomplete close attempts. The close/approval race prepares unrelated required inputs first and continues to race the target approval against close. Numbering race fixtures prepare sequentially before actual simultaneous issuance.
- Two user chats initially verified the same checkout/database simultaneously. After the owner explicitly authorized cross-chat coordination, the second chat stopped. The primary chat owns final source verification, reports and Git commits. A dedicated runner advisory lock serializes verification commands; it is separate from application source locking. Overlapping failed runs are retained as failures and excluded from final pass evidence.

Gate 3C-3B evidence: 19 invoice PostgreSQL cases, 23 billing cases and 15 finance/lease cases passed together on the identity-checked isolated database. The 14 meter cases passed on a separate fresh isolated database because the historical suite cannot recreate its fixed property/month fixture on reuse. Unit tests passed 120/120. The independent reviewer confirmed both final no-op and legacy fixes without further blocking findings. These development checks do not authorize production billing.
