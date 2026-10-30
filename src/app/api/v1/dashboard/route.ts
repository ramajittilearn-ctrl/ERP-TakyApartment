import { dashboard } from "@/server/dashboard";
import { parseDashboardQuery } from "@/server/dashboard/contracts";
import { handle, json, requireActor } from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor();
    const query = parseDashboardQuery(new URL(request.url).searchParams);
    return json(await dashboard(actor, query.month));
  });
}
