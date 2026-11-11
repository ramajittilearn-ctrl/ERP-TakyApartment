import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mock = vi.hoisted(() => ({
  transaction: vi.fn(),
  user: vi.fn(),
  invoices: vi.fn(),
  payments: vi.fn(),
  expenses: vi.fn(),
}));

vi.mock("../src/server/db", () => ({
  db: { $transaction: mock.transaction },
}));

import { monthlyReport } from "../src/server/reports/service";
import { parseMonthlyReportQuery } from "../src/server/reports/contracts";
import { AppError } from "../src/server/errors";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "ADMIN" as const,
  name: "Synthetic test actor",
  username: "synthetic",
};

const invoiceId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const opexId = "44444444-4444-4444-8444-444444444444";
const capexId = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  const tx = {
    user: { findUnique: mock.user },
    invoice: { findMany: mock.invoices },
    payment: { findMany: mock.payments },
    expense: { findMany: mock.expenses },
  };
  mock.transaction.mockImplementation(async (run) => run(tx));
  mock.user.mockResolvedValue({
    id: actor.id,
    disabled: false,
    role: actor.role,
  });
  mock.invoices.mockResolvedValue([
    {
      id: invoiceId,
      number: "INV-2026-02-0001",
      finalTotal: new Prisma.Decimal("1100.25"),
      allocations: [{ amount: new Prisma.Decimal("300.10") }],
    },
  ]);
  mock.payments.mockResolvedValue([
    {
      id: paymentId,
      reference: "PAY-2026-02-0001",
      receivedAt: new Date("2026-02-12T05:00:00.000Z"),
      amount: new Prisma.Decimal("300.10"),
      receipt: { number: "RCP-2026-02-0001" },
    },
  ]);
  mock.expenses.mockResolvedValue([
    {
      id: opexId,
      occurredAt: new Date("2026-02-28T00:00:00.000Z"),
      description: "Shared area maintenance",
      categoryNameSnapshot: "Maintenance",
      categoryKindSnapshot: "OPEX",
      amount: new Prisma.Decimal("100.10"),
    },
    {
      id: capexId,
      occurredAt: new Date("2026-02-01T00:00:00.000Z"),
      description: "Water pump replacement",
      categoryNameSnapshot: "Equipment",
      categoryKindSnapshot: "CAPEX",
      amount: new Prisma.Decimal("50.20"),
    },
  ]);
});

describe("monthly financial report", () => {
  it("keeps bill, receipt, and expense month bases separate with exact money", async () => {
    const report = await monthlyReport(actor, "2026-02");

    expect(report.invoices).toEqual({
      issuedTotal: "1100.25",
      issuedCount: 1,
      currentOutstanding: "800.15",
      currentOutstandingInvoiceCount: 1,
      rows: [
        {
          invoiceId,
          number: "INV-2026-02-0001",
          finalTotal: "1100.25",
          paidToDate: "300.10",
          currentOutstanding: "800.15",
        },
      ],
    });
    expect(report.receipts).toEqual({
      confirmedTotal: "300.10",
      confirmedCount: 1,
      rows: [
        {
          paymentId,
          reference: "PAY-2026-02-0001",
          receiptNumber: "RCP-2026-02-0001",
          receivedAt: "2026-02-12T05:00:00.000Z",
          amount: "300.10",
        },
      ],
    });
    expect(report.expenses).toMatchObject({
      opexTotal: "100.10",
      capexTotal: "50.20",
      total: "150.30",
      count: 2,
    });
    expect(report.expenses.rows[0]?.occurredAt).toBe("2026-02-28");

    expect(mock.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(mock.invoices.mock.calls[0]?.[0].where).toMatchObject({
      status: "ISSUED",
      isDemo: false,
      billingPeriodId: { not: null },
      frozenLeaseId: { not: null },
      lease: { isDemo: false, tenant: { isDemo: false } },
      frozenLease: {
        lease: { isDemo: false, tenant: { isDemo: false } },
        tenant: { isDemo: false },
      },
      billingPeriod: {
        is: {
          startsOn: {
            gte: new Date("2026-02-01T00:00:00.000Z"),
            lt: new Date("2026-03-01T00:00:00.000Z"),
          },
        },
      },
    });
    expect(mock.payments.mock.calls[0]?.[0].where.receivedAt).toEqual({
      gte: new Date("2026-01-31T17:00:00.000Z"),
      lt: new Date("2026-02-28T17:00:00.000Z"),
    });
    expect(mock.payments.mock.calls[0]?.[0].where).toMatchObject({
      status: "CONFIRMED",
      legacyUnmapped: false,
      isDemo: false,
      reversal: { is: null },
      lease: { isDemo: false, tenant: { isDemo: false } },
    });
    expect(
      mock.invoices.mock.calls[0]?.[0].select.allocations.where.payment.is,
    ).toMatchObject({
      isDemo: false,
      legacyUnmapped: false,
      reversal: { is: null },
      lease: { isDemo: false, tenant: { isDemo: false } },
    });
    expect(mock.expenses.mock.calls[0]?.[0].where.occurredAt).toEqual({
      gte: new Date("2026-02-01T00:00:00.000Z"),
      lt: new Date("2026-03-01T00:00:00.000Z"),
    });
  });

  it("refuses to report an impossible negative invoice balance", async () => {
    mock.invoices.mockResolvedValueOnce([
      {
        id: invoiceId,
        number: "INV-2026-02-0001",
        finalTotal: new Prisma.Decimal("10.00"),
        allocations: [{ amount: new Prisma.Decimal("10.01") }],
      },
    ]);

    await expect(monthlyReport(actor, "2026-02")).rejects.toMatchObject({
      status: 409,
      code: "REPORT_DATA_INVALID",
    } satisfies Partial<AppError>);
  });

  it("rejects disabled or role-changed actors before reading financial rows", async () => {
    mock.user.mockResolvedValueOnce({
      id: actor.id,
      disabled: true,
      role: actor.role,
    });
    await expect(monthlyReport(actor, "2026-02")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(mock.invoices).not.toHaveBeenCalled();
    expect(mock.payments).not.toHaveBeenCalled();
    expect(mock.expenses).not.toHaveBeenCalled();
  });
});

describe("monthly report query", () => {
  it("accepts one valid month and rejects malformed, repeated, or unknown fields", () => {
    expect(
      parseMonthlyReportQuery(new URLSearchParams("month=0001-01")),
    ).toEqual({ month: "0001-01" });
    expect(
      parseMonthlyReportQuery(new URLSearchParams("month=2026-02")),
    ).toEqual({
      month: "2026-02",
    });
    expect(() =>
      parseMonthlyReportQuery(new URLSearchParams("month=2026-13")),
    ).toThrow();
    expect(() =>
      parseMonthlyReportQuery(
        new URLSearchParams("month=2026-02&month=2026-03"),
      ),
    ).toThrow();
    expect(() =>
      parseMonthlyReportQuery(
        new URLSearchParams("month=2026-02&propertyId=tenant-supplied"),
      ),
    ).toThrow();
  });
});
