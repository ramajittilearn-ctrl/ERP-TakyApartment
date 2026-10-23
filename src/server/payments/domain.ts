import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "../errors";
import {
  paymentMoney,
  receiptSnapshotSchema,
  type ReceiptSnapshot,
} from "./contracts";
export function fingerprint(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, canonical(x)]),
      );
    return v;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function money(value: string): Prisma.Decimal {
  return new Prisma.Decimal(paymentMoney.parse(value));
}
export function outstanding(
  total: string,
  paid: string,
  status: "ISSUED" | "VOID",
): string {
  const result = money(total).minus(money(paid));
  if (result.isNegative())
    throw new AppError(
      409,
      "ALLOCATION_EXCEEDS_BALANCE",
      "Payments exceed invoice total",
    );
  return status === "VOID" ? "0.00" : result.toFixed(2);
}
export function bangkokDay(date: Date): string {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
export function receiptMonth(date: Date): string {
  return bangkokDay(date).slice(0, 7).replace("-", "");
}
export function receiptNumber(month: string, value: number): string {
  if (
    !/^\d{4}(0[1-9]|1[0-2])$/.test(month) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 9999
  )
    throw new AppError(
      409,
      "RECEIPT_SEQUENCE_EXHAUSTED",
      "Receipt sequence unavailable",
    );
  return `REC-${month}-${String(value).padStart(4, "0")}`;
}
export function verifiedReceipt(
  value: unknown,
  expected: string,
): ReceiptSnapshot {
  const parsed = receiptSnapshotSchema.safeParse(value);
  if (!parsed.success || fingerprint(parsed.data) !== expected)
    throw new AppError(
      409,
      "RECEIPT_SNAPSHOT_MISMATCH",
      "Receipt snapshot integrity check failed",
    );
  return parsed.data;
}
