import { describe, expect, it } from "vitest";
import {
  expenseCsv,
  expenseCsvCell,
  expenseCsvColumns,
} from "../src/server/expenses/export";
import {
  parseExpenseExportQuery,
  parseExpenseListQuery,
  expenseWhere,
} from "../src/server/expenses/query";
import { expensePageSchema } from "../src/features/expenses/client";
import type {
  ExpenseDto,
  ExpenseExportDto,
} from "../src/server/expenses/contracts";
const id = "11111111-1111-4111-8111-111111111111";
const item: ExpenseDto = {
  id,
  propertyId: id,
  categoryId: id,
  description: 'Synthetic, "quoted"',
  vendor: "=SUM(1,1)",
  amount: "999999999999.99",
  occurredAt: "2026-10-24",
  method: "CASH",
  note: "line one\nline two",
  categoryName: "Synthetic",
  categoryKind: "OPEX",
  version: 3,
  possibleDuplicateCount: 0,
  recordedById: id,
  createdAt: "2026-10-24T00:00:00.000Z",
  correctionOfId: null,
  status: "REVERSED",
  postedById: id,
  postedAt: "2026-10-24T01:00:00.000Z",
  reversedById: id,
  reversedAt: "2026-10-24T02:00:00.000Z",
  reverseReason: "\t +SUM(A1)",
};
const data: ExpenseExportDto = {
  scope: "managed-only",
  generatedAt: "2026-10-24T03:00:00.000Z",
  filters: { propertyId: id },
  excludedLegacyCount: 2,
  totals: { opex: "0.00", capex: "0.00", total: "0.00" },
  items: [item],
};
import { parseCsv } from "./helpers/expense-csv";
describe("expense CSV contract", () => {
  it("exports exact money, escaped text, complete immutable reversal history and summary", () => {
    const raw = expenseCsv(data);
    expect(raw.startsWith("\uFEFF")).toBe(true);
    const rows = parseCsv(raw);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.length === expenseCsvColumns.length)).toBe(
      true,
    );
    const value = Object.fromEntries(
      rows[0].map((key, index) => [key, rows[2][index]]),
    );
    expect(value).toMatchObject({
      recordType: "expense",
      amount: "999999999999.99",
      description: item.description,
      vendor: "'=SUM(1,1)",
      note: item.note,
      status: "REVERSED",
      postedById: id,
      reversedById: id,
      reverseReason: "'\t +SUM(A1)",
      cancelledById: "",
    });
    const summary = Object.fromEntries(
      rows[0].map((key, index) => [key, rows[1][index]]),
    );
    expect(summary).toMatchObject({
      recordType: "summary",
      excludedLegacyCount: "2",
      approvedTotal: "0.00",
    });
    expect(JSON.parse(summary.filtersJson)).toMatchObject({
      propertyId: id,
      viewSemantics:
        "current-approved-expenses-restated-on-original-occurred-date",
    });
    expect(item.vendor).toBe("=SUM(1,1)");
  });
  it("retains summary and column metadata in an empty export", () => {
    const rows = parseCsv(expenseCsv({ ...data, items: [] }));
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("summary");
  });
  it.each([
    "=1+1",
    " +1",
    "\t-1",
    "\r\n@SUM(A1)",
    "\u0000 =1",
    "\uFEFF=1",
    "\u0085=1",
    "\u009F+1",
  ])("neutralizes formula prefixes %j", (value) => {
    expect(expenseCsvCell(value)).toBe(`"'${value}"`);
    const rows = parseCsv(
      expenseCsv({ ...data, items: [{ ...item, vendor: value }] }),
    );
    expect(rows[2][expenseCsvColumns.indexOf("vendor")]).toBe(`'${value}`);
  });
  it("shares list predicates and rejects export pagination, duplicates and unknown fields", () => {
    const filters = `propertyId=${id}&from=2026-10-01&to=2026-10-31&kind=OPEX&status=POSTED&query=Synthetic`;
    expect(
      expenseWhere(parseExpenseExportQuery(new URLSearchParams(filters))),
    ).toEqual(
      expenseWhere(
        parseExpenseListQuery(
          new URLSearchParams(filters + "&offset=50&limit=100"),
        ),
      ),
    );
    for (const query of [
      "offset=0",
      "limit=50",
      "kind=OPEX&kind=CAPEX",
      "unknown=1",
      "__proto__=x",
      "from=2026-10-31&to=2026-10-01",
      "from=2026-02-30",
    ])
      expect(() =>
        parseExpenseExportQuery(new URLSearchParams(query)),
      ).toThrow();
  });
  it("rejects prototype keys in list input as unknown fields", () => {
    expect(() =>
      parseExpenseListQuery(new URLSearchParams("__proto__=x")),
    ).toThrow();
  });
  it("accepts aggregate money above the individual entry ceiling without number conversion", () => {
    const page = expensePageSchema.parse({
      scope: "managed-only",
      items: [],
      offset: 0,
      limit: 50,
      total: 10000,
      excludedLegacyCount: 0,
      totals: {
        opex: "9999999999999900.00",
        capex: "0.00",
        total: "9999999999999900.00",
      },
    });
    expect(page.totals.total).toBe("9999999999999900.00");
  });
});
