import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  encrypt,
  filesUnder,
  copyFiles,
  readKey,
  run,
  sha256,
} from "./archive.mjs";
import {
  exportSnapshot,
  recordHistory,
  verifyArchive,
  withTemp,
} from "./database.mjs";

export const FILE_PATTERN = /^taky-\d{8}T\d{6}Z-[a-f0-9-]{36}\.taky\.enc$/;
export const root = () => process.env.BACKUP_DIR || "/backups";
export const keyFile = () =>
  process.env.BACKUP_KEY_FILE || "/run/secrets/backup.key";
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.partial`;
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}
export async function records() {
  await fs.mkdir(path.join(root(), "records"), {
    recursive: true,
    mode: 0o700,
  });
  const result = [];
  for (const file of (await fs.readdir(path.join(root(), "records"))).filter(
    (f) => /^[a-f0-9-]{36}\.json$/.test(f),
  )) {
    const record = JSON.parse(
      await fs.readFile(path.join(root(), "records", file), "utf8"),
    );
    if (`${record.id}.json` !== file || !FILE_PATTERN.test(record.file))
      throw new Error("Invalid backup journal record");
    result.push(record);
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveRecord(record) {
  await atomicJson(path.join(root(), "records", `${record.id}.json`), record);
  try {
    await recordHistory(record);
    record.databaseLogPending = false;
  } catch {
    record.databaseLogPending = true;
  }
  await atomicJson(path.join(root(), "records", `${record.id}.json`), record);
}
export function selectedFile(name) {
  if (!FILE_PATTERN.test(name))
    throw new Error(
      "Select an exact taky-<timestamp>-<uuid>.taky.enc filename",
    );
  return path.join(root(), name);
}
export function retentionCandidates(all, keep = 12) {
  const verified = all
    .filter((r) => r.status === "SUCCEEDED" && r.verifiedAt && !r.prunedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const protectedIds = new Set();
  for (const kind of ["weekly", "manual", "rollback"])
    verified
      .filter((r) => r.kind === kind)
      .slice(0, keep)
      .forEach((r) => protectedIds.add(r.id));
  return verified.filter((r) => !protectedIds.has(r.id) && r.uploadedAt);
}
export function latestWeeklySlot(now = new Date()) {
  const shifted = new Date(now.getTime() + 7 * 3600000);
  shifted.setUTCDate(shifted.getUTCDate() - shifted.getUTCDay());
  shifted.setUTCHours(2, 0, 0, 0);
  let target = shifted.getTime() - 7 * 3600000;
  if (target > now.getTime()) target -= 7 * 86400000;
  return new Date(target).toISOString();
}
export function weeklyDue(all, now = new Date()) {
  const slot = latestWeeklySlot(now);
  if (
    all.some(
      (r) =>
        r.kind === "weekly" &&
        r.status === "SUCCEEDED" &&
        r.verifiedAt &&
        r.scheduledFor >= slot,
    )
  )
    return false;
  return !all.some(
    (r) =>
      r.kind === "weekly" && now.getTime() - Date.parse(r.createdAt) < 3600000,
  );
}
export async function createBackup(kind = "manual") {
  if (!["manual", "weekly", "rollback"].includes(kind))
    throw new Error("Unknown backup kind");
  const id = randomUUID(),
    createdAt = new Date().toISOString();
  const stamp = createdAt.slice(0, 19).replaceAll(/[-:]/g, "") + "Z";
  const record = {
    id,
    kind,
    createdAt,
    status: "RUNNING",
    file: `taky-${stamp}-${id}.taky.enc`,
    ...(kind === "weekly" ? { scheduledFor: latestWeeklySlot() } : {}),
  };
  const output = selectedFile(record.file),
    partial = `${output}.partial`;
  let stage = "key";
  await saveRecord(record);
  try {
    const key = await readKey(keyFile());
    await withTemp("backup", async (directory) => {
      const set = path.join(directory, "set");
      await fs.mkdir(set, { mode: 0o700 });
      const attachmentRoot = process.env.ATTACHMENT_DIR || "/attachments";
      stage = "attachment inventory";
      const before = await filesUnder(attachmentRoot);
      stage = "database snapshot";
      const snapshot = await exportSnapshot();
      try {
        stage = "database dump";
        const dump = path.join(set, "database.dump");
        await run("pg_dump", [
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          `--snapshot=${snapshot.snapshot}`,
          `--file=${dump}`,
        ]);
        stage = "attachment copy";
        await copyFiles(attachmentRoot, path.join(set, "attachments"), before);
        assert.deepEqual(
          await filesUnder(attachmentRoot),
          before,
          "Attachments changed during backup; retry required",
        );
        assert.deepEqual(
          await filesUnder(path.join(set, "attachments")),
          before,
          "Attachment copy differs",
        );
        for (const item of snapshot.inventory.attachments) {
          const actual = before.find((f) => f.path === item.path);
          if (
            !actual ||
            actual.sha256 !== item.sha256 ||
            actual.bytes !== item.bytes
          )
            throw new Error(
              "Database attachment metadata differs from private files",
            );
        }
        const manifest = {
          version: 1,
          id,
          createdAt,
          kind,
          timezone: "Asia/Bangkok",
          postgresMajor: 17,
          keyId: createHash("sha256").update(key).digest("hex").slice(0, 16),
          inventory: snapshot.inventory,
          database: {
            sha256: await sha256(dump),
            bytes: (await fs.stat(dump)).size,
          },
          attachments: before,
        };
        await atomicJson(path.join(set, "manifest.json"), manifest);
      } finally {
        snapshot.close();
      }
      stage = "archive encryption";
      const tar = path.join(directory, "set.tar.gz");
      await run("tar", [
        "-czf",
        tar,
        "-C",
        set,
        "manifest.json",
        "database.dump",
        "attachments",
      ]);
      await encrypt(tar, partial, key);
      stage = "authenticated isolated restore";
      await verifyArchive(partial, key);
      record.checksum = await sha256(partial);
      record.bytes = (await fs.stat(partial)).size;
      const handle = await fs.open(partial, "r");
      await handle.sync();
      await handle.close();
      await fs.rename(partial, output);
      record.status = "SUCCEEDED";
      record.verifiedAt = new Date().toISOString();
    });
  } catch (error) {
    record.status = "FAILED";
    record.error = `${stage}: ${error.message}`.slice(0, 1000);
    await fs.rm(partial, { force: true });
    await saveRecord(record);
    throw new Error(
      `Backup ${id} failed at ${stage}; inspect its private status record`,
      { cause: error },
    );
  }
  await saveRecord(record);
  return record;
}
async function remoteHash(file) {
  const child = spawn(
    "rclone",
    [
      "cat",
      file,
      "--retries=2",
      "--low-level-retries=2",
      "--contimeout=10s",
      "--timeout=60s",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.resume();
  const completion = once(child, "close");
  const timer = setTimeout(() => child.kill("SIGTERM"), 180000);
  const hash = createHash("sha256");
  try {
    for await (const chunk of child.stdout) hash.update(chunk);
    if ((await completion)[0] !== 0)
      throw new Error("rclone remote verification failed");
    return hash.digest("hex");
  } finally {
    clearTimeout(timer);
  }
}
export async function uploadRecord(record, remote = process.env.BACKUP_REMOTE) {
  if (!remote || /[\r\n]/.test(remote) || !remote.includes(":"))
    throw new Error("Google Drive remote is not configured");
  const source = selectedFile(record.file);
  if ((await sha256(source)) !== record.checksum)
    throw new Error("Local encrypted archive checksum mismatch");
  const target = `${remote.replace(/\/$/, "")}/${record.file}`;
  try {
    if ((await remoteHash(target)) === record.checksum) return;
  } catch {}
  const partial = `${target}.partial`;
  const flags = [
    "--retries=2",
    "--low-level-retries=2",
    "--contimeout=10s",
    "--timeout=60s",
  ];
  await run("rclone", ["copyto", source, partial, ...flags], {
    timeout: 240000,
  });
  if ((await remoteHash(partial)) !== record.checksum)
    throw new Error("Uploaded ciphertext checksum mismatch");
  await run("rclone", ["moveto", partial, target, ...flags], {
    timeout: 240000,
  });
  if ((await remoteHash(target)) !== record.checksum)
    throw new Error("Final remote ciphertext checksum mismatch");
}
export async function retryUploads() {
  const all = await records();
  for (const record of all.filter((r) => r.databaseLogPending))
    await saveRecord(record);
  for (const record of all.filter(
    (r) => r.status === "SUCCEEDED" && r.verifiedAt && !r.prunedAt,
  )) {
    if (
      !record.uploadedAt ||
      record.uploadRemote !== process.env.BACKUP_REMOTE
    ) {
      record.uploadAttempts = (record.uploadAttempts || 0) + 1;
      record.lastUploadAttemptAt = new Date().toISOString();
      try {
        await uploadRecord(record);
        record.uploadedAt = new Date().toISOString();
        record.uploadRemote = process.env.BACKUP_REMOTE;
        delete record.uploadError;
      } catch (error) {
        record.uploadError = error.message;
      }
    }
    await saveRecord(record);
  }
  return all;
}
export async function retain() {
  const all = await records();
  for (const record of retentionCandidates(all)) {
    try {
      if (
        !process.env.BACKUP_REMOTE ||
        record.uploadRemote !== process.env.BACKUP_REMOTE
      )
        continue;
      await run("rclone", [
        "deletefile",
        `${process.env.BACKUP_REMOTE.replace(/\/$/, "")}/${record.file}`,
        "--retries=2",
        "--timeout=60s",
      ]);
      await fs.unlink(selectedFile(record.file));
      record.prunedAt = new Date().toISOString();
      await saveRecord(record);
    } catch {
      record.retentionError =
        "Retention deferred; existing local backup preserved";
      await saveRecord(record);
    }
  }
}
export async function checkSelected(name) {
  const file = selectedFile(name),
    checksum = await sha256(file);
  const manifest = await verifyArchive(file, await readKey(keyFile()));
  const receipt = {
    file: name,
    checksum,
    verifiedAt: new Date().toISOString(),
    id: manifest.id,
    rooms: manifest.inventory.rooms.count,
    tenants: manifest.inventory.tenants.count,
    leases: manifest.inventory.leases.count,
    attachments: manifest.attachments.length,
  };
  await atomicJson(path.join(root(), "receipts", `${name}.json`), receipt);
  return receipt;
}
export async function recoverInterrupted() {
  for (const record of await records())
    if (record.status === "RUNNING") {
      record.status = "FAILED";
      record.error =
        "Worker interrupted before isolated verification completed; no success certified";
      await saveRecord(record);
    }
}
