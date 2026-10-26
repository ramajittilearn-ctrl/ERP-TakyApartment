import { Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import { invoiceLabelsSchema } from "../invoices/contracts";
import type { MonthlyReportDto } from "../reports/contracts";
import { monthlyReportInTransaction } from "../reports/service";
import {
  dashboardMonthSchema,
  type DashboardDto,
  type DashboardMonthSummary,
} from "./contracts";

function monthStart(value: string) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, 1);
  return date;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function trailingMonths(month: string) {
  const end = monthStart(month);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(end);
    date.setUTCMonth(date.getUTCMonth() - (5 - index));
    return monthKey(date);
  });
}

function monthSummary(report: MonthlyReportDto): DashboardMonthSummary {
  return {
    month: report.month,
    issuedTotal: report.invoices.issuedTotal,
    confirmedTotal: report.receipts.confirmedTotal,
    currentOutstanding: report.invoices.currentOutstanding,
    opexTotal: report.expenses.opexTotal,
    capexTotal: report.expenses.capexTotal,
    invoiceCount: report.invoices.issuedCount,
    receiptCount: report.receipts.confirmedCount,
    expenseCount: report.expenses.count,
  };
}

export async function dashboard(
  actor: Actor,
  month: DashboardDto["month"],
): Promise<DashboardDto> {
  month = dashboardMonthSchema.parse(month);
  const months = trailingMonths(month);

  return db.$transaction(
    async (tx) => {
      const [roomCounts, roomsWithActiveLease, reports] = await Promise.all([
        tx.room.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        tx.room.count({
          where: {
            leases: {
              some: {
                status: "ACTIVE",
                isDemo: false,
                tenant: { isDemo: false },
              },
            },
          },
        }),
        Promise.all(
          months.map((reportMonth) =>
            monthlyReportInTransaction(tx, actor, reportMonth),
          ),
        ),
      ]);

      const counts = new Map(
        roomCounts.map(({ status, _count }) => [status, _count._all]),
      );
      const selected = reports[reports.length - 1];
      if (!selected)
        throw new AppError(500, "INTERNAL", "Dashboard report unavailable");

      const outstandingRows = selected.invoices.rows.filter(
        (invoice) => invoice.currentOutstanding !== "0.00",
      );
      const invoiceDetails = outstandingRows.length
        ? await tx.invoice.findMany({
            where: {
              id: { in: outstandingRows.map(({ invoiceId }) => invoiceId) },
            },
            select: {
              id: true,
              dueDate: true,
              frozenLease: { select: { labels: true } },
            },
          })
        : [];
      const detailsById = new Map(
        invoiceDetails.map((invoice) => [invoice.id, invoice]),
      );
      const outstanding = outstandingRows.map((invoice) => {
        const detail = detailsById.get(invoice.invoiceId);
        const labels = detail?.frozenLease?.labels;
        const parsedLabels = invoiceLabelsSchema.safeParse(labels);
        if (!parsedLabels.success)
          throw new AppError(
            409,
            "REPORT_DATA_INVALID",
            "Issued invoice is missing its valid frozen room identity",
          );
        return {
          invoiceId: invoice.invoiceId,
          number: invoice.number,
          roomNumber: parsedLabels.data.room,
          dueDate: detail?.dueDate?.toISOString().slice(0, 10) ?? null,
          currentOutstanding: invoice.currentOutstanding,
        };
      });

      return {
        month,
        rooms: {
          listed: roomCounts.reduce(
            (total, { _count }) => total + _count._all,
            0,
          ),
          activeLeaseStatus: roomsWithActiveLease,
          available: counts.get("AVAILABLE") ?? 0,
          maintenance: counts.get("MAINTENANCE") ?? 0,
          reserved: counts.get("RESERVED") ?? 0,
        },
        financials: {
          selectedMonth: monthSummary(selected),
          trend: reports.map(monthSummary),
          outstanding,
        },
      } satisfies DashboardDto;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
