import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, sessionActor } from "@/server/auth";
import { PaymentsScreen } from "@/features/payments/screen";
export default async function Page() {
  const actor = await sessionActor((await cookies()).get(COOKIE)?.value);
  if (!actor) redirect("/login/");
  return <PaymentsScreen actorId={actor.id} admin={actor.role === "ADMIN"} />;
}
