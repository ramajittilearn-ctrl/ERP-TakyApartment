import { z } from "zod";

export const reportMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a month in YYYY-MM format")
  .refine((value) => Number(value.slice(0, 4)) > 0, {
    message: "Expected a calendar year after 0000",
  });

const decimalAmountSchema = z.string().regex(/^-?\d+\.\d{2}$/);

export const monthlyReportQuerySchema = z.object({
  month: reportMonthSchema,
});

export function parseMonthlyReportQuery(params: URLSearchParams) {
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
  return monthlyReportQuerySchema.parse({ month: params.get("month") });
}

export const monthlyReportDtoSchema = z.object({
  month: reportMonthSchema,
  invoices: z.object({
    issuedTotal: decimalAmountSchema,
    issuedCount: z.number().int().nonnegative(),
    currentOutstanding: decimalAmountSchema,
    currentOutstandingInvoiceCount: z.number().int().nonnegative(),
    rows: z.array(
      z.object({
        invoiceId: z.string().uuid(),
        number: z.string().min(1),
        finalTotal: decimalAmountSchema,
        paidToDate: decimalAmountSchema,
        currentOutstanding: decimalAmountSchema,
      }),
    ),
  }),
  receipts: z.object({
    confirmedTotal: decimalAmountSchema,
    confirmedCount: z.number().int().nonnegative(),
    rows: z.array(
      z.object({
        paymentId: z.string().uuid(),
        reference: z.string().min(1),
        receiptNumber: z.string().min(1).nullable(),
        receivedAt: z.string().datetime({ offset: true }),
        amount: decimalAmountSchema,
      }),
    ),
  }),
  expenses: z.object({
    opexTotal: decimalAmountSchema,
    capexTotal: decimalAmountSchema,
    total: decimalAmountSchema,
    count: z.number().int().nonnegative(),
    rows: z.array(
      z.object({
        expenseId: z.string().uuid(),
        occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string(),
        categoryName: z.string().min(1),
        kind: z.enum(["OPEX", "CAPEX"]),
        amount: decimalAmountSchema,
      }),
    ),
  }),
});

export const monthlyReportEnvelopeSchema = z.object({
  data: monthlyReportDtoSchema,
});

export type MonthlyReportDto = z.infer<typeof monthlyReportDtoSchema>;
