import { describe, expect, it } from "vitest";
import {
  createExpenseInput,
  expenseDtoSchema,
  createExpenseCategoryInput,
  expenseListInput,
} from "../src/server/expenses/contracts";
import {
  expenseTotals,
  expenseFingerprint,
} from "../src/server/expenses/domain";
import { parseExpenseListQuery } from "../src/server/expenses/query";
const id = "abcd1234-1234-4123-8123-123456789abc";
const input = {
  propertyId: id,
  categoryId: id,
  description: "Repair",
  vendor: "Synthetic vendor",
  amount: "1234.56",
  occurredAt: "2026-10-24",
  method: "CASH",
  commandKey: "synthetic-key",
};
describe("expense contracts and exact ledger totals", () => {
  it("normalizes UUID/text and preserves exact money and date", () => {
    expect(
      createExpenseInput.parse({
        ...input,
        propertyId: id.toUpperCase(),
        description: " Repair ",
        note: " ",
      }),
    ).toEqual({ ...input, note: null });
  });
  it.each([
    "0.00",
    "-1.00",
    "1.001",
    "1e3",
    "01.00",
    "1000000000000.00",
    "NaN",
  ])("rejects malformed/nonpositive amount %s", (amount) => {
    expect(createExpenseInput.safeParse({ ...input, amount }).success).toBe(
      false,
    );
  });
  it("canonicalizes omitted, null and blank note identically before fingerprinting", () => {
    const omitted = createExpenseInput.parse(input);
    expect(omitted.note).toBe(null);
    for (const note of [null, "", " "]) {
      const parsed = createExpenseInput.parse({ ...input, note });
      expect(parsed).toEqual(omitted);
      expect(expenseFingerprint(parsed)).toBe(expenseFingerprint(omitted));
    }
  });
  it("accepts the exact database amount maximum", () => {
    expect(
      createExpenseInput.parse({ ...input, amount: "999999999999.99" }).amount,
    ).toBe("999999999999.99");
  });
  it.each(["2026-02-29", "2026-13-01", "2026-04-31", "2026-10-24T00:00:00Z"])(
    "rejects invalid date %s",
    (occurredAt) => {
      expect(
        createExpenseInput.safeParse({ ...input, occurredAt }).success,
      ).toBe(false);
    },
  );
  it("rejects unknown finance flags and unsupported method", () => {
    expect(
      createExpenseInput.safeParse({ ...input, status: "POSTED" }).success,
    ).toBe(false);
    expect(
      createExpenseInput.safeParse({ ...input, method: "QR" }).success,
    ).toBe(false);
  });
  it("rejects reversed date range and oversized pages", () => {
    expect(
      expenseListInput.safeParse({ from: "2026-11-01", to: "2026-10-01" })
        .success,
    ).toBe(false);
    expect(expenseListInput.safeParse({ limit: 101 }).success).toBe(false);
  });
  it("sums POSTED OPEX/CAPEX exactly beyond single entry precision", () => {
    expect(
      expenseTotals([
        { amount: "1234.56", categoryKind: "OPEX", status: "POSTED" },
        { amount: "10000.01", categoryKind: "CAPEX", status: "POSTED" },
        { amount: "5.00", categoryKind: "OPEX", status: "PENDING" },
        { amount: "7.00", categoryKind: "OPEX", status: "CANCELLED" },
        { amount: "9.99", categoryKind: "OPEX", status: "REVERSED" },
      ]),
    ).toEqual({ opex: "1234.56", capex: "10000.01", total: "11234.57" });
    expect(
      expenseTotals([
        { amount: "999999999999.99", categoryKind: "OPEX", status: "POSTED" },
        { amount: "0.01", categoryKind: "OPEX", status: "POSTED" },
      ]),
    ).toEqual({
      opex: "1000000000000.00",
      capex: "0.00",
      total: "1000000000000.00",
    });
  });
  it("fingerprints canonical parsed input and distinguishes financial changes", () => {
    const parsed = createExpenseInput.parse(input);
    expect(expenseFingerprint(parsed)).toBe(
      expenseFingerprint(
        createExpenseInput.parse({ ...input, propertyId: id.toUpperCase() }),
      ),
    );
    expect(expenseFingerprint(parsed)).not.toBe(
      expenseFingerprint({ ...parsed, amount: "1234.57" }),
    );
    expect(expenseFingerprint({ a: 1, b: 2 })).toBe(
      expenseFingerprint({ b: 2, a: 1 }),
    );
  });
  it("rejects unknown/duplicate/ambiguous query params", () => {
    for (const query of [
      "status=POSTED&status=PENDING",
      "limit=1e2",
      "offset=-1",
      "legacy=true",
    ])
      expect(() => parseExpenseListQuery(new URLSearchParams(query))).toThrow();
    expect(
      parseExpenseListQuery(new URLSearchParams("limit=5&status=POSTED")),
    ).toEqual({ limit: 5, offset: 0, status: "POSTED" });
  });
  it("rejects conflicting lifecycle output and category controls", () => {
    expect(
      expenseDtoSchema.safeParse({ status: "PENDING", postedById: id }).success,
    ).toBe(false);
    expect(
      createExpenseCategoryInput.safeParse({
        name: "bad\nname",
        kind: "OPEX",
        commandKey: "valid-key",
      }).success,
    ).toBe(false);
  });
});
