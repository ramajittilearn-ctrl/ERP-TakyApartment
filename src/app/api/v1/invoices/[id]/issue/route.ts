import { issueInvoice } from "@/server/invoices";
import { issueInvoiceInput } from "@/server/invoices/contracts";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";

type Context = { params: Promise<{ id: string }> };
const bodySchema = issueInvoiceInput.omit({ invoiceId: true });

export function POST(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    const body = bodySchema.parse(await readJson(request));
    return json(
      await issueInvoice(actor, {
        ...body,
        invoiceId: (await context.params).id,
      }),
    );
  });
}
