import { createHash } from "node:crypto";
import type { ExpenseDto } from "./contracts";
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export function expenseFingerprint(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function expenseTotals(
  rows: Pick<ExpenseDto, "amount" | "categoryKind" | "status">[],
) {
  let opex = 0n,
    capex = 0n;
  for (const row of rows)
    if (row.status === "POSTED") {
      const satang = BigInt(row.amount.replace(".", ""));
      if (row.categoryKind === "OPEX") opex += satang;
      else capex += satang;
    }
  const fixed = (v: bigint) =>
    `${v / 100n}.${(v % 100n).toString().padStart(2, "0")}`;
  return { opex: fixed(opex), capex: fixed(capex), total: fixed(opex + capex) };
}
