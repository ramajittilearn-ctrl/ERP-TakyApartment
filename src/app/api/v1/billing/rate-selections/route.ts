import {
  approveBillingRate,
  listBillingRateSelections,
} from "@/server/billing";
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
      await listBillingRateSelections(actor, {
        billingPeriodId: new URL(request.url).searchParams.get(
          "billingPeriodId",
        ),
      }),
    );
  });
}

export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(await approveBillingRate(actor, await readJson(request)), 201);
  });
}
