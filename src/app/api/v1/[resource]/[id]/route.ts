import {
  handle,
  json,
  requireActor,
  checkOrigin,
  readJson,
} from "@/server/http";
import { resourceInput, uuid } from "@/server/validation";
import { getRecord } from "@/server/repository";
import { saveRecord, removeRecord } from "@/server/services";
type Context = { params: Promise<{ resource: string; id: string }> };
async function routeParams(context: Context) {
  const params = await context.params;
  return {
    resource: resourceInput.parse(params.resource),
    id: uuid.parse(params.id),
  };
}
export function GET(_request: Request, context: Context) {
  return handle(async () => {
    await requireActor();
    const { resource, id } = await routeParams(context);
    return json(await getRecord(resource, id));
  });
}
export function PUT(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    const { resource, id } = await routeParams(context);
    return json(await saveRecord(actor, resource, await readJson(request), id));
  });
}
export function DELETE(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    const { resource, id } = await routeParams(context);
    await removeRecord(actor, resource, id);
    return json({ deleted: true });
  });
}
