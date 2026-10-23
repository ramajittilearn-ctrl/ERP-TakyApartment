import { reversePayment, cancelPaymentInput } from "@/server/payments";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";
type Context = { params: Promise<{ id: string }> };
const bodySchema = cancelPaymentInput.omit({ paymentId: true });
export function POST(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    const body = bodySchema.parse(await readJson(request));
    const input = cancelPaymentInput.parse({
      ...body,
      paymentId: (await context.params).id,
    });
    return json(await reversePayment(actor, input));
  });
}
