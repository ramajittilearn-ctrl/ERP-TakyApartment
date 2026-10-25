# First retained deposit evidence interface

Sketch only. No application, shared schema or operations code changed. Grounded on Main `25b8a13`, the complete approved deposit implementation contract and correction-accepted review, original deposit design/review, current Attachment/AuditLog shapes, private volume mounts and current backup/snapshot code. Follow the existing selected design; no alternate ledger or new business policy is proposed. Login admission candidate `6f1ba96` stays parked and outside the narrowed completion scope.

## First executable unit

Implement private retained evidence before enabling deposit financial commands. The first unit owns `src/server/evidence/{contracts,service,storage,formats,index}.ts` and focused tests after Main freezes the baseline and ownership. It uploads bytes, retains them, creates accepted evidence metadata, lists existing accepted evidence and downloads/verifies it. It does not create a deposit account review, opening, receipt, refund, deduction, reversal or bank claim.

Preserve the approved defaults exactly: ADMIN upload, STAFF/ADMIN authenticated reads, 5 MiB decoded bytes/file, PDF/JPEG/PNG only, ten admitted attempts per rolling ten minutes per actor, one active upload per actor, 5 GiB retained-volume ceiling including orphans and destination partial files, no automatic accepted-file deletion or expiry. Existing filename extension, claimed MIME or an Attachment row never proves acceptance.

## Caller-facing types and signatures

Types derive from strict Zod contracts and the coordinator's actual generated schema. UUIDs normalize at boundaries. `bytes` is a safe integer bounded by the file limit; storage uses Attachment.bytes BigInt. Public metadata omits storageKey, filesystem paths and private admission details.

```ts
type DepositEvidenceDto = {
  id: EvidenceId;
  leaseId: LeaseId;
  originalName: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  bytes: number;
  sha256: string;
  uploadedById: UserId;
  acceptedAt: string;
};

type UploadEvidence = {
  actor: Actor;
  leaseId: unknown;
  originalName: unknown;
  declaredMimeType: unknown;
  body: ReadableStream<Uint8Array>;
  signal?: AbortSignal;
};

uploadDepositEvidence(input: UploadEvidence): Promise<DepositEvidenceDto>;
listDepositEvidence(actor: Actor, query: unknown): Promise<{
  items: DepositEvidenceDto[]; offset: number; limit: number; total: number;
}>;
getDepositEvidenceDownload(actor: Actor, evidenceId: unknown): Promise<{
  metadata: DepositEvidenceDto;
  body: ReadableStream<Uint8Array>;
}>;

// Internal deposit-service entry point, not an HTTP input or public DTO.
lockAndVerifyDepositEvidence(
  tx: Prisma.TransactionClient,
  reference: { leaseId: LeaseId; evidenceId: EvidenceId },
): Promise<{ evidenceId: EvidenceId; attachmentId: AttachmentId }>;
```

The financial service already owns actor authorization and its agreed source/bank/lease/account lock order before calling lockAndVerifyDepositEvidence. The evidence function locks/reads accepted same-lease metadata and verifies an opened regular retained file's length/hash before returning. It cannot accept a caller-created Attachment ID or merely an existing storage path. It does not acquire a new source/bank gate after financial entity locks. Missing/tampered bytes fail closed and no financial entry commits.

Public reads recheck current enabled STAFF/ADMIN and actual accepted metadata. Download opens the retained file safely and validates it using that same file descriptor before returning bytes. The route adds attachment Content-Disposition, no-store and nosniff; no inline preview. No absolute path or storage key becomes a caller-selectable pathname.

The list is needed to recover an upload whose successful response was lost and select already retained evidence. It returns accepted evidence only, with bounded paging and actual lease filtering, without inventing upload command idempotency or automatically deduplicating files. Uploaded evidence remains distinct from the separate financial command journal. A lost upload response never authorizes guessing an evidence ID.

## Internal operation sequence

1. Parse the caller boundary and authenticate current enabled ADMIN before consuming file bytes. Verify the lease exists and its tenant/lease are not demo. Do not add ACTIVE-only upload policy; the financial service separately enforces event eligibility, including ended-lease settlements.
2. Open a dedicated real PostgreSQL connection for the actor's session advisory lock. Prisma pooled query calls cannot impersonate ownership of a session lock across body streaming. Attempt the actor lock non-blockingly; busy admission reads no bytes. Under the held lock, check the rolling ten-minute admission AuditLog count and atomically append the dedicated admission action before reading. An admitted malformed/oversized file consumes its admission. Unauthorized, already-busy or exhausted admission never proceeds to file work. Keep the connection alive through completion and release in finally/connection teardown; fail closed if lock ownership is lost.
3. Stream to an exclusive private OS temporary file with a hard decoded byte cap, abort handling and SHA-256. Validate format from bytes and actual structure before destination publication. Do not trust the client MIME/extension. The normal OS input temporary file can be cleaned after completion; it is not accepted retained evidence.
4. In the acceptance transaction acquire the shared source gate, then the dedicated attachment-publication transaction advisory lock before touching the destination volume. Recheck current ADMIN, lease and same-lease ownership at acceptance. Count actual retained regular bytes, including final orphans and destination partials, under that gate. Reject admission that would exceed 5 GiB before copying.
5. Copy to a private exclusive destination temporary file under the attachment volume, fsync, then publish by atomic rename within an exclusively reserved server-generated destination namespace. Do not use exists-then-rename as an overwrite guarantee, use the original filename as a path, or assume OS tmp and Docker volume share a filesystem. The implementation must guarantee that a second writer cannot overwrite a final accepted key.
6. Only after durable publication, create the existing Attachment with exactly its leaseId owner, the new DepositEvidence reference and the acceptance audit in the same database transaction. Return the persisted DTO only after commit. Recheck unsupported mutations through coordinator-owned SQL guards.
7. Release transaction and actor admission resources on every outcome. If metadata fails after retention, the final file remains an orphan. It is backed up and counted for capacity but never appears as accepted evidence or satisfies posting. Do not unlink accepted files or retained destination partials/orphans automatically.

The persistent admission action can use the existing AuditLog table. Main freezes its exact action name, metadata shape and advisory namespace before implementation; no sixth table is proposed for quota counters. Record only identifiers/attempt metadata, never file bodies or credentials. Rejected/invalid admitted attempts remain counted across process restart.

## Schema and publication dependencies

Main owns the complete five-table migration, names/relations, triggers and exact applied baseline. Evidence implementation directly requires DepositEvidence plus existing Attachment/AuditLog/Lease/User. DepositAccount, DepositEntry, DepositCommand and DepositDocumentCounter are separate consumers, not uploads' arithmetic owners. Their later reference constraints must enforce same-lease accepted evidence and freeze referenced Attachment identity/content/owner/hash/bytes. Preserve all original Attachment and SecurityDeposit data and historical restore registries. Do not hard-code the resulting table count or migration timestamp in this sketch.

Main assigns one attachment-publication key/protocol shared by the app and operations owner. Upload uses source then publication; backup never takes source after publication. The operations owner adds a dedicated acknowledged SESSION lock before the first file inventory and before calling the existing separate read-only exportSnapshot. Hold its connection through dump, copy and final inventory. Keep exportSnapshot's current two-value parser/read-only transaction intact. Unexpected lock-owner loss must abort work and prevent verified publication; release/close in outer finally on inventory/snapshot/dump/copy failures.

The narrow operations interface is `withAttachmentPublicationSession(work)`, where work receives an abort signal and an ownership check. Actual pg_dump/copy execution must honor ownership loss rather than merely check it after successful archive publication. Main assigns the operations files to that owner; the evidence owner does not edit operations/database.mjs, backup.mjs, inventory registries or Compose concurrently.

## Concrete format dependency to resolve before enabling uploads

Installed Main node_modules contains sharp, available for real raster validation, but it is currently transitive. No pdfjs-dist/pdf-lib or other selected structural PDF reader was found. PDFKit is a writer, not an accepted PDF validator. Development-only Poppler/Python availability does not establish a production runtime dependency.

Keep format checking in the private `formats.ts` implementation behind `inspectEvidenceFile(path)`, returning only the validated MIME/byte facts used by retention. It is not a caller-injectable validator. Main must freeze an explicit production-compatible PDF validation dependency and bounded parser resources before uploads are enabled, and promote the selected raster dependency explicitly if used. Check real raster decoding/structure and PDF structure/encryption, reject detected executable/polyglot/malformed input, and never claim malware freedom. This is a concrete dependency assignment, not a competing business design; storage/admission implementation and tests can proceed independently, but PDF acceptance cannot be called complete with a stub.

## Immediate implementation handoff and gates

Once Main supplies the controlled schema baseline, evidence model names, shared advisory protocol and parser dependency owner, implement the above evidence module without ledger/Payment/operations writes. Main separately assigns exact upload/list/download routes and filename metadata transport so UI and backend agree before route code. The service accepts a decoded raw stream; existing readJson's 16 KiB JSON cap must remain unchanged, and a binary file must not become an unbounded JSON/base64 body.

Required first-unit proof is actual stream/file validation, current-role denial, per-actor concurrent admission exclusion, durable rolling limit including failed files, two actors competing for final capacity, exclusive path/symlink handling, disk/DB failure with no accepted metadata, accepted-file tampering denial, lost-response metadata recovery and authenticated downloads. Main executes guarded DB/browser and separate operations publication/restore tests. Review must verify real session-vs-transaction advisory exclusion and backup lock-loss behavior before integration. No test has run for this sketch, and no unimplemented route or schema is represented as ready.
