import { createHmac, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { db } from "./db";
import { AppError } from "./errors";
import { loginInput, userInput } from "./validation";
import type { Actor } from "./services";

export const COOKIE = "taky_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export function tokenHash(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(value).digest("hex");
}
export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} satisfies argon2.HashOptions;
const dummyHash = argon2.hash(randomBytes(32), passwordOptions);
export async function createUser(
  input: unknown,
  firstAdmin = false,
  actor?: Actor,
) {
  if (!firstAdmin && actor?.role !== "ADMIN")
    throw new AppError(403, "FORBIDDEN", "เฉพาะผู้ดูแลระบบเท่านั้น");
  const data = userInput.parse(input);
  const passwordHash = await argon2.hash(data.password, passwordOptions);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261016)`;
    if (firstAdmin && (await tx.user.count()) !== 0)
      throw new AppError(409, "SETUP_COMPLETE", "สร้างผู้ดูแลระบบคนแรกแล้ว");
    const user = await tx.user.create({
      data: {
        username: data.username,
        email: data.email,
        name: data.name,
        role: firstAdmin ? "ADMIN" : data.role,
        passwordHash,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor?.id ?? user.id,
        action: firstAdmin ? "FIRST_ADMIN_SETUP" : "USER_CREATE",
        entity: "users",
        entityId: user.id,
        metadata: { role: user.role },
      },
    });
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    };
  });
}
async function consumeAttempt(key: string, limit: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000);
  const rows = await db.$queryRaw<{ attempts: number }[]>`
    INSERT INTO "LoginThrottle" (id, key, attempts, "windowStart", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${key}, 1, ${now}, ${now}, ${now})
    ON CONFLICT (key) DO UPDATE SET attempts = CASE WHEN "LoginThrottle"."windowStart" < ${cutoff} THEN 1 ELSE "LoginThrottle".attempts + 1 END,
    "windowStart" = CASE WHEN "LoginThrottle"."windowStart" < ${cutoff} THEN ${now} ELSE "LoginThrottle"."windowStart" END,
    "updatedAt" = ${now} RETURNING attempts`;
  if ((rows[0]?.attempts ?? limit + 1) > limit)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที",
    );
}
export async function login(input: unknown) {
  const { identifier, password } = loginInput.parse(input);
  await consumeAttempt(tokenHash("login:global"), 100);
  const key = tokenHash(`login:${identifier}`);
  await consumeAttempt(key, 5);
  const user = await db.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
  });
  const valid = await argon2.verify(
    user?.passwordHash ?? (await dummyHash),
    password,
  );
  if (!user || !valid || user.disabled) {
    await db.auditLog.create({
      data: {
        action: "LOGIN_FAILED",
        entity: "sessions",
        metadata: { identifierHash: key },
      },
    });
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    );
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await tx.session.create({
      data: { tokenHash: tokenHash(token), userId: user.id, expiresAt },
    });
    await tx.loginThrottle.deleteMany({ where: { key } });
    await tx.auditLog.create({
      data: { actorId: user.id, action: "LOGIN", entity: "sessions" },
    });
  });
  return { token, expiresAt };
}
export async function sessionActor(token?: string): Promise<Actor | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || session.user.disabled)
    return null;
  const { id, role, name, username } = session.user;
  return { id, role, name, username };
}
export async function logout(token?: string) {
  if (!token) return;
  await db.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { tokenHash: tokenHash(token) },
    });
    if (!session) return;
    await tx.session.delete({ where: { id: session.id } });
    await tx.auditLog.create({
      data: { actorId: session.userId, action: "LOGOUT", entity: "sessions" },
    });
  });
}
