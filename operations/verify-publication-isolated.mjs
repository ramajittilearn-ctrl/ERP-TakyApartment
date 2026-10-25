import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { withAttachmentPublicationSession } from "./publication.mjs";
import { sql, verifyArchive } from "./database.mjs";
import { createBackup, selectedFile } from "./backup.mjs";
import { filesUnder, run } from "./archive.mjs";

export async function verifyPublicationProtocol({ database, directory }) {
  assert.equal(database, "inventory_migrated");
  assert.equal(process.env.PGDATABASE, database);
  assert.equal(process.env.PGPORT, "5545");
  assert.equal(await fs.realpath(process.env.PGHOST), directory);
  assert(path.basename(directory).startsWith("taky-inventory-acceptance-"));
  assert(
    !process.env.PGHOSTADDR &&
      !process.env.PGSERVICE &&
      !process.env.PGSERVICEFILE,
    "No ambient libpq service/host override is allowed",
  );
  assert.deepEqual(
    JSON.parse(
      await sql(
        "SELECT jsonb_build_object('database',current_database(),'role',current_user,'data',current_setting('data_directory'),'port',current_setting('port'),'socket',inet_server_addr() IS NULL)",
      ),
    ),
    {
      database,
      role: process.env.PGUSER,
      data: path.join(directory, "data"),
      port: "5545",
      socket: true,
    },
  );
  const original = { ...process.env };
  const adminEnv = { ...process.env };
  const role = "inventory_publication_role";
  assert.equal(
    await sql(`SELECT count(*) FROM pg_roles WHERE rolname='${role}'`),
    "0",
  );
  await sql(
    `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}; GRANT INSERT,UPDATE ON "BackupHistory" TO ${role};`,
  );
  const env = { ...adminEnv, PGUSER: role };
  assert.equal(await sql("SELECT current_user", env), role);
  assert.equal(
    await sql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user", env),
    "f",
  );
  async function transactionCanPublish() {
    const output = await sql(
      "BEGIN; SELECT pg_advisory_xact_lock_shared(73422193); SELECT pg_try_advisory_xact_lock(73422195); ROLLBACK;",
      env,
    );
    return output.split("\n").find((line) => line === "t" || line === "f");
  }
  await withAttachmentPublicationSession(
    async (session) => {
      assert.equal(session.role, role);
      await session.assertAlive();
      assert.equal(await transactionCanPublish(), "f");
    },
    { env },
  );
  assert.equal(await transactionCanPublish(), "t");
  console.info(
    "PASS real nonsuperuser session publication lock excludes upload transaction lock and releases afterward",
  );
  await assert.rejects(
    withAttachmentPublicationSession(
      async () => {
        throw new Error("Synthetic protected-work failure");
      },
      { env },
    ),
    /Synthetic protected-work failure/,
  );
  assert.equal(await transactionCanPublish(), "t");
  console.info("PASS real protected-work failure releases publication session");
  await assert.rejects(
    withAttachmentPublicationSession(
      async (session) => {
        const interrupted = run(
          process.execPath,
          ["-e", "setInterval(()=>{},1000)"],
          { signal: session.signal },
        );
        assert.equal(
          await sql(
            `SELECT pg_terminate_backend(${session.backendPid})`,
            adminEnv,
          ),
          "t",
        );
        await interrupted;
        throw new Error("Lost owner must not return a verified set");
      },
      { env },
    ),
    /failed|session lost/,
  );
  assert.equal(await transactionCanPublish(), "t");
  console.info(
    "PASS real lock-owner termination aborts protected child work; no verified result returned",
  );
  try {
    const attachments = path.join(directory, "retained-attachments");
    const backups = path.join(directory, "backup-acceptance");
    await fs.mkdir(path.join(attachments, "synthetic"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.mkdir(backups, { mode: 0o700 });
    await fs.writeFile(
      path.join(attachments, "synthetic/retained-proof"),
      "inventory-proof\n",
      { mode: 0o600 },
    );
    await fs.writeFile(
      path.join(attachments, "synthetic/orphan"),
      "Synthetic orphan bytes",
      { mode: 0o600 },
    );
    await fs.writeFile(
      path.join(attachments, "synthetic/destination.partial"),
      "Synthetic interrupted publication",
      { mode: 0o600 },
    );
    const before = await filesUnder(attachments);
    const key = randomBytes(32);
    const keyFile = path.join(directory, "synthetic-backup.key");
    await fs.writeFile(keyFile, key.toString("base64"), { mode: 0o600 });
    Object.assign(process.env, env, {
      ATTACHMENT_DIR: attachments,
      BACKUP_DIR: backups,
      BACKUP_KEY_FILE: keyFile,
    });
    const backup = await createBackup();
    assert.equal(backup.status, "SUCCEEDED");
    assert(backup.verifiedAt);
    const manifest = await verifyArchive(selectedFile(backup.file), key);
    assert.equal(manifest.inventory.version, 5);
    assert.equal(Object.keys(manifest.inventory.tables).length, 44);
    assert.deepEqual(manifest.attachments, before);
    assert.deepEqual(
      manifest.retainedFilesWithoutMetadata.map((entry) => entry.path),
      ["synthetic/destination.partial", "synthetic/orphan"],
    );
    assert.deepEqual(await filesUnder(attachments), before);
    console.info(
      "PASS actual encrypted backup and isolated restore retain44-model snapshot, metadata-referenced file, orphan and destination partial without source deletion",
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
}
