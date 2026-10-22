import { LiveRooms } from "@/features/live/rooms";
import { requirePageActor } from "@/server/http";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const actor = await requirePageActor();
  const { room = "" } = await searchParams;
  return (
    <LiveRooms key={room} initialId={room} admin={actor.role === "ADMIN"} />
  );
}
