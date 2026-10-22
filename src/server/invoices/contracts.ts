import { z } from "zod";
import {
  billingCalculationInputSchema,
  billingQuantitySchema,
  utilityKindSchema,
} from "../billing/contracts";
export const invoiceId = z.uuid();
const commandKey = z.string().trim().min(8).max(100);
const reason = z.string().trim().min(1).max(1000);
const evidence = z.array(z.string().trim().min(1).max(1000)).min(1).max(20);
export const calendarDate = z.iso.date();
const versioned = {
  invoiceId,
  expectedVersion: z.number().int().min(1),
  commandKey,
};
export const duePolicyInput = z.strictObject({
  propertyId: invoiceId,
  offsetDays: z.number().int().min(0).max(365),
  expectedVersion: z.number().int().min(0),
  commandKey,
});
export const prepareDraftInput = z.strictObject({
  billingPeriodId: invoiceId,
  leaseId: invoiceId,
  commandKey,
});
export const refreshDraftInput = z.strictObject(versioned);
export const updateDraftInput = z.strictObject({
  ...versioned,
  notes: z.string().max(2000).optional(),
  dueOverride: z
    .strictObject({ dueDate: calendarDate, reason })
    .nullable()
    .optional(),
});
export const issueInvoiceInput = z.strictObject(versioned);
export const voidInvoiceInput = z.strictObject({ ...versioned, reason });
export const correctionInput = z
  .strictObject({
    useCurrentContract: z.boolean().default(false),
    utilities: z
      .array(
        z.strictObject({
          kind: utilityKindSchema,
          utilityRateId: invoiceId.optional(),
          quantity: billingQuantitySchema.optional(),
          segmentQuantities: z
            .array(
              z.strictObject({
                meterId: invoiceId,
                quantity: billingQuantitySchema,
              }),
            )
            .min(1)
            .max(20)
            .optional(),
        }),
      )
      .max(2)
      .default([]),
  })
  .refine(
    (v) => v.useCurrentContract || v.utilities.length > 0,
    "Specify a supported correction",
  )
  .refine(
    (v) => new Set(v.utilities.map((u) => u.kind)).size === v.utilities.length,
    "Duplicate utility",
  );
export const reviseInvoiceInput = z.strictObject({
  ...versioned,
  correction: correctionInput,
  reason,
  evidence,
});
export const invoiceListInput = z.strictObject({
  billingPeriodId: invoiceId.optional(),
  roomId: invoiceId.optional(),
  leaseId: invoiceId.optional(),
  status: z.enum(["DRAFT", "ISSUED", "VOID"]).optional(),
});
export const dueProvenanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("POLICY"),
    propertyId: invoiceId,
    version: z.number().int(),
    offsetDays: z.number().int(),
    anchor: calendarDate,
    dueDate: calendarDate,
  }),
  z.strictObject({
    kind: z.literal("OVERRIDE"),
    actorId: invoiceId,
    reason,
    dueDate: calendarDate,
  }),
]);
export type DueProvenance = z.infer<typeof dueProvenanceSchema>;
const exact = z.strictObject({
  numerator: z.string(),
  denominator: z.string(),
  decimal: z.string(),
});
const totals = z.strictObject({
  rawTotal: exact,
  finalTotal: z.string(),
  displayLineTotal: z.string(),
  reconciliationDelta: z.string(),
});
export const invoiceSnapshotSchema = z.strictObject({
  snapshotVersion: z.literal("3C-2.1"),
  purpose: z.literal("PREVIEW_ONLY"),
  source: billingCalculationInputSchema,
  rentProration: z.strictObject({
    occupiedStartsOn: calendarDate,
    occupiedEndsOn: calendarDate,
    occupiedDays: z.number().int(),
    periodDays: z.number().int(),
  }),
  lines: z.array(
    z.strictObject({
      kind: z.enum(["RENT", "WATER", "ELECTRICITY"]),
      rawAmount: exact,
      displayAmount: z.string(),
    }),
  ),
  totals,
  rounding: z.strictObject({
    mode: z.literal("HALF_UP"),
    scale: z.literal(2),
    aggregation: z.literal("SUM_EXACT_RAW_THEN_ROUND_ONCE"),
    decimalDisplayPrecision: z.literal(80),
  }),
  fingerprint: z.string().length(64),
});
export const invoiceLabelsSchema = z.strictObject({
  property: z.string(),
  propertyAddress: z.string().optional(),
  room: z.string(),
  tenant: z.string(),
  leaseNumber: z.string().optional(),
});
export const invoiceDtoSchema = z.strictObject({
  id: invoiceId,
  number: z.string().nullable(),
  leaseId: invoiceId,
  billingPeriodId: invoiceId.nullable(),
  frozenLeaseId: invoiceId.nullable(),
  period: calendarDate,
  dueDate: calendarDate.nullable(),
  dueProvenance: dueProvenanceSchema.nullable(),
  status: z.enum(["DRAFT", "ISSUED", "VOID"]),
  revision: z.number().int(),
  version: z.number().int(),
  finalTotal: z.string().nullable(),
  notes: z.string(),
  fingerprint: z.string().nullable(),
  previousInvoiceId: invoiceId.nullable(),
  nextInvoiceId: invoiceId.nullable(),
  issuedAt: z.iso.datetime().nullable(),
  issuedById: invoiceId.nullable(),
  voidedAt: z.iso.datetime().nullable(),
  voidedById: invoiceId.nullable(),
  voidReason: z.string().nullable(),
  managed: z.boolean(),
  labels: invoiceLabelsSchema.nullable(),
  snapshot: invoiceSnapshotSchema.nullable(),
  correction: z
    .strictObject({
      id: invoiceId,
      reason: z.string(),
      evidence: z.array(z.string()),
      approvedById: invoiceId,
      approvedAt: z.iso.datetime(),
      differences: z.unknown(),
    })
    .nullable(),
});
export type InvoiceDto = z.infer<typeof invoiceDtoSchema>;
export const invoiceOptionsSchema = z.strictObject({
  properties: z.array(
    z.strictObject({
      id: invoiceId,
      name: z.string(),
      duePolicy: z
        .strictObject({
          offsetDays: z.number().int(),
          version: z.number().int(),
        })
        .nullable(),
    }),
  ),
  periods: z.array(
    z.strictObject({
      id: invoiceId,
      propertyId: invoiceId,
      startsOn: calendarDate,
      endsOn: calendarDate,
      status: z.enum(["OPEN", "CLOSED"]),
      freezeId: invoiceId.nullable(),
      candidates: z.array(
        z.strictObject({
          leaseId: invoiceId,
          roomId: invoiceId,
          room: z.string(),
          tenant: z.string(),
        }),
      ),
    }),
  ),
  rates: z.array(
    z.strictObject({
      id: invoiceId,
      propertyId: invoiceId,
      kind: utilityKindSchema,
      value: z.string(),
      effectiveFrom: calendarDate,
      nextEffectiveFrom: calendarDate.nullable(),
    }),
  ),
});
export type InvoiceOptions = z.infer<typeof invoiceOptionsSchema>;

export const duePolicyDtoSchema = z.strictObject({
  propertyId: invoiceId,
  offsetDays: z.number().int().min(0).max(365),
  version: z.number().int().min(1),
});
