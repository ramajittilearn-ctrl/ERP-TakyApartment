import { z } from "zod";
import { balanceListInput, paymentListInput } from "./contracts";

const integerText = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .transform(Number)
  .refine(Number.isSafeInteger);
function queryValues(params: URLSearchParams, allowed: readonly string[]) {
  const values: Record<string, string | number> = {};
  for (const [key, value] of params) {
    z.literal(true).parse(allowed.includes(key) && !Object.hasOwn(values, key));
    values[key] =
      key === "offset" || key === "limit" ? integerText.parse(value) : value;
  }
  return values;
}
export function parsePaymentListQuery(params: URLSearchParams) {
  return paymentListInput.parse(
    queryValues(params, ["leaseId", "status", "offset", "limit"]),
  );
}
export function parseBalanceListQuery(params: URLSearchParams) {
  return balanceListInput.parse(
    queryValues(params, ["leaseId", "offset", "limit"]),
  );
}
