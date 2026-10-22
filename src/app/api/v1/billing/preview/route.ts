import { getBillingPreview } from "@/server/billing";
import { handle, json, requireActor } from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor();
    return json(
      await getBillingPreview(actor, {
        billingPeriodId: new URL(request.url).searchParams.get(
          "billingPeriodId",
        ),
      }),
    );
  });
}
