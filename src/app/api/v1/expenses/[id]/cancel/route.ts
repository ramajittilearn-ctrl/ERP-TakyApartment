import { cancelExpense, cancelExpenseInput } from "@/server/expenses";
import {
  checkOrigin,
  handle,
  json,
  readJson,
  requireActor,
} from "@/server/http";
type Context = { params: Promise<{ id: string }> };
const bodySchema = cancelExpenseInput.omit({ expenseId: true });
export function POST(request: Request, context: Context) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    const body = bodySchema.parse(await readJson(request));
    return json(
      await cancelExpense(actor, {
        ...body,
        expenseId: (await context.params).id,
      }),
    );
  });
}
