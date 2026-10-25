import { noDepositQuery } from "@/server/deposit-api/boundary";
import { depositService } from "@/server/deposit-api/service";
import { handle, json, requireActor } from "@/server/http";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const actor = await requireActor();
    noDepositQuery(request);
    return json(
      await depositService.getDepositDocument(actor, {
        entryId: (await context.params).id,
      }),
    );
  });
}
