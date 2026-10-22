import { getInvoiceHistory } from "@/server/invoices";
import { handle, json, requireActor } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor();
    return json(await getInvoiceHistory(actor, (await context.params).id));
  });
}
