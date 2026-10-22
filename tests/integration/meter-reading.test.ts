import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import {
  closeBillingPeriod,
  createBillingPeriod,
} from "../../src/server/finance";
import {
  confirmReading,
  correctReading,
  getReadingHistory,
  getReadingOverview,
  registerMeter,
  replaceMeter,
  upsertDraftReading,
} from "../../src/server/meter";
import type { Actor } from "../../src/server/services";

let admin: Actor;
let staff: Actor;
let propertyId: string;
let roomId: string;
let meterId: string;
let electricityMeterId: string;
let januaryId: string;
let februaryId: string;
let marchId: string;
const suffix = randomUUID().slice(0, 8);

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.endsWith("/taky_phase2_test"))
    throw new Error("Only run integration tests in the isolated test database");
  admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  staff = await db.user.findUniqueOrThrow({
    where: { username: "test-staff" },
  });
  const property = await db.property.create({
    data: {
      code: `METER-${suffix}`,
      name: "Isolated meter workflow",
      floors: {
        create: [1, 2, 3].map((number) => ({
          number,
          name: `ชั้น ${number}`,
          rooms: {
            create: [1, 2, 3, 4, 5].map((index) => ({
              number: `M${number * 100 + index}`,
              rent: "0.00",
            })),
          },
        })),
      },
    },
  });
  propertyId = property.id;
  roomId = (
    await db.room.findFirstOrThrow({
      where: { number: "M305", floor: { propertyId } },
    })
  ).id;
  januaryId = (
    await createBillingPeriod(admin, { propertyId, month: "2026-01" })
  ).id;
  februaryId = (
    await createBillingPeriod(admin, { propertyId, month: "2026-02" })
  ).id;
  marchId = (await createBillingPeriod(admin, { propertyId, month: "2026-03" }))
    .id;
});

afterAll(() => db.$disconnect());

describe("Stage 3B PostgreSQL meter workflow", () => {
  it("applies migration and exposes both utility slots before setup", async () => {
    const migrations = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(migrations.map((row) => row.migration_name)).toContain(
      "202610180002_phase3b_meter_reading",
    );
    const overview = await getReadingOverview({
      billingPeriodId: januaryId,
      roomId,
    });
    expect(overview.summary).toMatchObject({
      rooms: 1,
      totalSlots: 2,
      missing: 2,
    });
    expect(overview.rooms[0]?.meters.map((slot) => slot.meterId)).toEqual([
      null,
      null,
    ]);
  });

  it("requires ADMIN for initial registration and creates an explicit opening reading atomically", async () => {
    const input = {
      roomId,
      kind: "WATER",
      serial: `W-${suffix}`,
      installedAt: "2026-01-01",
      openingReading: "100.125",
      reason: "ติดตั้งมิเตอร์เริ่มต้น",
    } as const;
    await expect(registerMeter(staff, input)).rejects.toMatchObject({
      status: 403,
    });
    const result = await registerMeter(admin, input);
    meterId = result.meter.id;
    expect(result.openingReading).toMatchObject({
      type: "OPENING",
      status: "CONFIRMED",
      value: "100.125",
      consumption: null,
    });
    expect(
      await db.auditLog.count({
        where: { entityId: meterId, action: "REGISTER" },
      }),
    ).toBe(1);
    const electricity = await registerMeter(admin, {
      roomId,
      kind: "ELECTRICITY",
      serial: `E-${suffix}`,
      installedAt: "2026-01-02",
      openingReading: "500.000",
      reason: "ติดตั้งมิเตอร์ไฟฟ้าเริ่มต้น",
    });
    electricityMeterId = electricity.meter.id;
  });

  it("restricts opening-reading drafts and confirmations to ADMIN", async () => {
    const before = await db.meterReading.count({ where: { meterId } });
    await expect(
      upsertDraftReading(staff, {
        meterId,
        billingPeriodId: februaryId,
        value: "101.000",
        readingDate: "2026-02-15",
        type: "OPENING",
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(await db.meterReading.count({ where: { meterId } })).toBe(before);

    const unmeteredRoom = await db.room.findFirstOrThrow({
      where: { floor: { propertyId }, meters: { none: { kind: "WATER" } } },
      select: { id: true },
    });
    const freshMeter = await db.utilityMeter.create({
      data: {
        roomId: unmeteredRoom.id,
        kind: "WATER",
        serial: `OPEN-${suffix}`,
        activeFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const openingDraft = await upsertDraftReading(admin, {
      meterId: freshMeter.id,
      billingPeriodId: februaryId,
      value: "10.000",
      readingDate: "2026-02-15",
      type: "OPENING",
    });
    await expect(confirmReading(staff, openingDraft.id)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(
      await db.meterReading.findUniqueOrThrow({
        where: { id: openingDraft.id },
      }),
    ).toMatchObject({ status: "DRAFT", type: "OPENING" });
    await expect(confirmReading(admin, openingDraft.id)).resolves.toMatchObject(
      {
        status: "CONFIRMED",
        type: "OPENING",
        value: "10.000",
      },
    );
  });

  it("confirms readings in chronological order and rechecks stale drafts", async () => {
    const rooms = await db.room.findMany({
      where: { floor: { propertyId }, meters: { none: { kind: "WATER" } } },
      select: { id: true },
      take: 3,
    });
    expect(rooms).toHaveLength(3);

    const orderedMeter = await registerMeter(admin, {
      roomId: rooms[0]!.id,
      kind: "WATER",
      serial: `ORDER-${suffix}`,
      installedAt: "2026-01-01",
      openingReading: "100.000",
      reason: "ลำดับทดสอบ",
    });
    const februaryDraft = await upsertDraftReading(staff, {
      meterId: orderedMeter.meter.id,
      billingPeriodId: februaryId,
      value: "110.000",
      readingDate: "2026-02-15",
      type: "NORMAL",
    });
    const marchDraft = await upsertDraftReading(staff, {
      meterId: orderedMeter.meter.id,
      billingPeriodId: marchId,
      value: "120.000",
      readingDate: "2026-03-15",
      type: "NORMAL",
    });
    await expect(confirmReading(staff, marchDraft.id)).rejects.toMatchObject({
      status: 409,
      code: "READING_ORDER",
    });
    const unchangedMarch = await db.meterReading.findUniqueOrThrow({
      where: { id: marchDraft.id },
    });
    expect(unchangedMarch.status).toBe("DRAFT");
    expect(unchangedMarch.consumption?.toFixed(3)).toBe("20.000");

    await expect(
      confirmReading(staff, februaryDraft.id),
    ).resolves.toMatchObject({
      status: "CONFIRMED",
      consumption: "10.000",
    });
    await expect(confirmReading(staff, marchDraft.id)).resolves.toMatchObject({
      status: "CONFIRMED",
      consumption: "10.000",
    });

    const staleMeter = await registerMeter(admin, {
      roomId: rooms[1]!.id,
      kind: "WATER",
      serial: `STALE-${suffix}`,
      installedAt: "2026-01-01",
      openingReading: "200.000",
      reason: "ลำดับย้อนหลังทดสอบ",
    });
    const laterDraft = await upsertDraftReading(staff, {
      meterId: staleMeter.meter.id,
      billingPeriodId: marchId,
      value: "220.000",
      readingDate: "2026-03-15",
      type: "NORMAL",
    });
    const laterConfirmed = await confirmReading(staff, laterDraft.id);
    await expect(
      upsertDraftReading(staff, {
        meterId: staleMeter.meter.id,
        billingPeriodId: februaryId,
        value: "210.000",
        readingDate: "2026-02-15",
        type: "NORMAL",
      }),
    ).rejects.toMatchObject({ status: 409, code: "READING_ORDER" });
    const oldDraft = await db.meterReading.create({
      data: {
        meterId: staleMeter.meter.id,
        period: new Date("2026-02-01T00:00:00.000Z"),
        billingPeriodId: februaryId,
        readingDate: new Date("2026-02-15T00:00:00.000Z"),
        value: "210.000",
        consumption: "10.000",
        type: "NORMAL",
        status: "DRAFT",
        previousReadingId: staleMeter.openingReading.id,
        recordedById: staff.id,
      },
    });
    await expect(confirmReading(staff, oldDraft.id)).rejects.toMatchObject({
      status: 409,
      code: "READING_ORDER",
    });
    const unchangedOld = await db.meterReading.findUniqueOrThrow({
      where: { id: oldDraft.id },
    });
    const unchangedLater = await db.meterReading.findUniqueOrThrow({
      where: { id: laterConfirmed.id },
    });
    expect(unchangedOld.status).toBe("DRAFT");
    expect(unchangedLater.status).toBe("CONFIRMED");
    expect(unchangedLater.consumption?.toFixed(3)).toBe("20.000");
    expect(
      await db.auditLog.count({
        where: { entityId: oldDraft.id, action: "CONFIRM" },
      }),
    ).toBe(0);

    const concurrentMeter = await registerMeter(admin, {
      roomId: rooms[2]!.id,
      kind: "WATER",
      serial: `RACE-${suffix}`,
      installedAt: "2026-01-01",
      openingReading: "300.000",
      reason: "ทดสอบยืนยันพร้อมกัน",
    });
    const concurrentFebruary = await upsertDraftReading(staff, {
      meterId: concurrentMeter.meter.id,
      billingPeriodId: februaryId,
      value: "310.000",
      readingDate: "2026-02-15",
      type: "NORMAL",
    });
    const concurrentMarch = await upsertDraftReading(staff, {
      meterId: concurrentMeter.meter.id,
      billingPeriodId: marchId,
      value: "320.000",
      readingDate: "2026-03-15",
      type: "NORMAL",
    });
    await Promise.allSettled([
      confirmReading(staff, concurrentMarch.id),
      confirmReading(staff, concurrentFebruary.id),
    ]);
    const racedReadings = await db.meterReading.findMany({
      where: { meterId: concurrentMeter.meter.id },
    });
    const racedFebruary = racedReadings.find(
      (reading) => reading.id === concurrentFebruary.id,
    );
    const racedMarch = racedReadings.find(
      (reading) => reading.id === concurrentMarch.id,
    );
    expect(racedFebruary?.status).toBe("CONFIRMED");
    if (racedMarch?.status === "CONFIRMED")
      expect(racedMarch.consumption?.toFixed(3)).toBe("10.000");
    else {
      expect(racedMarch?.status).toBe("DRAFT");
      await expect(
        confirmReading(staff, concurrentMarch.id),
      ).resolves.toMatchObject({ status: "CONFIRMED", consumption: "10.000" });
    }
  });

  it("supports STAFF draft/confirm, exact usage, uniqueness, and idempotent concurrent confirmation", async () => {
    const draft = await upsertDraftReading(staff, {
      meterId,
      billingPeriodId: februaryId,
      value: "105.250",
      readingDate: "2026-02-28",
      type: "NORMAL",
    });
    expect(draft).toMatchObject({ status: "DRAFT", consumption: "5.125" });
    const secondDraft = await upsertDraftReading(staff, {
      meterId,
      billingPeriodId: februaryId,
      value: "106.250",
      readingDate: "2026-02-28",
      type: "NORMAL",
    });
    expect(secondDraft.id).toBe(draft.id);
    const results = await Promise.all([
      confirmReading(staff, draft.id),
      confirmReading(staff, draft.id),
    ]);
    expect(results[0]).toMatchObject({
      status: "CONFIRMED",
      consumption: "6.125",
    });
    expect(
      await db.meterReading.count({
        where: { meterId, billingPeriodId: februaryId },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { entityId: draft.id, action: "CONFIRM" },
      }),
    ).toBe(1);
    const electricDraft = await upsertDraftReading(staff, {
      meterId: electricityMeterId,
      billingPeriodId: februaryId,
      value: "540.500",
      readingDate: "2026-02-27",
      type: "NORMAL",
    });
    await confirmReading(staff, electricDraft.id);
    const overview = await getReadingOverview({
      billingPeriodId: februaryId,
      roomId,
    });
    expect(
      overview.rooms[0]?.meters.map((slot) => slot.reading?.readingDate),
    ).toEqual(["2026-02-28", "2026-02-27"]);
  });

  it("allows historical dates but rejects future dates before writing", async () => {
    const count = await db.meterReading.count();
    await expect(
      upsertDraftReading(staff, {
        meterId: electricityMeterId,
        billingPeriodId: marchId,
        value: "550.000",
        readingDate: "2099-03-01",
        type: "NORMAL",
      }),
    ).rejects.toMatchObject({ code: "FUTURE_READING_DATE" });
    expect(await db.meterReading.count()).toBe(count);
  });

  it("enforces correction RBAC and immutable provenance", async () => {
    const reading = await db.meterReading.findUniqueOrThrow({
      where: {
        meterId_billingPeriodId: { meterId, billingPeriodId: februaryId },
      },
    });
    await expect(
      correctReading(staff, reading.id, {
        value: "106.000",
        reason: "ตรวจสอบภาพมิเตอร์อีกครั้ง",
      }),
    ).rejects.toMatchObject({ status: 403 });
    const corrected = await correctReading(admin, reading.id, {
      value: "106.000",
      reason: "ตรวจสอบภาพมิเตอร์อีกครั้ง",
    });
    expect(corrected.correction).toMatchObject({
      oldValue: "106.250",
      newValue: "106.000",
      readingDate: "2026-02-28",
    });
    await expect(
      db.meterReadingCorrection.update({
        where: { id: corrected.correction.id },
        data: { reason: "เปลี่ยน" },
      }),
    ).rejects.toThrow();
    const history = await getReadingHistory({ roomId, kind: "WATER" });
    expect(history.corrections).toHaveLength(1);
    expect(history.corrections[0]?.readingDate).toBe("2026-02-28");
  });

  it("corrects a non-latest reading and records derived next-consumption provenance", async () => {
    const marchDraft = await upsertDraftReading(staff, {
      meterId,
      billingPeriodId: marchId,
      value: "110.000",
      readingDate: "2026-03-10",
      type: "NORMAL",
    });
    await confirmReading(staff, marchDraft.id);
    const february = await db.meterReading.findUniqueOrThrow({
      where: {
        meterId_billingPeriodId: { meterId, billingPeriodId: februaryId },
      },
    });
    await correctReading(admin, february.id, {
      value: "105.500",
      reason: "แก้ค่าก่อนหน้าและคำนวณเดือนถัดไปใหม่",
    });
    const march = await db.meterReading.findUniqueOrThrow({
      where: { id: marchDraft.id },
    });
    expect(march.consumption?.toFixed(3)).toBe("4.500");
    expect(
      await db.meterReadingCorrection.count({
        where: {
          readingId: march.id,
          oldValue: march.value,
          newValue: march.value,
        },
      }),
    ).toBe(1);
  });

  it("atomically rejects correction when its confirmed successor is in a closed period", async () => {
    const room = await db.room.findFirstOrThrow({
      where: { floor: { propertyId }, meters: { none: { kind: "WATER" } } },
      select: { id: true },
    });
    const registered = await registerMeter(admin, {
      roomId: room.id,
      kind: "WATER",
      serial: `CLOSED-${suffix}`,
      installedAt: "2026-01-01",
      openingReading: "100.000",
      reason: "ทดสอบรอบปิด",
    });
    const march = await upsertDraftReading(staff, {
      meterId: registered.meter.id,
      billingPeriodId: marchId,
      value: "110.000",
      readingDate: "2026-03-15",
      type: "NORMAL",
    });
    await confirmReading(staff, march.id);

    const mayStartsOn = new Date("2026-05-01T00:00:00.000Z");
    const may =
      (await db.billingPeriod.findUnique({
        where: {
          propertyId_startsOn: { propertyId, startsOn: mayStartsOn },
        },
      })) ??
      (await createBillingPeriod(admin, { propertyId, month: "2026-05" }));
    const mayDraft = await upsertDraftReading(staff, {
      meterId: registered.meter.id,
      billingPeriodId: may.id,
      value: "120.000",
      readingDate: "2026-05-15",
      type: "NORMAL",
    });
    await confirmReading(staff, mayDraft.id);
    if (may.status === "OPEN") await closeBillingPeriod(admin, may.id);

    const before = await Promise.all([
      db.meterReading.findUniqueOrThrow({ where: { id: march.id } }),
      db.meterReading.findUniqueOrThrow({ where: { id: mayDraft.id } }),
      db.meterReadingCorrection.count({
        where: { readingId: { in: [march.id, mayDraft.id] } },
      }),
      db.auditLog.count({
        where: {
          entityId: { in: [march.id, mayDraft.id] },
          action: { in: ["CORRECT", "CONFIRM"] },
        },
      }),
    ]);

    await expect(
      correctReading(admin, march.id, {
        value: "105.500",
        reason: "แก้ไขก่อนรอบปิด",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });

    const after = await Promise.all([
      db.meterReading.findUniqueOrThrow({ where: { id: march.id } }),
      db.meterReading.findUniqueOrThrow({ where: { id: mayDraft.id } }),
      db.meterReadingCorrection.count({
        where: { readingId: { in: [march.id, mayDraft.id] } },
      }),
      db.auditLog.count({
        where: {
          entityId: { in: [march.id, mayDraft.id] },
          action: { in: ["CORRECT", "CONFIRM"] },
        },
      }),
    ]);
    expect(after[0]?.value.toFixed(3)).toBe("110.000");
    expect(after[0]?.consumption?.toFixed(3)).toBe(
      before[0]?.consumption?.toFixed(3),
    );
    expect(after[0]?.previousReadingId).toBe(before[0]?.previousReadingId);
    expect(after[1]?.consumption?.toFixed(3)).toBe("10.000");
    expect(after[1]?.previousReadingId).toBe(before[1]?.previousReadingId);
    expect(after[2]).toBe(before[2]);
    expect(after[3]).toBe(before[3]);
  });

  it("serializes predecessor correction with successor confirmation", async () => {
    const room = await db.room.findFirstOrThrow({
      where: { floor: { propertyId }, meters: { none: { kind: "WATER" } } },
      select: { id: true },
    });
    const registered = await registerMeter(admin, {
      roomId: room.id,
      kind: "WATER",
      serial: `RACE-${suffix}`,
      installedAt: "2026-01-01",
      openingReading: "100.000",
      reason: "ทดสอบการแก้ไขพร้อมยืนยัน",
    });
    const february = await upsertDraftReading(staff, {
      meterId: registered.meter.id,
      billingPeriodId: februaryId,
      value: "110.000",
      readingDate: "2026-02-15",
      type: "NORMAL",
    });
    await confirmReading(staff, february.id);
    const march = await upsertDraftReading(staff, {
      meterId: registered.meter.id,
      billingPeriodId: marchId,
      value: "120.000",
      readingDate: "2026-03-15",
      type: "NORMAL",
    });

    const outcomes = await Promise.allSettled([
      correctReading(admin, february.id, {
        value: "105.500",
        reason: "ยืนยันลำดับการเขียนพร้อมกัน",
      }),
      confirmReading(staff, march.id),
    ]);
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toMatchObject({ code: "P2034" });
        if (index === 0) {
          await correctReading(admin, february.id, {
            value: "105.500",
            reason: "ลองใหม่หลัง serialization conflict",
          });
        } else {
          await confirmReading(staff, march.id);
        }
      }
    }

    const [savedFebruary, savedMarch] = await Promise.all([
      db.meterReading.findUniqueOrThrow({ where: { id: february.id } }),
      db.meterReading.findUniqueOrThrow({ where: { id: march.id } }),
    ]);
    expect(savedFebruary.value.toFixed(3)).toBe("105.500");
    expect(savedMarch.status).toBe("CONFIRMED");
    expect(savedMarch.consumption?.toFixed(3)).toBe("14.500");
    const downstreamCorrections = await db.meterReadingCorrection.count({
      where: { readingId: march.id },
    });
    expect(downstreamCorrections).toBeLessThanOrEqual(1);
    expect(
      await db.meterReadingCorrection.count({
        where: { readingId: february.id },
      }),
    ).toBe(1);
  });

  it("rejects writes and ordinary corrections in a closed period", async () => {
    await closeBillingPeriod(admin, februaryId);
    const reading = await db.meterReading.findUniqueOrThrow({
      where: {
        meterId_billingPeriodId: { meterId, billingPeriodId: februaryId },
      },
    });
    await expect(
      correctReading(admin, reading.id, {
        value: "105.900",
        reason: "แก้ย้อนหลัง",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    await expect(
      upsertDraftReading(staff, {
        meterId,
        billingPeriodId: februaryId,
        value: "107.000",
        readingDate: "2026-02-28",
        type: "NORMAL",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("rolls replacement back on conflict and records separate old/new identities", async () => {
    const april = await createBillingPeriod(admin, {
      propertyId,
      month: "2026-04",
    });
    await expect(
      replaceMeter(admin, {
        oldMeterId: meterId,
        newSerial: `W-${suffix}`,
        finalReading: "115.000",
        initialReading: "2.500",
        replacementDate: "2026-04-15",
        reason: "มิเตอร์ชำรุด",
      }),
    ).rejects.toThrow();
    expect(
      (await db.utilityMeter.findUniqueOrThrow({ where: { id: meterId } }))
        .activeUntil,
    ).toBeNull();
    const result = await replaceMeter(admin, {
      oldMeterId: meterId,
      newSerial: `W2-${suffix}`,
      finalReading: "115.000",
      initialReading: "2.500",
      replacementDate: "2026-04-15",
      reason: "มิเตอร์ชำรุด",
    });
    expect(result.finalReading).toMatchObject({
      type: "FINAL",
      consumption: "5.000",
      billingPeriodId: april.id,
    });
    expect(result.initialReading).toMatchObject({
      type: "OPENING",
      consumption: null,
      value: "2.500",
      billingPeriodId: april.id,
    });
    expect(result.finalReading.meterId).not.toBe(result.initialReading.meterId);
    expect(
      await db.auditLog.count({
        where: { entityId: result.newMeter.id, action: "REPLACE" },
      }),
    ).toBe(1);
    expect(april.status).toBe("OPEN");
    const periodReadings = await db.meterReading.findMany({
      where: {
        billingPeriodId: april.id,
        id: { in: [result.finalReading.id, result.initialReading.id] },
      },
    });
    expect(periodReadings.map((reading) => reading.id).sort()).toEqual(
      [result.finalReading.id, result.initialReading.id].sort(),
    );
    await expect(
      correctReading(admin, result.finalReading.id, {
        value: "115.125",
        reason: "ตรวจสอบเลขสุดท้ายก่อนปิดรอบ",
      }),
    ).resolves.toMatchObject({
      reading: { billingPeriodId: april.id, value: "115.125" },
      correction: { readingDate: "2026-04-15" },
    });
  });

  it("keeps a later closed reading unchanged across multiple successors", async () => {
    const room = await db.room.findFirstOrThrow({
      where: { floor: { propertyId }, meters: { none: { kind: "WATER" } } },
      select: { id: true },
    });
    const registered = await registerMeter(admin, {
      roomId: room.id,
      kind: "WATER",
      serial: `MULTI-${suffix}`,
      installedAt: "2026-01-01",
      openingReading: "100.000",
      reason: "ทดสอบค่ามิเตอร์หลายรอบ",
    });
    const march = await upsertDraftReading(staff, {
      meterId: registered.meter.id,
      billingPeriodId: marchId,
      value: "110.000",
      readingDate: "2026-03-15",
      type: "NORMAL",
    });
    await confirmReading(staff, march.id);

    const juneStartsOn = new Date("2026-06-01T00:00:00.000Z");
    const june =
      (await db.billingPeriod.findUnique({
        where: {
          propertyId_startsOn: { propertyId, startsOn: juneStartsOn },
        },
      })) ??
      (await createBillingPeriod(admin, { propertyId, month: "2026-06" }));
    expect(june.status).toBe("OPEN");
    const juneDraft = await upsertDraftReading(staff, {
      meterId: registered.meter.id,
      billingPeriodId: june.id,
      value: "115.000",
      readingDate: "2026-06-15",
      type: "NORMAL",
    });
    await confirmReading(staff, juneDraft.id);

    const julyStartsOn = new Date("2026-07-01T00:00:00.000Z");
    const july =
      (await db.billingPeriod.findUnique({
        where: {
          propertyId_startsOn: { propertyId, startsOn: julyStartsOn },
        },
      })) ??
      (await createBillingPeriod(admin, { propertyId, month: "2026-07" }));
    const julyDraft = await upsertDraftReading(staff, {
      meterId: registered.meter.id,
      billingPeriodId: july.id,
      value: "120.000",
      readingDate: "2026-07-15",
      type: "NORMAL",
    });
    await confirmReading(staff, julyDraft.id);
    if (july.status === "OPEN") await closeBillingPeriod(admin, july.id);

    await expect(
      correctReading(admin, march.id, {
        value: "105.500",
        reason: "แก้ไขโดยไม่กระทบรอบปิด",
      }),
    ).resolves.toMatchObject({ reading: { value: "105.500" } });

    const [savedJune, savedJuly] = await Promise.all([
      db.meterReading.findUniqueOrThrow({ where: { id: juneDraft.id } }),
      db.meterReading.findUniqueOrThrow({ where: { id: julyDraft.id } }),
    ]);
    expect(savedJune.consumption?.toFixed(3)).toBe("9.500");
    expect(savedJuly.consumption?.toFixed(3)).toBe("5.000");
    expect(
      await db.meterReadingCorrection.count({
        where: { readingId: julyDraft.id },
      }),
    ).toBe(0);
  });

  it("keeps correction dependencies within the old physical meter during replacement", async () => {
    const room = await db.room.findFirstOrThrow({
      where: { floor: { propertyId }, meters: { none: { kind: "WATER" } } },
      select: { id: true },
    });
    const registered = await registerMeter(admin, {
      roomId: room.id,
      kind: "WATER",
      serial: `REPLACE-${suffix}`,
      installedAt: "2026-01-01",
      openingReading: "100.000",
      reason: "ทดสอบขอบเขตมิเตอร์",
    });
    const march = await upsertDraftReading(staff, {
      meterId: registered.meter.id,
      billingPeriodId: marchId,
      value: "110.000",
      readingDate: "2026-03-15",
      type: "NORMAL",
    });
    await confirmReading(staff, march.id);

    const juneStartsOn = new Date("2026-06-01T00:00:00.000Z");
    const june = await db.billingPeriod.findUniqueOrThrow({
      where: {
        propertyId_startsOn: { propertyId, startsOn: juneStartsOn },
      },
    });
    expect(june.status).toBe("OPEN");
    const replacement = await replaceMeter(admin, {
      oldMeterId: registered.meter.id,
      newSerial: `NEW-${suffix}`,
      finalReading: "120.000",
      initialReading: "2.500",
      replacementDate: "2026-06-15",
      reason: "ทดสอบการเปลี่ยนมิเตอร์",
    });

    await correctReading(admin, march.id, {
      value: "105.500",
      reason: "แก้ไขมิเตอร์เดิมเท่านั้น",
    });

    const [finalReading, initialReading] = await Promise.all([
      db.meterReading.findUniqueOrThrow({
        where: { id: replacement.finalReading.id },
      }),
      db.meterReading.findUniqueOrThrow({
        where: { id: replacement.initialReading.id },
      }),
    ]);
    expect(finalReading.meterId).toBe(registered.meter.id);
    expect(finalReading.consumption?.toFixed(3)).toBe("14.500");
    expect(initialReading.meterId).toBe(replacement.newMeter.id);
    expect(initialReading.consumption).toBeNull();
    expect(initialReading.previousReadingId).toBeNull();
    expect(
      await db.meterReadingCorrection.count({
        where: { readingId: initialReading.id },
      }),
    ).toBe(0);
  });
});
