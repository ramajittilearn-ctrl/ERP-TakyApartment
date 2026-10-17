import { LiveLeases } from "@/features/live/leases";
import { requirePageActor } from "@/server/http";
export default async function Page() {
  const actor = await requirePageActor();
  return <LiveLeases admin={actor.role === "ADMIN"} />;
}
