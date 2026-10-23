import { getExpense } from "@/server/expenses";
import { handle, json, requireActor } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export function GET(_request: Request, context: Context) {
  return handle(async () =>
    json(await getExpense(await requireActor(), (await context.params).id)),
  );
}
