import { z } from "zod";
import { getReceipt } from "@/server/payments";
import { handle, json, requireActor } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export function GET(_request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor();
    return json(
      await getReceipt(actor, z.uuid().parse((await context.params).id)),
    );
  });
}
