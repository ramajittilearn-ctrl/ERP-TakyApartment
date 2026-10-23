import {
  createPayment,
  listPayments,
  createPaymentInput,
} from "@/server/payments";
import { parsePaymentListQuery } from "@/server/payments/query";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor();
    return json(
      await listPayments(
        actor,
        parsePaymentListQuery(new URL(request.url).searchParams),
      ),
    );
  });
}
export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(
      await createPayment(
        actor,
        createPaymentInput.parse(await readJson(request)),
      ),
      201,
    );
  });
}
