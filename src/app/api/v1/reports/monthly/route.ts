import { monthlyReport } from "@/server/reports";
import { parseMonthlyReportQuery } from "@/server/reports/contracts";
import { handle, json, requireActor } from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor();
    const query = parseMonthlyReportQuery(new URL(request.url).searchParams);
    return json(await monthlyReport(actor, query.month));
  });
}
