import { exportExpenses } from "@/server/expenses";
import { expenseCsv } from "@/server/expenses/export";
import { parseExpenseExportQuery } from "@/server/expenses/query";
import { handle, requireActor } from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor();
    const data = await exportExpenses(
      actor,
      parseExpenseExportQuery(new URL(request.url).searchParams),
    );
    const stamp = data.generatedAt
      .replaceAll(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    return new Response(expenseCsv(data), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="expenses-${stamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
