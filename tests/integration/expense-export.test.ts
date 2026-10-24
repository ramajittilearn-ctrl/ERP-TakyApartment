import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { tokenHash } from "../../src/server/auth";
import type { Actor } from "../../src/server/services";
import {
  createExpense,
  createExpenseCategory,
  postExpense,
  reverseExpense,
  listExpenses,
  exportExpenses,
  EXPENSE_EXPORT_LIMIT,
} from "../../src/server/expenses";
import { parseCsv } from "../helpers/expense-csv";
const cookie = vi.hoisted((): { token?: string } => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "taky_session" && cookie.token
        ? { value: cookie.token }
        : undefined,
  }),
}));
vi.mock("@/server/http", async () => import("../../src/server/http"));
vi.mock("@/server/expenses", async () => import("../../src/server/expenses"));
vi.mock(
  "@/server/expenses/export",
  async () => import("../../src/server/expenses/export"),
);
vi.mock(
  "@/server/expenses/query",
  async () => import("../../src/server/expenses/query"),
);
import { GET } from "../../src/app/api/v1/expenses/export/route";
let admin: Actor, staff: Actor, staffToken: string;
const key = () => randomUUID();
beforeAll(async () => {
  const configured = process.env.DATABASE_URL;
  if (!configured)
    throw new Error("Explicit isolated expense database required");
  const url = new URL(configured);
  if (
    url.hostname !== "127.0.0.1" ||
    !/^taky_expense_test_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.search
  )
    throw new Error("Isolated synthetic expense database required");
  const identity = await db.$queryRaw<
    { database: string; role: string }[]
  >`SELECT current_database() AS database, current_user AS role`;
  expect(identity).toEqual([
    { database: url.pathname.slice(1), role: decodeURIComponent(url.username) },
  ]);
  const user = (role: "STAFF" | "ADMIN") =>
    db.user.create({
      data: {
        username: `export-${key()}`,
        email: `${key()}@synthetic.invalid`,
        name: "Synthetic export user",
        passwordHash: "not-a-password",
        role,
      },
    });
  admin = await user("ADMIN");
  staff = await user("STAFF");
  staffToken = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId: staff.id,
      tokenHash: tokenHash(staffToken),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
});
afterAll(() => db.$disconnect());
async function fixture(kind: "OPEX" | "CAPEX" = "OPEX") {
  const property = await db.property.create({
    data: {
      code: `EX-${key().replaceAll("-", "").slice(0, 29)}`,
      name: "Synthetic export property",
      address: "Synthetic address",
    },
  });
  const category = await createExpenseCategory(admin, {
    name: `Export ${key()}`,
    kind,
    commandKey: key(),
  });
  return { property, category };
}
async function entry(
  f: Awaited<ReturnType<typeof fixture>>,
  amount = "1234.56",
) {
  return createExpense(staff, {
    propertyId: f.property.id,
    categoryId: f.category.id,
    description: "Synthetic export repair",
    vendor: "=SUM(1,1)",
    amount,
    occurredAt: "2026-10-24",
    method: "CASH",
    note: "Synthetic\nmultiline",
    commandKey: key(),
  });
}
it("exports real stored-session CSV with exact filtered totals, immutable reversal history and no extra page", async () => {
  const f = await fixture();
  const pending = await entry(f);
  const posted = await postExpense(admin, {
    expenseId: pending.id,
    expectedVersion: 1,
    commandKey: key(),
  });
  cookie.token = staffToken;
  const url = new URL(
    "http://expense-export.synthetic.invalid/api/v1/expenses/export/",
  );
  url.searchParams.set("propertyId", f.property.id);
  url.searchParams.set("from", "2026-10-24");
  url.searchParams.set("to", "2026-10-24");
  const response = await GET(new Request(url));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const rows = parseCsv(await response.text());
  expect(rows).toHaveLength(3);
  const columns = rows[0];
  const summary = Object.fromEntries(
    columns.map((column, i) => [column, rows[1][i]]),
  );
  const detail = Object.fromEntries(
    columns.map((column, i) => [column, rows[2][i]]),
  );
  expect(summary).toMatchObject({
    approvedOpex: "1234.56",
    approvedTotal: "1234.56",
  });
  expect(detail).toMatchObject({
    id: posted.id,
    vendor: "'=SUM(1,1)",
    status: "POSTED",
    amount: "1234.56",
    postedById: admin.id,
  });
  const original = await db.expense.findUniqueOrThrow({
    where: { id: posted.id },
  });
  await reverseExpense(admin, {
    expenseId: posted.id,
    expectedVersion: posted.version,
    reason: "Synthetic correction",
    commandKey: key(),
  });
  const reversed = await exportExpenses(staff, { propertyId: f.property.id });
  expect(reversed.totals.total).toBe("0.00");
  expect(reversed.items[0]).toMatchObject({
    amount: original.amount.toFixed(2),
    vendor: original.vendor,
    status: "REVERSED",
    reverseReason: "Synthetic correction",
  });
  const empty = await GET(new Request(url + "&status=POSTED"));
  expect(parseCsv(await empty.text())).toHaveLength(2);
});
it("matches list filters, aggregates above per-entry precision and detects duplicates outside the selected page", async () => {
  const f = await fixture("CAPEX");
  const a = await entry(f, "999999999999.99");
  const b = await entry(f, "999999999999.99");
  await postExpense(admin, {
    expenseId: a.id,
    expectedVersion: 1,
    commandKey: key(),
  });
  await postExpense(admin, {
    expenseId: b.id,
    expectedVersion: 1,
    commandKey: key(),
  });
  const exported = await exportExpenses(staff, {
    propertyId: f.property.id,
    kind: "CAPEX",
    status: "POSTED",
    query: "repair",
  });
  const listed = await listExpenses(staff, {
    propertyId: f.property.id,
    kind: "CAPEX",
    status: "POSTED",
    query: "repair",
    offset: 1,
    limit: 1,
  });
  expect(exported.items).toHaveLength(2);
  expect(exported.totals).toEqual(listed.totals);
  expect(exported.totals.total).toBe("1999999999999.98");
  expect(
    exported.items.every((item) => item.possibleDuplicateCount === 1),
  ).toBe(true);
  expect(
    (
      await exportExpenses(staff, {
        propertyId: f.property.id,
        from: "2026-10-25",
      })
    ).items,
  ).toHaveLength(0);
});
it("reads rows and totals consistently while a real concurrent approval commits", async () => {
  const f = await fixture();
  const pending = await entry(f, "99.99");
  const results = await Promise.all([
    exportExpenses(staff, { propertyId: f.property.id }),
    postExpense(admin, {
      expenseId: pending.id,
      expectedVersion: 1,
      commandKey: key(),
    }),
  ]);
  const data = results[0];
  expect(data.items).toHaveLength(1);
  expect(data.totals.total).toBe(
    data.items[0].status === "POSTED" ? "99.99" : "0.00",
  );
  expect(
    (await exportExpenses(staff, { propertyId: f.property.id })).totals.total,
  ).toBe("99.99");
});
it("keeps the complete 10,000-row boundary and rejects 10,001 without partial CSV", async () => {
  const f = await fixture();
  // Synthetic pending rows exercise export volume only. All integrity triggers stay enabled.
  await db.$executeRaw`INSERT INTO "Expense" (id,"propertyId","categoryId",description,amount,"occurredAt","isDemo","createdAt","updatedAt","legacyUnmapped",status,version,vendor,method,"categoryNameSnapshot","categoryKindSnapshot","recordedById") SELECT gen_random_uuid(),${f.property.id}::uuid,${f.category.id}::uuid,'Synthetic export volume',0.01,'2026-10-24'::date,false,now(),now(),false,'PENDING'::"ExpenseStatus",1,'Synthetic vendor '||n,'CASH'::"ExpenseMethod",${f.category.name},'OPEX'::"ExpenseKind",${staff.id}::uuid FROM generate_series(1,${EXPENSE_EXPORT_LIMIT}::int) n`;
  const all = await exportExpenses(staff, { propertyId: f.property.id });
  expect(all.items).toHaveLength(EXPENSE_EXPORT_LIMIT);
  expect(all.totals.total).toBe("0.00");
  const page = await listExpenses(staff, { propertyId: f.property.id });
  expect(page.items).toHaveLength(50);
  expect(page.total).toBe(EXPENSE_EXPORT_LIMIT);
  await entry(f);
  cookie.token = staffToken;
  const response = await GET(
    new Request(
      `http://expense-export.synthetic.invalid/api/v1/expenses/export/?propertyId=${f.property.id}`,
    ),
  );
  expect(response.status).toBe(422);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toMatchObject({
    error: { code: "EXPORT_TOO_LARGE" },
  });
}, 60000);
it("enforces genuine missing and disabled sessions and rejects export pagination", async () => {
  cookie.token = undefined;
  expect(
    (
      await GET(
        new Request(
          "http://expense-export.synthetic.invalid/api/v1/expenses/export/",
        ),
      )
    ).status,
  ).toBe(401);
  cookie.token = staffToken;
  expect(
    (
      await GET(
        new Request(
          "http://expense-export.synthetic.invalid/api/v1/expenses/export/?limit=1",
        ),
      )
    ).status,
  ).toBe(422);
  await db.user.update({ where: { id: staff.id }, data: { disabled: true } });
  expect(
    (
      await GET(
        new Request(
          "http://expense-export.synthetic.invalid/api/v1/expenses/export/",
        ),
      )
    ).status,
  ).toBe(401);
});
