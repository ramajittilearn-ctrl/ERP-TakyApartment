import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";
import { seed } from "../../prisma/seed";
import {
  createUser,
  login,
  logout,
  sessionActor,
  tokenHash,
} from "../../src/server/auth";
import {
  saveRecord,
  removeRecord,
  type Actor,
} from "../../src/server/services";
import { leaseInput, tenantInput } from "../../src/server/validation";

let actor: Actor;
let staff: Actor;
const suffix = randomUUID().slice(0, 8);
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.endsWith("/taky_phase2_test"))
    throw new Error("Only run integration tests in the isolated test database");
  const admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  actor = admin;
  staff = await db.user.findUniqueOrThrow({
    where: { username: "test-staff" },
  });
});
afterAll(() => db.$disconnect());
describe("PostgreSQL foundation", () => {
  it("has both applied migrations and connects", async () => {
    const migrations = await db.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(migrations.map((m) => m.migration_name)).toEqual(
      expect.arrayContaining([
        "202610160001_foundation",
        "202610160002_constraints",
      ]),
    );
  });
  it("seeds exactly 15 rooms idempotently without overwriting edits", async () => {
    const room = await db.room.findFirstOrThrow({ where: { number: "105" } });
    await db.room.update({
      where: { id: room.id },
      data: { notes: "Demo persistence check" },
    });
    await seed();
    await seed();
    const rooms = await db.room.findMany({ orderBy: { number: "asc" } });
    expect(rooms.map((r) => r.number)).toEqual([
      "101",
      "102",
      "103",
      "104",
      "105",
      "201",
      "202",
      "203",
      "204",
      "205",
      "301",
      "302",
      "303",
      "304",
      "305",
    ]);
    expect(
      (await db.room.findUniqueOrThrow({ where: { id: room.id } })).notes,
    ).toBe("Demo persistence check");
  });
  it("stores Argon2id hashes and refuses second bootstrap", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(user.passwordHash.startsWith("$argon2id$v=19$")).toBe(true);
    expect(user.passwordHash.split("$")[3].split(",").sort()).toEqual([
      "m=65536",
      "p=1",
      "t=3",
    ]);
    await expect(
      createUser(
        {
          username: `another-${suffix}`,
          email: `${suffix}@example.invalid`,
          name: "Demo",
          password: randomUUID(),
          role: "ADMIN",
        },
        true,
      ),
    ).rejects.toThrow("สร้างผู้ดูแลระบบคนแรกแล้ว");
  });
  it("authenticates username/email, stores only token hash, expires and revokes sessions", async () => {
    const result = await login({
      identifier: "admin@example.invalid",
      password: process.env.TEST_ADMIN_PASSWORD,
    });
    expect((await sessionActor(result.token))?.id).toBe(actor.id);
    const stored = await db.session.findUniqueOrThrow({
      where: { tokenHash: tokenHash(result.token) },
    });
    expect(stored.tokenHash).not.toBe(result.token);
    await db.session.update({
      where: { id: stored.id },
      data: { expiresAt: new Date(0) },
    });
    expect(await sessionActor(result.token)).toBeNull();
    const next = await login({
      identifier: "test-admin",
      password: process.env.TEST_ADMIN_PASSWORD,
    });
    await logout(next.token);
    expect(await sessionActor(next.token)).toBeNull();
  });
  it("throttles invalid credentials persistently", async () => {
    const identifier = `missing-${suffix}`;
    for (let i = 0; i < 5; i++)
      await expect(
        login({ identifier, password: "wrong" }),
      ).rejects.toMatchObject({ status: 401 });
    await expect(
      login({ identifier, password: "wrong" }),
    ).rejects.toMatchObject({ status: 429 });
  });
  it("validates tenant contacts, money precision, real dates and lease date order", () => {
    expect(
      tenantInput.safeParse({ name: "", phone: "words", email: "bad" }).success,
    ).toBe(false);
    const base = {
      number: "Demo",
      roomId: randomUUID(),
      tenantId: randomUUID(),
      startDate: "2026-10-01",
      endDate: "2026-09-01",
      rent: "0.001",
      deposit: "-1",
      status: "ACTIVE",
    };
    expect(leaseInput.safeParse(base).success).toBe(false);
    expect(
      leaseInput.safeParse({
        ...base,
        rent: "1.00",
        deposit: "0",
        endDate: "2026-02-30",
      }).success,
    ).toBe(false);
  });
  it("authorizes room CRUD, audits changes and prevents negative SQL rent", async () => {
    const floor = await db.floor.findFirstOrThrow();
    const input = {
      floorId: floor.id,
      number: `T${suffix}`,
      rent: "3500.25",
      status: "AVAILABLE",
      notes: "Demo",
    };
    await expect(saveRecord(staff, "rooms", input)).rejects.toMatchObject({
      status: 403,
    });
    const room = await saveRecord(actor, "rooms", input);
    await saveRecord(actor, "rooms", { ...input, rent: "4000.50" }, room.id);
    expect(
      (
        await db.room.findUniqueOrThrow({ where: { id: room.id } })
      ).rent.toFixed(2),
    ).toBe("4000.50");
    await expect(
      db.$executeRaw`UPDATE "Room" SET rent = -1 WHERE id = ${room.id}::uuid`,
    ).rejects.toThrow();
    await removeRecord(actor, "rooms", room.id);
    expect(await db.auditLog.count({ where: { entityId: room.id } })).toBe(3);
  });
  it("supports tenant and draft lease CRUD with restrictive foreign keys", async () => {
    const tenantInput = {
      name: `Demo ${suffix}`,
      phone: "",
      email: "",
      address: "",
      notes: "",
      isDemo: true,
    };
    const tenant = await saveRecord(staff, "tenants", tenantInput);
    const room = await db.room.findFirstOrThrow({ where: { number: "101" } });
    const input = {
      number: `DEMO-${suffix}`,
      roomId: room.id,
      tenantId: tenant.id,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      rent: "3500.00",
      deposit: "7000.00",
      status: "DRAFT",
      isDemo: true,
    };
    const lease = await saveRecord(staff, "leases", input);
    await saveRecord(
      staff,
      "tenants",
      { ...tenantInput, name: `Demo edited ${suffix}` },
      tenant.id,
    );
    await saveRecord(staff, "leases", { ...input, rent: "3600.00" }, lease.id);
    await expect(removeRecord(actor, "tenants", tenant.id)).rejects.toThrow();
    await expect(removeRecord(staff, "leases", lease.id)).rejects.toMatchObject(
      { status: 403 },
    );
    await removeRecord(actor, "leases", lease.id);
    await removeRecord(actor, "tenants", tenant.id);
  });
  it("serializes competing active leases and preserves lease history", async () => {
    const tenant = await saveRecord(actor, "tenants", {
      name: `Demo concurrent ${suffix}`,
      phone: "",
      email: "",
      isDemo: true,
    });
    const room = await db.room.findFirstOrThrow({ where: { number: "305" } });
    const input = {
      roomId: room.id,
      tenantId: tenant.id,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      rent: "3500.00",
      deposit: "0",
      status: "ACTIVE",
      isDemo: true,
    };
    const results = await Promise.allSettled([
      saveRecord(actor, "leases", { ...input, number: `DEMO-A-${suffix}` }),
      saveRecord(actor, "leases", { ...input, number: `DEMO-B-${suffix}` }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const active = await db.lease.findFirstOrThrow({
      where: { roomId: room.id, status: "ACTIVE" },
    });
    await expect(
      removeRecord(actor, "leases", active.id),
    ).rejects.toMatchObject({ status: 409 });
    await saveRecord(
      actor,
      "leases",
      { ...input, number: active.number, status: "ENDED" },
      active.id,
    );
  });
  it("audit rows cannot be changed or deleted", async () => {
    const audit = await db.auditLog.findFirstOrThrow();
    await expect(
      db.auditLog.update({
        where: { id: audit.id },
        data: { action: "TAMPER" },
      }),
    ).rejects.toThrow();
    await expect(
      db.auditLog.delete({ where: { id: audit.id } }),
    ).rejects.toThrow();
  });
});
