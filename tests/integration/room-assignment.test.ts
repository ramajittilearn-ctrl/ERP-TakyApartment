import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";
import {
  saveRecord,
  removeRecord,
  type Actor,
} from "../../src/server/services";
import { getRecord } from "../../src/server/repository";
import { tenantInput } from "../../src/server/validation";

let actor: Actor;
let roomId: string;
let otherRoomId: string;
const prefix = `Demo P26 ${randomUUID().slice(0, 8)}`;
const profile = (label: string) => ({
  name: `${prefix} ${label}`,
  phone: "",
  email: "",
  isDemo: true,
});
const assignment = (room: string, number = randomUUID().slice(0, 24)) => ({
  roomId: room,
  number: `DEMO-${number}`,
  startDate: "2026-10-01",
  endDate: "2027-09-30",
  rent: "3500.25",
  deposit: "7000.50",
});
async function endAll() {
  // Only these test-created demo records are transitioned. History is retained.
  await db.lease.updateMany({
    where: { tenant: { name: { startsWith: prefix } }, status: "ACTIVE" },
    data: { status: "ENDED" },
  });
  await db.room.updateMany({
    where: { id: { in: [roomId, otherRoomId] } },
    data: { status: "AVAILABLE" },
  });
}
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.endsWith("/taky_phase2_test"))
    throw new Error("Isolated database required");
  actor = await db.user.findUniqueOrThrow({
    where: { username: "test-staff" },
  });
  roomId = (await db.room.findFirstOrThrow({ where: { number: "103" } })).id;
  otherRoomId = (await db.room.findFirstOrThrow({ where: { number: "203" } }))
    .id;
  if (
    await db.lease.count({
      where: { roomId: { in: [roomId, otherRoomId] }, status: "ACTIVE" },
    })
  )
    throw new Error(
      "Test rooms must be unoccupied; refusing to change existing leases",
    );
});
afterAll(async () => {
  await endAll();
  await db.$disconnect();
});

describe("atomic tenant-room integration", () => {
  it("applies additive migrations and PostgreSQL occupancy triggers", async () => {
    const rows = await db.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(rows.map((r) => r.migration_name)).toEqual(
      expect.arrayContaining([
        "202610170002_room_reserved",
        "202610170003_occupancy_integrity",
      ]),
    );
    const guards = await db.$queryRaw<
      { tgname: string }[]
    >`SELECT tgname FROM pg_trigger WHERE tgname IN ('active_lease_room_guard', 'occupied_room_status_guard')`;
    expect(guards).toHaveLength(2);
  });
  it("creates an unassigned tenant without generating a lease", async () => {
    const tenant = await saveRecord(actor, "tenants", profile("unassigned"));
    expect(await db.lease.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
  it("creates profile, active lease and audit rows atomically with exact decimals", async () => {
    const tenant = await saveRecord(actor, "tenants", {
      ...profile("assigned"),
      assignment: assignment(roomId),
    });
    const lease = await db.lease.findFirstOrThrow({
      where: { tenantId: tenant.id },
    });
    expect(lease.status).toBe("ACTIVE");
    expect(lease.rent.toFixed(2)).toBe("3500.25");
    expect(lease.deposit.toFixed(2)).toBe("7000.50");
    expect(
      await db.auditLog.count({
        where: { entityId: { in: [tenant.id, lease.id] } },
      }),
    ).toBe(2);
    const detail = await getRecord("tenants", tenant.id);
    expect(detail).toMatchObject({
      leases: [
        expect.objectContaining({
          room: expect.objectContaining({ id: roomId }),
        }),
      ],
    });
    await endAll();
  });
  it("rolls back tenant and audit writes for invalid/occupied/duplicate assignments", async () => {
    const values = assignment(roomId);
    await saveRecord(actor, "tenants", {
      ...profile("holder"),
      assignment: values,
    });
    const before = await db.auditLog.count();
    await expect(
      saveRecord(actor, "tenants", {
        ...profile("failed"),
        assignment: assignment(roomId),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      saveRecord(actor, "tenants", {
        ...profile("failed-duplicate"),
        assignment: { ...values, roomId: otherRoomId },
      }),
    ).rejects.toThrow();
    expect(
      await db.tenant.count({
        where: { name: { startsWith: `${prefix} failed` } },
      }),
    ).toBe(0);
    expect(await db.auditLog.count()).toBe(before);
    expect(
      tenantInput.safeParse({
        ...profile("bad-date"),
        assignment: { ...values, endDate: "2026-09-30" },
      }).success,
    ).toBe(false);
    expect(
      tenantInput.safeParse({ ...profile("missing"), assignment: { roomId } })
        .success,
    ).toBe(false);
    await endAll();
  });
  it("updates the existing assignment without creating duplicates or clearing a lease implicitly", async () => {
    const values = assignment(roomId);
    const tenant = await saveRecord(actor, "tenants", {
      ...profile("edit"),
      assignment: values,
    });
    const lease = await db.lease.findFirstOrThrow({
      where: { tenantId: tenant.id },
    });
    await saveRecord(
      actor,
      "tenants",
      {
        ...profile("edit"),
        assignment: { ...values, leaseId: lease.id, rent: "3900.75" },
      },
      tenant.id,
    );
    await saveRecord(
      actor,
      "tenants",
      { ...profile("edit"), notes: "Profile-only update" },
      tenant.id,
    );
    expect(await db.lease.count({ where: { tenantId: tenant.id } })).toBe(1);
    expect(
      await db.lease.findUniqueOrThrow({ where: { id: lease.id } }),
    ).toMatchObject({ status: "ACTIVE" });
    expect(
      (
        await db.lease.findUniqueOrThrow({ where: { id: lease.id } })
      ).rent.toFixed(2),
    ).toBe("3900.75");
    await expect(
      saveRecord(
        actor,
        "tenants",
        {
          ...profile("edit"),
          assignment: { ...values, leaseId: randomUUID() },
        },
        tenant.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await endAll();
  });
  it("transfers explicitly and preserves old room, tenant and financial history", async () => {
    const values = assignment(roomId);
    const tenant = await saveRecord(actor, "tenants", {
      ...profile("transfer"),
      assignment: values,
    });
    const old = await db.lease.findFirstOrThrow({
      where: { tenantId: tenant.id },
    });
    const next = {
      ...assignment(otherRoomId),
      leaseId: old.id,
      startDate: "2026-11-01",
      previousEndDate: "2026-10-31",
    };
    await expect(
      saveRecord(
        actor,
        "tenants",
        {
          ...profile("transfer"),
          assignment: { ...next, previousEndDate: "2026-11-01" },
        },
        tenant.id,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await saveRecord(
      actor,
      "tenants",
      { ...profile("transfer"), assignment: next },
      tenant.id,
    );
    const history = await db.lease.findUniqueOrThrow({ where: { id: old.id } });
    expect(history).toMatchObject({
      roomId,
      tenantId: tenant.id,
      status: "ENDED",
      number: old.number,
    });
    expect(history.rent.toString()).toBe(old.rent.toString());
    expect(history.endDate.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(
      await db.lease.count({
        where: { tenantId: tenant.id, roomId: otherRoomId, status: "ACTIVE" },
      }),
    ).toBe(1);
    await endAll();
  });
  it("rolls back a failed transfer, including ending the original lease", async () => {
    const tenant = await saveRecord(actor, "tenants", {
      ...profile("rollback"),
      assignment: assignment(roomId),
    });
    const old = await db.lease.findFirstOrThrow({
      where: { tenantId: tenant.id },
    });
    await db.room.update({
      where: { id: otherRoomId },
      data: { status: "RESERVED" },
    });
    await expect(
      saveRecord(
        actor,
        "tenants",
        {
          ...profile("changed-name"),
          assignment: {
            ...assignment(otherRoomId),
            leaseId: old.id,
            startDate: "2026-11-01",
            previousEndDate: "2026-10-31",
          },
        },
        tenant.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.lease.findUniqueOrThrow({ where: { id: old.id } }),
    ).toMatchObject({ status: "ACTIVE", endDate: old.endDate });
    expect(
      (await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).name,
    ).toBe(`${prefix} rollback`);
    await endAll();
  });
  it("blocks reserved/maintenance assignments and SQL occupancy inconsistencies", async () => {
    for (const status of ["RESERVED", "MAINTENANCE"] as const) {
      await db.room.update({ where: { id: roomId }, data: { status } });
      await expect(
        saveRecord(actor, "tenants", {
          ...profile("unavailable"),
          assignment: assignment(roomId),
        }),
      ).rejects.toMatchObject({ status: 409 });
      const tenant = await db.tenant.create({ data: profile("sql") });
      await expect(
        db.lease.create({
          data: {
            ...assignment(roomId),
            tenantId: tenant.id,
            status: "ACTIVE",
            startDate: new Date("2026-10-01"),
            endDate: new Date("2027-09-30"),
            isDemo: true,
          },
        }),
      ).rejects.toThrow();
    }
    await endAll();
    await saveRecord(actor, "tenants", {
      ...profile("occupied"),
      assignment: assignment(roomId),
    });
    await expect(
      db.room.update({
        where: { id: roomId },
        data: { status: "MAINTENANCE" },
      }),
    ).rejects.toThrow();
    const admin = await db.user.findUniqueOrThrow({
      where: { username: "test-admin" },
    });
    const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });
    const input = {
      floorId: room.floorId,
      number: room.number,
      rent: room.rent.toString(),
      status: "AVAILABLE",
      notes: room.notes,
    };
    await saveRecord(admin, "rooms", input, roomId);
    expect(await db.lease.count({ where: { roomId, status: "ACTIVE" } })).toBe(
      1,
    );
    await expect(
      saveRecord(admin, "rooms", { ...input, status: "RESERVED" }, roomId),
    ).rejects.toMatchObject({ status: 409 });
    await expect(removeRecord(admin, "rooms", roomId)).rejects.toMatchObject({
      status: 409,
    });
    await endAll();
  });
  it("serializes competing tenant creation and rolls back the losing profile", async () => {
    const results = await Promise.allSettled(
      ["A", "B"].map((name) =>
        saveRecord(actor, "tenants", {
          ...profile(`race-${name}`),
          assignment: assignment(roomId),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.tenant.count({
        where: { name: { startsWith: `${prefix} race-` } },
      }),
    ).toBe(1);
    expect(await db.lease.count({ where: { roomId, status: "ACTIVE" } })).toBe(
      1,
    );
    await endAll();
  });
});
