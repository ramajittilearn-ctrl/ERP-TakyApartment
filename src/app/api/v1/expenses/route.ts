import { createExpense, listExpenses } from "@/server/expenses";
import { parseExpenseListQuery } from "@/server/expenses/query";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";
export function GET(request: Request) {
  return handle(async () =>
    json(
      await listExpenses(
        await requireActor(),
        parseExpenseListQuery(new URL(request.url).searchParams),
      ),
    ),
  );
}
export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    return json(
      await createExpense(await requireActor(), await readJson(request)),
      201,
    );
  });
}
