import { getInvoice, updateDraft } from "@/server/invoices";
import { updateDraftInput } from "@/server/invoices/contracts";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";

type Context = { params: Promise<{ id: string }> };
const bodySchema = updateDraftInput.omit({ invoiceId: true });

export function GET(_request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor();
    return json(await getInvoice(actor, (await context.params).id));
  });
}

export function PATCH(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    const body = bodySchema.parse(await readJson(request));
    return json(
      await updateDraft(actor, {
        ...body,
        invoiceId: (await context.params).id,
      }),
    );
  });
}
