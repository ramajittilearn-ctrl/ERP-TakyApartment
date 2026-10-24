import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Client } from "pg";
async function main() {
  const configured = process.env.DATABASE_URL;
  if (!configured)
    throw new Error("Explicit isolated expense database required");
  const url = new URL(configured);
  if (
    !/^taky_expense_test_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.hostname !== "127.0.0.1" ||
    url.search
  )
    throw new Error(
      "Fresh loopback isolated synthetic expense database required",
    );
  const root = process.cwd(),
    evidence = join(root, "evidence/expenses"),
    stage = mkdtempSync(join(tmpdir(), "taky-expense-migration-"));
  mkdirSync(evidence, { recursive: true });
  mkdirSync(join(stage, "migrations"));
  const migration = "202610240001_phase4_expenses";
  const names = readdirSync(join(root, "prisma/migrations"))
    .filter((n) => /^\d+_/.test(n))
    .sort();
  assert.ok(names.includes(migration));
  for (const name of names.filter((n) => n < migration))
    cpSync(
      join(root, "prisma/migrations", name),
      join(stage, "migrations", name),
      { recursive: true },
    );
  cpSync(
    join(root, "prisma/migrations/migration_lock.toml"),
    join(stage, "migrations/migration_lock.toml"),
  );
  cpSync(join(root, "prisma/schema.prisma"), join(stage, "schema.prisma"));
  const config = join(stage, "prisma.config.ts");
  writeFileSync(
    config,
    `import { defineConfig } from ${JSON.stringify(resolve("node_modules/prisma/config.js"))}; export default defineConfig({ schema: ${JSON.stringify(join(stage, "schema.prisma"))},migrations:{ path:${JSON.stringify(join(stage, "migrations"))} },datasource:{url:process.env.DATABASE_URL} });\n`,
  );
  const attempt = randomUUID();
  function deploy(configuration: string, label: string) {
    const output = execFileSync(
      resolve("node_modules/.bin/prisma"),
      ["migrate", "deploy", "--config", configuration],
      { env: process.env, encoding: "utf8", timeout: 120000 },
    );
    writeFileSync(join(evidence, `migration-${attempt}-${label}.log`), output, {
      flag: "wx",
    });
  }
  const client = new Client({ connectionString: configured });
  await client.connect();
  try {
    assert.equal(
      (await client.query("SELECT current_database() AS name")).rows[0]?.name,
      url.pathname.slice(1),
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
        )
      ).rows[0]?.n,
      0,
      "No reset: migration rehearsal requires an untouched database",
    );
    deploy(config, "baseline");
    const ids = {
      property: randomUUID(),
      category: randomUUID(),
      expense: randomUUID(),
      demoExpense: randomUUID(),
      user: randomUUID(),
      attachment: randomUUID(),
    };
    await client.query(
      'INSERT INTO "Property"(id,code,name,"updatedAt") VALUES($1,$2,$3,$4)',
      [
        ids.property,
        `EXP-${randomUUID()}`,
        "Synthetic old expense property",
        "2026-01-02T03:04:05.123Z",
      ],
    );
    await client.query(
      'INSERT INTO "User"(id,username,email,name,"passwordHash",role,"updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        ids.user,
        `exp-old-${randomUUID()}`,
        `${randomUUID()}@synthetic.invalid`,
        "Synthetic old user",
        "not-a-password",
        "ADMIN",
        "2026-01-02T03:04:05.123Z",
      ],
    );
    await client.query(
      'INSERT INTO "ExpenseCategory"(id,name,kind,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$4)',
      [
        ids.category,
        `Legacy ${randomUUID()}`,
        "CAPEX",
        "2026-01-02T03:04:05.123Z",
      ],
    );
    for (const [id, amount, isDemo] of [
      [ids.expense, "999999999999.99", false],
      [ids.demoExpense, "0.01", true],
    ])
      await client.query(
        'INSERT INTO "Expense"(id,"propertyId","categoryId",description,amount,"occurredAt","isDemo","createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)',
        [
          id,
          ids.property,
          ids.category,
          "Synthetic legacy expense",
          amount,
          "2026-01-01",
          isDemo,
          "2026-01-02T03:04:05.123Z",
        ],
      );
    await client.query(
      'INSERT INTO "Attachment"(id,"storageKey","originalName","mimeType",bytes,sha256,"uploadedById","expenseId","createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)',
      [
        ids.attachment,
        `synthetic/not-a-file/${randomUUID()}`,
        "synthetic.txt",
        "text/plain",
        0,
        "0".repeat(64),
        ids.user,
        ids.expense,
        "2026-01-02T03:04:05.123Z",
      ],
    );
    const tables = ["Expense", "ExpenseCategory", "Attachment"];
    const columns: Record<string, string[]> = {};
    const before: Record<string, string[]> = {};
    for (const table of tables) {
      columns[table] = (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          [table],
        )
      ).rows.map((r) => r.column_name);
      before[table] = (
        await client.query(
          `SELECT to_jsonb(t)::text AS value FROM "${table}" t ORDER BY id`,
        )
      ).rows.map((r) => r.value);
    }
    const originalConstraints = (
      await client.query(
        "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('\"Expense\"'::regclass,'\"ExpenseCategory\"'::regclass,'\"Attachment\"'::regclass) ORDER BY conname",
      )
    ).rows;
    const originalIndexes = (
      await client.query(
        "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY indexname",
        [tables],
      )
    ).rows;
    deploy(resolve("prisma.config.ts"), "upgrade");
    for (const table of tables) {
      const all = (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          [table],
        )
      ).rows.map((r) => r.column_name);
      const added = all.filter((n) => !columns[table].includes(n));
      const after = (
        await client.query(
          `SELECT (to_jsonb(t)-$1::text[])::text AS value FROM "${table}" t ORDER BY id`,
          [added],
        )
      ).rows.map((r) => r.value);
      assert.deepEqual(
        after,
        before[table],
        `${table} original values and timestamps preserved exactly`,
      );
    }
    const currentConstraints = (
      await client.query(
        "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('\"Expense\"'::regclass,'\"ExpenseCategory\"'::regclass,'\"Attachment\"'::regclass) ORDER BY conname",
      )
    ).rows;
    const currentIndexes = (
      await client.query(
        "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY indexname",
        [tables],
      )
    ).rows;
    for (const row of originalConstraints)
      assert.deepEqual(
        currentConstraints.find((r) => r.conname === row.conname),
        row,
      );
    for (const row of originalIndexes)
      assert.deepEqual(
        currentIndexes.find((r) => r.indexname === row.indexname),
        row,
      );
    const legacy = (
      await client.query(
        'SELECT "legacyUnmapped",status,version,vendor,method,"recordedById","postedById" FROM "Expense" ORDER BY id',
      )
    ).rows;
    assert.deepEqual(legacy, [
      {
        legacyUnmapped: true,
        status: null,
        version: null,
        vendor: null,
        method: null,
        recordedById: null,
        postedById: null,
      },
      {
        legacyUnmapped: true,
        status: null,
        version: null,
        vendor: null,
        method: null,
        recordedById: null,
        postedById: null,
      },
    ]);
    await assert.rejects(
      client.query('UPDATE "Expense" SET description=$1 WHERE id=$2', [
        "Silent legacy rewrite",
        ids.expense,
      ]),
    );
    for (const explicit of [false, true])
      await assert.rejects(
        client.query(
          `INSERT INTO "Expense"(id,"propertyId","categoryId",description,amount,"occurredAt","updatedAt"${explicit ? ',"legacyUnmapped"' : ""}) VALUES($1,$2,$3,$4,$5,$6,$7${explicit ? ",true" : ""})`,
          [
            randomUUID(),
            ids.property,
            ids.category,
            "Forbidden new legacy",
            "1.00",
            "2026-01-01",
            "2026-01-02T03:04:05.123Z",
          ],
        ),
      );
    const { listExpenses } = await import("../../src/server/expenses");
    const { db } = await import("../../src/server/db");
    let managedReadProof;
    try {
      const actor = await db.user.findUniqueOrThrow({
        where: { id: ids.user },
      });
      const result = await listExpenses(actor, { propertyId: ids.property });
      assert.equal(result.scope, "managed-only");
      assert.equal(result.excludedLegacyCount, 2);
      assert.equal(result.total, 0);
      assert.deepEqual(result.items, []);
      assert.deepEqual(result.totals, {
        opex: "0.00",
        capex: "0.00",
        total: "0.00",
      });
      managedReadProof = {
        scope: result.scope,
        excludedLegacyCount: result.excludedLegacyCount,
        managedRows: result.total,
        totals: result.totals,
      };
    } finally {
      await db.$disconnect();
    }
    const report = {
      result: "PASS",
      database: url.pathname.slice(1),
      attempt,
      baselineMigrations: names.filter((n) => n < migration),
      appliedMigration: migration,
      preservedExpenseRows: 2,
      preservedCategoryRows: 1,
      preservedAttachmentRows: 1,
      preservedConstraints: originalConstraints.length,
      preservedIndexes: originalIndexes.length,
      legacyInsertFence: "omitted and explicit true rejected",
      legacyUpdate: "rejected",
      managedReadProof,
      stage,
    };
    writeFileSync(
      join(evidence, `migration-rehearsal-${attempt}.json`),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
    process.stdout.write(
      `Expense migration rehearsal PASS: 2 original expense rows, 1 category, 1 attachment, ${originalConstraints.length} constraints and ${originalIndexes.length} indexes preserved.\n`,
    );
  } finally {
    await client.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Expense migration rehearsal failed",
  );
  process.exitCode = 1;
});
