import { ExpenseWorkspace } from "@/features/expenses/live-screen";
import { requirePageActor } from "@/server/http";
export default async function Page() {
  const actor = await requirePageActor();
  return <ExpenseWorkspace actorId={actor.id} admin={actor.role === "ADMIN"} />;
}
