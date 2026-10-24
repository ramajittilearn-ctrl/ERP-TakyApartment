import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { expenseListInput, expenseExportInput } from "./contracts";
const integer = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/)
  .transform(Number);
function uniqueQuery(params: URLSearchParams) {
  const keys = new Set<string>();
  for (const [key] of params) {
    if (keys.has(key))
      throw new z.ZodError([
        { code: "custom", path: [key], message: "Repeated query parameter" },
      ]);
    keys.add(key);
  }
  return Object.fromEntries(params);
}
export function parseExpenseListQuery(params: URLSearchParams) {
  const entries = Object.entries(uniqueQuery(params)).map(([key, value]) => [
    key,
    key === "offset" || key === "limit" ? integer.parse(value) : value,
  ]);
  return expenseListInput.parse(Object.fromEntries(entries));
}
export function parseExpenseExportQuery(params: URLSearchParams) {
  return expenseExportInput.parse(uniqueQuery(params));
}
export function expenseWhere(
  data: z.infer<typeof expenseExportInput>,
): Prisma.ExpenseWhereInput {
  return {
    legacyUnmapped: false,
    isDemo: false,
    propertyId: data.propertyId,
    categoryId: data.categoryId,
    categoryKindSnapshot: data.kind,
    status: data.status,
    occurredAt: {
      ...(data.from ? { gte: new Date(data.from + "T00:00:00Z") } : {}),
      ...(data.to ? { lte: new Date(data.to + "T00:00:00Z") } : {}),
    },
    ...(data.query
      ? {
          OR: [
            { description: { contains: data.query, mode: "insensitive" } },
            { vendor: { contains: data.query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}
