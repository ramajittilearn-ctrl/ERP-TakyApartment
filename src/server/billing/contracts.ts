import { z } from "zod";

const id = z.string().trim().min(1);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");
const quantity = z.string().regex(/^(0|[1-9]\d{0,10})(?:\.\d{1,3})?$/);
export const billingQuantitySchema = quantity;
const rateValue = z.string().regex(/^(0|[1-9]\d{0,9})(?:\.\d{1,4})?$/);
const money = z.string().regex(/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/);
export const utilityKindSchema = z.enum(["WATER", "ELECTRICITY"]);
export const billingApprovalSchema = z.strictObject({
  id,
  approverId: id,
  approverRole: z.string().min(1),
  approvedAt: z.iso.datetime(),
});
export const billingReadingSchema = z.strictObject({
  id,
  version: id,
  propertyId: id,
  roomId: id,
  meterId: id,
  kind: utilityKindSchema,
  billingPeriodId: id.nullable(),
  value: quantity,
  readOn: calendarDate,
  status: z.string().min(1),
});
const reason = z.string().trim().min(1);
const evidence = z.array(z.string().trim().min(1)).min(1);
const actual = z.strictObject({
  kind: z.literal("ACTUAL"),
  previous: billingReadingSchema,
  current: billingReadingSchema,
  quantity,
  selection: z
    .strictObject({ approval: billingApprovalSchema, reason, evidence })
    .optional(),
});
const estimate = z.strictObject({
  kind: z.literal("ESTIMATE"),
  quantity,
  reason,
  evidence,
  sourceContext: reason,
  approval: billingApprovalSchema,
});
const allocatedActual = z.strictObject({
  kind: z.literal("ALLOCATED_ACTUAL"),
  previous: billingReadingSchema,
  current: billingReadingSchema,
  quantity,
  reason,
  evidence,
  approval: billingApprovalSchema,
});
const segmentApproval = {
  meterId: id,
  replacementIds: z.array(id).min(1),
  quantity,
  reason,
  evidence,
  approval: billingApprovalSchema,
};
export const replacementSegmentSchema = z.discriminatedUnion("verification", [
  z.strictObject({
    ...segmentApproval,
    verification: z.literal("READINGS"),
    previous: billingReadingSchema,
    current: billingReadingSchema,
  }),
  z.strictObject({
    ...segmentApproval,
    verification: z.literal("ADMIN_EVIDENCE"),
    sourceReadings: z.array(billingReadingSchema).min(1),
    startsOn: calendarDate,
    endsOn: calendarDate,
  }),
]);
export const billingConsumptionSchema = z.discriminatedUnion("kind", [
  actual,
  allocatedActual,
  estimate,
  z.strictObject({
    kind: z.literal("REPLACEMENT"),
    segments: z.array(replacementSegmentSchema).min(1),
  }),
]);
export const billingRateSchema = z.strictObject({
  id,
  propertyId: id,
  billingPeriodId: id,
  kind: utilityKindSchema,
  value: rateValue,
  effectiveFrom: calendarDate,
  nextEffectiveFrom: calendarDate.nullable(),
  approval: billingApprovalSchema,
});
export const billingValidationIssueSchema = z.strictObject({
  code: z.string().min(1),
  path: z.string(),
  message: z.string().min(1),
});
export const billingCalculationInputSchema = z.strictObject({
  propertyId: id,
  period: z.strictObject({
    id,
    propertyId: id,
    startsOn: calendarDate,
    endsOn: calendarDate,
    status: z.enum(["OPEN", "CLOSED"]),
    version: id,
  }),
  lease: z.strictObject({
    id,
    propertyId: id,
    roomId: id,
    tenantId: id,
    version: id,
    rent: money,
    startsOn: calendarDate,
    endsOn: calendarDate,
  }),
  utilities: z.array(
    z.strictObject({
      kind: utilityKindSchema,
      rate: billingRateSchema.nullable(),
      consumption: billingConsumptionSchema.nullable(),
    }),
  ),
  validationIssues: z.array(billingValidationIssueSchema).default([]),
});
export type BillingCalculationInput = z.infer<
  typeof billingCalculationInputSchema
>;
export type BillingConsumption = z.infer<typeof billingConsumptionSchema>;
export type BillingReading = z.infer<typeof billingReadingSchema>;
export type BillingApproval = z.infer<typeof billingApprovalSchema>;
export type BillingValidationIssue = z.infer<
  typeof billingValidationIssueSchema
>;
export type BillingUtilityKind = z.infer<typeof utilityKindSchema>;

export type ExactAmount = {
  numerator: string;
  denominator: string;
  decimal: string;
};
export type BillingLine = {
  kind: "RENT" | BillingUtilityKind;
  rawAmount: ExactAmount;
  displayAmount: string;
};
export type BillingTotals = {
  rawTotal: ExactAmount;
  finalTotal: string;
  displayLineTotal: string;
  reconciliationDelta: string;
};
export type BillingPreviewSnapshot = {
  snapshotVersion: "3C-2.1";
  purpose: "PREVIEW_ONLY";
  source: BillingCalculationInput;
  rentProration: {
    occupiedStartsOn: string;
    occupiedEndsOn: string;
    occupiedDays: number;
    periodDays: number;
  };
  lines: BillingLine[];
  totals: BillingTotals;
  rounding: {
    mode: "HALF_UP";
    scale: 2;
    aggregation: "SUM_EXACT_RAW_THEN_ROUND_ONCE";
    decimalDisplayPrecision: 80;
  };
  fingerprint: string;
};
type ResultBase = {
  eligibleForFutureIssuance: false;
  futureIssuanceReasons: string[];
  issues: BillingValidationIssue[];
};
export type BillingCalculationResult = ResultBase &
  (
    | {
        status: "INCOMPLETE";
        complete: false;
        readyToClose: false;
        lines: BillingLine[];
        totals: null;
        snapshot: null;
      }
    | {
        status: "COMPLETE";
        complete: true;
        readyToClose: true;
        lines: BillingLine[];
        totals: BillingTotals;
        snapshot: BillingPreviewSnapshot;
      }
  );
