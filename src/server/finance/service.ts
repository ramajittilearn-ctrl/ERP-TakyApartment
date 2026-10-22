import { closeAndFreezeBillingPeriod } from "../invoices/service";
import { acquireSourceGate } from "../invoices/gate";
import { Prisma, type MeterKind } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import {
  findBillingPeriods,
  findUtilityRateAt,
  findUtilityRates,
  lockProperty,
} from "./repository";
import {
  billingPeriodCreateInput,
  billingPeriodListInput,
  utilityRateCreateInput,
  utilityRateListInput,
  utilityRateResolveInput,
} from "./validation";

function day(value: Date) {
  return value.toISOString().slice(0, 10);
}

function periodDto(value: {
  id: string;
  propertyId: string;
  startsOn: Date;
  endsOn: Date;
  status: "OPEN" | "CLOSED";
  closedAt: Date | null;
  createdById: string;
  closedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...value,
    startsOn: day(value.startsOn),
    endsOn: day(value.endsOn),
    closedAt: value.closedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function rateDto(value: {
  id: string;
  propertyId: string;
  kind: MeterKind;
  unitPrice: Prisma.Decimal;
  effectiveFrom: Date;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...value,
    unitPrice: value.unitPrice.toFixed(4),
    effectiveFrom: day(value.effectiveFrom),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function admin(actor: Actor) {
  if (actor.role !== "ADMIN")
    throw new AppError(403, "FORBIDDEN", "เฉพาะผู้ดูแลระบบเท่านั้น");
}

export async function listBillingPeriods(input: unknown) {
  const query = billingPeriodListInput.parse(input);
  return db.$transaction(async (tx) =>
    (await findBillingPeriods(tx, query.propertyId)).map(periodDto),
  );
}

export async function createBillingPeriod(actor: Actor, input: unknown) {
  const data = billingPeriodCreateInput.parse(input);
  const startsOn = new Date(`${data.month}-01T00:00:00.000Z`);
  const endsOn = new Date(
    Date.UTC(startsOn.getUTCFullYear(), startsOn.getUTCMonth() + 1, 0),
  );
  return db.$transaction(
    async (tx) => {
      await acquireSourceGate(tx);
      if (!(await lockProperty(tx, data.propertyId)).length)
        throw new AppError(404, "NOT_FOUND", "ไม่พบอาคาร");
      const record = await tx.billingPeriod.create({
        data: {
          propertyId: data.propertyId,
          startsOn,
          endsOn,
          createdById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "CREATE",
          entity: "billing_periods",
          entityId: record.id,
          metadata: { month: data.month },
        },
      });
      return periodDto(record);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function closeBillingPeriod(actor: Actor, idInput: unknown) {
  return periodDto(await closeAndFreezeBillingPeriod(actor, idInput));
}

export async function listUtilityRates(input: unknown) {
  const query = utilityRateListInput.parse(input);
  return db.$transaction(async (tx) =>
    (await findUtilityRates(tx, query.propertyId, query.kind)).map(rateDto),
  );
}

export async function resolveUtilityRate(input: unknown) {
  const query = utilityRateResolveInput.parse(input);
  const record = await db.$transaction((tx) =>
    findUtilityRateAt(tx, {
      propertyId: query.propertyId,
      kind: query.kind,
      effectiveOn: new Date(`${query.effectiveOn}T00:00:00.000Z`),
    }),
  );
  if (!record)
    throw new AppError(
      404,
      "UTILITY_RATE_NOT_FOUND",
      "ไม่พบอัตราค่าสาธารณูปโภคสำหรับวันที่กำหนด",
    );
  return rateDto(record);
}

export async function createUtilityRate(actor: Actor, input: unknown) {
  admin(actor);
  const data = utilityRateCreateInput.parse(input);
  return db.$transaction(
    async (tx) => {
      await acquireSourceGate(tx);
      if (!(await lockProperty(tx, data.propertyId)).length)
        throw new AppError(404, "NOT_FOUND", "ไม่พบอาคาร");
      const record = await tx.utilityRate.create({
        data: {
          propertyId: data.propertyId,
          kind: data.kind,
          effectiveFrom: new Date(`${data.effectiveFrom}T00:00:00.000Z`),
          unitPrice: data.unitPrice,
          createdById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "CREATE",
          entity: "utility_rates",
          entityId: record.id,
          metadata: {
            kind: data.kind,
            effectiveFrom: data.effectiveFrom,
            unitPrice: new Prisma.Decimal(data.unitPrice).toFixed(4),
          },
        },
      });
      return rateDto(record);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
