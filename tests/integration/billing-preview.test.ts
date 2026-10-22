import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import {
  approveBillingConsumption,
  approveBillingRate,
  getBillingPreview,
} from "../../src/server/billing";
import {
  createBillingPeriod,
  createUtilityRate,
  closeBillingPeriod,
} from "../../src/server/finance";
import {
  registerMeter,
  upsertDraftReading,
  confirmReading,
  replaceMeter,
  correctReading,
} from "../../src/server/meter";
import type { Actor } from "../../src/server/services";

let admin: Actor;
let staff: Actor;
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.endsWith("/taky_phase2_test"))
    throw new Error("Only run in dedicated isolated test database");
  const identity = await db.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  expect(identity[0].name).toBe("taky_phase2_test");
  admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  staff = await db.user.findUniqueOrThrow({
    where: { username: "test-staff" },
  });
});
afterAll(() => db.$disconnect());

async function fixture(rent = "1000.00") {
  const suffix = randomUUID();
  const property = await db.property.create({
    data: { code: `C${suffix}`, name: "Billing synthetic test" },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name: "Test floor" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "101", rent: "9999.00" },
  });
  const tenant = await db.tenant.create({
    data: { name: "Billing synthetic tenant", isDemo: true },
  });
  const lease = await db.lease.create({
    data: {
      number: `L${suffix}`,
      roomId: room.id,
      tenantId: tenant.id,
      rent,
      deposit: "0.00",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      status: "ACTIVE",
      isDemo: true,
    },
  });
  const prior = await createBillingPeriod(admin, {
    propertyId: property.id,
    month: "2026-01",
  });
  const period = await createBillingPeriod(admin, {
    propertyId: property.id,
    month: "2026-02",
  });
  const water = await createUtilityRate(admin, {
    propertyId: property.id,
    kind: "WATER",
    effectiveFrom: "2026-01-01",
    unitPrice: "20.0050",
  });
  const electricity = await createUtilityRate(admin, {
    propertyId: property.id,
    kind: "ELECTRICITY",
    effectiveFrom: "2026-01-01",
    unitPrice: "30.0050",
  });
  return { property, room, lease, prior, period, water, electricity };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function rates(f: Fixture) {
  for (const [kind, rate] of [
    ["WATER", f.water],
    ["ELECTRICITY", f.electricity],
  ] as const)
    await approveBillingRate(admin, {
      billingPeriodId: f.period.id,
      kind,
      utilityRateId: rate.id,
      reason: "Owner selects applicable rate",
    });
}
function estimate(f: Fixture, kind = "WATER", quantity = "1.000") {
  return {
    billingPeriodId: f.period.id,
    leaseId: f.lease.id,
    kind,
    reason: "Meter inaccessible; approved estimate",
    evidence: ["operator-note:synthetic"],
    source: {
      kind: "ESTIMATE",
      quantity,
      sourceContext: "Prior usage and operator visit",
    },
  };
}
async function meter(f: Fixture, kind: "WATER" | "ELECTRICITY") {
  const result = await registerMeter(admin, {
    roomId: f.room.id,
    kind,
    serial: randomUUID(),
    installedAt: "2026-01-01",
    openingReading: "0.000",
    reason: "Synthetic installation",
  });
  const previous = await upsertDraftReading(staff, {
    meterId: result.meter.id,
    billingPeriodId: f.prior.id,
    readingDate: "2026-01-31",
    value: "100.000",
  });
  await confirmReading(staff, previous.id);
  return result;
}
async function actual(
  f: Fixture,
  kind: "WATER" | "ELECTRICITY",
  value = "101.000",
) {
  const m = await meter(f, kind);
  const draft = await upsertDraftReading(staff, {
    meterId: m.meter.id,
    billingPeriodId: f.period.id,
    readingDate: kind === "WATER" ? "2026-02-20" : "2026-02-25",
    value,
  });
  const reading = await confirmReading(staff, draft.id);
  return { ...m, reading };
}
async function preview(f: Fixture) {
  return getBillingPreview(staff, { billingPeriodId: f.period.id });
}
function codes(value: Awaited<ReturnType<typeof getBillingPreview>>) {
  return value.results.flatMap((row) =>
    row.result.issues.map((issue) => issue.code),
  );
}
async function financialCounts() {
  return Promise.all([
    db.invoice.count(),
    db.invoiceItem.count(),
    db.meterReading.count(),
    db.billingRateSelection.count(),
    db.billingConsumptionApproval.count(),
    db.auditLog.count(),
  ]);
}

describe("Stage 3C-2 isolated PostgreSQL billing", () => {
  it("applies additive approval migrations and retains the invoice uniqueness contract", async () => {
    const migrations = await db.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(migrations.map((row) => row.migration_name)).toContain(
      "202610200001_phase3c2_approval_sources",
    );
    expect(migrations.map((row) => row.migration_name)).toContain(
      "202610200002_phase3c2_lease_allocations",
    );
    const indexes = await db.$queryRaw<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE tablename = 'Invoice'`;
    expect(indexes.map((row) => row.indexname)).toContain(
      "Invoice_active_lease_period_key",
    );
  });
  it("reports missing inputs and never defaults to zero", async () => {
    const f = await fixture();
    expect(codes(await preview(f))).toEqual(
      expect.arrayContaining(["MISSING_RATE", "MISSING_CONSUMPTION"]),
    );
    expect((await preview(f)).results[0].result.totals).toBeNull();
  });
  it("rejects STAFF approvals without any approval, reading, invoice or audit writes", async () => {
    const f = await fixture();
    const before = await financialCounts();
    await expect(
      approveBillingRate(staff, {
        billingPeriodId: f.period.id,
        kind: "WATER",
        utilityRateId: f.water.id,
        reason: "Denied attempt",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      approveBillingConsumption(staff, estimate(f)),
    ).rejects.toMatchObject({ status: 403 });
    expect(await financialCounts()).toEqual(before);
  });
  it("uses contractual rent, separate dates, exact raw totals and read-only deterministic previews", async () => {
    const f = await fixture();
    await rates(f);
    await actual(f, "WATER");
    await actual(f, "ELECTRICITY");
    const before = await financialCounts();
    const first = await preview(f);
    expect(first).toEqual(await preview(f));
    expect(first.complete).toBe(true);
    expect(first.results[0].result.totals).toMatchObject({
      finalTotal: "1050.01",
      displayLineTotal: "1050.02",
      reconciliationDelta: "-0.01",
    });
    expect(first.results[0].result.snapshot?.source.lease.rent).toBe("1000.00");
    expect(first.eligibleForFutureIssuance).toBe(false);
    expect(await financialCounts()).toEqual(before);
  });
  it("allows either mid-month overlapping rate, retains history, rejects future/expired/wrong scope", async () => {
    const f = await fixture();
    const mid = await createUtilityRate(admin, {
      propertyId: f.property.id,
      kind: "WATER",
      effectiveFrom: "2026-02-15",
      unitPrice: "22.0000",
    });
    const future = await createUtilityRate(admin, {
      propertyId: f.property.id,
      kind: "WATER",
      effectiveFrom: "2026-03-01",
      unitPrice: "23.0000",
    });
    const first = await approveBillingRate(admin, {
      billingPeriodId: f.period.id,
      kind: "WATER",
      utilityRateId: f.water.id,
      reason: "Use earlier overlapping rate",
    });
    const second = await approveBillingRate(admin, {
      billingPeriodId: f.period.id,
      kind: "WATER",
      utilityRateId: mid.id,
      reason: "Use later overlapping rate",
    });
    expect(second.revision).toBe(2);
    expect(first.selectionId).not.toBe(first.id);
    await expect(
      approveBillingRate(admin, {
        billingPeriodId: f.period.id,
        kind: "WATER",
        utilityRateId: future.id,
        reason: "Future rate attempt",
      }),
    ).rejects.toMatchObject({ code: "RATE_NOT_ELIGIBLE" });
    await expect(
      approveBillingRate(admin, {
        billingPeriodId: f.period.id,
        kind: "WATER",
        utilityRateId: f.electricity.id,
        reason: "Wrong utility attempt",
      }),
    ).rejects.toMatchObject({ code: "RATE_SCOPE_MISMATCH" });
    const expired = await createUtilityRate(admin, {
      propertyId: f.property.id,
      kind: "WATER",
      effectiveFrom: "2025-01-01",
      unitPrice: "1.0000",
    });
    await expect(
      approveBillingRate(admin, {
        billingPeriodId: f.period.id,
        kind: "WATER",
        utilityRateId: expired.id,
        reason: "Expired rate attempt",
      }),
    ).rejects.toMatchObject({ code: "RATE_NOT_ELIGIBLE" });
    expect(
      await db.billingRateSelection.count({
        where: { billingPeriodId: f.period.id },
      }),
    ).toBe(2);
    expect(
      await db.auditLog.count({
        where: { entityId: second.selectionId, action: "APPROVE_RATE" },
      }),
    ).toBe(1);
  });
  it("persists explicit estimates and approval provenance without creating MeterReading records", async () => {
    const f = await fixture();
    await rates(f);
    const before = await db.meterReading.count();
    const approval = await approveBillingConsumption(admin, estimate(f));
    await approveBillingConsumption(admin, estimate(f, "ELECTRICITY"));
    const value = await preview(f);
    expect(value.complete).toBe(true);
    expect(
      value.results[0].result.snapshot?.source.utilities[0].consumption,
    ).toMatchObject({
      kind: "ESTIMATE",
      quantity: "1.000",
      approval: {
        id: approval.id,
        approverId: admin.id,
        approverRole: "ADMIN",
      },
    });
    expect(await db.meterReading.count()).toBe(before);
    expect(
      await db.auditLog.count({
        where: { entityId: approval.id, action: "APPROVE_CONSUMPTION" },
      }),
    ).toBe(1);
  });
  it("rejects excess scale, forged approval fields and missing reasons/evidence atomically", async () => {
    const f = await fixture();
    const before = await financialCounts();
    await expect(
      approveBillingConsumption(admin, estimate(f, "WATER", "1.0001")),
    ).rejects.toThrow();
    await expect(
      approveBillingConsumption(admin, {
        ...estimate(f),
        approval: { approverRole: "ADMIN" },
      }),
    ).rejects.toThrow();
    await expect(
      approveBillingConsumption(admin, {
        ...estimate(f),
        reason: "",
        evidence: [],
      }),
    ).rejects.toThrow();
    expect(await financialCounts()).toEqual(before);
  });
  it("detects actual/estimate conflict and permits an explicit audited ADMIN actual supersession in an open period", async () => {
    const f = await fixture();
    await rates(f);
    const old = await approveBillingConsumption(admin, estimate(f));
    await approveBillingConsumption(admin, estimate(f, "ELECTRICITY"));
    const m = await actual(f, "WATER");
    expect(codes(await preview(f))).toContain("ACTUAL_ESTIMATE_CONFLICT");
    await expect(
      approveBillingConsumption(admin, estimate(f)),
    ).rejects.toMatchObject({ code: "ACTUAL_ESTIMATE_CONFLICT" });
    const next = await approveBillingConsumption(admin, {
      ...estimate(f),
      source: { kind: "ACTUAL", currentReadingId: m.reading.id },
      reason: "Actual verified before close; supersede estimate",
    });
    expect(next.revision).toBe(2);
    expect(
      await db.billingConsumptionApproval.findUnique({ where: { id: old.id } }),
    ).not.toBeNull();
    expect((await preview(f)).complete).toBe(true);
  });
  it("supports an explicit same-month canonical opening anchor without assigning it a fabricated period", async () => {
    const f = await fixture();
    await rates(f);
    for (const kind of ["WATER", "ELECTRICITY"] as const) {
      const m = await registerMeter(admin, {
        roomId: f.room.id,
        kind,
        serial: randomUUID(),
        installedAt: "2026-02-01",
        openingReading: "100.000",
        reason: "First billing month installation",
      });
      expect(m.openingReading.billingPeriodId).toBeNull();
      const draft = await upsertDraftReading(staff, {
        meterId: m.meter.id,
        billingPeriodId: f.period.id,
        readingDate: "2026-02-28",
        value: "101.000",
      });
      await confirmReading(staff, draft.id);
    }
    expect((await preview(f)).complete).toBe(true);
  });
  it("requires complete verified replacement segments and preserves separate physical meter sources", async () => {
    const f = await fixture();
    await rates(f);
    const old = await meter(f, "WATER");
    const replacement = await replaceMeter(admin, {
      oldMeterId: old.meter.id,
      newSerial: randomUUID(),
      replacementDate: "2026-02-15",
      finalReading: "105.000",
      initialReading: "200.000",
      reason: "Damaged synthetic meter",
    });
    await approveBillingConsumption(admin, estimate(f, "ELECTRICITY"));
    expect(codes(await preview(f))).toContain("REPLACEMENT_APPROVAL_REQUIRED");
    const input = {
      ...estimate(f),
      reason: "Verified old final and external new-meter closing evidence",
      source: {
        kind: "REPLACEMENT",
        segments: [
          {
            verification: "READINGS",
            currentReadingId: replacement.finalReading.id,
            quantity: "5.000",
          },
          {
            verification: "ADMIN_EVIDENCE",
            meterId: replacement.newMeter.id,
            sourceReadingIds: [replacement.initialReading.id],
            startsOn: "2026-02-15",
            endsOn: "2026-02-28",
            quantity: "2.000",
          },
        ],
      },
    };
    const approved = await approveBillingConsumption(admin, input);
    const value = await preview(f);
    expect(value.complete).toBe(true);
    expect(value.results[0].result.totals?.finalTotal).toBe("1170.04");
    expect(
      await db.meterReading.count({
        where: {
          meterId: replacement.newMeter.id,
          billingPeriodId: f.period.id,
        },
      }),
    ).toBe(1);
    await expect(
      approveBillingConsumption(admin, {
        ...input,
        source: {
          ...input.source,
          segments: [input.source.segments[0], input.source.segments[0]],
        },
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_METER_SEGMENT" });
    await expect(
      approveBillingConsumption(admin, {
        ...input,
        source: {
          ...input.source,
          segments: [
            { ...input.source.segments[0], quantity: "6.000" },
            input.source.segments[1],
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "REPLACEMENT_QUANTITY_EXCEEDS_VERIFIED" });
    expect(
      await db.billingConsumptionApproval.count({
        where: { billingPeriodId: f.period.id, kind: "WATER" },
      }),
    ).toBe(1);
    await correctReading(admin, replacement.finalReading.id, {
      value: "104.000",
      reason: "Verified source correction",
    });
    expect(codes(await preview(f))).toContain("APPROVED_SOURCE_STALE");
    expect(await db.auditLog.count({ where: { entityId: approved.id } })).toBe(
      1,
    );
  });
  it("rejects changed lease evidence and zero contractual rent as non-issuable", async () => {
    const f = await fixture();
    await rates(f);
    await approveBillingConsumption(admin, estimate(f));
    await approveBillingConsumption(admin, estimate(f, "ELECTRICITY"));
    await db.$executeRaw`UPDATE "Lease" SET rent = 1000.01 WHERE id = ${f.lease.id}::uuid`;
    expect(codes(await preview(f))).toContain("APPROVED_LEASE_STALE");
    await db.lease.update({
      where: { id: f.lease.id },
      data: { rent: "0.00" },
    });
    expect(codes(await preview(f))).toEqual(
      expect.arrayContaining(["APPROVED_LEASE_STALE", "ZERO_RENT"]),
    );
  });
  it("keeps approval history immutable at the database boundary", async () => {
    const f = await fixture();
    const record = await approveBillingConsumption(admin, estimate(f));
    await expect(
      db.billingConsumptionApproval.update({
        where: { id: record.id },
        data: { revision: 99 },
      }),
    ).rejects.toThrow();
    await expect(
      db.billingConsumptionApproval.delete({ where: { id: record.id } }),
    ).rejects.toThrow();
    const rate = await approveBillingRate(admin, {
      billingPeriodId: f.period.id,
      kind: "WATER",
      utilityRateId: f.water.id,
      reason: "Append-only selection",
    });
    await expect(
      db.billingRateSelection.update({
        where: { id: rate.selectionId },
        data: { reason: "Changed reason" },
      }),
    ).rejects.toThrow();
    await expect(
      db.billingRateSelection.delete({ where: { id: rate.selectionId } }),
    ).rejects.toThrow();
  });
  it("supports read-only closed preview but closure alone does not authorize issuing or retrospective approvals", async () => {
    const f = await fixture();
    await rates(f);
    await approveBillingConsumption(admin, estimate(f));
    await approveBillingConsumption(admin, estimate(f, "ELECTRICITY"));
    await closeBillingPeriod(admin, f.period.id);
    const before = await financialCounts();
    const value = await preview(f);
    expect(value.complete).toBe(true);
    expect(value.eligibleForFutureIssuance).toBe(false);
    expect(value.results[0].result.futureIssuanceReasons).toContain(
      "SOURCE_FREEZE_MISSING",
    );
    await expect(
      approveBillingConsumption(admin, estimate(f)),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    await expect(
      approveBillingRate(admin, {
        billingPeriodId: f.period.id,
        kind: "WATER",
        utilityRateId: f.water.id,
        reason: "Closed period attempt",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    expect(await financialCounts()).toEqual(before);
    await expect(
      db.billingRateSelection.create({
        data: {
          billingPeriodId: f.period.id,
          kind: "WATER",
          utilityRateId: f.water.id,
          revision: 2,
          reason: "Direct closed attempt",
          approvedById: admin.id,
        },
      }),
    ).rejects.toThrow();
    const legacy = await fixture();
    await expect(
      closeBillingPeriod(admin, legacy.period.id),
    ).rejects.toMatchObject({ code: "BILLING_INPUTS_INCOMPLETE" });
    expect((await preview(legacy)).complete).toBe(false);
    expect(
      (
        await db.billingPeriod.findUniqueOrThrow({
          where: { id: legacy.period.id },
        })
      ).status,
    ).toBe("OPEN");
  });
  it("serializes simultaneous approvals and retains exactly one audit per successful revision", async () => {
    const f = await fixture();
    const inputs = [
      estimate(f, "WATER", "1.000"),
      estimate(f, "WATER", "2.000"),
    ];
    const results = await Promise.allSettled(
      inputs.map((input) => approveBillingConsumption(admin, input)),
    );
    const successes = results.filter((r) => r.status === "fulfilled");
    expect(successes.length).toBeGreaterThanOrEqual(1);
    const rows = await db.billingConsumptionApproval.findMany({
      where: { billingPeriodId: f.period.id },
      orderBy: { revision: "asc" },
    });
    expect(rows).toHaveLength(successes.length);
    expect(rows.map((row) => row.revision)).toEqual(
      rows.map((_, index) => index + 1),
    );
    expect(
      await db.auditLog.count({
        where: {
          entityId: { in: rows.map((row) => row.id) },
          action: "APPROVE_CONSUMPTION",
        },
      }),
    ).toBe(rows.length);
  });
  it("rolls approval and revision back when audit insertion fails", async () => {
    const f = await fixture();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION stage3c2_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity IN ('billing_consumption', 'billing_rate_selections') AND NEW.metadata->>'billingPeriodId' = '${f.period.id}' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER stage3c2_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION stage3c2_fail_audit()',
    );
    const before = await financialCounts();
    try {
      await expect(
        approveBillingConsumption(admin, estimate(f)),
      ).rejects.toThrow();
      await expect(
        approveBillingRate(admin, {
          billingPeriodId: f.period.id,
          kind: "WATER",
          utilityRateId: f.water.id,
          reason: "Synthetic rate audit rollback",
        }),
      ).rejects.toThrow();
      expect(await financialCounts()).toEqual(before);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER stage3c2_audit_failure ON "AuditLog"',
      );
      await db.$executeRawUnsafe("DROP FUNCTION stage3c2_fail_audit()");
    }
    expect((await approveBillingConsumption(admin, estimate(f))).revision).toBe(
      1,
    );
    expect(
      (
        await approveBillingRate(admin, {
          billingPeriodId: f.period.id,
          kind: "WATER",
          utilityRateId: f.water.id,
          reason: "Retry after rollback",
        })
      ).revision,
    ).toBe(1);
  });
  it("blocks partial-month actual usage and overlapping occupancy without assigning unapproved quantities", async () => {
    const f = await fixture();
    await rates(f);
    await actual(f, "WATER");
    await db.lease.update({
      where: { id: f.lease.id },
      data: { startDate: new Date("2026-02-10") },
    });
    expect(codes(await preview(f))).toContain("OCCUPANCY_ALLOCATION_REQUIRED");
    const tenant = await db.tenant.create({
      data: { name: "Synthetic former tenant", isDemo: true },
    });
    await db.lease.create({
      data: {
        number: randomUUID(),
        roomId: f.room.id,
        tenantId: tenant.id,
        status: "ENDED",
        startDate: new Date("2026-02-01"),
        endDate: new Date("2026-02-15"),
        rent: "1000",
        deposit: "0",
        isDemo: true,
      },
    });
    expect(codes(await preview(f))).toContain("OVERLAPPING_OCCUPANCY");
  });
  it("serializes approval versus close and rejects every later approval", async () => {
    const f = await fixture();
    await rates(f);
    await approveBillingConsumption(admin, estimate(f, "ELECTRICITY"));
    const outcomes = await Promise.allSettled([
      approveBillingConsumption(admin, estimate(f)),
      closeBillingPeriod(admin, f.period.id),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(
      true,
    );
    await closeBillingPeriod(admin, f.period.id);
    const before = await financialCounts();
    await expect(
      approveBillingConsumption(admin, estimate(f)),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    expect(await financialCounts()).toEqual(before);
    const approvals = await db.billingConsumptionApproval.findMany({
      where: { billingPeriodId: f.period.id, kind: "WATER" },
    });
    expect(approvals.length).toBeLessThanOrEqual(1);
    expect(
      await db.auditLog.count({
        where: {
          entityId: { in: approvals.map((row) => row.id) },
          action: "APPROVE_CONSUMPTION",
        },
      }),
    ).toBe(approvals.length);
  });
  it("rejects direct STAFF approval records in PostgreSQL", async () => {
    const f = await fixture();
    await expect(
      db.billingRateSelection.create({
        data: {
          billingPeriodId: f.period.id,
          kind: "WATER",
          utilityRateId: f.water.id,
          revision: 1,
          approvedById: staff.id,
          reason: "Direct unauthorized approval",
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.billingConsumptionApproval.create({
        data: {
          billingPeriodId: f.period.id,
          leaseId: f.lease.id,
          kind: "WATER",
          revision: 1,
          approvedById: staff.id,
          sourceData: { kind: "ESTIMATE" },
        },
      }),
    ).rejects.toThrow();
    expect(
      await db.billingConsumptionApproval.count({
        where: { billingPeriodId: f.period.id },
      }),
    ).toBe(0);
  });
  it("does not silently assign a multi-period actual reading to its final month", async () => {
    const f = await fixture();
    const m = await meter(f, "WATER");
    const march = await createBillingPeriod(admin, {
      propertyId: f.property.id,
      month: "2026-03",
    });
    const target = { ...f, period: march };
    await rates(target);
    const draft = await upsertDraftReading(staff, {
      meterId: m.meter.id,
      billingPeriodId: march.id,
      readingDate: "2026-03-20",
      value: "102.000",
    });
    await confirmReading(staff, draft.id);
    expect(codes(await preview(target))).toContain(
      "ACTUAL_PERIOD_ALLOCATION_REQUIRED",
    );
  });
  it("rejects unverified physical lifecycle data rather than billing inconsistent legacy rows", async () => {
    const f = await fixture();
    await rates(f);
    const m = await actual(f, "WATER");
    await actual(f, "ELECTRICITY");
    await db.utilityMeter.update({
      where: { id: m.meter.id },
      data: { activeUntil: new Date("2026-02-01") },
    });
    expect(codes(await preview(f))).toContain(
      "READING_OUTSIDE_METER_LIFECYCLE",
    );
    await db.utilityMeter.update({
      where: { id: m.meter.id },
      data: { activeFrom: null, activeUntil: null },
    });
    expect(codes(await preview(f))).toContain("METER_LIFECYCLE_UNVERIFIED");
  });
  it("bills explicit ADMIN allocations to each nonoverlapping lease without exceeding room usage", async () => {
    const f = await fixture();
    await rates(f);
    const water = await actual(f, "WATER", "110.000");
    const electricity = await actual(f, "ELECTRICITY", "120.000");
    await db.lease.update({
      where: { id: f.lease.id },
      data: { status: "ENDED", endDate: new Date("2026-02-14") },
    });
    const tenant = await db.tenant.create({
      data: { name: "Synthetic turnover tenant", isDemo: true },
    });
    const next = await db.lease.create({
      data: {
        number: randomUUID(),
        roomId: f.room.id,
        tenantId: tenant.id,
        startDate: new Date("2026-02-15"),
        endDate: new Date("2026-12-31"),
        rent: "1000.00",
        deposit: "0.00",
        status: "ACTIVE",
        isDemo: true,
      },
    });
    const allocation = (
      leaseId: string,
      kind: string,
      currentReadingId: string,
      quantity: string,
    ) => ({
      ...estimate(f, kind),
      leaseId,
      reason: "Verified turnover allocation per lease",
      evidence: ["turnover-check:synthetic"],
      source: { kind: "ALLOCATED_ACTUAL", currentReadingId, quantity },
    });
    const beforeDenied = await financialCounts();
    await expect(
      approveBillingConsumption(
        staff,
        allocation(f.lease.id, "WATER", water.reading.id, "4.000"),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await financialCounts()).toEqual(beforeDenied);
    await approveBillingConsumption(
      admin,
      allocation(f.lease.id, "WATER", water.reading.id, "4.000"),
    );
    await approveBillingConsumption(
      admin,
      allocation(next.id, "WATER", water.reading.id, "6.000"),
    );
    await approveBillingConsumption(
      admin,
      allocation(f.lease.id, "ELECTRICITY", electricity.reading.id, "7.000"),
    );
    await approveBillingConsumption(
      admin,
      allocation(next.id, "ELECTRICITY", electricity.reading.id, "13.000"),
    );
    const value = await preview(f);
    expect(value.complete).toBe(true);
    expect(value.results.map((row) => row.result.totals?.finalTotal)).toEqual([
      "790.06",
      "1010.10",
    ]);
    const beforeExcess = await financialCounts();
    await expect(
      approveBillingConsumption(
        admin,
        allocation(next.id, "WATER", water.reading.id, "6.001"),
      ),
    ).rejects.toMatchObject({ code: "ALLOCATION_EXCEEDS_VERIFIED" });
    expect(await financialCounts()).toEqual(beforeExcess);
    await closeBillingPeriod(admin, f.period.id);
    await expect(
      approveBillingConsumption(
        admin,
        allocation(next.id, "WATER", water.reading.id, "5.000"),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
  it("prevents concurrent per-lease allocations from exceeding verified room consumption", async () => {
    const f = await fixture();
    const water = await actual(f, "WATER", "110.000");
    await db.lease.update({
      where: { id: f.lease.id },
      data: { status: "ENDED", endDate: new Date("2026-02-14") },
    });
    const tenant = await db.tenant.create({
      data: { name: "Synthetic concurrent turnover", isDemo: true },
    });
    const next = await db.lease.create({
      data: {
        number: randomUUID(),
        roomId: f.room.id,
        tenantId: tenant.id,
        startDate: new Date("2026-02-15"),
        endDate: new Date("2026-12-31"),
        rent: "1000.00",
        deposit: "0.00",
        status: "ACTIVE",
        isDemo: true,
      },
    });
    const outcomes = await Promise.allSettled(
      [f.lease.id, next.id].map((leaseId) =>
        approveBillingConsumption(admin, {
          ...estimate(f),
          leaseId,
          source: {
            kind: "ALLOCATED_ACTUAL",
            currentReadingId: water.reading.id,
            quantity: "6.000",
          },
        }),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const rows = await db.billingConsumptionApproval.findMany({
      where: { billingPeriodId: f.period.id, kind: "WATER" },
    });
    expect(rows).toHaveLength(1);
    expect(
      await db.auditLog.count({
        where: { entityId: rows[0].id, action: "APPROVE_CONSUMPTION" },
      }),
    ).toBe(1);
  });
  it("rejects allocation of consumption measured entirely after lease occupancy without writes", async () => {
    const f = await fixture();
    await db.lease.update({
      where: { id: f.lease.id },
      data: { status: "ENDED", endDate: new Date("2026-02-10") },
    });
    const m = await registerMeter(admin, {
      roomId: f.room.id,
      kind: "WATER",
      serial: randomUUID(),
      installedAt: "2026-02-20",
      openingReading: "0.000",
      reason: "Synthetic installation after tenancy",
    });
    const draft = await upsertDraftReading(staff, {
      meterId: m.meter.id,
      billingPeriodId: f.period.id,
      readingDate: "2026-02-28",
      value: "10.000",
    });
    const current = await confirmReading(staff, draft.id);
    const before = await financialCounts();
    await expect(
      approveBillingConsumption(admin, {
        ...estimate(f),
        reason: "Evidence cannot authorize a post-tenancy source",
        source: {
          kind: "ALLOCATED_ACTUAL",
          currentReadingId: current.id,
          quantity: "5.000",
        },
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_SOURCE_AFTER_OCCUPANCY" });
    expect(await financialCounts()).toEqual(before);
  });
});
