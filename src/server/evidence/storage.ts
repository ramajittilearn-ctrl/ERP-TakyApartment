import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { AppError } from "../errors";
export type StagedEvidence = { directory: string; file: string; bytes: number; sha256: string };
function fail(code: string, message: string, status = 422): never { throw new AppError(status, code, message); }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) fail("EVIDENCE_ABORTED", "ยกเลิกการรับไฟล์หลักฐาน", 408); }
async function writeAll(file: FileHandle, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await file.write(bytes, offset, bytes.byteLength - offset);
    if (!result.bytesWritten) throw new Error("Evidence file write made no progress");
    offset += result.bytesWritten;
  }
}
export async function stageEvidence(body: ReadableStream<Uint8Array>, maxBytes: number, signal?: AbortSignal): Promise<StagedEvidence> {
  checkAbort(signal);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "taky-evidence-"));
  await fs.chmod(directory, 0o700);
  const file = path.join(directory, "input");
  let handle: FileHandle | undefined;
  const reader = body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const hash = createHash("sha256"); let bytes = 0;
    for (;;) {
      checkAbort(signal); const item = await reader.read(); checkAbort(signal);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) fail("EVIDENCE_TOO_LARGE", "ไฟล์หลักฐานมีขนาดเกินกำหนด", 413);
      await writeAll(handle, item.value); hash.update(item.value);
    }
    if (!bytes) fail("EVIDENCE_EMPTY", "ไฟล์หลักฐานว่างเปล่า");
    await handle.sync();
    return { directory, file, bytes, sha256: hash.digest("hex") };
  } catch (error) {
    await reader.cancel().catch(() => {});
    await handle?.close(); handle = undefined;
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort); reader.releaseLock(); await handle?.close();
  }
}
export async function discardStagedEvidence(staged: StagedEvidence) { await fs.rm(staged.directory, { recursive: true, force: true }); }
export async function privateAttachmentRoot(root: string) {
  const absolute = path.resolve(root), stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) fail("EVIDENCE_STORAGE_CONFIGURATION", "พื้นที่เก็บหลักฐานส่วนตัวยังไม่พร้อม", 503);
  if (await fs.realpath(absolute) !== absolute) fail("EVIDENCE_STORAGE_CONFIGURATION", "เส้นทางพื้นที่เก็บหลักฐานไม่ถูกต้อง", 503);
  return absolute;
}
export async function retainedEvidenceBytes(root: string): Promise<bigint> {
  let bytes = 0n;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name), stat = await fs.lstat(file, { bigint: true });
    if (stat.isSymbolicLink()) fail("EVIDENCE_UNSAFE_STORAGE", "พบไฟล์หลักฐานที่ไม่ปลอดภัย", 503);
    if (stat.isDirectory()) bytes += await retainedEvidenceBytes(file);
    else if (stat.isFile()) bytes += stat.size;
    else fail("EVIDENCE_UNSAFE_STORAGE", "พบชนิดไฟล์ที่ไม่รองรับในพื้นที่หลักฐาน", 503);
  }
  return bytes;
}
export async function readVerifiedFile(root: string, storageKey: string, expected: { bytes: number; sha256: string }): Promise<Buffer> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/evidence$/.test(storageKey)) fail("EVIDENCE_FILE_INVALID", "เส้นทางหลักฐานไม่ถูกต้อง", 409);
  const file = path.join(root, storageKey), directory = path.dirname(file), stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) fail("EVIDENCE_FILE_INVALID", "พื้นที่หลักฐานไม่ถูกต้อง", 409);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.size !== expected.bytes) fail("EVIDENCE_FILE_INVALID", "ขนาดไฟล์หลักฐานไม่ตรงกับที่บันทึก", 409);
    const data = await handle.readFile();
    if (createHash("sha256").update(data).digest("hex") !== expected.sha256) fail("EVIDENCE_FILE_INVALID", "ไฟล์หลักฐานไม่ตรงกับที่บันทึก", 409);
    return data;
  } finally { await handle.close(); }
}
export async function readStagedEvidence(staged: StagedEvidence): Promise<Buffer> {
  const handle = await fs.open(staged.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== staged.bytes) fail("EVIDENCE_FILE_INVALID", "ไฟล์รับเข้ามีการเปลี่ยนแปลง", 409);
    const data = await handle.readFile();
    if (createHash("sha256").update(data).digest("hex") !== staged.sha256) fail("EVIDENCE_FILE_INVALID", "ไฟล์รับเข้ามีการเปลี่ยนแปลง", 409);
    return data;
  } finally { await handle.close(); }
}
// The acceptance service calls this only after real format validation and while holding publication admission.
export async function retainEvidenceUnderGate(root: string, staged: StagedEvidence, maxRetainedBytes: bigint, signal?: AbortSignal) {
  checkAbort(signal); const current = await retainedEvidenceBytes(root);
  if (current + BigInt(staged.bytes) > maxRetainedBytes) fail("EVIDENCE_STORAGE_FULL", "พื้นที่เก็บหลักฐานถึงขีดจำกัด", 507);
  const namespace = randomUUID(), directory = path.join(root, namespace);
  await fs.mkdir(directory, { mode: 0o700 });
  const partial = path.join(directory, "partial"), final = path.join(directory, "evidence");
  const data = await readStagedEvidence(staged); checkAbort(signal);
  const file = await fs.open(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await writeAll(file, data); await file.chmod(0o400); await file.sync(); } finally { await file.close(); }
  checkAbort(signal); await fs.rename(partial, final); await fs.chmod(directory, 0o500);
  const parent = await fs.open(directory, constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
  const rootHandle = await fs.open(root, constants.O_RDONLY); try { await rootHandle.sync(); } finally { await rootHandle.close(); }
  return { storageKey: `${namespace}/evidence`, bytes: staged.bytes, sha256: staged.sha256 };
}
