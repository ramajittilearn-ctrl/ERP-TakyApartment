// Run inside a disposable operations image with no network, published ports or volumes.
// Creates only synthetic data in private Unix-socket PostgreSQL clusters.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { run } from "./archive.mjs";
import { createHash } from "node:crypto";
import { verifyPublicationProtocol } from "./verify-publication-isolated.mjs";
import {
  INVENTORY_TABLES_V2 as INVENTORY_TABLES,
  INVENTORY_TABLES_V3,
  INVENTORY_TABLES_V4,
  INVENTORY_TABLES_V5,
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
      await snapshot.close();
    }
    await verifyDatabase(dump, snapshot.inventory);
    console.info(
      "PASS real pg_dump exported-snapshot consistency and private-socket pg_restore inventory comparison",
    );
    for (const version of [null, 1, 6, "2"])
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
    17,
    "Review migration baseline before updating this harness",
  );
  assert.equal(names[13], "202610230001_phase3d_payments");
  assert.equal(names[14], "202610240001_phase4_expenses");
  assert.equal(names[15], "202610240002_payment_finite_amounts");
  assert.equal(names[16], "202610240003_phase3e_deposits");
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
  for (const name of names.slice(0, 13)) await migrate(name);
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
  await migrate(names[13]);
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
  await sql(`
    INSERT INTO "ExpenseCategory" (id,name,kind,"updatedAt") VALUES ('${id(12)}','Synthetic inventory category','OPEX',now());
    INSERT INTO "Expense" (id,"propertyId","categoryId",description,amount,"occurredAt","updatedAt") VALUES ('${id(13)}','${id(1)}','${id(12)}','Synthetic legacy inventory expense',123.45,'2026-10-23',now());
  `);
  await roundTrip(3, "migrated38", directory);
  console.info(
    "PASS all14 actual migrations; synthetic inventory-only payment fixture; trigger state origin/enabled",
  );
  const historicalExpenses = JSON.parse(
    await sql(
      `SELECT jsonb_build_object('expense',(SELECT to_jsonb(t) FROM "Expense" t),'category',(SELECT to_jsonb(t) FROM "ExpenseCategory" t))`,
    ),
  );
  await migrate(names[14]);
  assert.equal(
    await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"),
    "40",
  );
  const upgradedExpenses = JSON.parse(
    await sql(
      `SELECT jsonb_build_object('expense',(SELECT to_jsonb(t) FROM "Expense" t),'category',(SELECT to_jsonb(t) FROM "ExpenseCategory" t))`,
    ),
  );
  for (const table of ["expense", "category"])
    for (const [column, value] of Object.entries(historicalExpenses[table]))
      assert.deepEqual(upgradedExpenses[table][column], value);
  assert.equal(upgradedExpenses.expense.legacyUnmapped, true);
  assert.equal(upgradedExpenses.expense.status, null);
  assert.equal(upgradedExpenses.category.active, true);
  console.info(
    "PASS v4 migration preserves every historical expense/category column",
  );
  await sql(`
    INSERT INTO "Expense" (id,"propertyId","categoryId",description,amount,"occurredAt","updatedAt","legacyUnmapped",status,version,vendor,method,note,"categoryNameSnapshot","categoryKindSnapshot","recordedById") VALUES ('${id(14)}','${id(1)}','${id(12)}','Synthetic managed inventory expense',999999999999.99,'2026-10-24',now(),false,'PENDING',1,'Synthetic vendor','CASH','Synthetic inventory note','Synthetic inventory category','OPEX','${id(6)}');
    INSERT INTO "ExpenseCommand" (id,"actorId","commandKey",operation,"requestFingerprint",result) VALUES ('${id(15)}','${id(6)}','synthetic-expense-inventory','expense.create',repeat('c',64),'{"synthetic":true}');
  `);
  await assertTriggers(true);
  const newest = await inventory(process.env, 4);
  assert.equal(newest.version, 4);
  assert.equal(Object.keys(newest.tables).length, 39);
  await assertInventory(newest);
  await roundTrip(4, "migrated39", directory);
  console.info(
    "PASS all15 actual migrations; frozen v4 captures all39 tables and added expense columns",
  );
  await migrate(names[15]);
  assert.equal(
    await sql(
      `SELECT count(*) FROM pg_constraint WHERE conname IN ('Payment_managed_amount_finite','Allocation_amount_finite') AND convalidated`,
    ),
    "2",
  );
  await roundTrip(4, "finite39", directory);
  console.info(
    "PASS all16 actual migrations; finite payment checks preserve v4 compatibility",
  );
  await assertLateDepositRollback(names[16], directory);
  await migrate(names[16]);
  assert.equal(
    await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"),
    "45",
  );
  // These private inventory-only rows exercise full-row restore fingerprints.
  // They bypass lifecycle triggers only in this disposable transaction and do
  // not establish real evidence acceptance or deposit financial correctness.
  const retainedBytes = Buffer.from("inventory-proof\n");
  const retainedSha256 = createHash("sha256")
    .update(retainedBytes)
    .digest("hex");
  await sql(`BEGIN; SET LOCAL session_replication_role=replica;
    INSERT INTO "Attachment" (id,"leaseId","uploadedById","storageKey","originalName","mimeType",bytes,sha256,"updatedAt") VALUES ('${id(16)}','${id(5)}','${id(6)}','synthetic/retained-proof','Synthetic retained proof','application/pdf',${retainedBytes.length},'${retainedSha256}',now());
    INSERT INTO "DepositEvidence" (id,"leaseId","attachmentId","uploadedById") VALUES ('${id(17)}','${id(5)}','${id(16)}','${id(6)}');
    INSERT INTO "DepositAccount" ("leaseId",version,"reviewState","reviewedById","reviewedAt","legacyDigest","reviewReason","evidenceId","openingAmount") VALUES ('${id(5)}',2,'REVIEWED','${id(6)}',now(),repeat('e',64),'Synthetic inventory-only review','${id(17)}',0);
    INSERT INTO "DepositEntry" (id,"leaseId",sequence,kind,amount,"occurredAt","postedById",reason,"evidenceId",method,"documentNumber","documentSnapshot","snapshotSha256") VALUES ('${id(18)}','${id(5)}',1,'RECEIPT',0.01,now(),'${id(6)}','Synthetic inventory-only deposit','${id(17)}','CASH','DEP-202610-000001','{"synthetic":true}',repeat('f',64));
    INSERT INTO "DepositCommand" (id,"actorId","commandKey",operation,"requestFingerprint",result) VALUES ('${id(19)}','${id(6)}','synthetic-deposit-inventory','deposit.receipt',repeat('a',64),'{"synthetic":true}');
    INSERT INTO "DepositDocumentCounter" (month,"nextValue") VALUES ('202610',2);
    COMMIT;`);
  await assertTriggers(true);
  const latest = await inventory();
  assert.equal(latest.version, 5);
  assert.equal(Object.keys(latest.tables).length, 44);
  await assertInventory(latest);
  await roundTrip(5, "deposit44", directory);
  console.info(
    "PASS all17 actual migrations; default v5 captures44 tables including inventory-only deposit representation",
  );
  await verifyPublicationProtocol({
    database: "inventory_migrated",
    directory,
  });
}
async function assertTriggers(expenses = false) {
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
  if (expenses)
    assert.equal(
      await sql(
        "SELECT count(*) FROM pg_trigger WHERE tgname IN ('expense_category_integrity','expense_integrity','expense_command_integrity')",
      ),
      "3",
      "All expense integrity triggers remain installed",
    );
}
async function assertLateDepositRollback(name, directory) {
  assert.equal(name, "202610240003_phase3e_deposits");
  const before = await inventory(process.env, 4);
  const guardsBefore = await guardDocument();
  const source = await fs.readFile(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/\$deposit_migration\$/g) ?? []).length, 2);
  const closing = /END\s+\$deposit_migration\$;\s*$/;
  assert(closing.test(source));
  const injected = source.replace(
    closing,
    "RAISE EXCEPTION 'TAKY_SYNTHETIC_DEPOSIT_LATE_FAILURE' USING ERRCODE='P0001';\nEND\n$deposit_migration$;\n",
  );
  const file = path.join(directory, "deposit-late-failure.sql");
  await fs.writeFile(file, injected, { flag: "wx", mode: 0o600 });
  await assert.rejects(
    run("psql", [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "--set=VERBOSITY=verbose",
      "-f",
      file,
    ]),
    (error) => {
      const output = String(error.cause?.stderr ?? "");
      return (
        output.includes("P0001") &&
        output.includes("TAKY_SYNTHETIC_DEPOSIT_LATE_FAILURE")
      );
    },
  );
  await assertInventory(before);
  assert.deepEqual(await guardDocument(), guardsBefore);
  assert.equal(
    await sql(
      `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('DepositAccount','DepositEntry','DepositCommand','DepositEvidence','DepositDocumentCounter')`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'deposit_%'",
    ),
    "0",
  );
  console.info(
    "PASS forced P0001 at final deposit003 DDL rolls back all new tables, functions, guards and old-data changes before unchanged migration is applied",
  );
}
async function roundTrip(version, label, directory) {
  const originalDatabase = process.env.PGDATABASE;
  const originalGuards = version === 5 ? await guardFingerprint() : undefined;
  const originalGuardDocument =
    version === 5 ? await guardDocument() : undefined;
  const registry =
    version === 2
      ? INVENTORY_TABLES
      : version === 3
        ? INVENTORY_TABLES_V3
        : version === 4
          ? INVENTORY_TABLES_V4
          : INVENTORY_TABLES_V5;
  const snapshot = await (version === 5
    ? exportSnapshot()
    : exportSnapshot(version));
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
    await snapshot.close();
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
    if (version === 5) {
      const restoredGuards = await guardFingerprint();
      if (restoredGuards !== originalGuards) {
        console.info(
          "TAKY_GUARD_DIFF " +
            JSON.stringify(
              guardDifference(originalGuardDocument, await guardDocument()),
            ),
        );
      }
      assert.equal(
        restoredGuards,
        originalGuards,
        "Restored constraints, indexes, trigger states and functions must match",
      );
      console.info(
        "PASS v5 restore preserves normalized public constraints, indexes, trigger definitions/states and function definitions",
      );
    }
    if (version >= 3) {
      let expected = snapshot.inventory;
      await assertTriggers(version >= 4);
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
        const after = await inventory(process.env, version);
        assert.equal(after.tables[table].count, "1");
        assert.notEqual(
          after.tables[table].sha256,
          expected.tables[table].sha256,
        );
        for (const other of registry.filter((name) => name !== table))
          assert.deepEqual(after.tables[other], expected.tables[other]);
        console.info(`PASS v${version} restored equal-count mutation ${table}`);
        expected = after;
      }
      if (version >= 4) {
        for (const [table, column, expression, predicate] of [
          [
            "ExpenseCommand",
            "result",
            `result || '{"mutation":true}'::jsonb`,
            "true",
          ],
          ["Expense", "note", "note || ' mutated'", 'NOT "legacyUnmapped"'],
          ["ExpenseCategory", "active", "NOT active", "true"],
        ]) {
          const count = expected.tables[table].count;
          assert.notEqual(count, "0");
          await sql(
            `BEGIN; SET LOCAL session_replication_role=replica; UPDATE "${table}" SET "${column}"=${expression} WHERE ${predicate}; COMMIT;`,
          );
          await assert.rejects(assertInventory(expected), /inventory differs/);
          const after = await inventory(process.env, version);
          assert.equal(after.tables[table].count, count);
          assert.notEqual(
            after.tables[table].sha256,
            expected.tables[table].sha256,
          );
          for (const other of registry.filter((name) => name !== table))
            assert.deepEqual(after.tables[other], expected.tables[other]);
          expected = after;
          console.info(
            `PASS v4 restored equal-count mutation ${table}.${column}`,
          );
        }
      }
      if (version === 5) {
        let expected = await inventory(process.env, 5);
        for (const [table, column, expression] of [
          ["DepositAccount", "reviewReason", `"reviewReason" || ' mutated'`],
          ["DepositEntry", "reason", "reason || ' mutated'"],
          ["DepositCommand", "result", `result || '{"mutation":true}'::jsonb`],
          [
            "DepositEvidence",
            "acceptedAt",
            `"acceptedAt" + interval '1 millisecond'`,
          ],
          ["DepositDocumentCounter", "nextValue", '"nextValue"+1'],
        ]) {
          assert.equal(expected.tables[table].count, "1");
          await sql(
            `BEGIN; SET LOCAL session_replication_role=replica; UPDATE "${table}" SET "${column}"=${expression}; COMMIT;`,
          );
          await assert.rejects(assertInventory(expected), /inventory differs/);
          const after = await inventory(process.env, 5);
          assert.equal(after.tables[table].count, "1");
          assert.notEqual(
            after.tables[table].sha256,
            expected.tables[table].sha256,
          );
          for (const other of registry.filter((name) => name !== table))
            assert.deepEqual(after.tables[other], expected.tables[other]);
          expected = after;
          console.info(
            `PASS v5 restored equal-count mutation ${table}.${column}`,
          );
        }
      }
      assert.equal(await sql("SHOW session_replication_role"), "origin");
      await assertTriggers(version >= 4);
    }
    console.info(
      `PASS actual ${label} v${version} ${registry.length}-table exported snapshot pg_dump/pg_restore (database=${restored})`,
    );
  } finally {
    process.env.PGDATABASE = originalDatabase;
  }
}

function guardDocumentExpression() {
  return `jsonb_build_object(
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid),'validated',x.convalidated) ORDER BY c.relname,x.conname),'[]') FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',i.relname,'definition',pg_get_indexdef(x.indexrelid)) ORDER BY c.relname,i.relname),'[]') FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY c.relname,t.tgname),'[]') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f')
  )`;
}
async function guardFingerprint() {
  return sql(
    `SELECT encode(sha256(convert_to(${guardDocumentExpression()}::text,'UTF8')),'hex')`,
  );
}
async function guardDocument() {
  return JSON.parse(await sql(`SELECT ${guardDocumentExpression()}`));
}
function guardDifference(before, after) {
  const result = {};
  for (const category of ["constraints", "indexes", "triggers", "functions"]) {
    const key = (entry) =>
      `${entry.table ?? ""}:${entry.name ?? entry.identity}`;
    const old = new Map(before[category].map((entry) => [key(entry), entry]));
    const latest = new Map(after[category].map((entry) => [key(entry), entry]));
    assert.equal(old.size, before[category].length);
    assert.equal(latest.size, after[category].length);
    result[category] = {
      missing: [...old]
        .filter(([id]) => !latest.has(id))
        .map(([, entry]) => entry),
      added: [...latest]
        .filter(([id]) => !old.has(id))
        .map(([, entry]) => entry),
      changed: [...old]
        .filter(
          ([id, entry]) =>
            latest.has(id) &&
            JSON.stringify(entry) !== JSON.stringify(latest.get(id)),
        )
        .map(([id, entry]) => ({
          identity: id,
          before: entry,
          after: latest.get(id),
        })),
    };
  }
  return result;
}
