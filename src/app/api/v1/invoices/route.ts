import { listInvoices } from "@/server/invoices";
import { handle, json, requireActor } from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor();
    return json(
      await listInvoices(
        actor,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    );
  });
}
