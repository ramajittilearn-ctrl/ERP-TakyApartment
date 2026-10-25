import { Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import { acquireSourceGate } from "../invoices/gate";
import {
  ATTACHMENT_PUBLICATION_KEY,
  evidenceDtoSchema,
  evidenceId,
  evidenceMime,
  evidenceListQuery,
  readEvidenceLimits,
  uploadMetadata,
  type DepositEvidenceDto,
} from "./contracts";
import { withEvidenceAdmission } from "./admission";
import { validateStagedEvidence } from "./formats";
import {
  discardStagedEvidence,
  privateAttachmentRoot,
  readVerifiedFile,
  retainEvidenceUnderGate,
  stageEvidence,
} from "./storage";

type EvidenceRow = Prisma.DepositEvidenceGetPayload<{
  include: { attachment: true };
}>;
async function authorize(
  tx: Pick<Prisma.TransactionClient, "user">,
  actor: Actor,
  admin = false,
) {
  const current = await tx.user.findUnique({ where: { id: actor.id } });
  if (
    !current ||
    current.disabled ||
    current.role !== actor.role ||
    (admin && current.role !== "ADMIN")
  )
    throw new AppError(
      403,
      "FORBIDDEN",
      "ไม่มีสิทธิ์ดำเนินการกับหลักฐานเงินประกัน",
    );
}
async function leaseExists(
  tx: Pick<Prisma.TransactionClient, "lease">,
  leaseId: string,
) {
  const lease = await tx.lease.findUnique({
    where: { id: leaseId },
    include: { tenant: true },
  });
  if (!lease || lease.isDemo || lease.tenant.isDemo)
    throw new AppError(
      404,
      "LEASE_NOT_FOUND",
      "ไม่พบสัญญาเช่าที่ใช้หลักฐานได้",
    );
}
function dto(row: EvidenceRow): DepositEvidenceDto {
  return evidenceDtoSchema.parse({
    id: row.id,
    leaseId: row.leaseId,
    uploadedById: row.uploadedById,
    acceptedAt: row.acceptedAt.toISOString(),
    originalName: row.attachment.originalName,
    mimeType: row.attachment.mimeType,
    bytes: Number(row.attachment.bytes),
    sha256: row.attachment.sha256,
  });
}
async function attachmentRoot() {
  const root = process.env.ATTACHMENT_DIR;
  if (!root)
    throw new AppError(
      503,
      "EVIDENCE_STORAGE_CONFIGURATION",
      "พื้นที่เก็บหลักฐานส่วนตัวยังไม่พร้อม",
    );
  return privateAttachmentRoot(root);
}
async function readRetained(row: EvidenceRow) {
  dto(row);
  if (
    row.attachment.leaseId !== row.leaseId ||
    row.attachment.tenantId ||
    row.attachment.paymentId ||
    row.attachment.expenseId ||
    row.attachment.uploadedById !== row.uploadedById
  )
    throw new AppError(
      409,
      "EVIDENCE_FILE_INVALID",
      "เจ้าของหลักฐานไม่ตรงกับข้อมูลที่บันทึก",
    );
  const root = await attachmentRoot();
  try {
    return await readVerifiedFile(root, row.attachment.storageKey, {
      bytes: Number(row.attachment.bytes),
      sha256: row.attachment.sha256,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      409,
      "EVIDENCE_FILE_INVALID",
      "ไม่พบไฟล์หลักฐานที่รับไว้หรือไม่สามารถตรวจสอบไฟล์ได้",
    );
  }
}
export async function uploadDepositEvidence(input: {
  actor: Actor;
  metadata: unknown;
  body: ReadableStream<Uint8Array>;
  signal?: AbortSignal;
}): Promise<DepositEvidenceDto> {
  if (input.actor.role !== "ADMIN")
    throw new AppError(403, "FORBIDDEN", "เฉพาะผู้ดูแลระบบเท่านั้น");
  const metadata = uploadMetadata.parse(input.metadata);
  if (!evidenceMime.safeParse(metadata.declaredMimeType).success)
    throw new AppError(415, "EVIDENCE_TYPE", "รองรับเฉพาะ PDF JPEG และ PNG");
  const limits = readEvidenceLimits();
  return withEvidenceAdmission(
    {
      actor: input.actor,
      leaseId: metadata.leaseId,
      limits,
      signal: input.signal,
    },
    async (admission) => {
      const stagingSignal = AbortSignal.any([
        admission.signal,
        AbortSignal.timeout(30000),
      ]);
      const staged = await stageEvidence(
        input.body,
        limits.maxFileBytes,
        stagingSignal,
      );
      try {
        const inspected = await validateStagedEvidence(
          staged,
          metadata.declaredMimeType,
          admission.signal,
        );
        const root = await attachmentRoot();
        return await db.$transaction(
          async (tx) => {
            await acquireSourceGate(tx);
            const locks = await tx.$queryRaw<
              { acquired: boolean }[]
            >`SELECT pg_try_advisory_xact_lock(${ATTACHMENT_PUBLICATION_KEY}) AS acquired`;
            if (locks[0]?.acquired !== true)
              throw new AppError(
                409,
                "EVIDENCE_PUBLICATION_BUSY",
                "กำลังสำรองหรือรับหลักฐาน กรุณาลองใหม่ภายหลัง",
              );
            admission.assertHeld();
            admission.signal.throwIfAborted();
            await authorize(tx, input.actor, true);
            await leaseExists(tx, metadata.leaseId);
            const retained = await retainEvidenceUnderGate(
              root,
              staged,
              limits.maxRetainedBytes,
              admission.signal,
            );
            admission.assertHeld();
            admission.signal.throwIfAborted();
            const attachment = await tx.attachment.create({
              data: {
                ...retained,
                originalName: metadata.originalName,
                mimeType: inspected.mimeType,
                bytes: BigInt(retained.bytes),
                uploadedById: input.actor.id,
                leaseId: metadata.leaseId,
              },
            });
            const evidence = await tx.depositEvidence.create({
              data: {
                leaseId: metadata.leaseId,
                attachmentId: attachment.id,
                uploadedById: input.actor.id,
              },
              include: { attachment: true },
            });
            await tx.auditLog.create({
              data: {
                actorId: input.actor.id,
                action: "DEPOSIT_EVIDENCE_ACCEPTED",
                entity: "deposit-evidence",
                entityId: evidence.id,
                metadata: {
                  leaseId: metadata.leaseId,
                  evidenceId: evidence.id,
                  attachmentId: attachment.id,
                  attemptId: admission.attemptId,
                },
              },
            });
            admission.assertHeld();
            admission.signal.throwIfAborted();
            return dto(evidence);
          },
          { timeout: 10000 },
        );
      } finally {
        await discardStagedEvidence(staged);
      }
    },
  );
}
export async function listDepositEvidence(actor: Actor, input: unknown) {
  const query = evidenceListQuery.parse(input);
  return db.$transaction(
    async (tx) => {
      await authorize(tx, actor);
      await leaseExists(tx, query.leaseId);
      const where = { leaseId: query.leaseId };
      const total = await tx.depositEvidence.count({ where });
      const rows = await tx.depositEvidence.findMany({
        where,
        include: { attachment: true },
        orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
        skip: query.offset,
        take: query.limit,
      });
      return {
        items: rows.map(dto),
        total,
        offset: query.offset,
        limit: query.limit,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function getDepositEvidenceDownload(actor: Actor, rawId: unknown) {
  const id = evidenceId.parse(rawId);
  const result = await db.$transaction(
    async (tx) => {
      await authorize(tx, actor);
      const row = await tx.depositEvidence.findUnique({
        where: { id },
        include: { attachment: true },
      });
      if (!row)
        throw new AppError(404, "EVIDENCE_NOT_FOUND", "ไม่พบหลักฐานเงินประกัน");
      await leaseExists(tx, row.leaseId);
      const bytes = await readRetained(row);
      return { metadata: dto(row), bytes };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    metadata: result.metadata,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(result.bytes));
        controller.close();
      },
    }),
  };
}
export async function lockAndVerifyDepositEvidence(
  tx: Prisma.TransactionClient,
  reference: { leaseId: string; evidenceId: string },
) {
  const leaseId = evidenceId.parse(reference.leaseId),
    id = evidenceId.parse(reference.evidenceId);
  await tx.$queryRaw`SELECT id FROM "DepositEvidence" WHERE id=${id}::uuid AND "leaseId"=${leaseId}::uuid FOR UPDATE`;
  const row = await tx.depositEvidence.findUnique({
    where: { id },
    include: { attachment: true },
  });
  if (!row || row.leaseId !== leaseId)
    throw new AppError(
      409,
      "EVIDENCE_NOT_FOUND",
      "ต้องใช้หลักฐานที่รับไว้สำหรับสัญญานี้",
    );
  await tx.$queryRaw`SELECT id FROM "Attachment" WHERE id=${row.attachmentId}::uuid FOR UPDATE`;
  await readRetained(row);
  return { evidenceId: row.id, attachmentId: row.attachmentId };
}
