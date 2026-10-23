import { z } from "zod";
export const expenseId = z.uuid().transform((v) => v.toLowerCase());
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/[\u0000-\u001f\u007f]/.test(v),
      "Control characters are not allowed",
    );
export const expenseMoney = z.string().regex(/^(?:0|[1-9]\d{0,11})\.\d{2}$/);
const positiveMoney = expenseMoney.refine(
  (v) => /[1-9]/.test(v),
  "Amount must be positive",
);
const commandKey = text(100).min(8);
const reason = text(1000);
export const expenseKind = z.enum(["OPEX", "CAPEX"]);
export const expenseStatus = z.enum([
  "PENDING",
  "POSTED",
  "CANCELLED",
  "REVERSED",
]);
export const createExpenseInput = z.strictObject({
  propertyId: expenseId,
  categoryId: expenseId,
  description: text(200),
  vendor: text(120),
  amount: positiveMoney,
  occurredAt: z.iso.date(),
  method: z.enum(["CASH", "BANK_TRANSFER"]),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
  correctionOfId: expenseId.optional(),
  commandKey,
});
export const postExpenseInput = z.strictObject({
  expenseId,
  expectedVersion: z.number().int().positive(),
  commandKey,
});
export const cancelExpenseInput = postExpenseInput.extend({ reason });
export const reverseExpenseInput = cancelExpenseInput;
export const createExpenseCategoryInput = z.strictObject({
  name: text(100),
  kind: expenseKind,
  commandKey,
});
export const setExpenseCategoryActiveInput = z.strictObject({
  categoryId: expenseId,
  active: z.boolean(),
  expectedVersion: z.number().int().positive(),
  commandKey,
});
export const expenseListInput = z
  .strictObject({
    propertyId: expenseId.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    kind: expenseKind.optional(),
    categoryId: expenseId.optional(),
    status: expenseStatus.optional(),
    query: text(100).optional(),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "Date range is reversed");
export const categoryDtoSchema = z.strictObject({
  id: expenseId,
  name: text(100),
  kind: expenseKind,
  active: z.boolean(),
  version: z.number().int().positive(),
});
const common = {
  id: expenseId,
  propertyId: expenseId,
  categoryId: expenseId,
  description: text(200),
  vendor: text(120),
  amount: positiveMoney,
  occurredAt: z.iso.date(),
  method: z.enum(["CASH", "BANK_TRANSFER"]),
  note: z.string().nullable(),
  categoryName: text(100),
  categoryKind: expenseKind,
  version: z.number().int().positive(),
  possibleDuplicateCount: z.number().int().nonnegative(),
  recordedById: expenseId,
  createdAt: z.iso.datetime(),
  correctionOfId: expenseId.nullable(),
};
const posted = { postedById: expenseId, postedAt: z.iso.datetime() };
export const expenseDtoSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...common, status: z.literal("PENDING") }),
  z.strictObject({ ...common, ...posted, status: z.literal("POSTED") }),
  z.strictObject({
    ...common,
    status: z.literal("CANCELLED"),
    cancelledById: expenseId,
    cancelledAt: z.iso.datetime(),
    cancelReason: reason,
  }),
  z.strictObject({
    ...common,
    ...posted,
    status: z.literal("REVERSED"),
    reversedById: expenseId,
    reversedAt: z.iso.datetime(),
    reverseReason: reason,
  }),
]);
export type ExpenseDto = z.infer<typeof expenseDtoSchema>;
export type CategoryDto = z.infer<typeof categoryDtoSchema>;
export type ExpenseListDto = {
  scope: "managed-only";
  items: ExpenseDto[];
  offset: number;
  limit: number;
  total: number;
  excludedLegacyCount: number;
  totals: { opex: string; capex: string; total: string };
};
