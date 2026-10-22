import { z } from "zod";

export const uuid = z.uuid();
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const rate = z.string().regex(/^(0|[1-9]\d{0,9})(?:\.\d{1,4})?$/);
export const meterKind = z.enum(["WATER", "ELECTRICITY"]);

export const billingPeriodCreateInput = z
  .object({
    propertyId: uuid,
    month,
  })
  .strict();

export const billingPeriodListInput = z.object({ propertyId: uuid });

export const utilityRateCreateInput = z
  .object({
    propertyId: uuid,
    kind: meterKind,
    effectiveFrom: z.iso.date(),
    unitPrice: rate,
  })
  .strict();

export const utilityRateListInput = z.object({
  propertyId: uuid,
  kind: meterKind.optional(),
});

export const utilityRateResolveInput = z
  .object({
    propertyId: uuid,
    kind: meterKind,
    effectiveOn: z.iso.date(),
  })
  .strict();
