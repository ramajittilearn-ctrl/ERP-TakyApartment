import { z } from "zod";
export const uuid = z.uuid();
export const moneyInput = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/,
    "จำนวนเงินต้องไม่ติดลบ และมีทศนิยมไม่เกิน 2 ตำแหน่ง",
  );
const text = (max: number) => z.string().trim().max(max);
export const propertyInput = z
  .object({
    code: text(40)
      .min(1)
      .regex(/^[A-Za-z0-9_-]+$/),
    name: text(160).min(1),
    address: text(500).default(""),
  })
  .strict();
export const floorInput = z
  .object({
    propertyId: uuid,
    number: z.number().int().min(1).max(99),
    name: text(80).min(1),
  })
  .strict();
export const roomInput = z
  .object({
    floorId: uuid,
    number: text(12).regex(/^[A-Za-z0-9-]+$/),
    rent: moneyInput,
    status: z.enum(["AVAILABLE", "RESERVED", "MAINTENANCE"]),
    notes: text(1000).default(""),
  })
  .strict();
export const assignmentInput = z
  .object({
    leaseId: uuid.optional(),
    roomId: uuid,
    number: text(40).min(1),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    rent: moneyInput,
    deposit: moneyInput,
    previousEndDate: z.iso.date().optional(),
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, {
    message: "วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มสัญญา",
    path: ["endDate"],
  });
export const tenantInput = z
  .object({
    name: text(160).min(1),
    phone: text(40).regex(/^[+\d ()-]*$/),
    email: z.union([z.email().max(254), z.literal("")]),
    address: text(500).default(""),
    notes: text(1000).default(""),
    isDemo: z.boolean().default(false),
    assignment: assignmentInput.optional(),
  })
  .strict();
const calendarDate = z.iso.date();
export const leaseInput = z
  .object({
    number: text(40).min(1),
    roomId: uuid,
    tenantId: uuid,
    startDate: calendarDate,
    endDate: calendarDate,
    rent: moneyInput,
    deposit: moneyInput,
    status: z.enum(["DRAFT", "ACTIVE", "ENDED", "CANCELLED"]),
    isDemo: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, {
    message: "วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มสัญญา",
    path: ["endDate"],
  });
export const loginInput = z
  .object({
    identifier: text(254)
      .min(1)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export const userInput = z
  .object({
    username: text(80)
      .min(3)
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .transform((v) => v.toLowerCase()),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    name: text(160).min(1),
    password: z.string().min(12).max(128),
    role: z.enum(["ADMIN", "STAFF"]),
  })
  .strict();
export const resourceInput = z.enum([
  "properties",
  "floors",
  "rooms",
  "tenants",
  "leases",
]);
export type Resource = z.infer<typeof resourceInput>;
