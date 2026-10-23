import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { db } from "../../src/server/db";
import type { Actor } from "../../src/server/services";
import {
  createExpense,
  postExpense,
  cancelExpense,
  reverseExpense,
  createExpenseCategory,
  setExpenseCategoryActive,
  getExpense,
  listExpenses,
  listExpenseCategories,
} from "../../src/server/expenses";
let admin: Actor, staff: Actor;
const key = () => randomUUID();
beforeAll(async () => {
  const configured = process.env.DATABASE_URL;
  if (!configured)
    throw new Error("Explicit isolated synthetic expense database required");
  const url = new URL(configured);
  if (
    !/^taky_expense_test_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.hostname !== "127.0.0.1" ||
    url.search
  )
    throw new Error(
      "Fresh loopback isolated synthetic expense database required",
    );
  const identity = await db.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  expect(identity[0]?.name).toBe(url.pathname.slice(1));
  admin = await db.user.create({
    data: {
      username: `expense-admin-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: "Synthetic expense admin",
      passwordHash: "not-a-password",
      role: "ADMIN",
    },
  });
  staff = await db.user.create({
    data: {
      username: `expense-staff-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: "Synthetic expense staff",
      passwordHash: "not-a-password",
      role: "STAFF",
    },
  });
});
afterAll(() => db.$disconnect());
async function fixture(kind: "OPEX" | "CAPEX" = "OPEX") {
  const property = await db.property.create({
    data: {
      code: `EXP-${key()}`,
      name: "Synthetic expense property",
      address: "Synthetic address",
    },
  });
  const category = await createExpenseCategory(admin, {
    name: `Synthetic ${key()}`,
    kind,
    commandKey: key(),
  });
  return { property, category };
}
function draft(f: Awaited<ReturnType<typeof fixture>>, amount = "1234.56") {
  return {
    propertyId: f.property.id,
    categoryId: f.category.id,
    description: "Synthetic repair",
    vendor: "Synthetic vendor",
    amount,
    occurredAt: "2026-10-24",
    method: "CASH",
    commandKey: key(),
  };
}
async function pending(
  f: Awaited<ReturnType<typeof fixture>>,
  amount = "1234.56",
) {
  return createExpense(staff, draft(f, amount));
}
const posting = (id: string, version = 1) => ({
  expenseId: id,
  expectedVersion: version,
  commandKey: key(),
});
async function pausedRace(
  table: "Expense" | "ExpenseCategory",
  id: string,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const locker = new Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();
  const lock = 91823017;
  let firstResult: Promise<unknown> | undefined;
  let secondResult: Promise<unknown> | undefined;
  await locker.query("SELECT pg_advisory_lock($1)", [lock]);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION expense_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER expense_test_pause BEFORE UPDATE ON "${table}" FOR EACH ROW WHEN (NEW.id='${id}'::uuid) EXECUTE FUNCTION expense_test_pause()`,
  );
  try {
    firstResult = first();
    let waiting = false;
    for (let count = 0; count < 200; count++) {
      const rows = await locker.query(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=$1",
        [lock],
      );
      if (rows.rows[0]?.n === 1) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(waiting).toBe(true);
    secondResult = second();
    await locker.query("SELECT pg_advisory_unlock($1)", [lock]);
    return await Promise.allSettled([firstResult, secondResult]);
  } finally {
    await locker.query("SELECT pg_advisory_unlock_all()");
    if (firstResult) await Promise.allSettled([firstResult]);
    if (secondResult) await Promise.allSettled([secondResult]);
    await db.$executeRawUnsafe(`DROP TRIGGER expense_test_pause ON "${table}"`);
    await db.$executeRawUnsafe("DROP FUNCTION expense_test_pause()");
    await locker.end();
  }
}
describe("persisted expenses with real PostgreSQL integrity", () => {
  it("persists STAFF input exactly, ADMIN posts and reverses retained history", async () => {
    const f = await fixture();
    const row = await pending(f);
    expect(await getExpense(staff, row.id)).toMatchObject({
      amount: "1234.56",
      vendor: "Synthetic vendor",
      occurredAt: "2026-10-24",
      status: "PENDING",
      version: 1,
      categoryKind: "OPEX",
    });
    await expect(postExpense(staff, posting(row.id))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const posted = await postExpense(admin, posting(row.id));
    expect(posted).toMatchObject({
      status: "POSTED",
      version: 2,
      postedById: admin.id,
    });
    const reversed = await reverseExpense(admin, {
      ...posting(row.id, 2),
      reason: "Synthetic correction",
    });
    expect(reversed).toMatchObject({
      status: "REVERSED",
      version: 3,
      postedById: admin.id,
      reversedById: admin.id,
      amount: "1234.56",
    });
    await expect(
      reverseExpense(admin, {
        ...posting(row.id, 3),
        reason: "No reversal chains",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await db.auditLog.count({ where: { entityId: row.id } })).toBe(3);
  });
  it("replays canonical command once and rejects key conflicts across operations", async () => {
    const f = await fixture();
    const input = draft(f);
    const a = await createExpense(admin, input);
    expect(
      await createExpense(admin, {
        ...input,
        propertyId: input.propertyId.toUpperCase(),
      }),
    ).toEqual(a);
    await expect(
      createExpense(admin, { ...input, amount: "1.00" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      postExpense(admin, {
        expenseId: a.id,
        expectedVersion: 1,
        commandKey: input.commandKey,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    for (const note of [null, "", " "])
      expect(await createExpense(admin, { ...input, note })).toEqual(a);
    const other = await createExpense(staff, input);
    expect(other.id).not.toBe(a.id);
    expect(other.possibleDuplicateCount).toBe(1);
    expect(
      await db.expenseCommand.count({
        where: { actorId: admin.id, commandKey: input.commandKey },
      }),
    ).toBe(1);
  });
  it("rechecks disabled and changed roles even on replay", async () => {
    const f = await fixture();
    const user = await db.user.create({
      data: {
        username: `disabled-${key()}`,
        email: `${key()}@synthetic.invalid`,
        name: "Synthetic temporary staff",
        passwordHash: "not-a-password",
        role: "STAFF",
      },
    });
    const input = draft(f);
    await createExpense(user, input);
    await db.user.update({ where: { id: user.id }, data: { disabled: true } });
    await expect(createExpense(user, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await db.user.update({
      where: { id: user.id },
      data: { disabled: false, role: "ADMIN" },
    });
    await expect(listExpenses(user, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("rejects missing entities, inactive categories and stale versions", async () => {
    const f = await fixture();
    await expect(
      createExpense(admin, { ...draft(f), propertyId: key() }),
    ).rejects.toMatchObject({ code: "PROPERTY_NOT_FOUND" });
    await expect(
      createExpense(admin, { ...draft(f), categoryId: key() }),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });
    const row = await pending(f);
    await expect(postExpense(admin, posting(row.id, 2))).rejects.toMatchObject({
      code: "STALE_VERSION",
    });
    await setExpenseCategoryActive(admin, {
      categoryId: f.category.id,
      active: false,
      expectedVersion: 1,
      commandKey: key(),
    });
    await expect(createExpense(admin, draft(f))).rejects.toMatchObject({
      code: "INACTIVE_CATEGORY",
    });
    await expect(postExpense(admin, posting(row.id))).rejects.toMatchObject({
      code: "INACTIVE_CATEGORY",
    });
    expect(
      (
        await cancelExpense(admin, {
          ...posting(row.id),
          reason: "Replace inactive category",
        })
      ).status,
    ).toBe("CANCELLED");
  });
  it("requires ADMIN category mutation and preserves historical snapshots", async () => {
    await expect(
      createExpenseCategory(staff, {
        name: `Denied ${key()}`,
        kind: "OPEX",
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const f = await fixture("CAPEX");
    const row = await pending(f);
    await postExpense(admin, posting(row.id));
    await setExpenseCategoryActive(admin, {
      categoryId: f.category.id,
      active: false,
      expectedVersion: 1,
      commandKey: key(),
    });
    expect((await getExpense(admin, row.id)).categoryKind).toBe("CAPEX");
    expect(
      (await listExpenseCategories(staff)).find((c) => c.id === f.category.id),
    ).toMatchObject({ active: false, version: 2, kind: "CAPEX" });
    await expect(
      setExpenseCategoryActive(admin, {
        categoryId: f.category.id,
        active: true,
        expectedVersion: 1,
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });
  it("permits correction only from a terminal same-property original", async () => {
    const f = await fixture();
    const original = await pending(f);
    await expect(
      createExpense(admin, { ...draft(f), correctionOfId: original.id }),
    ).rejects.toMatchObject({ code: "INVALID_CORRECTION" });
    await cancelExpense(admin, {
      ...posting(original.id),
      reason: "Wrong amount",
    });
    expect(
      await createExpense(admin, {
        ...draft(f, "12.34"),
        correctionOfId: original.id,
      }),
    ).toMatchObject({
      correctionOfId: original.id,
      amount: "12.34",
      status: "PENDING",
    });
    const other = await fixture();
    await expect(
      createExpense(admin, { ...draft(other), correctionOfId: original.id }),
    ).rejects.toMatchObject({ code: "INVALID_CORRECTION" });
  });
  it("reconciles exact full-filter totals despite paging and excludes pending/cancelled/reversed", async () => {
    const f = await fixture();
    const cap = await createExpenseCategory(admin, {
      name: `Capital ${key()}`,
      kind: "CAPEX",
      commandKey: key(),
    });
    const first = await pending(f, "1234.56");
    await postExpense(admin, posting(first.id));
    const capital = await createExpense(staff, {
      ...draft(f, "10000.01"),
      categoryId: cap.id,
    });
    await postExpense(admin, posting(capital.id));
    await pending(f, "5.00");
    const cancelled = await pending(f, "7.00");
    await cancelExpense(admin, {
      ...posting(cancelled.id),
      reason: "Cancelled",
    });
    const reversed = await pending(f, "9.99");
    await postExpense(admin, posting(reversed.id));
    await reverseExpense(admin, {
      ...posting(reversed.id, 2),
      reason: "Reversed",
    });
    const result = await listExpenses(staff, {
      propertyId: f.property.id,
      from: "2026-10-24",
      to: "2026-10-24",
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(5);
    expect(result.totals).toEqual({
      opex: "1234.56",
      capex: "10000.01",
      total: "11234.57",
    });
    expect(
      (
        await listExpenses(staff, {
          propertyId: f.property.id,
          status: "PENDING",
        })
      ).totals.total,
    ).toBe("0.00");
    expect(
      (
        await listExpenses(staff, {
          propertyId: f.property.id,
          to: "2026-10-23",
        })
      ).total,
    ).toBe(0);
    expect(
      (await listExpenses(staff, { propertyId: f.property.id, kind: "CAPEX" }))
        .totals,
    ).toEqual({ opex: "0.00", capex: "10000.01", total: "10000.01" });
  });
  it.each(["post/post", "post/cancel", "reverse/reverse"])(
    "allows exactly one committed conflicting %s transition",
    async (kind) => {
      const f = await fixture();
      const row = await pending(f);
      if (kind === "reverse/reverse") await postExpense(admin, posting(row.id));
      const actions =
        kind === "reverse/reverse"
          ? [
              () =>
                reverseExpense(admin, {
                  ...posting(row.id, 2),
                  reason: "First",
                }),
              () =>
                reverseExpense(admin, {
                  ...posting(row.id, 2),
                  reason: "Second",
                }),
            ]
          : [
              () => postExpense(admin, posting(row.id)),
              () =>
                kind === "post/cancel"
                  ? cancelExpense(admin, {
                      ...posting(row.id),
                      reason: "Cancel",
                    })
                  : postExpense(admin, posting(row.id)),
            ];
      const result = await Promise.allSettled(
        actions.map((action) => action()),
      );
      expect(result.filter((v) => v.status === "fulfilled")).toHaveLength(1);
      expect(result.filter((v) => v.status === "rejected")).toHaveLength(1);
      expect((await getExpense(admin, row.id)).version).toBe(
        kind === "reverse/reverse" ? 3 : 2,
      );
      expect(await db.auditLog.count({ where: { entityId: row.id } })).toBe(
        kind === "reverse/reverse" ? 3 : 2,
      );
    },
  );
  it("serializes posting first then category deactivation with both commands committed", async () => {
    const f = await fixture();
    const row = await pending(f);
    const result = await pausedRace(
      "Expense",
      row.id,
      () => postExpense(admin, posting(row.id)),
      () =>
        setExpenseCategoryActive(admin, {
          categoryId: f.category.id,
          active: false,
          expectedVersion: 1,
          commandKey: key(),
        }),
    );
    expect(result.map((v) => v.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await getExpense(admin, row.id)).status).toBe("POSTED");
    expect(
      (
        await db.expenseCategory.findUniqueOrThrow({
          where: { id: f.category.id },
        })
      ).active,
    ).toBe(false);
  });
  it("serializes category deactivation first then rejects posting and preserves pending", async () => {
    const f = await fixture();
    const row = await pending(f);
    const result = await pausedRace(
      "ExpenseCategory",
      f.category.id,
      () =>
        setExpenseCategoryActive(admin, {
          categoryId: f.category.id,
          active: false,
          expectedVersion: 1,
          commandKey: key(),
        }),
      () => postExpense(admin, posting(row.id)),
    );
    expect(result.map((v) => v.status)).toEqual(["fulfilled", "rejected"]);
    expect((await getExpense(admin, row.id)).status).toBe("PENDING");
    expect(await db.auditLog.count({ where: { entityId: row.id } })).toBe(1);
  });
  it("rejects SQL mutation of financial originals, classification, identity flags and DELETE", async () => {
    const f = await fixture();
    const row = await pending(f);
    for (const change of [
      "amount=999.99",
      "vendor='tampered'",
      '"legacyUnmapped"=true',
      '"isDemo"=true',
      "\"categoryKindSnapshot\"='CAPEX'",
      `"recordedById"='${admin.id}'::uuid`,
    ]) {
      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Expense" SET ${change},status='POSTED',version=2,"postedById"='${admin.id}'::uuid,"postedAt"=now() WHERE id='${row.id}'::uuid`,
        ),
      ).rejects.toThrow();
    }
    await expect(
      db.expense.delete({ where: { id: row.id } }),
    ).rejects.toThrow();
    expect(await getExpense(admin, row.id)).toMatchObject({
      amount: "1234.56",
      vendor: "Synthetic vendor",
      status: "PENDING",
      version: 1,
    });
    await expect(
      db.expenseCategory.update({
        where: { id: f.category.id },
        data: { kind: "CAPEX", version: 2 },
      }),
    ).rejects.toThrow();
    await expect(
      db.expenseCategory.delete({ where: { id: f.category.id } }),
    ).rejects.toThrow();
  });
  it("rejects direct SQL legacy INSERT, forged snapshot and invalid actor or state", async () => {
    const f = await fixture();
    const base = {
      propertyId: f.property.id,
      categoryId: f.category.id,
      description: "SQL test",
      amount: "1.00",
      occurredAt: new Date("2026-10-24T00:00:00Z"),
    };
    await expect(db.expense.create({ data: base })).rejects.toThrow();
    await expect(
      db.expense.create({ data: { ...base, legacyUnmapped: true } }),
    ).rejects.toThrow();
    const valid = {
      ...base,
      legacyUnmapped: false,
      status: "PENDING" as const,
      version: 1,
      vendor: "Synthetic",
      method: "CASH" as const,
      recordedById: staff.id,
      categoryNameSnapshot: f.category.name,
      categoryKindSnapshot: f.category.kind,
    };
    await expect(
      db.expense.create({ data: { ...valid, categoryNameSnapshot: "Forged" } }),
    ).rejects.toThrow();
    await expect(
      db.expense.create({
        data: {
          ...valid,
          status: "POSTED",
          postedById: admin.id,
          postedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    const row = await pending(f);
    await expect(
      db.expense.update({
        where: { id: row.id },
        data: {
          status: "POSTED",
          version: 2,
          postedById: staff.id,
          postedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.expense.update({
        where: { id: row.id },
        data: {
          status: "REVERSED",
          version: 2,
          reversedById: admin.id,
          reversedAt: new Date(),
          reverseReason: "Skip approval",
        },
      }),
    ).rejects.toThrow();
    expect((await getExpense(admin, row.id)).status).toBe("PENDING");
  });
  it("rejects numeric NaN at the database boundary with otherwise valid managed provenance", async () => {
    const f = await fixture();
    const row = await pending(f);
    await expect(db.$executeRaw`INSERT INTO "Expense"(id,"propertyId","categoryId",description,amount,"occurredAt","updatedAt","legacyUnmapped",status,version,vendor,method,"recordedById","categoryNameSnapshot","categoryKindSnapshot")
      SELECT gen_random_uuid(),"propertyId","categoryId",description,'NaN'::numeric,"occurredAt",now(),false,'PENDING',1,vendor,method,"recordedById","categoryNameSnapshot","categoryKindSnapshot" FROM "Expense" WHERE id=${row.id}::uuid`).rejects.toThrow();
    await expect(
      db.$executeRaw`UPDATE "Expense" SET amount='NaN'::numeric,status='POSTED',version=2,"postedById"=${admin.id}::uuid,"postedAt"=now() WHERE id=${row.id}::uuid`,
    ).rejects.toThrow();
    expect((await getExpense(admin, row.id)).amount).toBe("1234.56");
    expect(
      (await listExpenses(admin, { propertyId: f.property.id })).totals.total,
    ).toBe("0.00");
  });
  it("retains immutable posting provenance through direct SQL reversal attempts", async () => {
    const f = await fixture();
    const row = await pending(f);
    await postExpense(admin, posting(row.id));
    await expect(
      db.expense.update({
        where: { id: row.id },
        data: {
          status: "REVERSED",
          version: 3,
          postedAt: new Date("2000-01-01"),
          reversedAt: new Date(),
          reversedById: admin.id,
          reverseReason: "Tampered posting",
        },
      }),
    ).rejects.toThrow();
    expect((await getExpense(admin, row.id)).status).toBe("POSTED");
  });
  it.each(["AuditLog", "ExpenseCommand", "deferred-command"])(
    "rolls back transition/audit/command on %s failure",
    async (stage) => {
      const f = await fixture();
      const row = await pending(f);
      const table = stage === "AuditLog" ? "AuditLog" : "ExpenseCommand";
      const column =
        table === "AuditLog" ? 'NEW."entityId"' : "(NEW.result->>'id')::uuid";
      await db.$executeRawUnsafe(
        "CREATE FUNCTION expense_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic expense failure'; END $$",
      );
      const declaration =
        stage === "deferred-command"
          ? `CREATE CONSTRAINT TRIGGER expense_test_fail AFTER INSERT ON "${table}" DEFERRABLE INITIALLY DEFERRED`
          : `CREATE TRIGGER expense_test_fail BEFORE INSERT ON "${table}"`;
      await db.$executeRawUnsafe(
        `${declaration} FOR EACH ROW WHEN (${column}='${row.id}'::uuid) EXECUTE FUNCTION expense_test_fail()`,
      );
      try {
        await expect(postExpense(admin, posting(row.id))).rejects.toThrow();
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER expense_test_fail ON "${table}"`,
        );
        await db.$executeRawUnsafe("DROP FUNCTION expense_test_fail()");
      }
      expect((await getExpense(admin, row.id)).status).toBe("PENDING");
      expect(await db.auditLog.count({ where: { entityId: row.id } })).toBe(1);
      expect(
        await db.expenseCommand.count({
          where: {
            operation: "expense.post",
            result: { path: ["id"], equals: row.id },
          },
        }),
      ).toBe(0);
    },
  );
  it("keeps commands immutable and validates category ADMIN provenance", async () => {
    const f = await fixture();
    const row = await pending(f);
    const command = await db.expenseCommand.findFirstOrThrow({
      where: { result: { path: ["id"], equals: row.id } },
    });
    await expect(
      db.expenseCommand.update({
        where: { id: command.id },
        data: { operation: "expense.post" },
      }),
    ).rejects.toThrow();
    await expect(
      db.expenseCommand.delete({ where: { id: command.id } }),
    ).rejects.toThrow();
    await expect(
      db.expenseCategory.create({
        data: {
          name: `Forged ${key()}`,
          kind: "OPEX",
          createdById: staff.id,
          changedById: staff.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.expenseCategory.update({
        where: { id: f.category.id },
        data: { active: false, version: 2, changedById: staff.id },
      }),
    ).rejects.toThrow();
    expect(
      (await listExpenseCategories(admin)).find((c) => c.id === f.category.id)
        ?.active,
    ).toBe(true);
  });
  it("has zero global managed-lifecycle or classification violations", async () => {
    const rows = await db.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM "Expense" e JOIN "ExpenseCategory" c ON c.id=e."categoryId" WHERE NOT e."legacyUnmapped" AND (e."isDemo" OR e."categoryNameSnapshot"<>c.name OR e."categoryKindSnapshot"<>c.kind OR (e.status IN ('POSTED','REVERSED') AND (e."postedById" IS NULL OR e."postedAt" IS NULL)) OR (e.status='REVERSED' AND (e."reversedById" IS NULL OR e."reversedAt" IS NULL)))`;
    expect(rows[0]?.n).toBe(0n);
  });
});
