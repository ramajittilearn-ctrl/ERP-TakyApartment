import { z } from "zod";

export const uuid = z.uuid();
export const meterKind = z.enum(["WATER", "ELECTRICITY"]);
export const readingType = z.enum(["OPENING", "NORMAL"]);
export const readingValue = z
  .string()
  .regex(/^(0|[1-9]\d{0,10})(?:\.\d{1,3})?$/);
const reason = z.string().trim().min(3).max(1000);

export const overviewInput = z.object({
  billingPeriodId: uuid,
  floor: z.coerce.number().int().positive().optional(),
  roomId: uuid.optional(),
});

export const draftInput = z
  .object({
    meterId: uuid,
    billingPeriodId: uuid,
    value: readingValue,
    readingDate: z.iso.date(),
    type: readingType.default("NORMAL"),
  })
  .strict();

export const historyInput = z.object({
  roomId: uuid,
  kind: meterKind.optional(),
});
export const correctionInput = z
  .object({ value: readingValue, reason })
  .strict();
export const replacementInput = z
  .object({
    oldMeterId: uuid,
    newSerial: z.string().trim().min(1).max(80),
    finalReading: readingValue,
    initialReading: readingValue,
    replacementDate: z.iso.date(),
    reason,
  })
  .strict();
export const registrationInput = z
  .object({
    roomId: uuid,
    kind: meterKind,
    serial: z.string().trim().min(1).max(80),
    installedAt: z.iso.date(),
    openingReading: readingValue,
    reason,
  })
  .strict();
