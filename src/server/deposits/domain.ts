import { createHash } from "node:crypto";
import type { DepositEntryKind, DepositTotals } from "./contracts";
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
export function depositFingerprint(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function depositSatang(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(value)) throw new Error("Invalid exact deposit amount");
  return BigInt(value.replace(".", ""));
}
export function depositFixed(value: bigint): string { const sign = value < 0n ? "-" : ""; const abs = value < 0n ? -value : value; return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`; }
export function depositTotals(rows: { id: string; kind: DepositEntryKind; amount: string; reverseOfId: string | null }[]): DepositTotals {
  const originals = new Map(rows.filter((row) => row.kind !== "REVERSAL").map((row) => [row.id, row]));
  const gross = { RECEIPT: 0n, REFUND: 0n, DEDUCTION: 0n, OPENING: 0n };
  const reversed = { ...gross };
  const targets = new Set<string>();
  for (const row of rows) {
    const amount = depositSatang(row.amount);
    if (amount <= 0n) throw new Error("Deposit entry must be positive");
    if (row.kind !== "REVERSAL") { if (row.reverseOfId !== null) throw new Error("Original entry has reversal target"); gross[row.kind] += amount; continue; }
    const original = row.reverseOfId ? originals.get(row.reverseOfId) : undefined;
    if (!original || original.kind === "REVERSAL" || targets.has(original.id) || original.amount !== row.amount) throw new Error("Invalid deposit reversal target");
    targets.add(original.id); reversed[original.kind] += amount;
  }
  const net = { RECEIPT: gross.RECEIPT - reversed.RECEIPT, REFUND: gross.REFUND - reversed.REFUND, DEDUCTION: gross.DEDUCTION - reversed.DEDUCTION, OPENING: gross.OPENING - reversed.OPENING };
  return { grossReceipts: depositFixed(gross.RECEIPT), grossRefunds: depositFixed(gross.REFUND), grossDeductions: depositFixed(gross.DEDUCTION), grossOpening: depositFixed(gross.OPENING), reversedReceipts: depositFixed(reversed.RECEIPT), reversedRefunds: depositFixed(reversed.REFUND), reversedDeductions: depositFixed(reversed.DEDUCTION), reversedOpening: depositFixed(reversed.OPENING), netReceipts: depositFixed(net.RECEIPT), netRefunds: depositFixed(net.REFUND), netDeductions: depositFixed(net.DEDUCTION), netOpening: depositFixed(net.OPENING), heldLiability: depositFixed(net.OPENING + net.RECEIPT - net.REFUND - net.DEDUCTION) };
}
