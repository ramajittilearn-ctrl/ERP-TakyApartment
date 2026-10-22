import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execute = promisify(execFile);
const MAGIC = Buffer.from("TAKY-BACKUP-1\n");
export async function run(command, args, options = {}) {
  try {
    return (
      await execute(command, args, {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 300000,
        ...options,
      })
    ).stdout.trim();
  } catch (error) {
    throw new Error(
      `${path.basename(command)} failed (${error.code ?? error.signal ?? "unknown"})`,
      { cause: error },
    );
  }
}
export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function readKey(file) {
  const text = (await fs.readFile(file, "utf8")).trim();
  const key = Buffer.from(text, "base64");
  if (key.length !== 32 || key.toString("base64") !== text)
    throw new Error(
      "Backup key must be exactly 32 random bytes encoded as base64",
    );
  return key;
}
export async function encrypt(source, destination, key) {
  const header = Buffer.concat([MAGIC, randomBytes(12)]);
  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    header.subarray(MAGIC.length),
    { authTagLength: 16 },
  );
  cipher.setAAD(header);
  await fs.writeFile(destination, header, { flag: "wx", mode: 0o600 });
  await pipeline(
    createReadStream(source),
    cipher,
    createWriteStream(destination, { flags: "a", mode: 0o600 }),
  );
  await fs.appendFile(destination, cipher.getAuthTag());
}
export async function decrypt(source, destination, key) {
  const file = await fs.open(source, "r");
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(MAGIC.length + 12),
      tag = Buffer.alloc(16);
    if (size <= header.length + tag.length)
      throw new Error("Invalid encrypted archive length");
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error("Unsupported encrypted archive format");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(MAGIC.length),
      { authTagLength: 16 },
    );
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    try {
      await pipeline(
        createReadStream(source, { start: header.length, end: size - 17 }),
        decipher,
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      );
    } catch {
      await fs.rm(destination, { force: true });
      throw new Error(
        "Archive authentication failed: incorrect key or damaged ciphertext",
      );
    }
  } finally {
    await file.close();
  }
}
export function safeRelative(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    ![...name].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "\\",
    ) &&
    !path.posix.isAbsolute(name) &&
    !name.split("/").some((p) => p === ".." || p === "." || p === "")
  );
}
export async function filesUnder(root, prefix = "") {
  const result = [];
  for (const entry of (
    await fs.readdir(path.join(root, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!safeRelative(relative)) throw new Error("Unsafe attachment filename");
    if (entry.isDirectory()) result.push(...(await filesUnder(root, relative)));
    else if (entry.isFile()) {
      const file = path.join(root, relative);
      result.push({
        path: relative,
        bytes: (await fs.stat(file)).size,
        sha256: await sha256(file),
      });
    } else
      throw new Error(
        "Attachments must be regular files or directories; links are not accepted",
      );
  }
  return result;
}
export async function copyFiles(source, destination, entries) {
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    if (!safeRelative(entry.path)) throw new Error("Unsafe attachment path");
    const target = path.join(destination, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.copyFile(
      path.join(source, entry.path),
      target,
      fs.constants.COPYFILE_EXCL,
    );
    await fs.chmod(target, 0o600);
  }
}
export async function unpack(encrypted, key, directory) {
  const archive = path.join(directory, "archive.tar.gz"),
    target = path.join(directory, "set");
  await decrypt(encrypted, archive, key);
  const names = (await run("tar", ["-tzf", archive])).split("\n");
  const details = (await run("tar", ["-tvzf", archive])).split("\n");
  if (
    names.length !== details.length ||
    details.some((line) => !["-", "d"].includes(line[0]))
  )
    throw new Error("Archive contains a link or unsupported entry");
  for (const name of names) {
    const value = name.replace(/\/$/, "");
    if (
      !safeRelative(value) ||
      !["manifest.json", "database.dump", "attachments"].includes(
        value.split("/")[0],
      )
    )
      throw new Error("Unsafe archive member");
  }
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate archive members");
  await fs.mkdir(target, { mode: 0o700 });
  await run("tar", [
    "-xzf",
    archive,
    "--no-same-owner",
    "--no-same-permissions",
    "-C",
    target,
  ]);
  const manifest = JSON.parse(
    await fs.readFile(path.join(target, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.attachments) ||
    !manifest.inventory
  )
    throw new Error("Unsupported backup manifest");
  const dump = path.join(target, "database.dump");
  if (
    (await sha256(dump)) !== manifest.database.sha256 ||
    (await fs.stat(dump)).size !== manifest.database.bytes
  )
    throw new Error("Database archive checksum mismatch");
  if (
    JSON.stringify(await filesUnder(path.join(target, "attachments"))) !==
    JSON.stringify(manifest.attachments)
  )
    throw new Error("Attachment inventory/checksum mismatch");
  return { manifest, target, dump };
}
