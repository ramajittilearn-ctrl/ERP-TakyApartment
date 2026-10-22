import { createUser } from "@/server/auth";
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
    return json(await createUser(await readJson(request), false, actor), 201);
  });
}
