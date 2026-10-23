import { z } from "zod";
import { getPayment } from "@/server/payments";
import { handle, json, requireActor } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export function GET(_request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor();
    return json(
      await getPayment(actor, z.uuid().parse((await context.params).id)),
    );
  });
}
