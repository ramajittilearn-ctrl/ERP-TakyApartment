import { InvoiceScreen } from "@/features/invoices/screen";
import { requirePageActor } from "@/server/http";

export default async function Page() {
  const actor = await requirePageActor();
  return <InvoiceScreen admin={actor.role === "ADMIN"} />;
}
