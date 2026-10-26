import { z } from "zod";
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_PUBLICATION_KEY = 73422195;
export const EVIDENCE_ADMISSION_ACTION = "DEPOSIT_EVIDENCE_ADMISSION";
export const evidenceId = z.uuid().transform((value) => value.toLowerCase());
export const evidenceMime = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
export type EvidenceMime = z.infer<typeof evidenceMime>;
export const evidenceDtoSchema = z.strictObject({
  id: evidenceId,
  leaseId: evidenceId,
  originalName: z.string().min(1).max(200),
  mimeType: evidenceMime,
  bytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uploadedById: evidenceId,
  acceptedAt: z.iso.datetime(),
});
export type DepositEvidenceDto = z.infer<typeof evidenceDtoSchema>;
export const uploadMetadata = z.strictObject({
  leaseId: evidenceId,
  originalName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(
      (value) => !/[\\/\p{Cc}]/u.test(value) && value !== "." && value !== "..",
      "Invalid evidence filename",
    ),
  declaredMimeType: z.string().trim().min(1).max(100),
});
export const evidenceListQuery = z.strictObject({
  leaseId: evidenceId,
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
const positive = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
export function readEvidenceLimits() {
  const maxFileBytes = positive.parse(
    process.env.DEPOSIT_EVIDENCE_MAX_BYTES ?? String(MAX_EVIDENCE_BYTES),
  );
  if (maxFileBytes > MAX_EVIDENCE_BYTES)
    throw new Error("Evidence file limit cannot exceed 5 MiB");
  return {
    maxFileBytes,
    maxAttempts: positive.parse(
      process.env.DEPOSIT_EVIDENCE_MAX_ATTEMPTS ?? "10",
    ),
    windowMilliseconds: 10 * 60 * 1000,
    maxRetainedBytes: BigInt(
      positive.parse(
        process.env.DEPOSIT_EVIDENCE_MAX_RETAINED_BYTES ??
          String(5 * 1024 ** 3),
      ),
    ),
  };
}
export type EvidenceLimits = ReturnType<typeof readEvidenceLimits>;
