import { correctReading } from "@/server/meter";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";

type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    return json(
      await correctReading(
        actor,
        (await context.params).id,
        await readJson(request),
      ),
      201,
    );
  });
}
