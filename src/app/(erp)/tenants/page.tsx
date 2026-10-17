import { LiveTenants } from "@/features/live/tenants";
import { requirePageActor } from "@/server/http";
export default async function Page() {
  const actor = await requirePageActor();
  return <LiveTenants admin={actor.role === "ADMIN"} />;
}
