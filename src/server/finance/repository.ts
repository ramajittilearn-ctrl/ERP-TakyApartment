import type { MeterKind, Prisma } from "@prisma/client";

export function lockProperty(tx: Prisma.TransactionClient, propertyId: string) {
  return tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Property" WHERE id = ${propertyId}::uuid FOR UPDATE`;
}

export function findBillingPeriods(
  tx: Prisma.TransactionClient,
  propertyId: string,
) {
  return tx.billingPeriod.findMany({
    where: { propertyId },
    orderBy: { startsOn: "desc" },
  });
}

export function findUtilityRates(
  tx: Prisma.TransactionClient,
  propertyId: string,
  kind?: MeterKind,
) {
  return tx.utilityRate.findMany({
    where: { propertyId, ...(kind ? { kind } : {}) },
    orderBy: [{ kind: "asc" }, { effectiveFrom: "desc" }],
  });
}

export function findUtilityRateAt(
  tx: Prisma.TransactionClient,
  input: { propertyId: string; kind: MeterKind; effectiveOn: Date },
) {
  return tx.utilityRate.findFirst({
    where: {
      propertyId: input.propertyId,
      kind: input.kind,
      effectiveFrom: { lte: input.effectiveOn },
    },
    orderBy: { effectiveFrom: "desc" },
  });
}
