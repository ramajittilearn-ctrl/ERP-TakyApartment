import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (
    !url ||
    !/^taky_payment_test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1))
  )
    throw new Error("Fresh isolated synthetic payment database required");
  const root = process.cwd();
  const evidence = join(root, "evidence/payments");
  mkdirSync(evidence, { recursive: true });
  const stage = join(evidence, "migration-staging", randomUUID());
  mkdirSync(join(stage, "migrations"), { recursive: true });
  const names = readdirSync(join(root, "prisma/migrations"))
    .filter((name) => /^\d+_/.test(name))
    .sort();
  for (const name of names.filter((name) => name < "202610210001"))
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
    `import { defineConfig } from "prisma/config"; export default defineConfig({ schema: ${JSON.stringify(join(stage, "schema.prisma"))}, migrations: { path: ${JSON.stringify(join(stage, "migrations"))} }, datasource: { url: process.env.DATABASE_URL } });\n`,
  );
  function deploy(configuration: string) {
    const output = execFileSync(
      resolve("node_modules/.bin/prisma"),
      ["migrate", "deploy", "--config", configuration],
      { env: process.env, encoding: "utf8" },
    );
    writeFileSync(join(evidence, "migration-deploy.log"), output, {
      flag: "a",
    });
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = await client.query("SELECT current_database() AS name");
    assert.equal(identity.rows[0]?.name, new URL(url).pathname.slice(1));
    const existing = await client.query(
      "SELECT to_regclass('public.\"Payment\"') AS relation",
    );
    assert.equal(
      existing.rows[0]?.relation,
      null,
      "Rehearsal requires untouched fresh database",
    );
    deploy(config);
    const ids = {
      property: randomUUID(),
      floor: randomUUID(),
      room: randomUUID(),
      tenant: randomUUID(),
      lease: randomUUID(),
      invoice: randomUUID(),
    };
    await client.query(
      'INSERT INTO "Property" (id,code,name,"updatedAt") VALUES ($1,$2,$3,now())',
      [
        ids.property,
        `SYN-${randomUUID()}`,
        "Synthetic legacy migration property",
      ],
    );
    await client.query(
      'INSERT INTO "Floor" (id,"propertyId",number,name,"updatedAt") VALUES ($1,$2,1,$3,now())',
      [ids.floor, ids.property, "Synthetic floor"],
    );
    await client.query(
      'INSERT INTO "Room" (id,"floorId",number,rent,"updatedAt") VALUES ($1,$2,$3,1000,now())',
      [ids.room, ids.floor, "S01"],
    );
    await client.query(
      'INSERT INTO "Tenant" (id,name,"updatedAt") VALUES ($1,$2,now())',
      [ids.tenant, "Synthetic legacy tenant"],
    );
    await client.query(
      'INSERT INTO "Lease" (id,number,"roomId","tenantId","startDate","endDate",rent,deposit,status,"updatedAt") VALUES ($1,$2,$3,$4,\'2026-01-01\',\'2026-12-31\',1000,0,\'ACTIVE\',now())',
      [ids.lease, `SYN-${randomUUID()}`, ids.room, ids.tenant],
    );
    await client.query(
      'INSERT INTO "Invoice" (id,number,"leaseId",period,"dueDate",status,"issuedAt","updatedAt") VALUES ($1,$2,$3,\'2026-02-01\',\'2026-02-07\',\'ISSUED\',now(),now())',
      [ids.invoice, `SYN-${randomUUID()}`, ids.lease],
    );
    const paymentIds: string[] = [];
    const allocationIds: string[] = [];
    for (const status of ["PENDING", "CONFIRMED", "REVERSED"]) {
      const paymentId = randomUUID();
      const allocationId = randomUUID();
      paymentIds.push(paymentId);
      allocationIds.push(allocationId);
      await client.query(
        'INSERT INTO "Payment" (id,reference,"leaseId",amount,method,status,"receivedAt","updatedAt") VALUES ($1,$2,$3,123.45,$4,$5::"PaymentStatus",\'2026-02-02T03:04:05Z\',now())',
        [
          paymentId,
          `SYN-LEGACY-${randomUUID()}`,
          ids.lease,
          "historical-cheque",
          status,
        ],
      );
      await client.query(
        'INSERT INTO "PaymentAllocation" (id,"paymentId","invoiceId",amount,"updatedAt") VALUES ($1,$2,$3,123.45,now())',
        [allocationId, paymentId, ids.invoice],
      );
    }
    for (const name of names.filter(
      (name) => name >= "202610210001" && name < "202610230001",
    ))
      cpSync(
        join(root, "prisma/migrations", name),
        join(stage, "migrations", name),
        { recursive: true },
      );
    deploy(config);
    const baselinePayments = (
      await client.query('SELECT * FROM "Payment" ORDER BY id')
    ).rows;
    const baselineAllocations = (
      await client.query('SELECT * FROM "PaymentAllocation" ORDER BY id')
    ).rows;
    const constraints = (
      await client.query(
        `SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('"Payment"'::regclass,'"PaymentAllocation"'::regclass) ORDER BY conname`,
      )
    ).rows;
    const indexes = (
      await client.query(
        `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Payment','PaymentAllocation') ORDER BY indexname`,
      )
    ).rows;
    const statuses = (
      await client.query(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='PaymentStatus' ORDER BY e.enumsortorder`,
      )
    ).rows.map((row) => row.enumlabel);
    deploy(join(root, "prisma.config.ts"));
    const afterPayments = (
      await client.query('SELECT * FROM "Payment" ORDER BY id')
    ).rows;
    const afterAllocations = (
      await client.query('SELECT * FROM "PaymentAllocation" ORDER BY id')
    ).rows;
    assert.deepEqual(
      afterPayments.map((row) =>
        Object.fromEntries(
          Object.keys(baselinePayments[0]).map((key) => [key, row[key]]),
        ),
      ),
      baselinePayments,
    );
    assert.deepEqual(afterAllocations, baselineAllocations);
    for (const row of afterPayments) {
      assert.equal(row.legacyUnmapped, true);
      assert.equal(row.methodCode, null);
      assert.equal(row.recordedById, null);
    }
    const afterConstraints = (
      await client.query(
        `SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('"Payment"'::regclass,'"PaymentAllocation"'::regclass) ORDER BY conname`,
      )
    ).rows;
    for (const constraint of constraints)
      assert(
        afterConstraints.some(
          (row) =>
            row.conname === constraint.conname &&
            row.definition === constraint.definition,
        ),
      );
    const afterIndexes = (
      await client.query(
        `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Payment','PaymentAllocation') ORDER BY indexname`,
      )
    ).rows;
    for (const index of indexes)
      assert(
        afterIndexes.some(
          (row) =>
            row.indexname === index.indexname &&
            row.indexdef === index.indexdef,
        ),
      );
    const afterStatuses = (
      await client.query(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='PaymentStatus' ORDER BY e.enumsortorder`,
      )
    ).rows.map((row) => row.enumlabel);
    assert.deepEqual(afterStatuses.slice(0, statuses.length), statuses);
    const report = {
      result: "PASS",
      database: new URL(url).pathname.slice(1),
      legacy: { ...ids, paymentIds, allocationIds },
      preservedPaymentRows: baselinePayments.length,
      preservedAllocationRows: baselineAllocations.length,
      preservedConstraints: constraints.length,
      preservedIndexes: indexes.length,
      preservedStatuses: statuses,
      migrations: names,
    };
    writeFileSync(
      join(evidence, "legacy-migration-rehearsal.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    process.stdout.write(
      `Legacy migration rehearsal PASS: ${baselinePayments.length} payments, ${baselineAllocations.length} allocations, ${constraints.length} original constraints preserved.\n`,
    );
  } finally {
    await client.end();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
