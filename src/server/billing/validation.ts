import { z } from "zod";
import { utilityKindSchema } from "./contracts";

export const billingId = z.uuid();
const reason = z.string().trim().min(3).max(1000);
const quantity = z.string().regex(/^(0|[1-9]\d{0,10})(?:\.\d{1,3})?$/);
const day = z.iso.date();
const evidence = z.array(z.string().trim().min(1).max(500)).min(1).max(20);
export const previewInput = z.strictObject({ billingPeriodId: billingId });
export const rateSelectionInput = z.strictObject({
  billingPeriodId: billingId,
  kind: utilityKindSchema,
  utilityRateId: billingId,
  reason,
});
const segment = z.discriminatedUnion("verification", [
  z.strictObject({
    verification: z.literal("READINGS"),
    currentReadingId: billingId,
    quantity,
  }),
  z.strictObject({
    verification: z.literal("ADMIN_EVIDENCE"),
    meterId: billingId,
    sourceReadingIds: z.array(billingId).min(1).max(20),
    startsOn: day,
    endsOn: day,
    quantity,
  }),
]);
export const consumptionApprovalInput = z.strictObject({
  billingPeriodId: billingId,
  leaseId: billingId,
  kind: utilityKindSchema,
  reason,
  evidence,
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("ACTUAL"),
      currentReadingId: billingId,
    }),
    z.strictObject({
      kind: z.literal("ALLOCATED_ACTUAL"),
      currentReadingId: billingId,
      quantity,
    }),
    z.strictObject({
      kind: z.literal("ESTIMATE"),
      quantity,
      sourceContext: reason,
    }),
    z.strictObject({
      kind: z.literal("REPLACEMENT"),
      segments: z.array(segment).min(2).max(20),
    }),
  ]),
});
