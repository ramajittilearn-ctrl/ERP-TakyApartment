import { z } from "zod";
import { invoiceLabelsSchema } from "../invoices/contracts";
export const paymentMoney = z.string().regex(/^(?:0|[1-9]\d{0,11})\.\d{2}$/);
export const positivePaymentMoney = paymentMoney.refine(
  (v) => /[1-9]/.test(v),
  "Amount must be positive",
);
const id = z.uuid().transform((value) => value.toLowerCase());
const commandKey = z.string().trim().min(8).max(100);
const reason = z.string().trim().min(1).max(1000);
export const paymentMethodSchema = z.enum(["CASH", "BANK_TRANSFER"]);
export const createPaymentInput = z
  .strictObject({
    leaseId: id,
    amount: positivePaymentMoney,
    method: paymentMethodSchema,
    receivedAt: z.iso.datetime({ offset: true }),
    externalReference: z.string().trim().min(1).max(120).optional(),
    receivingAccountKey: z.string().trim().min(1).max(80).optional(),
    commandKey,
  })
  .superRefine((v, ctx) => {
    if (
      v.method === "BANK_TRANSFER" &&
      (!v.externalReference || !v.receivingAccountKey)
    )
      ctx.addIssue({
        code: "custom",
        message: "Bank reference and receiving account are required",
      });
    if (
      v.method === "CASH" &&
      (v.externalReference !== undefined || v.receivingAccountKey !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Cash cannot have bank identity",
      });
  });
const versioned = {
  paymentId: id,
  expectedVersion: z.number().int().positive(),
  commandKey,
};
export const confirmPaymentInput = z
  .strictObject({
    ...versioned,
    allocations: z
      .array(
        z.strictObject({
          invoiceId: id,
          expectedVersion: z.number().int().positive(),
          amount: positivePaymentMoney,
        }),
      )
      .min(1)
      .max(100),
    duplicateOverrideReason: reason.optional(),
  })
  .refine(
    (v) =>
      new Set(v.allocations.map((a) => a.invoiceId)).size ===
      v.allocations.length,
    "Duplicate invoice",
  );
export const cancelPaymentInput = z.strictObject({ ...versioned, reason });
export const paymentListInput = z.strictObject({
  leaseId: id.optional(),
  status: z.enum(["PENDING", "CONFIRMED", "REVERSED", "CANCELLED"]).optional(),
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
export const balanceListInput = z.strictObject({
  leaseId: id.optional(),
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});
const timestamp = z.iso.datetime();
export const receiptSnapshotSchema = z.strictObject({
  schemaVersion: z.literal("receipt.v1"),
  paymentId: id,
  reference: z.string(),
  amount: positivePaymentMoney,
  method: paymentMethodSchema,
  receivedAt: timestamp,
  externalReference: z.string().nullable(),
  issuedAt: timestamp,
  issuedBy: z.strictObject({ id, name: z.string() }),
  number: z.string().regex(/^REC-\d{6}-\d{4}$/),
  invoices: z
    .array(
      z.strictObject({
        invoiceId: id,
        number: z.string(),
        frozenLeaseId: id,
        frozenTenantId: id,
        labels: invoiceLabelsSchema,
        finalTotal: paymentMoney,
        allocatedAmount: positivePaymentMoney,
      }),
    )
    .min(1)
    .max(100),
});
export const paymentDtoSchema = z.strictObject({
  id,
  reference: z.string(),
  leaseId: id,
  amount: positivePaymentMoney,
  method: paymentMethodSchema,
  status: z.enum(["PENDING", "CONFIRMED", "REVERSED", "CANCELLED"]),
  version: z.number().int().positive(),
  receivedAt: timestamp,
  createdAt: timestamp,
  recordedById: id,
  confirmedAt: timestamp.nullable(),
  confirmedById: id.nullable(),
  cancelledAt: timestamp.nullable(),
  cancelledById: id.nullable(),
  cancelReason: z.string().nullable(),
  externalReference: z.string().nullable(),
  receivingAccountKey: z.string().nullable(),
  allocations: z.array(
    z.strictObject({ invoiceId: id, amount: positivePaymentMoney }),
  ),
  receipt: z.strictObject({ id, number: z.string() }).nullable(),
  reversal: z
    .strictObject({ id, reason: z.string(), actorId: id, createdAt: timestamp })
    .nullable(),
});
export const receiptDtoSchema = z.strictObject({
  id,
  number: z.string(),
  paymentId: id,
  fingerprint: z.string().length(64),
  snapshot: receiptSnapshotSchema,
  cancellation: z
    .strictObject({
      id,
      reversalId: id,
      reason: z.string(),
      actorId: id,
      createdAt: timestamp,
    })
    .nullable(),
});
export const balanceDtoSchema = z.strictObject({
  invoiceId: id,
  number: z.string(),
  leaseId: id,
  frozenTenantId: id,
  labels: invoiceLabelsSchema,
  dueDate: z.iso.date(),
  status: z.enum(["ISSUED", "VOID"]),
  finalTotal: paymentMoney,
  activePaid: paymentMoney,
  outstanding: paymentMoney,
});
export type PaymentDto = z.infer<typeof paymentDtoSchema>;
export type ReceiptDto = z.infer<typeof receiptDtoSchema>;
export type BalanceDto = z.infer<typeof balanceDtoSchema>;
export type PaymentListDto = {
  scope: "managed-only";
  items: PaymentDto[];
  offset: number;
  limit: number;
};
export type BalanceListDto = {
  scope: "managed-only";
  items: BalanceDto[];
  offset: number;
  limit: number;
};
export type ReceiptSnapshot = z.infer<typeof receiptSnapshotSchema>;
