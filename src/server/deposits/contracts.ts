import { z } from "zod";
export const depositId = z.uuid().transform((value) => value.toLowerCase());
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        !Array.from(value).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
      "Control characters are not allowed",
    );
export const depositMoney = z.string().regex(/^(?:0|[1-9]\d{0,11})\.\d{2}$/);
export const positiveDepositMoney = depositMoney.refine(
  (value) => value !== "0.00",
  "Amount must be positive",
);
export const depositEntryKind = z.enum([
  "RECEIPT",
  "REFUND",
  "DEDUCTION",
  "REVERSAL",
  "OPENING",
]);
const base = {
  leaseId: depositId,
  expectedVersion: z.number().int().nonnegative(),
  evidenceId: depositId,
  reason: text(1000),
  commandKey: text(100).min(8),
};
const occurrence = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const movement = {
  ...base,
  amount: positiveDepositMoney,
  occurredAt: occurrence,
};
export const reviewDepositInput = z.strictObject({
  ...base,
  openingAmount: depositMoney,
  verified: z.literal(true),
});
export const receiptDepositInput = z.discriminatedUnion("method", [
  z.strictObject({
    ...movement,
    verified: z.literal(true),
    method: z.literal("CASH"),
  }),
  z.strictObject({
    ...movement,
    verified: z.literal(true),
    method: z.literal("BANK_TRANSFER"),
    receivingAccountKey: text(120),
    externalReference: text(120),
  }),
]);
export const refundDepositInput = z.discriminatedUnion("method", [
  z.strictObject({
    ...movement,
    settlementReviewed: z.literal(true),
    method: z.literal("CASH"),
    payeeName: text(200),
  }),
  z.strictObject({
    ...movement,
    settlementReviewed: z.literal(true),
    method: z.literal("BANK_TRANSFER"),
    payeeName: text(200),
    outgoingReference: text(120),
    destination: text(200),
  }),
]);
export const deductionDepositInput = z.strictObject({
  ...movement,
  verified: z.literal(true),
});
export const reversalDepositInput = z.strictObject({
  ...base,
  entryId: depositId,
  occurredAt: occurrence,
  verified: z.literal(true),
});
export const depositLedgerInput = z.strictObject({
  leaseId: depositId,
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
export const depositDocumentInput = z.strictObject({ entryId: depositId });
export const depositSnapshotSchema = z.strictObject({
  format: z.literal("taky.deposit.v1"),
  entryId: depositId,
  leaseId: depositId,
  leaseNumber: z.string(),
  tenantId: depositId,
  tenantName: z.string(),
  roomId: depositId,
  roomNumber: z.string(),
  kind: depositEntryKind,
  amount: positiveDepositMoney,
  occurredAt: z.iso.datetime(),
  postedAt: z.iso.datetime(),
  postedById: depositId,
  postedByName: z.string(),
  reason: z.string(),
  evidenceId: depositId,
  method: z.enum(["CASH", "BANK_TRANSFER"]).nullable(),
  receivingAccountKey: z.string().nullable(),
  externalReference: z.string().nullable(),
  payeeName: z.string().nullable(),
  destination: z.string().nullable(),
  documentNumber: z.string(),
  reverseOfId: depositId.nullable(),
  originalDocumentNumber: z.string().nullable(),
  operatorVerified: z.literal(true),
  legalIssuerVerified: z.literal(false),
});
export type DepositSnapshot = z.infer<typeof depositSnapshotSchema>;
export type DepositEntryKind = z.infer<typeof depositEntryKind>;
export type DepositEntryDto = {
  id: string;
  leaseId: string;
  sequence: number;
  kind: DepositEntryKind;
  amount: string;
  occurredAt: string;
  postedAt: string;
  postedById: string;
  reason: string;
  evidenceId: string;
  method: "CASH" | "BANK_TRANSFER" | null;
  receivingAccountKey: string | null;
  externalReference: string | null;
  payeeName: string | null;
  destination: string | null;
  reverseOfId: string | null;
  documentNumber: string;
  documentSnapshot: DepositSnapshot;
  snapshotSha256: string;
  reversedBy: { id: string; documentNumber: string; postedAt: string } | null;
};
export type DepositTotals = {
  grossReceipts: string;
  grossRefunds: string;
  grossDeductions: string;
  grossOpening: string;
  reversedReceipts: string;
  reversedRefunds: string;
  reversedDeductions: string;
  reversedOpening: string;
  netReceipts: string;
  netRefunds: string;
  netDeductions: string;
  netOpening: string;
  heldLiability: string;
};
export type DepositLedgerDto = {
  leaseId: string;
  contractualRequirement: string;
  account: {
    version: number;
    reviewState: "UNREVIEWED" | "REVIEWED";
    reviewedById: string | null;
    reviewedAt: string | null;
    legacyDigest: string | null;
    reviewReason: string | null;
    evidenceId: string | null;
    openingAmount: string | null;
  };
  unverifiedLegacy: {
    count: number;
    grossReceived: string;
    grossRefunded: string;
    grossDeducted: string;
  };
  items: DepositEntryDto[];
  total: number;
  offset: number;
  limit: number;
  totals: DepositTotals;
  asOfPostedAt: string;
};
export type DepositDocumentDto = DepositEntryDto;
export const depositEntryDtoSchema = z.strictObject({
  id: depositId,
  leaseId: depositId,
  sequence: z.number().int().positive(),
  kind: depositEntryKind,
  amount: positiveDepositMoney,
  occurredAt: z.iso.datetime(),
  postedAt: z.iso.datetime(),
  postedById: depositId,
  reason: z.string(),
  evidenceId: depositId,
  method: z.enum(["CASH", "BANK_TRANSFER"]).nullable(),
  receivingAccountKey: z.string().nullable(),
  externalReference: z.string().nullable(),
  payeeName: z.string().nullable(),
  destination: z.string().nullable(),
  reverseOfId: depositId.nullable(),
  documentNumber: z.string(),
  documentSnapshot: depositSnapshotSchema,
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  reversedBy: z
    .strictObject({
      id: depositId,
      documentNumber: z.string(),
      postedAt: z.iso.datetime(),
    })
    .nullable(),
});
const totalMoney = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/);
export const depositLedgerDtoSchema = z.strictObject({
  leaseId: depositId,
  contractualRequirement: depositMoney,
  account: z.strictObject({
    version: z.number().int().nonnegative(),
    reviewState: z.enum(["UNREVIEWED", "REVIEWED"]),
    reviewedById: depositId.nullable(),
    reviewedAt: z.iso.datetime().nullable(),
    legacyDigest: z.string().nullable(),
    reviewReason: z.string().nullable(),
    evidenceId: depositId.nullable(),
    openingAmount: depositMoney.nullable(),
  }),
  unverifiedLegacy: z.strictObject({
    count: z.number().int().nonnegative(),
    grossReceived: totalMoney,
    grossRefunded: totalMoney,
    grossDeducted: totalMoney,
  }),
  items: z.array(depositEntryDtoSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  totals: z.strictObject({
    grossReceipts: totalMoney,
    grossRefunds: totalMoney,
    grossDeductions: totalMoney,
    grossOpening: totalMoney,
    reversedReceipts: totalMoney,
    reversedRefunds: totalMoney,
    reversedDeductions: totalMoney,
    reversedOpening: totalMoney,
    netReceipts: totalMoney,
    netRefunds: totalMoney,
    netDeductions: totalMoney,
    netOpening: totalMoney,
    heldLiability: totalMoney,
  }),
  asOfPostedAt: z.iso.datetime(),
});
