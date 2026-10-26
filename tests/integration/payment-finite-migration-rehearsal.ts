import assert from "node:assert/strict";
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
import { Client } from "pg";

const migration = "202610240002_payment_finite_amounts";
const scenario = process.argv[2];
const attempt = randomUUID();
const evidence = resolve("evidence/financial-nan");
function sanitize(value: string) {
  let result = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (secret && /URL|PASSWORD|SECRET/.test(key))
      result = result.replaceAll(secret, "[redacted]");
  }
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    for (const value of [url.password, decodeURIComponent(url.password)])
      if (value) result = result.replaceAll(value, "[redacted]");
  }
  return result.replace(
    /postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
    "[synthetic database URL]",
  );
}
function deploy(
  config: string,
  label: string,
  expectBlock = false,
  expectedMessage = "Managed Payment contains non-finite amounts; audited reconciliation required before migration",
) {
  try {
    const output = execFileSync(
      process.execPath,
      [
        resolve("node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--config",
        config,
      ],
      {
        env: process.env,
        encoding: "utf8",
        timeout: 120000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    writeFileSync(
      join(evidence, `finite-${attempt}-${label}.log`),
      sanitize(output),
      { flag: "wx" },
    );
    assert(!expectBlock, "Managed NaN must block migration");
  } catch (error: unknown) {
    if (!expectBlock) throw error;
    if (
      !error ||
      typeof error !== "object" ||
      !("stdout" in error) ||
      !("stderr" in error)
    )
      throw error;
    const output = sanitize(
      String(error.stdout ?? "") + String(error.stderr ?? ""),
    );
    writeFileSync(
      join(evidence, `finite-${attempt}-${label}-blocked.log`),
      output,
      { flag: "wx" },
    );
    assert(
      output.includes(expectedMessage),
      "Expected fixed prerequisite error",
    );
    assert.match(output, /23514/);
  }
}
async function triggerState(client: Client) {
  return (
    await client.query(
      "SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,t.tgname",
    )
  ).rows;
}
async function rows(client: Client) {
  return (
    await client.query(
      'SELECT to_jsonb(p)::text AS value FROM "Payment" p ORDER BY id',
    )
  ).rows;
}
async function insertPayment(
  client: Client,
  lease: string,
  actor: string,
  amount: string,
) {
  const id = randomUUID();
  await client.query(
    'INSERT INTO "Payment" (id,reference,"leaseId",amount,method,status,"receivedAt","updatedAt","legacyUnmapped","isDemo","methodCode",version,"recordedById") VALUES ($1,$2,$3,$4::numeric,\'CASH\',\'PENDING\',\'2026-10-24T00:00:00Z\',\'2026-10-24T00:00:00Z\',false,false,\'CASH\',1,$5)',
    [id, `FIN-${id}`, lease, amount, actor],
  );
  return id;
}
async function main() {
  if (
    process.argv.length !== 3 ||
    !["preserve", "blocker", "alloc-blocker"].includes(scenario ?? "")
  )
    throw new Error(
      "Explicit preserve, blocker or alloc-blocker scenario required",
    );
  const configured = process.env.DATABASE_URL;
  if (!configured)
    throw new Error("Explicit isolated finite rehearsal URL required");
  const url = new URL(configured);
  const expectedDatabase =
    scenario === "preserve"
      ? "taky_payment_test_2b5214bd52_finite_rehearsal2"
      : scenario === "blocker"
        ? "taky_payment_test_2b5214bd52_finite_blocker2"
        : "taky_payment_test_2b5214bd52_finite_alloc_blocker2";
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55489" ||
    url.pathname !== "/" + expectedDatabase ||
    url.username !== "taky_qa_2b5214bd52" ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Exact dedicated finite rehearsal target required");
  mkdirSync(evidence, { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), "taky-finite-rehearsal-"));
  mkdirSync(join(stage, "migrations"));
  cpSync(resolve("prisma/schema.prisma"), join(stage, "schema.prisma"));
  cpSync(
    resolve("prisma/migrations/migration_lock.toml"),
    join(stage, "migrations/migration_lock.toml"),
  );
  const names = readdirSync(resolve("prisma/migrations"))
    .filter((name) => /^\d+_/.test(name))
    .sort();
  assert.equal(names.length, 16);
  assert.equal(names.at(-1), migration);
  assert.equal(names.at(-2), "202610240001_phase4_expenses");
  const config = join(stage, "prisma.config.ts");
  writeFileSync(
    config,
    `import { defineConfig } from ${JSON.stringify(resolve("node_modules/prisma/config.js"))}; export default defineConfig({schema:${JSON.stringify(join(stage, "schema.prisma"))},migrations:{path:${JSON.stringify(join(stage, "migrations"))}},datasource:{url:process.env.DATABASE_URL}});\n`,
  );
  const client = new Client({
    connectionString: configured,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await client.connect();
  try {
    assert.deepEqual(
      (
        await client.query(
          "SELECT current_database() AS database,current_user AS role",
        )
      ).rows[0],
      { database: expectedDatabase, role: "taky_qa_2b5214bd52" },
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
        )
      ).rows[0]?.count,
      0,
      "Requires pristine target, no reset permitted",
    );
    // Insert historical invoice/payment rows before managed invoice insertion guards.
    for (const name of names.slice(0, 10))
      cpSync(
        resolve("prisma/migrations", name),
        join(stage, "migrations", name),
        { recursive: true },
      );
    deploy(config, "historical10");
    const ids = Object.fromEntries(
      [
        "property",
        "floor",
        "room",
        "tenant",
        "lease",
        "user",
        "invoice",
        "legacyPayment",
        "legacyAllocation",
      ].map((name) => [name, randomUUID()]),
    );
    await client.query(
      'INSERT INTO "Property" (id,code,name,"updatedAt") VALUES ($1,$2,\'Synthetic finite legacy property\',now())',
      [ids.property, "FIN-" + randomUUID().replaceAll("-", "").slice(0, 24)],
    );
    await client.query(
      'INSERT INTO "Floor" (id,"propertyId",number,name,"updatedAt") VALUES ($1,$2,1,\'Synthetic legacy floor\',now())',
      [ids.floor, ids.property],
    );
    await client.query(
      'INSERT INTO "Room" (id,"floorId",number,rent,"updatedAt") VALUES ($1,$2,\'FIN-101\',1000,now())',
      [ids.room, ids.floor],
    );
    await client.query(
      'INSERT INTO "Tenant" (id,name,"updatedAt") VALUES ($1,\'Synthetic legacy tenant\',now())',
      [ids.tenant],
    );
    await client.query(
      'INSERT INTO "Lease" (id,number,"roomId","tenantId","startDate","endDate",rent,deposit,status,"updatedAt") VALUES ($1,$2,$3,$4,\'2026-01-01\',\'2026-12-31\',1000,0,\'DRAFT\',now())',
      [
        ids.lease,
        "FIN-" + randomUUID().replaceAll("-", "").slice(0, 24),
        ids.room,
        ids.tenant,
      ],
    );
    await client.query(
      "INSERT INTO \"User\" (id,username,email,name,\"passwordHash\",role,\"updatedAt\") VALUES ($1,$2,$3,'Synthetic finite admin','unusable-hash','ADMIN',now())",
      [ids.user, "finite-" + randomUUID(), randomUUID() + "@synthetic.invalid"],
    );
    await client.query(
      'INSERT INTO "Invoice" (id,number,"leaseId",period,"dueDate",status,"updatedAt") VALUES ($1,$2,$3,\'2026-02-01\',\'2026-02-07\',\'DRAFT\',now())',
      [
        ids.invoice,
        "FIN-" + randomUUID().replaceAll("-", "").slice(0, 24),
        ids.lease,
      ],
    );
    await client.query(
      "INSERT INTO \"Payment\" (id,reference,\"leaseId\",amount,method,status,\"receivedAt\",\"updatedAt\") VALUES ($1,$2,$3,'NaN'::numeric,'historical-cheque','PENDING','2026-01-02T03:04:05.123Z','2026-01-02T03:04:05.123Z')",
      [ids.legacyPayment, "FIN-LEGACY-" + randomUUID(), ids.lease],
    );
    await client.query(
      'INSERT INTO "PaymentAllocation" (id,"paymentId","invoiceId",amount,"updatedAt") VALUES ($1,$2,$3,$4::numeric,\'2026-01-02T03:04:05.123Z\')',
      [
        ids.legacyAllocation,
        ids.legacyPayment,
        ids.invoice,
        scenario === "alloc-blocker" ? "NaN" : "0.01",
      ],
    );
    for (const name of names.slice(10, 15))
      cpSync(
        resolve("prisma/migrations", name),
        join(stage, "migrations", name),
        { recursive: true },
      );
    deploy(config, "baseline15");
    await insertPayment(client, ids.lease, ids.user, "100.00");
    if (scenario === "blocker")
      await insertPayment(client, ids.lease, ids.user, "NaN");
    const before = await rows(client);
    const allocationsBefore = (
      await client.query(
        'SELECT to_jsonb(a)::text AS value FROM "PaymentAllocation" a ORDER BY id',
      )
    ).rows;
    const triggersBefore = await triggerState(client);
    assert(triggersBefore.every((row) => row.tgenabled === "O"));
    cpSync(
      resolve("prisma/migrations", migration),
      join(stage, "migrations", migration),
      { recursive: true },
    );
    deploy(
      config,
      scenario === "preserve" ? "upgrade16" : `upgrade16-${scenario}`,
      scenario !== "preserve",
      scenario === "alloc-blocker"
        ? "PaymentAllocation contains non-finite amounts; audited reconciliation required before migration"
        : "Managed Payment contains non-finite amounts; audited reconciliation required before migration",
    );
    assert.deepEqual(
      await rows(client),
      before,
      "Every payment amount, flag and timestamp preserved exactly",
    );
    assert.deepEqual(
      (
        await client.query(
          'SELECT to_jsonb(a)::text AS value FROM "PaymentAllocation" a ORDER BY id',
        )
      ).rows,
      allocationsBefore,
    );
    assert.deepEqual(await triggerState(client), triggersBefore);
    const added = (
      await client.query(
        "SELECT conname,convalidated FROM pg_constraint WHERE conname=ANY($1::text[]) ORDER BY conname",
        [["Payment_managed_amount_finite", "Allocation_amount_finite"]],
      )
    ).rows;
    if (scenario !== "preserve") {
      assert.deepEqual(added, [], "Failed migration adds no constraints");
      assert.equal(
        (
          await client.query(
            'SELECT count(*)::int AS count FROM "Payment" WHERE NOT "legacyUnmapped" AND amount=\'NaN\'::numeric',
          )
        ).rows[0]?.count,
        scenario === "blocker" ? 1 : 0,
      );
      if (scenario === "alloc-blocker") {
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM \"PaymentAllocation\" WHERE amount='NaN'::numeric",
            )
          ).rows[0]?.count,
          1,
        );
      }
      assert.equal(
        (
          await client.query(
            'SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL',
            [migration],
          )
        ).rows[0]?.count,
        0,
      );
    } else {
      assert.deepEqual(added, [
        { conname: "Allocation_amount_finite", convalidated: true },
        { conname: "Payment_managed_amount_finite", convalidated: true },
      ]);
      await insertPayment(client, ids.lease, ids.user, "0.01");
      await assert.rejects(insertPayment(client, ids.lease, ids.user, "NaN"), {
        code: "23514",
        constraint: "Payment_managed_amount_finite",
      });
      assert.equal(
        (
          await client.query(
            'SELECT amount::text AS amount FROM "Payment" WHERE id=$1',
            [ids.legacyPayment],
          )
        ).rows[0]?.amount,
        "NaN",
      );
    }
    const report = {
      result: "PASS",
      candidateVersion: "single-do-v2",
      scenario,
      database: expectedDatabase,
      attempt,
      preservedPayments: before.length,
      preservedAllocations: allocationsBefore.length,
      triggersUnchanged: triggersBefore.length,
      historicalPaymentNaN: "preserved unchanged and legacy-only",
      constraints: added,
      managedNaNBlocks: scenario === "blocker",
      legacyAllocationNaNBlocks: scenario === "alloc-blocker",
    };
    writeFileSync(
      join(evidence, `finite-rehearsal-${scenario}-${attempt}.json`),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
    console.info(
      `PASS finite-payment ${scenario} migration rehearsal; prior rows and trigger definitions unchanged`,
    );
  } finally {
    await client.end();
  }
}
main().catch((error: unknown) => {
  if (error instanceof Error) console.error(sanitize(error.message));
  console.error(
    "Finite payment migration rehearsal failed; inspect sanitized immutable artifacts",
  );
  process.exitCode = 1;
});
