import {
  createExpenseCategory,
  listExpenseCategories,
} from "@/server/expenses";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";
export function GET() {
  return handle(async () =>
    json(await listExpenseCategories(await requireActor())),
  );
}
export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    return json(
      await createExpenseCategory(
        await requireActor(),
        await readJson(request),
      ),
      201,
    );
  });
}
