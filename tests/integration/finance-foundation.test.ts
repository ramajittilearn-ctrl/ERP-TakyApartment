import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import {
  closeBillingPeriod,
  createBillingPeriod,
  createUtilityRate,
  listBillingPeriods,
  listUtilityRates,
  resolveUtilityRate,
} from "../../src/server/finance";
import type { Actor } from "../../src/server/services";

let admin: Actor;
let staff: Actor;
let propertyId: string;
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
  propertyId = (
    await db.property.create({
      data: { code: `F${suffix}`, name: "Finance test" },
    })
  ).id;
});

afterAll(() => db.$disconnect());

describe("Stage 3A PostgreSQL foundation", () => {
  it("applies the additive migration and database checks", async () => {
    const migrations = await db.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(migrations.map((value) => value.migration_name)).toContain(
      "202610180001_phase3a_financial_foundation",
    );
    await expect(
      db.billingPeriod.create({
        data: {
          propertyId,
          startsOn: new Date("2026-01-02"),
          endsOn: new Date("2026-01-31"),
          createdById: admin.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("allows STAFF period creation but rejects duplicate concurrent months", async () => {
    const results = await Promise.allSettled([
      createBillingPeriod(staff, { propertyId, month: "2026-01" }),
      createBillingPeriod(staff, { propertyId, month: "2026-01" }),
    ]);
    expect(
      results.filter((value) => value.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await listBillingPeriods({ propertyId }))[0]).toMatchObject({
      startsOn: "2026-01-01",
      endsOn: "2026-01-31",
      status: "OPEN",
    });
  });

  it("allows only ADMIN to close and makes close retries deterministic", async () => {
    const period = await createBillingPeriod(staff, {
      propertyId,
      month: "2026-02",
    });
    await expect(closeBillingPeriod(staff, period.id)).rejects.toMatchObject({
      status: 403,
    });
    const first = await closeBillingPeriod(admin, period.id);
    const second = await closeBillingPeriod(admin, period.id);
    expect(second).toEqual(first);
    expect(
      await db.auditLog.count({
        where: { entityId: period.id, action: "CLOSE" },
      }),
    ).toBe(1);
    await expect(
      db.billingPeriod.update({
        where: { id: period.id },
        data: { status: "OPEN", closedAt: null, closedById: null },
      }),
    ).rejects.toThrow();
  });

  it("keeps rate change points append-only, exact, unique, audited, and ADMIN-only", async () => {
    const input = {
      propertyId,
      kind: "ELECTRICITY",
      effectiveFrom: "2026-01-01",
      unitPrice: "8.2500",
    } as const;
    await expect(createUtilityRate(staff, input)).rejects.toMatchObject({
      status: 403,
    });
    const saved = await createUtilityRate(admin, input);
    expect(saved.unitPrice).toBe("8.2500");
    await expect(createUtilityRate(admin, input)).rejects.toThrow();
    expect(
      await listUtilityRates({ propertyId, kind: "ELECTRICITY" }),
    ).toHaveLength(1);
    expect(
      await db.auditLog.count({
        where: { entityId: saved.id, action: "CREATE" },
      }),
    ).toBe(1);
    await expect(
      db.utilityRate.update({
        where: { id: saved.id },
        data: { unitPrice: "9.0000" },
      }),
    ).rejects.toThrow();
    await expect(
      db.utilityRate.delete({ where: { id: saved.id } }),
    ).rejects.toThrow();
  });

  it("resolves the latest rate on or before the requested date without a future fallback", async () => {
    await createUtilityRate(admin, {
      propertyId,
      kind: "WATER",
      effectiveFrom: "2026-02-01",
      unitPrice: "20.0000",
    });
    await createUtilityRate(admin, {
      propertyId,
      kind: "WATER",
      effectiveFrom: "2026-03-15",
      unitPrice: "21.5000",
    });
    await expect(
      resolveUtilityRate({
        propertyId,
        kind: "WATER",
        effectiveOn: "2026-01-31",
      }),
    ).rejects.toMatchObject({ status: 404, code: "UTILITY_RATE_NOT_FOUND" });
    await expect(
      resolveUtilityRate({
        propertyId,
        kind: "WATER",
        effectiveOn: "2026-03-14",
      }),
    ).resolves.toMatchObject({
      effectiveFrom: "2026-02-01",
      unitPrice: "20.0000",
    });
    await expect(
      resolveUtilityRate({
        propertyId,
        kind: "WATER",
        effectiveOn: "2026-03-15",
      }),
    ).resolves.toMatchObject({
      effectiveFrom: "2026-03-15",
      unitPrice: "21.5000",
    });
  });

  it("rejects rate scale before PostgreSQL can coerce it", async () => {
    const countBefore = await db.utilityRate.count({
      where: { propertyId, kind: "WATER" },
    });
    await expect(
      createUtilityRate(admin, {
        propertyId,
        kind: "WATER",
        effectiveFrom: "2026-01-01",
        unitPrice: "20.00001",
      }),
    ).rejects.toThrow();
    expect(
      await db.utilityRate.count({ where: { propertyId, kind: "WATER" } }),
    ).toBe(countBefore);
  });
});
