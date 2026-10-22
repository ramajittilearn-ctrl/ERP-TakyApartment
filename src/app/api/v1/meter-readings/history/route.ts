import { getReadingHistory } from "@/server/meter";
import { handle, json, requireActor } from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    await requireActor();
    const query = new URL(request.url).searchParams;
    return json(
      await getReadingHistory({
        roomId: query.get("roomId"),
        kind: query.get("kind") ?? undefined,
      }),
    );
  });
}
