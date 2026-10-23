import { z } from "zod";
import { expenseListInput } from "./contracts";
const integer = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/)
  .transform(Number);
export function parseExpenseListQuery(params: URLSearchParams) {
  const data: Record<string, string | number> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(data, key))
      throw new z.ZodError([
        { code: "custom", path: [key], message: "Repeated query parameter" },
      ]);
    data[key] =
      key === "offset" || key === "limit" ? integer.parse(value) : value;
  }
  return expenseListInput.parse(data);
}
