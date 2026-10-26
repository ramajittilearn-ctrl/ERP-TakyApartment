import { connection } from "next/server";
import { DashboardScreen } from "@/features/dashboard/screen";
import { requirePageActor } from "@/server/http";

function currentBangkokMonth(): string {
  const values = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = values.find((part) => part.type === "year")?.value;
  const month = values.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Unable to determine the current month");
  return `${year}-${month}`;
}

export default async function Page() {
  await requirePageActor();
  await connection();
  return <DashboardScreen initialMonth={currentBangkokMonth()} />;
}
