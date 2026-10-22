import { LiveTenants } from "@/features/live/tenants";
import { requirePageActor } from "@/server/http";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const actor = await requirePageActor();
  const { tenant = "" } = await searchParams;
  return (
    <LiveTenants
      key={tenant}
      initialId={tenant}
      admin={actor.role === "ADMIN"}
    />
  );
}
