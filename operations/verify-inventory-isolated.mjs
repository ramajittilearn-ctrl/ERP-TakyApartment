// Run inside a disposable operations image with no network, published ports or volumes.
// Creates only synthetic data in private Unix-socket PostgreSQL clusters.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { run } from "./archive.mjs";
import { INVENTORY_TABLES } from "./inventory.mjs";
import {
  inventory,
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
    const baseline = await inventory();
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
    const twoRows = await inventory();
    await sql(
      'BEGIN; CREATE TEMP TABLE saved AS TABLE "Invoice"; DELETE FROM "Invoice"; INSERT INTO "Invoice" SELECT * FROM saved ORDER BY id DESC; COMMIT;',
    );
    await assertInventory(twoRows);
    console.info(
      "PASS deletion, NULL/empty distinction, large numeric precision and reordered rows",
    );
    const snapshot = await exportSnapshot();
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
    for (const version of [null, 1, 3, "2"])
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
  } finally {
    if (started)
      await pg("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  }
});
