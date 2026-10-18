import { Prisma, type MeterKind } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import {
  assertReadingDateNotFuture,
  calculateConsumption,
  canonicalReading,
} from "./calculations";
import {
  correctionInput,
  draftInput,
  historyInput,
  overviewInput,
  registrationInput,
  replacementInput,
  uuid,
} from "./validation";

const serializable = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
};
const date = (value: Date) => value.toISOString().slice(0, 10);
const timestamp = (value: Date | null) => value?.toISOString() ?? null;

function requireAdmin(actor: Actor) {
  if (actor.role !== "ADMIN")
    throw new AppError(403, "FORBIDDEN", "เฉพาะผู้ดูแลระบบเท่านั้น");
}

type ReadingRecord = Prisma.MeterReadingGetPayload<{
  include: { recordedBy: true; confirmedBy: true; meter: true };
}>;

function readingDto(value: ReadingRecord) {
  return {
    id: value.id,
    meterId: value.meterId,
    roomId: value.meter.roomId,
    kind: value.meter.kind,
    serial: value.meter.serial,
    billingPeriodId: value.billingPeriodId,
    value: value.value.toFixed(3),
    consumption: value.consumption?.toFixed(3) ?? null,
    readingDate: value.readingDate
      ? date(value.readingDate)
      : date(value.period),
    status: value.status,
    type: value.type,
    previousReadingId: value.previousReadingId,
    recordedBy: {
      id: value.recordedBy.id,
      name: value.recordedBy.name,
      username: value.recordedBy.username,
    },
    confirmedBy: value.confirmedBy
      ? {
          id: value.confirmedBy.id,
          name: value.confirmedBy.name,
          username: value.confirmedBy.username,
        }
      : null,
    confirmedAt: timestamp(value.confirmedAt),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

const readingInclude = {
  recordedBy: true,
  confirmedBy: true,
  meter: true,
} satisfies Prisma.MeterReadingInclude;

async function lockMeter(tx: Prisma.TransactionClient, meterId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "UtilityMeter" WHERE id = ${meterId}::uuid FOR UPDATE`;
  if (!rows.length) throw new AppError(404, "METER_NOT_FOUND", "ไม่พบมิเตอร์");
  return tx.utilityMeter.findUniqueOrThrow({
    where: { id: meterId },
    include: { room: { include: { floor: true } } },
  });
}

async function lockPeriod(
  tx: Prisma.TransactionClient,
  billingPeriodId: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "BillingPeriod" WHERE id = ${billingPeriodId}::uuid FOR UPDATE`;
  if (!rows.length)
    throw new AppError(404, "PERIOD_NOT_FOUND", "ไม่พบรอบเรียกเก็บ");
  const period = await tx.billingPeriod.findUniqueOrThrow({
    where: { id: billingPeriodId },
  });
  if (period.status !== "OPEN")
    throw new AppError(409, "PERIOD_CLOSED", "รอบเรียกเก็บปิดแล้ว");
  return period;
}

function assertDateInPeriod(
  readingDate: Date,
  period: { startsOn: Date; endsOn: Date },
) {
  if (readingDate < period.startsOn || readingDate > period.endsOn)
    throw new AppError(
      422,
      "READING_DATE_OUTSIDE_PERIOD",
      "วันที่อ่านมิเตอร์อยู่นอกรอบเรียกเก็บ",
    );
}

function assertMeterActive(
  meter: { activeFrom: Date | null; activeUntil: Date | null },
  readingDate: Date,
) {
  if (
    (meter.activeFrom && readingDate < meter.activeFrom) ||
    (meter.activeUntil && readingDate > meter.activeUntil)
  )
    throw new AppError(
      409,
      "METER_INACTIVE",
      "วันที่อ่านอยู่นอกช่วงการใช้งานของมิเตอร์",
    );
}

async function previousConfirmed(
  tx: Prisma.TransactionClient,
  meterId: string,
  readingDate: Date,
  excludeId?: string,
) {
  return tx.meterReading.findFirst({
    where: {
      meterId,
      status: "CONFIRMED",
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        { readingDate: { lt: readingDate } },
        { readingDate: null, period: { lt: readingDate } },
      ],
    },
    orderBy: [{ readingDate: "desc" }, { period: "desc" }],
  });
}

async function nextConfirmed(
  tx: Prisma.TransactionClient,
  meterId: string,
  readingDate: Date,
  excludeId?: string,
) {
  return tx.meterReading.findFirst({
    where: {
      meterId,
      status: "CONFIRMED",
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        { readingDate: { gt: readingDate } },
        { readingDate: null, period: { gt: readingDate } },
      ],
    },
    orderBy: [{ readingDate: "asc" }, { period: "asc" }],
  });
}

function usage(
  previous: { value: Prisma.Decimal } | null,
  current: string,
  type: "OPENING" | "NORMAL" | "FINAL",
) {
  if (type === "OPENING") {
    if (previous)
      throw new AppError(
        409,
        "OPENING_NOT_ALLOWED",
        "มิเตอร์นี้มีค่าตั้งต้นหรือประวัติแล้ว",
      );
    return null;
  }
  if (!previous)
    throw new AppError(
      409,
      "PREVIOUS_READING_REQUIRED",
      "ต้องบันทึกค่าตั้งต้นก่อนอ่านมิเตอร์รายเดือน",
    );
  return calculateConsumption({
    previousReading: previous.value.toFixed(3),
    currentReading: current,
  });
}

export async function getReadingOverview(input: unknown) {
  const query = overviewInput.parse(input);
  const period = await db.billingPeriod.findUnique({
    where: { id: query.billingPeriodId },
  });
  if (!period) throw new AppError(404, "PERIOD_NOT_FOUND", "ไม่พบรอบเรียกเก็บ");
  const rooms = await db.room.findMany({
    where: {
      floor: {
        propertyId: period.propertyId,
        ...(query.floor ? { number: query.floor } : {}),
      },
      ...(query.roomId ? { id: query.roomId } : {}),
    },
    include: {
      floor: true,
      meters: {
        where: {
          OR: [
            { activeFrom: null },
            { activeFrom: { lte: period.endsOn }, activeUntil: null },
            {
              activeFrom: { lte: period.endsOn },
              activeUntil: { gte: period.startsOn },
            },
          ],
        },
        include: {
          readings: {
            where: { billingPeriodId: period.id },
            include: readingInclude,
          },
        },
        orderBy: { activeFrom: "desc" },
      },
    },
    orderBy: [{ floor: { number: "asc" } }, { number: "asc" }],
  });
  let missing = 0,
    draft = 0,
    confirmed = 0;
  const resultRooms = await Promise.all(
    rooms.map(async (room) => {
      const slots = await Promise.all(
        (["WATER", "ELECTRICITY"] satisfies MeterKind[]).map(async (kind) => {
          const meter =
            room.meters.find((candidate) => candidate.kind === kind) ?? null;
          const reading = meter?.readings[0] ?? null;
          if (!reading) missing += 1;
          else if (reading.status === "DRAFT") draft += 1;
          else confirmed += 1;
          const previous = meter
            ? await db.meterReading.findFirst({
                where: {
                  meterId: meter.id,
                  status: "CONFIRMED",
                  OR: [
                    { readingDate: { lt: period.startsOn } },
                    { type: "OPENING", readingDate: { lte: period.endsOn } },
                  ],
                },
                orderBy: { readingDate: "desc" },
              })
            : null;
          return {
            meterId: meter?.id ?? null,
            kind,
            serial: meter?.serial ?? null,
            previousReading: previous
              ? {
                  id: previous.id,
                  value: previous.value.toFixed(3),
                  readingDate: date(previous.readingDate ?? previous.period),
                }
              : null,
            reading: reading ? readingDto(reading) : null,
          };
        }),
      );
      return {
        id: room.id,
        number: room.number,
        floor: {
          id: room.floor.id,
          number: room.floor.number,
          name: room.floor.name,
        },
        meters: slots,
      };
    }),
  );
  return {
    billingPeriod: {
      id: period.id,
      propertyId: period.propertyId,
      startsOn: date(period.startsOn),
      endsOn: date(period.endsOn),
      status: period.status,
    },
    summary: {
      rooms: resultRooms.length,
      totalSlots: resultRooms.length * 2,
      missing,
      draft,
      confirmed,
    },
    rooms: resultRooms,
  };
}

export async function upsertDraftReading(actor: Actor, input: unknown) {
  const data = draftInput.parse(input);
  const value = canonicalReading(data.value);
  assertReadingDateNotFuture(data.readingDate);
  const readingDate = new Date(`${data.readingDate}T00:00:00.000Z`);
  return db.$transaction(async (tx) => {
    const meter = await lockMeter(tx, data.meterId);
    const period = await lockPeriod(tx, data.billingPeriodId);
    if (meter.room.floor.propertyId !== period.propertyId)
      throw new AppError(
        409,
        "PROPERTY_MISMATCH",
        "มิเตอร์และรอบเรียกเก็บอยู่คนละอาคาร",
      );
    assertDateInPeriod(readingDate, period);
    assertMeterActive(meter, readingDate);
    const existing = await tx.meterReading.findUnique({
      where: {
        meterId_billingPeriodId: {
          meterId: meter.id,
          billingPeriodId: period.id,
        },
      },
    });
    if (existing?.status === "CONFIRMED")
      throw new AppError(409, "READING_CONFIRMED", "ยืนยันค่ามิเตอร์แล้ว");
    const previous = await previousConfirmed(
      tx,
      meter.id,
      readingDate,
      existing?.id,
    );
    const consumption = usage(previous, value, data.type);
    const following = await nextConfirmed(
      tx,
      meter.id,
      readingDate,
      existing?.id,
    );
    if (following && new Prisma.Decimal(value).greaterThan(following.value))
      throw new AppError(
        409,
        "CHRONOLOGY",
        "ค่ามิเตอร์สูงกว่าค่าที่บันทึกในภายหลัง",
      );
    const record = await tx.meterReading.upsert({
      where: {
        meterId_billingPeriodId: {
          meterId: meter.id,
          billingPeriodId: period.id,
        },
      },
      create: {
        meterId: meter.id,
        period: period.startsOn,
        billingPeriodId: period.id,
        readingDate,
        value,
        consumption,
        type: data.type,
        status: "DRAFT",
        previousReadingId: previous?.id,
        recordedById: actor.id,
      },
      update: {
        readingDate,
        value,
        consumption,
        type: data.type,
        previousReadingId: previous?.id,
        recordedById: actor.id,
      },
      include: readingInclude,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: existing ? "DRAFT_UPDATE" : "DRAFT_CREATE",
        entity: "meter_readings",
        entityId: record.id,
        metadata: { value, readingDate: data.readingDate, type: data.type },
      },
    });
    return readingDto(record);
  }, serializable);
}

export async function confirmReading(actor: Actor, idInput: unknown) {
  const id = uuid.parse(idInput);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "MeterReading" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length)
      throw new AppError(404, "READING_NOT_FOUND", "ไม่พบค่ามิเตอร์");
    const existing = await tx.meterReading.findUniqueOrThrow({
      where: { id },
      include: readingInclude,
    });
    if (existing.status === "CONFIRMED") return readingDto(existing);
    if (!existing.billingPeriodId)
      throw new AppError(
        409,
        "LEGACY_READING",
        "ข้อมูลเดิมไม่รองรับขั้นตอนนี้",
      );
    await lockPeriod(tx, existing.billingPeriodId);
    const record = await tx.meterReading.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        confirmedById: actor.id,
        confirmedAt: new Date(),
      },
      include: readingInclude,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "CONFIRM",
        entity: "meter_readings",
        entityId: id,
      },
    });
    return readingDto(record);
  });
}

export async function getReadingHistory(input: unknown) {
  const query = historyInput.parse(input);
  const readings = await db.meterReading.findMany({
    where: {
      meter: {
        roomId: query.roomId,
        ...(query.kind ? { kind: query.kind } : {}),
      },
    },
    include: readingInclude,
    orderBy: [{ readingDate: "desc" }, { period: "desc" }],
  });
  const corrections = await db.meterReadingCorrection.findMany({
    where: {
      reading: {
        meter: {
          roomId: query.roomId,
          ...(query.kind ? { kind: query.kind } : {}),
        },
      },
    },
    include: { correctedBy: true, reading: true },
    orderBy: { createdAt: "desc" },
  });
  const replacements = await db.meterReplacement.findMany({
    where: {
      roomId: query.roomId,
      ...(query.kind ? { kind: query.kind } : {}),
    },
    include: { oldMeter: true, newMeter: true, replacedBy: true },
    orderBy: { replacementDate: "desc" },
  });
  return {
    readings: readings.map(readingDto),
    corrections: corrections.map((item) => ({
      id: item.id,
      readingId: item.readingId,
      readingDate: date(item.reading.readingDate ?? item.reading.period),
      oldValue: item.oldValue.toFixed(3),
      newValue: item.newValue.toFixed(3),
      oldConsumption: item.oldConsumption?.toFixed(3) ?? null,
      newConsumption: item.newConsumption?.toFixed(3) ?? null,
      reason: item.reason,
      correctedBy: {
        id: item.correctedBy.id,
        name: item.correctedBy.name,
        username: item.correctedBy.username,
      },
      createdAt: item.createdAt.toISOString(),
    })),
    replacements: replacements.map((item) => ({
      id: item.id,
      kind: item.kind,
      oldMeter: { id: item.oldMeter.id, serial: item.oldMeter.serial },
      newMeter: { id: item.newMeter.id, serial: item.newMeter.serial },
      finalReadingId: item.finalReadingId,
      initialReadingId: item.initialReadingId,
      replacementDate: date(item.replacementDate),
      reason: item.reason,
      replacedBy: {
        id: item.replacedBy.id,
        name: item.replacedBy.name,
        username: item.replacedBy.username,
      },
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

export async function correctReading(
  actor: Actor,
  idInput: unknown,
  input: unknown,
) {
  requireAdmin(actor);
  const id = uuid.parse(idInput);
  const data = correctionInput.parse(input);
  const newValue = canonicalReading(data.value);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MeterReading" WHERE id = ${id}::uuid FOR UPDATE`;
    const existing = await tx.meterReading.findUnique({
      where: { id },
      include: readingInclude,
    });
    if (!existing)
      throw new AppError(404, "READING_NOT_FOUND", "ไม่พบค่ามิเตอร์");
    if (
      existing.status !== "CONFIRMED" ||
      !existing.readingDate ||
      !existing.billingPeriodId
    )
      throw new AppError(
        409,
        "CORRECTION_NOT_ALLOWED",
        "แก้ไขได้เฉพาะค่าที่ยืนยันในระบบใหม่",
      );
    await lockPeriod(tx, existing.billingPeriodId);
    const previous = await previousConfirmed(
      tx,
      existing.meterId,
      existing.readingDate,
      existing.id,
    );
    const next = await nextConfirmed(
      tx,
      existing.meterId,
      existing.readingDate,
      existing.id,
    );
    const newConsumption = usage(previous, newValue, existing.type);
    if (next && new Prisma.Decimal(newValue).greaterThan(next.value))
      throw new AppError(
        409,
        "CHRONOLOGY",
        "ค่าที่แก้ไขสูงกว่าค่าที่บันทึกในภายหลัง",
      );
    await tx.$queryRaw`SELECT set_config('taky.meter_correction', 'on', true)`;
    const correction = await tx.meterReadingCorrection.create({
      data: {
        readingId: id,
        oldValue: existing.value,
        newValue,
        oldConsumption: existing.consumption,
        newConsumption,
        reason: data.reason,
        correctedById: actor.id,
      },
      include: { correctedBy: true },
    });
    const record = await tx.meterReading.update({
      where: { id },
      data: { value: newValue, consumption: newConsumption },
      include: readingInclude,
    });
    if (next) {
      const nextConsumption = calculateConsumption({
        previousReading: newValue,
        currentReading: next.value.toFixed(3),
      });
      await tx.meterReadingCorrection.create({
        data: {
          readingId: next.id,
          oldValue: next.value,
          newValue: next.value,
          oldConsumption: next.consumption,
          newConsumption: nextConsumption,
          reason: `ปรับการใช้ต่อเนื่องจากการแก้ไข: ${data.reason.slice(0, 900)}`,
          correctedById: actor.id,
        },
      });
      await tx.meterReading.update({
        where: { id: next.id },
        data: { consumption: nextConsumption },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "CORRECT",
        entity: "meter_readings",
        entityId: id,
        metadata: {
          oldValue: existing.value.toFixed(3),
          newValue,
          readingDate: date(existing.readingDate),
          reason: data.reason,
          ...(next
            ? {
                affectedNextReadingId: next.id,
                oldNextConsumption: next.consumption?.toFixed(3) ?? null,
                newNextConsumption: calculateConsumption({
                  previousReading: newValue,
                  currentReading: next.value.toFixed(3),
                }),
              }
            : {}),
        },
      },
    });
    return {
      reading: readingDto(record),
      correction: {
        id: correction.id,
        readingId: id,
        readingDate: date(existing.readingDate),
        oldValue: correction.oldValue.toFixed(3),
        newValue: correction.newValue.toFixed(3),
        oldConsumption: correction.oldConsumption?.toFixed(3) ?? null,
        newConsumption: correction.newConsumption?.toFixed(3) ?? null,
        reason: correction.reason,
        correctedBy: {
          id: correction.correctedBy.id,
          name: correction.correctedBy.name,
          username: correction.correctedBy.username,
        },
        createdAt: correction.createdAt.toISOString(),
      },
    };
  }, serializable);
}

async function periodContaining(
  tx: Prisma.TransactionClient,
  propertyId: string,
  on: Date,
) {
  const period = await tx.billingPeriod.findFirst({
    where: { propertyId, startsOn: { lte: on }, endsOn: { gte: on } },
  });
  if (!period)
    throw new AppError(
      409,
      "PERIOD_REQUIRED",
      "ต้องสร้างรอบเรียกเก็บที่ครอบคลุมวันที่นี้ก่อน",
    );
  return lockPeriod(tx, period.id);
}

export async function registerMeter(actor: Actor, input: unknown) {
  requireAdmin(actor);
  const data = registrationInput.parse(input);
  assertReadingDateNotFuture(data.installedAt);
  const installedAt = new Date(`${data.installedAt}T00:00:00.000Z`);
  const openingReading = canonicalReading(data.openingReading);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${data.roomId}::uuid FOR UPDATE`;
    const room = await tx.room.findUnique({
      where: { id: data.roomId },
      include: { floor: true },
    });
    if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "ไม่พบห้อง");
    const active = await tx.utilityMeter.findFirst({
      where: { roomId: room.id, kind: data.kind, activeUntil: null },
    });
    if (active)
      throw new AppError(
        409,
        "ACTIVE_METER_EXISTS",
        "ห้องนี้มีมิเตอร์ชนิดนี้ใช้งานอยู่แล้ว",
      );
    const meter = await tx.utilityMeter.create({
      data: {
        roomId: room.id,
        kind: data.kind,
        serial: data.serial,
        activeFrom: installedAt,
      },
    });
    const reading = await tx.meterReading.create({
      data: {
        meterId: meter.id,
        period: installedAt,
        readingDate: installedAt,
        value: openingReading,
        type: "OPENING",
        status: "CONFIRMED",
        recordedById: actor.id,
        confirmedById: actor.id,
        confirmedAt: new Date(),
      },
      include: readingInclude,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "REGISTER",
        entity: "utility_meters",
        entityId: meter.id,
        metadata: {
          roomId: room.id,
          kind: data.kind,
          serial: data.serial,
          installedAt: data.installedAt,
          openingReading,
          reason: data.reason,
        },
      },
    });
    return {
      meter: {
        id: meter.id,
        roomId: meter.roomId,
        kind: meter.kind,
        serial: meter.serial,
        activeFrom: date(installedAt),
        activeUntil: null,
      },
      openingReading: readingDto(reading),
    };
  }, serializable);
}

export async function replaceMeter(actor: Actor, input: unknown) {
  requireAdmin(actor);
  const data = replacementInput.parse(input);
  assertReadingDateNotFuture(data.replacementDate);
  const replacementDate = new Date(`${data.replacementDate}T00:00:00.000Z`);
  const finalValue = canonicalReading(data.finalReading);
  const initialValue = canonicalReading(data.initialReading);
  return db.$transaction(async (tx) => {
    const oldMeter = await lockMeter(tx, data.oldMeterId);
    if (oldMeter.activeUntil)
      throw new AppError(409, "METER_INACTIVE", "มิเตอร์นี้ถูกเปลี่ยนแล้ว");
    assertMeterActive(oldMeter, replacementDate);
    const period = await periodContaining(
      tx,
      oldMeter.room.floor.propertyId,
      replacementDate,
    );
    const previous = await previousConfirmed(tx, oldMeter.id, replacementDate);
    const finalConsumption = usage(previous, finalValue, "FINAL");
    const existing = await tx.meterReading.findUnique({
      where: {
        meterId_billingPeriodId: {
          meterId: oldMeter.id,
          billingPeriodId: period.id,
        },
      },
    });
    if (existing)
      throw new AppError(
        409,
        "PERIOD_READING_EXISTS",
        "มิเตอร์เดิมมีรายการในรอบนี้แล้ว",
      );
    await tx.utilityMeter.update({
      where: { id: oldMeter.id },
      data: { activeUntil: replacementDate },
    });
    const newMeter = await tx.utilityMeter.create({
      data: {
        roomId: oldMeter.roomId,
        kind: oldMeter.kind,
        serial: data.newSerial,
        activeFrom: replacementDate,
      },
    });
    const now = new Date();
    const finalReading = await tx.meterReading.create({
      data: {
        meterId: oldMeter.id,
        period: replacementDate,
        readingDate: replacementDate,
        value: finalValue,
        consumption: finalConsumption,
        type: "FINAL",
        status: "CONFIRMED",
        previousReadingId: previous?.id,
        recordedById: actor.id,
        confirmedById: actor.id,
        confirmedAt: now,
      },
      include: readingInclude,
    });
    const initialReading = await tx.meterReading.create({
      data: {
        meterId: newMeter.id,
        period: period.startsOn,
        billingPeriodId: period.id,
        readingDate: replacementDate,
        value: initialValue,
        type: "OPENING",
        status: "CONFIRMED",
        recordedById: actor.id,
        confirmedById: actor.id,
        confirmedAt: now,
      },
      include: readingInclude,
    });
    const replacement = await tx.meterReplacement.create({
      data: {
        roomId: oldMeter.roomId,
        kind: oldMeter.kind,
        oldMeterId: oldMeter.id,
        newMeterId: newMeter.id,
        finalReadingId: finalReading.id,
        initialReadingId: initialReading.id,
        replacementDate,
        reason: data.reason,
        replacedById: actor.id,
      },
      include: { replacedBy: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "REPLACE",
        entity: "utility_meters",
        entityId: newMeter.id,
        metadata: {
          oldMeterId: oldMeter.id,
          finalReading: finalValue,
          initialReading: initialValue,
          replacementDate: data.replacementDate,
          reason: data.reason,
        },
      },
    });
    return {
      oldMeter: {
        id: oldMeter.id,
        serial: oldMeter.serial,
        activeUntil: data.replacementDate,
      },
      newMeter: {
        id: newMeter.id,
        serial: newMeter.serial,
        activeFrom: data.replacementDate,
      },
      finalReading: readingDto(finalReading),
      initialReading: readingDto(initialReading),
      replacement: {
        id: replacement.id,
        replacementDate: data.replacementDate,
        reason: replacement.reason,
        replacedBy: {
          id: replacement.replacedBy.id,
          name: replacement.replacedBy.name,
          username: replacement.replacedBy.username,
        },
        createdAt: replacement.createdAt.toISOString(),
      },
    };
  }, serializable);
}
