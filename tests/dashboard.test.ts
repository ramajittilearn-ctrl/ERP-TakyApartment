import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mock = vi.hoisted(() => ({
  transaction: vi.fn(),
  user: vi.fn(),
  invoices: vi.fn(),
  payments: vi.fn(),
  expenses: vi.fn(),
  roomGroups: vi.fn(),
  activeRooms: vi.fn(),
}));

vi.mock("../src/server/db", () => ({
  db: { $transaction: mock.transaction },
}));

import { dashboard } from "../src/server/dashboard/service";
import { dashboardMonthSchema } from "../src/server/dashboard/contracts";
import { monthlyReportInTransaction } from "../src/server/reports/service";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "ADMIN" as const,
  name: "Synthetic test actor",
  username: "synthetic",
};
const invoiceId = "22222222-2222-4222-8222-222222222222";

function transactionClient() {
  return {
    user: { findUnique: mock.user },
    invoice: { findMany: mock.invoices },
    payment: { findMany: mock.payments },
    expense: { findMany: mock.expenses },
    room: { groupBy: mock.roomGroups, count: mock.activeRooms },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.transaction.mockImplementation(async (run) => run(transactionClient()));
  mock.user.mockResolvedValue({
    id: actor.id,
    disabled: false,
    role: actor.role,
  });
  mock.invoices.mockResolvedValue([]);
  mock.payments.mockResolvedValue([]);
  mock.expenses.mockResolvedValue([]);
  mock.roomGroups.mockResolvedValue([
    { status: "AVAILABLE", _count: { _all: 4 } },
    { status: "MAINTENANCE", _count: { _all: 1 } },
    { status: "RESERVED", _count: { _all: 2 } },
  ]);
  mock.activeRooms.mockResolvedValue(3);
});

describe("dashboard service", () => {
  it("requires the six-month window to begin in calendar year 0001", async () => {
    expect(dashboardMonthSchema.parse("0001-06")).toBe("0001-06");
    expect(() => dashboardMonthSchema.parse("0001-05")).toThrow();
    await expect(dashboard(actor, "0001-05")).rejects.toThrow();
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it("uses one repeatable-read snapshot for truthful room counts and six report months", async () => {
    const result = await dashboard(actor, "2027-03");

    expect(result.month).toBe("2027-03");
    expect(result.rooms).toEqual({
      listed: 7,
      activeLeaseStatus: 3,
      available: 4,
      maintenance: 1,
      reserved: 2,
    });
    expect(result.financials.trend.map(({ month }) => month)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(result.financials.selectedMonth).toEqual({
      month: "2027-03",
      issuedTotal: "0.00",
      confirmedTotal: "0.00",
      currentOutstanding: "0.00",
      opexTotal: "0.00",
      capexTotal: "0.00",
      invoiceCount: 0,
      receiptCount: 0,
      expenseCount: 0,
    });
    expect(result.financials.outstanding).toEqual([]);
    expect(mock.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.user).toHaveBeenCalledTimes(6);
    expect(mock.invoices).toHaveBeenCalledTimes(6);
    expect(mock.payments).toHaveBeenCalledTimes(6);
    expect(mock.expenses).toHaveBeenCalledTimes(6);
    expect(mock.activeRooms.mock.calls[0]?.[0].where.leases.some).toMatchObject(
      {
        status: "ACTIVE",
        isDemo: false,
        tenant: { isDemo: false },
      },
    );
  });

  it("keeps the transaction-scoped report helper independent of opening a transaction", async () => {
    const tx = transactionClient();
    const report = await monthlyReportInTransaction(
      tx as never,
      actor,
      "2027-03",
    );

    expect(report.month).toBe("2027-03");
    expect(mock.transaction).not.toHaveBeenCalled();
    expect(mock.user).toHaveBeenCalledTimes(1);
  });

  it("uses the frozen invoice room label even when the live room identity differs", async () => {
    mock.invoices.mockImplementation(async (args) => {
      if (args.select?.frozenLease) {
        return [
          {
            id: invoiceId,
            dueDate: new Date("2027-03-05T00:00:00.000Z"),
            frozenLease: {
              labels: {
                property: "Taky Apartment",
                room: "203",
                tenant: "Synthetic tenant",
              },
              room: { number: "999", floor: { number: 9 } },
            },
          },
        ];
      }
      const startsOn = args.where.billingPeriod.is.startsOn.gte as Date;
      if (startsOn.toISOString().slice(0, 10) !== "2027-03-01") return [];
      return [
        {
          id: invoiceId,
          number: "INV-2027-03-0001",
          finalTotal: new Prisma.Decimal("100.00"),
          allocations: [],
        },
      ];
    });

    const result = await dashboard(actor, "2027-03");

    expect(result.financials.outstanding).toEqual([
      {
        invoiceId,
        number: "INV-2027-03-0001",
        roomNumber: "203",
        dueDate: "2027-03-05",
        currentOutstanding: "100.00",
      },
    ]);
  });
});
