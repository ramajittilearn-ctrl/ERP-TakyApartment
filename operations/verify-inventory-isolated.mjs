// Run inside a disposable operations image with no network, published ports or volumes.
// Creates only synthetic data in private Unix-socket PostgreSQL clusters.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { run } from "./archive.mjs";
import { createHash } from "node:crypto";
import {
  INVENTORY_TABLES_V2 as INVENTORY_TABLES,
  INVENTORY_TABLES_V3,
} from "./inventory.mjs";
import {
  inventory,
  literal,
  assertInventory,
  sql,
  withTemp,
  exportSnapshot,
  verifyDatabase,
} from "./database.mjs";

await withTemp("inventory-acceptance", async (directory) => {
  const root = process.getuid() === 0;
  if (root)
    await fs.chown(
      directory,
      Number(await run("id", ["-u", "postgres"])),
      Number(await run("id", ["-g", "postgres"])),
    );
  const pg = (command, args) =>
    root
      ? run("runuser", ["-u", "postgres", "--", command, ...args])
      : run(command, args);
  const data = path.join(directory, "data");
  await pg("initdb", [
    "-D",
    data,
    "--no-locale",
    "--encoding=UTF8",
    "--auth-local=trust",
    "--auth-host=reject",
  ]);
  let started = false;
  try {
    await pg("pg_ctl", [
      "-D",
      data,
      "-l",
      path.join(directory, "server.log"),
      "-w",
      "-t",
      "30",
      "-o",
      `-F -k ${directory} -c listen_addresses='' -p 5545`,
      "start",
    ]);
    started = true;
    Object.assign(process.env, {
      PGHOST: directory,
      PGPORT: "5545",
      PGUSER: root ? "postgres" : process.env.USER,
      PGDATABASE: "postgres",
      PGPASSWORD: "",
    });
    await sql(
      "CREATE TABLE \"_prisma_migrations\" (migration_name text, checksum text, finished_at timestamptz); INSERT INTO \"_prisma_migrations\" VALUES ('synthetic','abc',now())",
    );
    for (const table of INVENTORY_TABLES) {
      const extra =
        table === "Room"
          ? ",number text"
          : table === "Attachment"
            ? ',"storageKey" text,sha256 text,bytes bigint'
            : "";
      // Allocation/counter intentionally have no id and use composite keys.
      const key = ["PaymentAllocation", "InvoiceMonthCounter"].includes(table)
        ? "part text, sequence integer, PRIMARY KEY(part,sequence)"
        : "id text PRIMARY KEY";
      await sql(
        `CREATE TABLE "${table}" (${key}, amount numeric, memo text, at timestamptz ${extra})`,
      );
      const columns = ["PaymentAllocation", "InvoiceMonthCounter"].includes(
        table,
      )
        ? "part,sequence"
        : "id";
      const values = columns === "id" ? "'synthetic'" : "'synthetic',1";
      const extraColumns =
        table === "Room"
          ? ",number"
          : table === "Attachment"
            ? ',"storageKey",sha256,bytes'
            : "";
      const extraValues =
        table === "Room"
          ? ",'101'"
          : table === "Attachment"
            ? ",'private/synthetic','abc',1"
            : "";
      await sql(
        `INSERT INTO "${table}" (${columns},amount,memo,at${extraColumns}) VALUES (${values},90071992547409931234567890.01,NULL,'2026-10-23T00:00:00Z'${extraValues})`,
      );
    }
    const baseline = await inventory(process.env, 2);
    await assertInventory(baseline);
    const legacy = await inventory(process.env, 1);
    await assertInventory(legacy);
    console.info("PASS baseline v2 and unchanged unversioned legacy inventory");
    for (const table of INVENTORY_TABLES) {
      await sql(`UPDATE "${table}" SET amount=amount+0.01`);
      await assert.rejects(assertInventory(baseline), /inventory differs/);
      await sql(`UPDATE "${table}" SET amount=amount-0.01`);
      await assertInventory(baseline);
      console.info(`PASS equal-count decimal mutation ${table}`);
    }
    await sql("UPDATE \"Invoice\" SET memo=''");
    await assert.rejects(assertInventory(baseline), /inventory differs/);
    await sql('UPDATE "Invoice" SET memo=NULL');
    await sql('BEGIN; DELETE FROM "Payment"; ROLLBACK;');
    await assertInventory(baseline);
    await sql('DELETE FROM "Payment"');
    await assert.rejects(assertInventory(baseline), /inventory differs/);
    await sql(
      `INSERT INTO "Payment" VALUES ('synthetic',90071992547409931234567890.01,NULL,'2026-10-23T00:00:00Z')`,
    );
    await assertInventory(baseline);
    await sql(
      `INSERT INTO "Invoice" VALUES ('second',1.23,'order test','2026-10-23T00:00:00Z')`,
    );
    const twoRows = await inventory(process.env, 2);
    await sql(
      'BEGIN; CREATE TEMP TABLE saved AS TABLE "Invoice"; DELETE FROM "Invoice"; INSERT INTO "Invoice" SELECT * FROM saved ORDER BY id DESC; COMMIT;',
    );
    await assertInventory(twoRows);
    console.info(
      "PASS deletion, NULL/empty distinction, large numeric precision and reordered rows",
    );
    const snapshot = await exportSnapshot(2);
    const dump = path.join(directory, "snapshot.dump");
    try {
      await sql('UPDATE "Invoice" SET amount=amount+0.01');
      await run("pg_dump", [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--snapshot=${snapshot.snapshot}`,
        "--file",
        dump,
      ]);
    } finally {
      snapshot.close();
    }
    await verifyDatabase(dump, snapshot.inventory);
    console.info(
      "PASS real pg_dump exported-snapshot consistency and private-socket pg_restore inventory comparison",
    );
    for (const version of [null, 1, 4, "2"])
      await assert.rejects(
        assertInventory({ ...twoRows, version }),
        /Unsupported inventory version/,
      );
    const noVersion = { ...twoRows };
    delete noVersion.version;
    await assert.rejects(
      assertInventory(noVersion),
      /Missing inventory version/,
    );
    console.info("PASS unknown/missing v2 version rejection");
    await migratedCompatibility(directory);
  } finally {
    if (started)
      await pg("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  }
});

async function migratedCompatibility(directory) {
  const migrations = new URL("../prisma/migrations/", import.meta.url);
  const names = (await fs.readdir(migrations))
    .filter((name) => /^\d+_/.test(name))
    .sort();
  assert.equal(
    names.length,
    14,
    "Review migration baseline before updating this harness",
  );
  assert.equal(names.at(-1), "202610230001_phase3d_payments");
  await sql("CREATE DATABASE inventory_migrated");
  process.env.PGDATABASE = "inventory_migrated";
  await sql(
    'CREATE TABLE "_prisma_migrations" (migration_name text, checksum text, finished_at timestamptz)',
  );
  async function migrate(name) {
    const file = new URL(`${name}/migration.sql`, migrations);
    const contents = await fs.readFile(file, "utf8");
    await run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", file.pathname]);
    const checksum = createHash("sha256").update(contents).digest("hex");
    await sql(
      `INSERT INTO "_prisma_migrations" VALUES ('${name}', '${checksum}', now())`,
    );
  }
  for (const name of names.slice(0, -1)) await migrate(name);
  const id = (number) =>
    `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  await sql(`
    INSERT INTO "Property" (id,code,name,"updatedAt") VALUES ('${id(1)}','SYN','Synthetic inventory property',now());
    INSERT INTO "Floor" (id,"propertyId",number,name,"updatedAt") VALUES ('${id(2)}','${id(1)}',1,'Synthetic floor',now());
    INSERT INTO "Room" (id,"floorId",number,rent,"updatedAt") VALUES ('${id(3)}','${id(2)}','S01',999999999999.99,now());
    INSERT INTO "Tenant" (id,name,"updatedAt") VALUES ('${id(4)}','Synthetic inventory tenant',now());
    INSERT INTO "Lease" (id,number,"roomId","tenantId","startDate","endDate",rent,deposit,status,"updatedAt") VALUES ('${id(5)}','SYN-L','${id(3)}','${id(4)}','2026-01-01','2026-12-31',999999999999.99,0,'DRAFT',now());
    INSERT INTO "User" (id,username,email,name,"passwordHash",role,"updatedAt") VALUES ('${id(6)}','synthetic','synthetic@example.invalid','Synthetic inventory admin','unusable synthetic hash','ADMIN',now());
    INSERT INTO "Payment" (id,reference,"leaseId",amount,method,status,"receivedAt","updatedAt") VALUES ('${id(7)}','SYN-OLD','${id(5)}',123.45,'historical-cheque','REVERSED','2026-10-23T00:00:00Z',now());
  `);
  assert.equal(
    await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"),
    "34",
  );
  assert.equal(
    await sql(`SELECT to_regclass('public."Receipt"') IS NULL`),
    "t",
  );
  await roundTrip(2, "historical33", directory);
  const legacy = await inventory(process.env, 1);
  const legacyDump = path.join(directory, "legacy-migrated.dump");
  await run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    legacyDump,
  ]);
  await verifyDatabase(legacyDump, legacy);
  console.info(
    "PASS actual historical33 unversioned legacy pg_dump/pg_restore",
  );
  await migrate(names.at(-1));
  assert.equal(
    await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"),
    "39",
  );
  // Inventory-only fixture: bypass lifecycle triggers in this private transaction.
  // This does not claim a valid managed payment lifecycle; the dedicated payment
  // integration suite proves those rules. Foreign keys remain structurally valid.
  await sql(`BEGIN; SET LOCAL session_replication_role=replica;
    INSERT INTO "PaymentReversal" (id,"paymentId",reason,"actorId") VALUES ('${id(8)}','${id(7)}','Synthetic inventory reversal','${id(6)}');
    INSERT INTO "ReceiptMonthCounter" (month,value) VALUES ('202610',1);
    INSERT INTO "Receipt" (id,number,"paymentId","issuedAt","issuedById","snapshotVersion",snapshot,fingerprint) VALUES ('${id(9)}','REC-202610-0001','${id(7)}','2026-10-23T00:00:00Z','${id(6)}','receipt.v1','{"synthetic":"ใบเสร็จ integrity fixture only","amount":"123.45"}',repeat('a',64));
    INSERT INTO "ReceiptCancellation" (id,"receiptId","reversalId",reason,"actorId") VALUES ('${id(10)}','${id(9)}','${id(8)}','Synthetic inventory cancellation','${id(6)}');
    INSERT INTO "PaymentCommand" (id,"actorId","commandKey",operation,"requestFingerprint",result) VALUES ('${id(11)}','${id(6)}','synthetic-inventory','confirm',repeat('b',64),'{"synthetic":true}');
    COMMIT;`);
  assert.equal(await sql("SHOW session_replication_role"), "origin");
  await assertTriggers();
  await roundTrip(3, "migrated38", directory);
  console.info(
    "PASS all14 actual migrations; synthetic inventory-only payment fixture; trigger state origin/enabled",
  );
}
async function assertTriggers() {
  const disabled = await sql(
    "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgenabled<>'O'",
  );
  assert.equal(
    disabled,
    "0",
    "Every restored trigger must retain origin-enabled state",
  );
  const payment = await sql(
    "SELECT count(*) FROM pg_trigger WHERE tgname IN ('payment_guard','payment_child_guard','payment_final_guard','payment_command_immutable','receipt_counter_monotonic','invoice_payment_guard')",
  );
  assert.equal(
    payment,
    "13",
    "All payment lifecycle triggers remain installed",
  );
}
async function roundTrip(version, label, directory) {
  const originalDatabase = process.env.PGDATABASE;
  const registry = version === 2 ? INVENTORY_TABLES : INVENTORY_TABLES_V3;
  const snapshot = await exportSnapshot(version);
  assert.equal(snapshot.inventory.version, version);
  assert.equal(Object.keys(snapshot.inventory.tables).length, registry.length);
  const dump = path.join(directory, `${label}.dump`);
  try {
    await sql(
      `UPDATE "Room" SET notes=${literal(`independent transaction after ${label} v${version} snapshot`)}`,
    );
    const live = await inventory(process.env, version);
    assert.equal(live.tables.Room.count, snapshot.inventory.tables.Room.count);
    assert.notEqual(
      live.tables.Room.sha256,
      snapshot.inventory.tables.Room.sha256,
      `v${version} must commit a real row change after snapshot acquisition`,
    );
    await assert.rejects(
      assertInventory(snapshot.inventory),
      /inventory differs/,
    );
    console.info(
      `PASS v${version} live row differs from exported snapshot before pg_dump`,
    );
    await run("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--snapshot=${snapshot.snapshot}`,
      "--file",
      dump,
    ]);
  } finally {
    snapshot.close();
  }
  await verifyDatabase(dump, snapshot.inventory);
  const restored = `inventory_${label}_restore`;
  await sql(`CREATE DATABASE ${restored}`);
  process.env.PGDATABASE = restored;
  try {
    await run("pg_restore", [
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      `--dbname=${restored}`,
      dump,
    ]);
    await assertInventory(snapshot.inventory);
    if (version === 3) {
      let expected = snapshot.inventory;
      await assertTriggers();
      for (const [table, column, expression] of [
        ["PaymentReversal", "reason", "reason || ' mutated'"],
        ["Receipt", "snapshot", `snapshot || '{"mutation":true}'::jsonb`],
        ["ReceiptCancellation", "reason", "reason || ' mutated'"],
        ["PaymentCommand", "result", `result || '{"mutation":true}'::jsonb`],
        ["ReceiptMonthCounter", "value", "value+1"],
      ]) {
        assert.equal(expected.tables[table].count, "1");
        // Alter only this disposable restored copy; restore original values in a
        // transaction-local replica session, never disable persistent triggers.
        await sql(
          `BEGIN; SET LOCAL session_replication_role=replica; UPDATE "${table}" SET "${column}"=${expression}; COMMIT;`,
        );
        await assert.rejects(assertInventory(expected), /inventory differs/);
        const after = await inventory(process.env, 3);
        assert.equal(after.tables[table].count, "1");
        assert.notEqual(
          after.tables[table].sha256,
          expected.tables[table].sha256,
        );
        for (const other of registry.filter((name) => name !== table))
          assert.deepEqual(after.tables[other], expected.tables[other]);
        console.info(`PASS v3 restored equal-count mutation ${table}`);
        expected = after;
      }
      await assertTriggers();
    }
    console.info(
      `PASS actual ${label} v${version} ${registry.length}-table exported snapshot pg_dump/pg_restore (database=${restored})`,
    );
  } finally {
    process.env.PGDATABASE = originalDatabase;
  }
}
