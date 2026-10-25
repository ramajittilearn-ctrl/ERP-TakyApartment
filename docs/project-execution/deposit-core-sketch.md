# Managed deposit core implementation sketch

Grounded against ff9c2bf and the adopted deposit implementation contract. This freezes interfaces for independent review before implementation. The evidence owner owns filesystem validation and upload admission; this owner owns the additive schema, ledger service and cross-stream Payment gate.

## Data and ownership

Five new Prisma models, restrictive relations only:

- DepositAccount: leaseId UUID primary key, version integer default 0, reviewState string UNREVIEWED/REVIEWED, reviewedById UUID nullable, reviewedAt timestamp nullable, legacyDigest char64 nullable, reviewReason varchar1000 nullable, evidenceId UUID nullable, openingAmount numeric14,2 nullable. Review transition increments version once, even zero opening. A positive opening entry shares that version increment.
- DepositEntry: id UUID, leaseId UUID, sequence integer, kind RECEIPT/REFUND/DEDUCTION/REVERSAL/OPENING, amount numeric14,2, occurredAt/postedAt timestamp, postedById UUID, reason varchar1000, evidenceId UUID, method CASH/BANK_TRANSFER nullable, receivingAccountKey/externalReference varchar120 nullable, payeeName/destination varchar200 nullable, reverseOfId UUID nullable unique, documentNumber varchar40 unique, documentSnapshot JSON, snapshotSha256 char64. Unique leaseId/sequence and id/leaseId permit same-lease composite evidence/reversal integrity. Immutable after insert.
- DepositCommand: id UUID, actorId UUID, commandKey varchar100, operation varchar80, requestFingerprint char64, result JSON, createdAt timestamp. Unique actorId/commandKey; immutable.
- DepositEvidence: id UUID, leaseId UUID, attachmentId UUID unique, uploadedById UUID, acceptedAt timestamp. Unique id/leaseId for same-lease references. Immutable. Attachment retains leaseId as its single owner. User and lease restrictive relations. Evidence creation requires current ADMIN, matching upload actor/lease, and an admission audit with attemptId; filesystem integrity remains an application boundary and cannot be inferred from SQL metadata alone.
- DepositDocumentCounter: month char6 primary key, nextValue integer. Counter row lock under the agreed order. DEP-YYYYMM-NNNNNN, fail before overflow 999999.

Enum-like strings have database CHECK constraints and strict Zod enums. User/Lease/Attachment gain only opposite relation declarations. Existing SecurityDeposit and Lease.deposit bytes and semantics remain unchanged.

## Service interfaces

All public raw inputs are unknown and parse with strict Zod schemas. Current actor authorization is reloaded before idempotent replay. All writes acquire source shared gate 73422193, authorization, actor-command identity, bank gate 73422194, then lease/account/original/evidence/counter locks in that order. SQL BEFORE STATEMENT admission takes source then bank. SERIALIZABLE transactions use bounded retries under the same command key for stale cross-stream snapshots.

reviewDepositAccount(actor, { leaseId, expectedVersion, openingAmount, evidenceId, reason, verified: true, commandKey })
recordDepositReceipt(actor, { leaseId, expectedVersion, amount, occurredAt, evidenceId, reason, verified: true, method, receivingAccountKey?, externalReference?, commandKey })
recordDepositRefund(actor, { leaseId, expectedVersion, amount, occurredAt, evidenceId, reason, settlementReviewed: true, method, payeeName, outgoingReference?, destination?, commandKey })
recordDepositDeduction(actor, { leaseId, expectedVersion, amount, occurredAt, evidenceId, reason, verified: true, commandKey })
reverseDepositEntry(actor, { leaseId, entryId, expectedVersion, occurredAt, evidenceId, reason, verified: true, commandKey })
getLeaseDepositLedger(actor, { leaseId, offset = 0, limit = 50 })
getDepositDocument(actor, { entryId })

The ledger DTO contains contractualRequirement, unverifiedLegacy rows/count/gross, reviewed account state/version/opening/digest, paged immutable entries with separate reversedBy information, complete gross/reversed/net totals, heldLiability, total/offset/limit and asOfPostedAt. Read history and totals share one Repeatable Read snapshot. Entry snapshots freeze lease/tenant/room, posting actor, method provenance, dates, kind, amount, document number and original target. No fictitious legal issuer fields.

Evidence boundary import is src/server/evidence/index.ts export lockAndVerifyDepositEvidence(tx: Prisma.TransactionClient, input: { leaseId: string; evidenceId: string }): Promise<{ evidenceId: string; attachmentId: string }>. It must lock the evidence/attachment rows and verify regular retained bytes/hash/length. The core cannot post until this real implementation is integrated. There is no permissive implementation or metadata-only fallback. DepositEvidence public upload DTO is { id, leaseId, uploadedById, acceptedAt, originalName, mimeType, bytes: number, sha256 }. Bytes are a safe integer capped at 5 MiB.

The admission audit action is DEPOSIT_EVIDENCE_ADMISSION, entity deposit-evidence, entityId null, metadata { leaseId, attemptId }, under session lock hashtextextended('deposit-evidence-admission:' + actorId, 0). Publication uses 73422195. Evidence acceptance adds a DEPOSIT_EVIDENCE_ACCEPTED audit with evidenceId/attachmentId/attemptId under its transaction. UI and routes must never supply actor IDs, snapshot JSON or retained paths.

## Verification units

Blocking first steps are independent review of this sketch and evidence boundary agreement. Core ownership is one writer because schema, SQL invariant functions and ledger commands share financial invariants. Evidence filesystem implementation and independent review remain separate workstreams. Tests cover exact arithmetic, strict parsing, complete equations, reversal targets and canonical digests locally; Main executes fresh real PostgreSQL migration preservation, direct SQL invalid writes, financial races, cross-stream source-close order and rollback injection. No test result is claimed by this sketch.

## Main acceptance and binding

Main independently accepted this exact sketch with the evidence result/DTO refinements above. Core exports createDepositService(realVerifier) with a required verifier argument and no default. Main wires the actual evidence module when integrating routes. This keeps the standalone core typecheckable without pretending retained-file verification exists. No global mutable verifier registry is introduced.
