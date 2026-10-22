import { invoiceOptions } from "@/server/invoices";
import { handle, json, requireActor } from "@/server/http";

export function GET() {
  return handle(async () => {
    return json(await invoiceOptions(await requireActor()));
  });
}
