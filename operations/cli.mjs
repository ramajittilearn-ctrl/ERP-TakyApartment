import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  root,
  keyFile,
  atomicJson,
  records,
  createBackup,
  retryUploads,
  retain,
  weeklyDue,
  checkSelected,
  selectedFile,
  recoverInterrupted,
} from "./backup.mjs";
import { readKey, sha256 } from "./archive.mjs";
import { restoreIsolated } from "./database.mjs";
import { restoreProduction } from "./production-restore.mjs";

process.umask(0o077);
const [command = "status", ...args] = process.argv.slice(2);
const file = fileURLToPath(import.meta.url);
async function locked(name, values = []) {
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
  const child = spawn(
    "flock",
    [
      "--nonblock",
      "--conflict-exit-code",
      "75",
      path.join(root(), ".job.lock"),
      process.execPath,
      file,
      name,
      ...values,
    ],
    { stdio: "inherit", env: { ...process.env, TAKY_BACKUP_LOCKED: "1" } },
  );
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}
async function main() {
  if (command === "heartbeat") {
    const heartbeat = JSON.parse(
      await fs.readFile(path.join(root(), "heartbeat.json"), "utf8"),
    );
    const at =
      typeof heartbeat?.at === "string" ? Date.parse(heartbeat.at) : NaN;
    if (!Number.isFinite(at))
      throw new Error("Scheduler heartbeat timestamp is invalid");
    const age = Date.now() - at;
    if (age < 0)
      throw new Error("Scheduler heartbeat timestamp is in the future");
    if (age > 20 * 60000) throw new Error("Scheduler heartbeat is stale");
    return;
  }
  if (command === "status") {
    console.info(JSON.stringify(await records(), null, 2));
    return;
  }
  if (command === "schedule") {
    let lastUpload = 0;
    while (true) {
      await atomicJson(path.join(root(), "heartbeat.json"), {
        at: new Date().toISOString(),
        timezone: "Asia/Bangkok",
        schedule: "Sunday 02:00",
      });
      if (weeklyDue(await records())) await locked("weekly");
      if (Date.now() - lastUpload >= 3600000) {
        await locked("retry");
        lastUpload = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  }
  if (!process.env.TAKY_BACKUP_LOCKED) {
    process.exitCode = await locked(command, args);
    return;
  }
  if (["backup", "weekly", "rollback"].includes(command)) {
    await recoverInterrupted();
    const record = await createBackup(
      command === "backup" ? "manual" : command,
    );
    console.info(
      JSON.stringify({
        status: record.status,
        file: record.file,
        bytes: record.bytes,
        checksum: record.checksum,
        verifiedAt: record.verifiedAt,
      }),
    );
    await retryUploads();
    await retain();
    return;
  }
  if (command === "retry") {
    await retryUploads();
    await retain();
    return;
  }
  if (command === "verify") {
    console.info(JSON.stringify(await checkSelected(args[0])));
    return;
  }
  if (command === "restore-production") {
    await restoreProduction(args[0]);
    return;
  }
  if (command === "restore-isolated") {
    const name = args[0],
      file = selectedFile(name);
    const manifest = await restoreIsolated(
      file,
      await readKey(keyFile()),
      "/restore-attachments",
    );
    const receipt = {
      file: name,
      checksum: await sha256(file),
      verifiedAt: new Date().toISOString(),
      target: "isolated Docker volumes",
      inventory: manifest.inventory,
      attachments: manifest.attachments.length,
    };
    await atomicJson(
      path.join(root(), "receipts", `${name}.docker.json`),
      receipt,
    );
    console.info(JSON.stringify(receipt));
    return;
  }
  throw new Error("Unknown operations command");
}
main().catch((error) => {
  console.error(
    JSON.stringify({ event: "operations_failed", message: error.message }),
  );
  process.exitCode = 1;
});
