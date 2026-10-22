import { approveBillingConsumption } from "@/server/billing";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";

export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(
      await approveBillingConsumption(actor, await readJson(request)),
      201,
    );
  });
}
