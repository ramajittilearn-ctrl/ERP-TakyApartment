import { z } from "zod";
import { confirmPayment, confirmPaymentInput } from "@/server/payments";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";
type Context = { params: Promise<{ id: string }> };
const { paymentId: _paymentId, ...bodyShape } = confirmPaymentInput.shape;
const bodySchema = z.strictObject(bodyShape);
export function POST(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    const body = bodySchema.parse(await readJson(request));
    const input = confirmPaymentInput.parse({
      ...body,
      paymentId: (await context.params).id,
    });
    return json(await confirmPayment(actor, input));
  });
}
