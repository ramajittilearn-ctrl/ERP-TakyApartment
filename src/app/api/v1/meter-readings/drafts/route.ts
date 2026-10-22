import { upsertDraftReading } from "@/server/meter";
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
    return json(await upsertDraftReading(actor, await readJson(request)));
  });
}
