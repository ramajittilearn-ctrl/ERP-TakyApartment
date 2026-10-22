import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { AppError } from "../../src/server/errors";
import {
  createUser,
  login,
  logout,
  sessionActor,
  tokenHash,
} from "../../src/server/auth";

const suffix = randomUUID().slice(0, 8);
const password = randomUUID();
const adminIdentifier = `throttle-admin-${suffix}`;
const staffIdentifier = `throttle-staff-${suffix}`;
const unknownIdentifier = (label: string) => `missing-${label}-${suffix}`;
const keyFor = (identifier: string) => tokenHash(`login:${identifier}`);
const wrongLogin = (identifier: string) =>
  login({ identifier, password: "wrong" });

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.endsWith("/taky_phase2_test"))
    throw new Error("Only run integration tests in the isolated test database");
  const admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  for (const [identifier, role] of [
    [adminIdentifier, "ADMIN"],
    [staffIdentifier, "STAFF"],
  ] satisfies [string, "ADMIN" | "STAFF"][]) {
    await createUser(
      {
        username: identifier,
        email: `${identifier}@example.invalid`,
        name: "Throttle regression fixture",
        password,
        role,
      },
      false,
      admin,
    );
  }
});

afterAll(async () => {
  vi.useRealTimers();
  await db.$disconnect();
});

describe("isolated login throttling", () => {
  it("allows unrelated ADMIN and STAFF login when the legacy global bucket is exhausted", async () => {
    const key = tokenHash("login:global");
    await db.loginThrottle.upsert({
      where: { key },
      create: { key, attempts: 100, windowStart: new Date() },
      update: { attempts: 100, windowStart: new Date() },
    });
    try {
      for (const [identifier, role] of [
        [adminIdentifier, "ADMIN"],
        [staffIdentifier, "STAFF"],
      ]) {
        const session = await login({ identifier, password });
        expect((await sessionActor(session.token))?.role).toBe(role);
        await logout(session.token);
      }
    } finally {
      await db.loginThrottle.deleteMany({ where: { key } });
    }
  });

  it("gives existing and unknown identifiers the same five-attempt allowance and errors", async () => {
    const identifiers = [adminIdentifier, unknownIdentifier("uniform")];
    for (const identifier of identifiers) {
      for (let attempt = 0; attempt < 5; attempt++)
        await expect(wrongLogin(identifier)).rejects.toMatchObject({
          status: 401,
          code: "INVALID_CREDENTIALS",
          message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
        });
      await expect(wrongLogin(identifier)).rejects.toMatchObject({
        status: 429,
        code: "RATE_LIMITED",
      });
    }
    await expect(
      login({ identifier: adminIdentifier, password }),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    const session = await login({ identifier: staffIdentifier, password });
    expect((await sessionActor(session.token))?.role).toBe("STAFF");
    await logout(session.token);
    await db.loginThrottle.deleteMany({
      where: { key: { in: identifiers.map(keyFor) } },
    });
  });

  it("normalizes case and whitespace before counting attempts", async () => {
    const identifier = unknownIdentifier("normalize");
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(
        wrongLogin(` ${identifier.toUpperCase()} `),
      ).rejects.toMatchObject({ status: 401 });
    await expect(wrongLogin(identifier)).rejects.toMatchObject({ status: 429 });
  });

  it("counts concurrent attempts atomically", async () => {
    const identifier = unknownIdentifier("concurrent");
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => wrongLogin(identifier)),
    );
    const errors: unknown[] = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason] : [],
    );
    expect(
      errors.filter(
        (error) => error instanceof AppError && error.status === 401,
      ),
    ).toHaveLength(5);
    expect(
      errors.filter(
        (error) => error instanceof AppError && error.status === 429,
      ),
    ).toHaveLength(5);
  });

  it("saturates blocked counters instead of permitting integer overflow", async () => {
    const identifier = unknownIdentifier("saturated");
    const key = keyFor(identifier);
    await db.loginThrottle.create({
      data: { key, attempts: 2147483647, windowStart: new Date() },
    });
    await expect(wrongLogin(identifier)).rejects.toMatchObject({ status: 429 });
    expect(
      (await db.loginThrottle.findUniqueOrThrow({ where: { key } })).attempts,
    ).toBe(6);
  });

  it("starts a fresh window exactly fifteen minutes after its start", async () => {
    const identifier = unknownIdentifier("boundary");
    const key = keyFor(identifier);
    const now = Date.now();
    await db.loginThrottle.create({
      data: { key, attempts: 6, windowStart: new Date(now - 15 * 60 * 1000) },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      await expect(wrongLogin(identifier)).rejects.toMatchObject({
        status: 401,
      });
      expect(
        (await db.loginThrottle.findUniqueOrThrow({ where: { key } })).attempts,
      ).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes expired identifier rows while keeping active windows", async () => {
    const expiredKey = keyFor(unknownIdentifier("expired"));
    const activeKey = keyFor(unknownIdentifier("active"));
    await db.loginThrottle.createMany({
      data: [
        {
          key: expiredKey,
          attempts: 3,
          windowStart: new Date(Date.now() - 16 * 60 * 1000),
        },
        { key: activeKey, attempts: 3, windowStart: new Date() },
      ],
    });
    await expect(
      wrongLogin(unknownIdentifier("cleanup")),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await db.loginThrottle.findUnique({ where: { key: expiredKey } }),
    ).toBeNull();
    expect(
      (await db.loginThrottle.findUniqueOrThrow({ where: { key: activeKey } }))
        .attempts,
    ).toBe(3);
  });

  it("resets its own attempt allowance after a successful login", async () => {
    for (let attempt = 0; attempt < 4; attempt++)
      await expect(wrongLogin(adminIdentifier)).rejects.toMatchObject({
        status: 401,
      });
    const session = await login({ identifier: adminIdentifier, password });
    expect(
      await db.loginThrottle.findUnique({
        where: { key: keyFor(adminIdentifier) },
      }),
    ).toBeNull();
    await logout(session.token);
    await expect(wrongLogin(adminIdentifier)).rejects.toMatchObject({
      status: 401,
    });
  });
});
