import { describe, expect, it } from "vitest";
import {
  depositFingerprint,
  depositTotals,
} from "../src/server/deposits/domain";
import {
  receiptDepositInput,
  reviewDepositInput,
} from "../src/server/deposits/contracts";
const id = "00000000-0000-4000-8000-000000000001";
const base = {
  leaseId: id,
  expectedVersion: 0,
  evidenceId: id,
  reason: "Verified synthetic evidence",
  commandKey: "command-0001",
};
describe("managed deposits", () => {
  it("requires exact finite money and method provenance", () => {
    const cash = {
      ...base,
      amount: "1.25",
      occurredAt: "2026-10-01T08:00:00+07:00",
      verified: true,
      method: "CASH",
    };
    expect(receiptDepositInput.parse(cash).occurredAt).toBe(
      "2026-10-01T01:00:00.000Z",
    );
    for (const amount of [
      "NaN",
      "Infinity",
      "1e2",
      "1.234",
      "-1.00",
      "0.00",
      "1000000000000.00",
    ])
      expect(receiptDepositInput.safeParse({ ...cash, amount }).success).toBe(
        false,
      );
    expect(
      receiptDepositInput.safeParse({ ...cash, method: "BANK_TRANSFER" })
        .success,
    ).toBe(false);
    expect(
      receiptDepositInput.safeParse({ ...cash, postedById: id }).success,
    ).toBe(false);
    expect(
      reviewDepositInput.parse({
        ...base,
        openingAmount: "0.00",
        verified: true,
      }).openingAmount,
    ).toBe("0.00");
  });
  it("reports exact gross and net buckets above the individual entry ceiling", () => {
    const rows = [
      { id: "o", kind: "OPENING" as const, amount: "10.00", reverseOfId: null },
      {
        id: "r1",
        kind: "RECEIPT" as const,
        amount: "999999999999.99",
        reverseOfId: null,
      },
      {
        id: "r2",
        kind: "RECEIPT" as const,
        amount: "999999999999.99",
        reverseOfId: null,
      },
      { id: "f", kind: "REFUND" as const, amount: "3.00", reverseOfId: null },
      {
        id: "d",
        kind: "DEDUCTION" as const,
        amount: "1.25",
        reverseOfId: null,
      },
      { id: "vf", kind: "REVERSAL" as const, amount: "3.00", reverseOfId: "f" },
      { id: "vd", kind: "REVERSAL" as const, amount: "1.25", reverseOfId: "d" },
    ];
    expect(depositTotals(rows)).toMatchObject({
      grossReceipts: "1999999999999.98",
      reversedRefunds: "3.00",
      reversedDeductions: "1.25",
      netRefunds: "0.00",
      netDeductions: "0.00",
      heldLiability: "2000000000009.98",
    });
  });
  it("rejects repeated, mismatched and reversal-of-reversal targets", () => {
    const original = {
      id: "r",
      kind: "RECEIPT" as const,
      amount: "1.00",
      reverseOfId: null,
    };
    const reversal = {
      id: "v",
      kind: "REVERSAL" as const,
      amount: "1.00",
      reverseOfId: "r",
    };
    expect(depositTotals([original, reversal]).heldLiability).toBe("0.00");
    expect(() =>
      depositTotals([original, reversal, { ...reversal, id: "v2" }]),
    ).toThrow();
    expect(() =>
      depositTotals([original, { ...reversal, amount: "2.00" }]),
    ).toThrow();
    expect(() =>
      depositTotals([
        original,
        reversal,
        { ...reversal, id: "v2", reverseOfId: "v" },
      ]),
    ).toThrow();
    expect(() => depositTotals([{ ...original, amount: "NaN" }])).toThrow();
  });
  it("canonicalizes source object ordering and preserves provenance differences", () => {
    expect(depositFingerprint({ b: 2, a: 1 })).toBe(
      depositFingerprint({ a: 1, b: 2 }),
    );
    expect(depositFingerprint({ amount: "1.00", isDemo: false })).not.toBe(
      depositFingerprint({ amount: "1.00", isDemo: true }),
    );
  });
});
