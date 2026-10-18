import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().datetime();
const actor = z.object({
  id: z.uuid(),
  name: z.string(),
  username: z.string(),
});

export const readingSchema = z.object({
  id: z.uuid(),
  value: z.string(),
  consumption: z.string().nullable(),
  readingDate: date,
  status: z.enum(["DRAFT", "CONFIRMED"]),
  type: z.enum(["OPENING", "NORMAL", "FINAL"]),
  recordedBy: actor,
  confirmedBy: actor.nullable(),
  confirmedAt: timestamp.nullable(),
});

const meterSlotSchema = z.object({
  meterId: z.uuid().nullable(),
  kind: z.enum(["WATER", "ELECTRICITY"]),
  serial: z.string().nullable(),
  previousReading: z
    .object({ id: z.uuid(), value: z.string(), readingDate: date })
    .nullable(),
  reading: readingSchema.nullable(),
});

export const overviewSchema = z.object({
  billingPeriod: z.object({
    id: z.uuid(),
    propertyId: z.uuid(),
    startsOn: date,
    endsOn: date,
    status: z.enum(["OPEN", "CLOSED"]),
  }),
  summary: z.object({
    rooms: z.number().int(),
    totalSlots: z.number().int(),
    missing: z.number().int(),
    draft: z.number().int(),
    confirmed: z.number().int(),
  }),
  rooms: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      floor: z.object({
        id: z.uuid(),
        number: z.number().int(),
        name: z.string(),
      }),
      meters: z.array(meterSlotSchema).length(2),
    }),
  ),
});

export const historySchema = z.object({
  readings: z.array(
    readingSchema.extend({
      kind: z.enum(["WATER", "ELECTRICITY"]),
      serial: z.string(),
    }),
  ),
  corrections: z.array(
    z.object({
      id: z.uuid(),
      readingId: z.uuid(),
      readingDate: date,
      oldValue: z.string(),
      newValue: z.string(),
      oldConsumption: z.string().nullable(),
      newConsumption: z.string().nullable(),
      reason: z.string(),
      correctedBy: actor,
      createdAt: timestamp,
    }),
  ),
  replacements: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["WATER", "ELECTRICITY"]),
      oldMeter: z.object({ id: z.uuid(), serial: z.string() }),
      newMeter: z.object({ id: z.uuid(), serial: z.string() }),
      finalReadingId: z.uuid(),
      initialReadingId: z.uuid(),
      replacementDate: date,
      reason: z.string(),
      replacedBy: actor,
      createdAt: timestamp,
    }),
  ),
});

export type MeterOverview = z.infer<typeof overviewSchema>;
export type MeterRoom = MeterOverview["rooms"][number];
export type MeterSlot = MeterRoom["meters"][number];
export type Reading = z.infer<typeof readingSchema>;
export type MeterHistory = z.infer<typeof historySchema>;
