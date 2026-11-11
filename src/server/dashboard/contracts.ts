import { z } from "zod";
import { reportMonthSchema } from "../reports/contracts";

const moneySchema = z.string().regex(/^\d+\.\d{2}$/);

export const dashboardMonthSchema = reportMonthSchema.refine(
  (month) => {
    const [year, monthNumber] = month.split("-").map(Number);
    return year * 12 + monthNumber - 1 >= 17;
  },
  { message: "Dashboard month must be 0001-06 or later" },
);

export const dashboardQuerySchema = z.object({ month: dashboardMonthSchema });

export function parseDashboardQuery(params: URLSearchParams) {
  const keys = new Set<string>();
  for (const [key] of params) {
    if (keys.has(key) || key !== "month")
      throw new z.ZodError([
        {
          code: "custom",
          path: [key],
          message: keys.has(key)
            ? "Repeated query parameter"
            : "Unknown query parameter",
        },
      ]);
    keys.add(key);
  }
  return dashboardQuerySchema.parse({ month: params.get("month") });
}

export const dashboardMonthSummarySchema = z.object({
  month: dashboardMonthSchema,
  issuedTotal: moneySchema,
  confirmedTotal: moneySchema,
  currentOutstanding: moneySchema,
  opexTotal: moneySchema,
  capexTotal: moneySchema,
  invoiceCount: z.number().int().nonnegative(),
  receiptCount: z.number().int().nonnegative(),
  expenseCount: z.number().int().nonnegative(),
});

export const dashboardDtoSchema = z.object({
  month: dashboardMonthSchema,
  rooms: z.object({
    listed: z.number().int().nonnegative(),
    activeLeaseStatus: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    maintenance: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
  }),
  financials: z.object({
    selectedMonth: dashboardMonthSummarySchema,
    trend: z.array(dashboardMonthSummarySchema).length(6),
    outstanding: z.array(
      z.object({
        invoiceId: z.string().uuid(),
        number: z.string().min(1),
        roomNumber: z.string().min(1),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        currentOutstanding: moneySchema,
      }),
    ),
  }),
});

export const dashboardEnvelopeSchema = z.object({ data: dashboardDtoSchema });

export type DashboardDto = z.infer<typeof dashboardDtoSchema>;
export type DashboardMonthSummary = z.infer<typeof dashboardMonthSummarySchema>;
