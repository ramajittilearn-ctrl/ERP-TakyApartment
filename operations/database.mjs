import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { run, copyFiles, filesUnder, unpack } from "./archive.mjs";

export const INVENTORY_SQL = `SELECT jsonb_build_object(
 'schema', (SELECT encode(sha256(convert_to(string_agg(table_name||':'||column_name||':'||data_type||':'||is_nullable,',' ORDER BY table_name,ordinal_position),'UTF8')),'hex') FROM information_schema.columns WHERE table_schema='public'),
 'migrations', (SELECT jsonb_agg(jsonb_build_object('name',migration_name,'checksum',checksum) ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL),
 'rooms', (SELECT jsonb_build_object('count',count(*),'numbers',jsonb_agg(number ORDER BY number),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Room" t),
 'tenants', (SELECT jsonb_build_object('count',count(*),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Tenant" t),
 'leases', (SELECT jsonb_build_object('count',count(*),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Lease" t),
 'attachments', (SELECT coalesce(jsonb_agg(jsonb_build_object('path',"storageKey",'sha256',sha256,'bytes',bytes) ORDER BY "storageKey"),'[]') FROM "Attachment"));`;
export const literal = (value) =>
  value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
export function sql(query, env = process.env) {
  return run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-Atc", query], {
    env: { ...env, PGOPTIONS: "-c timezone=UTC" },
  });
}
export async function inventory(env = process.env) {
  return JSON.parse(await sql(INVENTORY_SQL, env));
}
export async function exportSnapshot() {
  const child = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-At"], {
    env: { ...process.env, PGOPTIONS: "-c timezone=UTC" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  child.stdin.write(
    `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n${INVENTORY_SQL}\n`,
  );
  const values = [];
  const timeout = setTimeout(() => child.kill("SIGTERM"), 30000);
  try {
    for await (const line of { [Symbol.asyncIterator]: () => iterator }) {
      if (line !== "BEGIN") values.push(line);
      if (values.length === 2) break;
    }
    if (values.length !== 2 || !/^[0-9A-F-]+$/i.test(values[0]))
      throw new Error("Could not acquire PostgreSQL snapshot");
    clearTimeout(timeout);
    return {
      snapshot: values[0],
      inventory: JSON.parse(values[1]),
      close: () => {
        child.stdin.end("ROLLBACK;\n");
        lines.close();
      },
    };
  } catch (error) {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    throw error;
  }
}
export async function recordHistory(record) {
  const query = `INSERT INTO "BackupHistory" (id,status,"storageKey",checksum,bytes,error,"verifiedAt","uploadedAt",kind,"createdAt","updatedAt","finishedAt") VALUES (${literal(record.id)}::uuid,${literal(record.status)}::"BackupStatus",${literal(record.file)},${literal(record.checksum)},${literal(record.bytes)},${literal(record.error || record.uploadError)},${literal(record.verifiedAt)},${literal(record.uploadedAt)},${literal(record.kind)},${literal(record.createdAt)}::timestamptz,now(),${record.status === "RUNNING" ? "NULL" : "now()"}) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,"storageKey"=EXCLUDED."storageKey",checksum=EXCLUDED.checksum,bytes=EXCLUDED.bytes,error=EXCLUDED.error,"verifiedAt"=EXCLUDED."verifiedAt","uploadedAt"=EXCLUDED."uploadedAt","finishedAt"=EXCLUDED."finishedAt","updatedAt"=now();`;
  await sql(query);
}
export async function withTemp(prefix, work) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `taky-${prefix}-`));
  try {
    return await work(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
export async function verifyDatabase(dump, expected) {
  return withTemp("verify", async (directory) => {
    const data = path.join(directory, "data");
    const root = process.getuid() === 0;
    if (root)
      await fs.chown(
        directory,
        Number(await run("id", ["-u", "postgres"])),
        Number(await run("id", ["-g", "postgres"])),
      );
    const asPostgres = (command, args) =>
      root
        ? run("runuser", ["-u", "postgres", "--", command, ...args])
        : run(command, args);
    await asPostgres("initdb", [
      "-D",
      data,
      "--no-locale",
      "--encoding=UTF8",
      "--auth-local=trust",
      "--auth-host=reject",
    ]);
    let started = false;
    try {
      await asPostgres("pg_ctl", [
        "-D",
        data,
        "-l",
        path.join(directory, "server.log"),
        "-w",
        "-t",
        "30",
        "-o",
        `-F -k ${directory} -c listen_addresses='' -p 5544`,
        "start",
      ]);
      started = true;
      const env = {
        ...process.env,
        PGHOST: directory,
        PGPORT: "5544",
        PGUSER: root ? "postgres" : process.env.USER,
        PGPASSWORD: "",
        PGDATABASE: "postgres",
      };
      await run(
        "createdb",
        ["--template=template0", "--encoding=UTF8", "taky_restore_verify"],
        { env },
      );
      env.PGDATABASE = "taky_restore_verify";
      await run(
        "pg_restore",
        [
          "--exit-on-error",
          "--no-owner",
          "--no-privileges",
          "--dbname=taky_restore_verify",
          dump,
        ],
        { env },
      );
      assert.deepEqual(
        await inventory(env),
        expected,
        "Restored database inventory differs from snapshot",
      );
    } finally {
      if (started)
        await asPostgres("pg_ctl", [
          "-D",
          data,
          "-m",
          "immediate",
          "-w",
          "stop",
        ]);
    }
  });
}
export async function verifyArchive(file, key) {
  return withTemp("unpack", async (directory) => {
    const set = await unpack(file, key, directory);
    await verifyDatabase(set.dump, set.manifest.inventory);
    return set.manifest;
  });
}
export async function restoreIsolated(file, key, attachmentTarget) {
  if (
    process.env.RESTORE_MODE !== "isolated" ||
    process.env.PGHOST !== "restore-db" ||
    process.env.PGDATABASE !== "taky_restore_test"
  )
    throw new Error("Restore requires the isolated Compose database");
  if (
    (await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'")) !==
    "0"
  )
    throw new Error(
      "Restore database must be empty; existing data will not be overwritten",
    );
  if ((await fs.readdir(attachmentTarget)).length)
    throw new Error("Restore attachment volume must be empty");
  return withTemp("restore", async (directory) => {
    const set = await unpack(file, key, directory);
    await run("pg_restore", [
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--dbname=taky_restore_test",
      set.dump,
    ]);
    await copyFiles(
      path.join(set.target, "attachments"),
      attachmentTarget,
      set.manifest.attachments,
    );
    assert.deepEqual(await inventory(), set.manifest.inventory);
    assert.deepEqual(
      await filesUnder(attachmentTarget),
      set.manifest.attachments,
    );
    return set.manifest;
  });
}
