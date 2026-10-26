import { noDepositQuery } from "@/server/deposit-api/boundary";
import { handle, json, requireActor } from "@/server/http";

export function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor();
    noDepositQuery(request);
    return json({ id: actor.id, role: actor.role });
  });
}
