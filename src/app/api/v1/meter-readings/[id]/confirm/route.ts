import { confirmReading } from "@/server/meter";
import { checkOrigin, handle, json, requireActor } from "@/server/http";

type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(await confirmReading(actor, (await context.params).id));
  });
}
