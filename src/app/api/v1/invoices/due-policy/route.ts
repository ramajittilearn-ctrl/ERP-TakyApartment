import { configureDuePolicy } from "@/server/invoices";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";

export function PUT(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(await configureDuePolicy(actor, await readJson(request)));
  });
}
