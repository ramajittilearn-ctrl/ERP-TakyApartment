import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {
  unpack,
  readKey,
  copyFiles,
  chownTree,
  filesUnder,
  run,
  sha256,
} from "./archive.mjs";
import { assertInventory, verifyArchive, withTemp } from "./database.mjs";
import { inventoryVersion } from "./inventory.mjs";
import { root, keyFile, selectedFile, records } from "./backup.mjs";

export async function restoreProduction(name) {
  if (
    process.env.RESTORE_MODE !== "production" ||
    process.env.PGHOST !== "db" ||
    process.env.OWNER_RESTORE_CONFIRMATION !== name ||
    !process.env.ROLLBACK_BACKUP
  )
    throw new Error(
      "Production recovery requires explicit owner confirmation and a verified rollback backup",
    );
  const key = await readKey(keyFile());
  const rollback = (await records()).find(
    (r) =>
      r.file === process.env.ROLLBACK_BACKUP &&
      r.kind === "rollback" &&
      r.status === "SUCCEEDED" &&
      r.verifiedAt &&
      !r.prunedAt,
  );
  if (
    !rollback ||
    (await sha256(selectedFile(rollback.file))) !== rollback.checksum
  )
    throw new Error("Verified rollback archive is unavailable");
  await verifyArchive(selectedFile(rollback.file), key);
  const target = "/restore-attachments";
  if ((await fs.realpath(target)) !== target || root() === target)
    throw new Error("Unexpected recovery attachment mount");
  await filesUnder(target);
  await withTemp("production-restore", async (directory) => {
    const set = await unpack(selectedFile(name), key, directory);
    inventoryVersion(set.manifest.inventory);
    await verifyArchive(selectedFile(name), key);
    await run("pg_restore", [
      "--clean",
      "--if-exists",
      "--single-transaction",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      `--dbname=${process.env.PGDATABASE}`,
      set.dump,
    ]);
    for (const entry of await fs.readdir(target))
      await fs.rm(path.join(target, entry), { recursive: true, force: false });
    await copyFiles(
      path.join(set.target, "attachments"),
      target,
      set.manifest.attachments,
    );
    await chownTree(target);
    assert.deepEqual(await filesUnder(target), set.manifest.attachments);
    await assertInventory(set.manifest.inventory);
    console.info(
      JSON.stringify({
        status: "RESTORED",
        file: name,
        rollback: rollback.file,
      }),
    );
  });
}
