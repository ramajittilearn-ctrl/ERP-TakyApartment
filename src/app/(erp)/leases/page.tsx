import { LiveLeases } from "@/features/live/leases";
import { requirePageActor } from "@/server/http";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ lease?: string }>;
}) {
  const actor = await requirePageActor();
  const { lease = "" } = await searchParams;
  return (
    <LiveLeases key={lease} initialId={lease} admin={actor.role === "ADMIN"} />
  );
}
