import { getReadingOverview } from "@/server/meter";
import { handle, json, requireActor } from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    await requireActor();
    const query = new URL(request.url).searchParams;
    return json(
      await getReadingOverview({
        billingPeriodId: query.get("billingPeriodId"),
        floor: query.get("floor") ?? undefined,
        roomId: query.get("roomId") ?? undefined,
      }),
    );
  });
}
