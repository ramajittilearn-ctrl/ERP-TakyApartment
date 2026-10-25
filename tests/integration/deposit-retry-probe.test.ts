import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { attestDepositTestDatabase } from "../helpers/deposit-core";

function safeErrorShape(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const output: Record<string, unknown> = {};
  for (const key of [
    "code",
    "sqlState",
    "sqlstate",
    "kind",
    "originalCode",
    "name",
  ] as const) {
    if (key in value) {
      const item: unknown = Reflect.get(value, key);
      if (typeof item === "string" && /^[A-Za-z0-9_]{1,80}$/.test(item))
        output[key] = item;
    }
  }
  for (const key of ["meta", "cause", "driverAdapterError"] as const) {
    if (key in value)
      output[key] = safeErrorShape(Reflect.get(value, key), depth + 1);
  }
  return output;
}

afterAll(() => db.$disconnect());
it("captures only allowlisted serialization error shape from the actual Prisma adapter", async () => {
  await attestDepositTestDatabase();
  const user = await db.user.create({
    data: {
      username: `deposit-probe-${randomUUID()}`,
      email: `${randomUUID()}@synthetic.invalid`,
      name: "Synthetic transaction probe",
      passwordHash: "not-a-password",
      role: "STAFF",
    },
  });
  let snapshotReady: () => void = () => {};
  const snapshot = new Promise<void>((resolve) => {
    snapshotReady = resolve;
  });
  let updated: () => void = () => {};
  const committed = new Promise<void>((resolve) => {
    updated = resolve;
  });
  const conflicting = db
    .$transaction(
      async (tx) => {
        await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        snapshotReady();
        await committed;
        return tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id}::uuid FOR UPDATE`;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    )
    .then(
      () => ({ ok: true, knownInstance: false, shape: null }),
      (error: unknown) => ({
        ok: false,
        knownInstance: error instanceof Prisma.PrismaClientKnownRequestError,
        shape: safeErrorShape(error),
      }),
    );
  try {
    await snapshot;
    await db.user.update({
      where: { id: user.id },
      data: { name: "Synthetic transaction probe updated" },
    });
  } finally {
    updated();
  }
  const result = await conflicting;
  console.info(
    JSON.stringify({ event: "deposit_serialization_error_shape", ...result }),
  );
  expect(result.ok).toBe(false);
  expect(result.shape).not.toBeNull();
});
