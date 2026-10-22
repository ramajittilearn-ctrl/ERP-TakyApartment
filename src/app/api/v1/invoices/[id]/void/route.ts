import { voidInvoice } from "@/server/invoices";
import { voidInvoiceInput } from "@/server/invoices/contracts";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";

type Context = { params: Promise<{ id: string }> };
const bodySchema = voidInvoiceInput.omit({ invoiceId: true });

export function POST(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    const body = bodySchema.parse(await readJson(request));
    return json(
      await voidInvoice(actor, {
        ...body,
        invoiceId: (await context.params).id,
      }),
    );
  });
}
