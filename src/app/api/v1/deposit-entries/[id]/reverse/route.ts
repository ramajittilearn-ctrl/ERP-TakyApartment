import {
  depositMutation,
  reverseDepositCommand,
} from "@/server/deposit-api/boundary";
import { depositService } from "@/server/deposit-api/service";
import { handle, json } from "@/server/http";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { actor, body } = await depositMutation(request);
    return json(
      await depositService.reverseDepositEntry(
        actor,
        reverseDepositCommand((await context.params).id, body),
      ),
      201,
    );
  });
}
