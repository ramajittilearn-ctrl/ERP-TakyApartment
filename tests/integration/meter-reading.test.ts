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
  const property = await db.property.findUniqueOrThrow({
    where: { code: "TAKY" },
  });
  propertyId = property.id;
  roomId = (
    await db.room.findFirstOrThrow({
      where: { number: "305", floor: { propertyId } },
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
    });
    expect(result.initialReading).toMatchObject({
      type: "OPENING",
      consumption: null,
      value: "2.500",
    });
    expect(result.finalReading.meterId).not.toBe(result.initialReading.meterId);
    expect(
      await db.auditLog.count({
        where: { entityId: result.newMeter.id, action: "REPLACE" },
      }),
    ).toBe(1);
    expect(april.status).toBe("OPEN");
  });
});
