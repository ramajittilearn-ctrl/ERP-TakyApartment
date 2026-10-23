import { listOutstandingBalances } from "@/server/payments";
import { parseBalanceListQuery } from "@/server/payments/query";
import { handle, json, requireActor } from "@/server/http";
export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor();
    return json(
      await listOutstandingBalances(
        actor,
        parseBalanceListQuery(new URL(request.url).searchParams),
      ),
    );
  });
}
