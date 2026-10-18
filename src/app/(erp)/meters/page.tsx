import { db } from "@/server/db";
import { requirePageActor } from "@/server/http";
import { MeterReadingScreen } from "@/features/meters/screen";

export default async function Page() {
  const actor = await requirePageActor();
  const property = await db.property.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      billingPeriods: {
        orderBy: { startsOn: "desc" },
        select: { id: true, startsOn: true, endsOn: true, status: true },
      },
    },
  });
  return (
    <MeterReadingScreen
      admin={actor.role === "ADMIN"}
      propertyId={property?.id ?? null}
      periods={(property?.billingPeriods ?? []).map((period) => ({
        ...period,
        startsOn: period.startsOn.toISOString().slice(0, 10),
        endsOn: period.endsOn.toISOString().slice(0, 10),
      }))}
    />
  );
}
