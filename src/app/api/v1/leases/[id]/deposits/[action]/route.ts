import {
  depositMutation,
  leaseDepositCommand,
} from "@/server/deposit-api/boundary";
import { depositService } from "@/server/deposit-api/service";
import { handle, json } from "@/server/http";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> },
) {
  return handle(async () => {
    const { actor, body } = await depositMutation(request);
    const { id, action } = await context.params;
    const input = leaseDepositCommand(action, id, body);
    switch (input.kind) {
      case "review":
        return json(
          await depositService.reviewDepositAccount(actor, input.command),
        );
      case "receipts":
        return json(
          await depositService.recordDepositReceipt(actor, input.command),
          201,
        );
      case "deductions":
        return json(
          await depositService.recordDepositDeduction(actor, input.command),
          201,
        );
      case "refunds":
        return json(
          await depositService.recordDepositRefund(actor, input.command),
          201,
        );
    }
  });
}
