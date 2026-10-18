import { createUtilityRate, listUtilityRates } from "@/server/finance";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    await requireActor();
    const params = new URL(request.url).searchParams;
    return json(
      await listUtilityRates({
        propertyId: params.get("propertyId"),
        kind: params.get("kind") ?? undefined,
      }),
    );
  });
}
export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(await createUtilityRate(actor, await readJson(request)), 201);
  });
}
