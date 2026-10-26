import { Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import type { MonthlyReportDto } from "./contracts";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function calendarDate(year: number, monthIndex: number) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, 1);
  return date;
}

function monthRanges(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = calendarDate(year, monthNumber - 1);
  const end = calendarDate(year, monthNumber);
  return {
    start,
    end,
    receivedAtStart: new Date(start.getTime() - BANGKOK_OFFSET_MS),
    receivedAtEnd: new Date(end.getTime() - BANGKOK_OFFSET_MS),
  };
}

function sum(values: Prisma.Decimal[]) {
  return values.reduce(
    (total, value) => total.plus(value),
    new Prisma.Decimal(0),
  );
}

function money(value: Prisma.Decimal) {
  return value.toFixed(2);
}

async function assertCurrentActor(tx: Prisma.TransactionClient, actor: Actor) {
  const current = await tx.user.findUnique({
    where: { id: actor.id },
    select: { id: true, disabled: true, role: true },
  });
  if (!current || current.disabled || current.role !== actor.role)
    throw new AppError(403, "FORBIDDEN", "Report permission denied");
}

export async function monthlyReportInTransaction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  month: MonthlyReportDto["month"],
): Promise<MonthlyReportDto> {
  const { start, end, receivedAtStart, receivedAtEnd } = monthRanges(month);
  await assertCurrentActor(tx, actor);

  const invoices = await tx.invoice.findMany({
    where: {
      status: "ISSUED",
      isDemo: false,
      number: { not: null },
      finalTotal: { not: null },
      billingPeriodId: { not: null },
      frozenLeaseId: { not: null },
      lease: {
        isDemo: false,
        tenant: { isDemo: false },
      },
      frozenLease: {
        lease: {
          isDemo: false,
          tenant: { isDemo: false },
        },
        tenant: { isDemo: false },
      },
      billingPeriod: {
        is: { startsOn: { gte: start, lt: end } },
      },
    },
    orderBy: [{ number: "asc" }, { id: "asc" }],
    select: {
      id: true,
      number: true,
      finalTotal: true,
      allocations: {
        where: {
          payment: {
            is: {
              status: "CONFIRMED",
              isDemo: false,
              legacyUnmapped: false,
              reversal: { is: null },
              lease: {
                isDemo: false,
                tenant: { isDemo: false },
              },
            },
          },
        },
        select: { amount: true },
      },
    },
  });

  const invoiceRows = invoices.map((invoice) => {
    if (invoice.number === null || invoice.finalTotal === null)
      throw new AppError(
        409,
        "REPORT_DATA_INVALID",
        "Issued invoice is missing its immutable number or total",
      );
    const paid = sum(invoice.allocations.map(({ amount }) => amount));
    const outstanding = invoice.finalTotal.minus(paid);
    if (outstanding.isNegative())
      throw new AppError(
        409,
        "REPORT_DATA_INVALID",
        "Confirmed allocations exceed an issued invoice total",
      );
    return {
      invoiceId: invoice.id,
      number: invoice.number,
      finalTotal: money(invoice.finalTotal),
      paidToDate: money(paid),
      currentOutstanding: money(outstanding),
      outstandingAmount: outstanding,
    };
  });

  const payments = await tx.payment.findMany({
    where: {
      status: "CONFIRMED",
      isDemo: false,
      legacyUnmapped: false,
      reversal: { is: null },
      lease: {
        isDemo: false,
        tenant: { isDemo: false },
      },
      receivedAt: { gte: receivedAtStart, lt: receivedAtEnd },
    },
    orderBy: [{ receivedAt: "asc" }, { reference: "asc" }],
    select: {
      id: true,
      reference: true,
      receivedAt: true,
      amount: true,
      receipt: { select: { number: true } },
    },
  });

  const expenses = await tx.expense.findMany({
    where: {
      legacyUnmapped: false,
      isDemo: false,
      status: "POSTED",
      categoryKindSnapshot: { in: ["OPEX", "CAPEX"] },
      categoryNameSnapshot: { not: null },
      occurredAt: { gte: start, lt: end },
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      occurredAt: true,
      description: true,
      categoryNameSnapshot: true,
      categoryKindSnapshot: true,
      amount: true,
    },
  });

  const expenseRows = expenses.map((expense) => {
    if (
      expense.categoryNameSnapshot === null ||
      (expense.categoryKindSnapshot !== "OPEX" &&
        expense.categoryKindSnapshot !== "CAPEX")
    )
      throw new AppError(
        409,
        "REPORT_DATA_INVALID",
        "Posted expense is missing its frozen category",
      );
    return {
      expenseId: expense.id,
      occurredAt: expense.occurredAt.toISOString().slice(0, 10),
      description: expense.description,
      categoryName: expense.categoryNameSnapshot,
      kind: expense.categoryKindSnapshot,
      amount: money(expense.amount),
    };
  });

  const issuedTotal = sum(
    invoiceRows.map((row) => new Prisma.Decimal(row.finalTotal)),
  );
  const outstandingTotal = sum(invoiceRows.map((row) => row.outstandingAmount));
  const confirmedTotal = sum(payments.map(({ amount }) => amount));
  const opexTotal = sum(
    expenses
      .filter((expense) => expense.categoryKindSnapshot === "OPEX")
      .map(({ amount }) => amount),
  );
  const capexTotal = sum(
    expenses
      .filter((expense) => expense.categoryKindSnapshot === "CAPEX")
      .map(({ amount }) => amount),
  );

  return {
    month,
    invoices: {
      issuedTotal: money(issuedTotal),
      issuedCount: invoiceRows.length,
      currentOutstanding: money(outstandingTotal),
      currentOutstandingInvoiceCount: invoiceRows.filter((row) =>
        row.outstandingAmount.isPositive(),
      ).length,
      rows: invoiceRows.map(
        ({ outstandingAmount: _outstandingAmount, ...row }) => row,
      ),
    },
    receipts: {
      confirmedTotal: money(confirmedTotal),
      confirmedCount: payments.length,
      rows: payments.map((payment) => ({
        paymentId: payment.id,
        reference: payment.reference,
        receiptNumber: payment.receipt?.number ?? null,
        receivedAt: payment.receivedAt.toISOString(),
        amount: money(payment.amount),
      })),
    },
    expenses: {
      opexTotal: money(opexTotal),
      capexTotal: money(capexTotal),
      total: money(opexTotal.plus(capexTotal)),
      count: expenseRows.length,
      rows: expenseRows,
    },
  } satisfies MonthlyReportDto;
}

export async function monthlyReport(
  actor: Actor,
  month: MonthlyReportDto["month"],
): Promise<MonthlyReportDto> {
  return db.$transaction((tx) => monthlyReportInTransaction(tx, actor, month), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
