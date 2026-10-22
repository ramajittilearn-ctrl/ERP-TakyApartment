import {
  handle,
  json,
  requireActor,
  checkOrigin,
  readJson,
} from "@/server/http";
import { resourceInput } from "@/server/validation";
import { listRecords } from "@/server/repository";
import { saveRecord } from "@/server/services";
type Context = { params: Promise<{ resource: string }> };
export function GET(_request: Request, context: Context) {
  return handle(async () => {
    await requireActor();
    return json(
      await listRecords(resourceInput.parse((await context.params).resource)),
    );
  });
}
export function POST(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(
      await saveRecord(
        actor,
        resourceInput.parse((await context.params).resource),
        await readJson(request),
      ),
      201,
    );
  });
}
