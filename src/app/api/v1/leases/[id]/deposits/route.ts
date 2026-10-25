import { depositId } from "@/server/deposits/contracts";
import { depositPageQuery } from "@/server/deposit-api/boundary";
import { depositService } from "@/server/deposit-api/service";
import { handle, json, requireActor } from "@/server/http";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const actor = await requireActor();
    const leaseId = depositId.parse((await context.params).id);
    return json(
      await depositService.getLeaseDepositLedger(actor, {
        leaseId,
        ...depositPageQuery(new URL(request.url).searchParams),
      }),
    );
  });
}
