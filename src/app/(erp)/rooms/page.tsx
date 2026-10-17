import { LiveRooms } from "@/features/live/rooms";
import { requirePageActor } from "@/server/http";
export default async function Page() {
  const actor = await requirePageActor();
  return <LiveRooms admin={actor.role === "ADMIN"} />;
}
