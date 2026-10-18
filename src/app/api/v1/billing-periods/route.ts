import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";
import { createBillingPeriod, listBillingPeriods } from "@/server/finance";

export function GET(request: Request) {
  return handle(async () => {
    await requireActor();
    return json(
      await listBillingPeriods({
        propertyId: new URL(request.url).searchParams.get("propertyId"),
      }),
    );
  });
}
export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(await createBillingPeriod(actor, await readJson(request)), 201);
  });
}
