import Link from "next/link";
import { notFound } from "next/navigation";
import { DepositScreen } from "@/features/deposits/screen";
import { depositId } from "@/server/deposits/contracts";
import { depositSsrQuery } from "@/server/deposit-api/boundary";
import { depositService } from "@/server/deposit-api/service";
import { db } from "@/server/db";
import { requirePageActor } from "@/server/http";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ leaseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageActor();
  const parsed = depositId.safeParse((await params).leaseId);
  if (!parsed.success) notFound();
  const leaseId = parsed.data;
  const query = depositSsrQuery(await searchParams);
  const [lease, ledger] = await Promise.all([
    db.lease.findFirst({
      where: { id: leaseId, isDemo: false, tenant: { isDemo: false } },
      select: {
        number: true,
        status: true,
        room: { select: { number: true } },
        tenant: { select: { name: true } },
      },
    }),
    depositService.getLeaseDepositLedger(actor, { leaseId, ...query }),
  ]);
  if (!lease) notFound();
  return (
    <>
      <div className="screen-toolbar">
        <div>
          <h1>เงินประกันสัญญา {lease.number}</h1>
          <p>
            ห้อง {lease.room.number} · {lease.tenant.name}
          </p>
        </div>
        <Link href="/deposits/">สัญญาทั้งหมด</Link>
      </div>
      <DepositScreen
        key={leaseId}
        initialLedger={ledger}
        actorId={actor.id}
        admin={actor.role === "ADMIN"}
        leaseStatus={lease.status}
      />
    </>
  );
}
