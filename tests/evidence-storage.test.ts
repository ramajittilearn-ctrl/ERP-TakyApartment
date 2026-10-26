import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  MAX_EVIDENCE_BYTES,
  readEvidenceLimits,
} from "../src/server/evidence/contracts";
import {
  parseEvidenceListQuery,
  parseEvidenceUploadQuery,
} from "../src/server/evidence/query";
import {
  discardStagedEvidence,
  privateAttachmentRoot,
  readStagedEvidence,
  readVerifiedFile,
  retainedEvidenceBytes,
  retainEvidenceUnderGate,
  stageEvidence,
} from "../src/server/evidence/storage";
const roots: string[] = [];
async function temporary() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "taky-evidence-unit-")),
  );
  roots.push(root);
  return root;
}
async function writableTree(root: string) {
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink()) return;
  await fs.chmod(root, stat.isDirectory() ? 0o700 : 0o600);
  if (stat.isDirectory())
    for (const entry of await fs.readdir(root))
      await writableTree(path.join(root, entry));
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    await writableTree(root);
    await fs.rm(root, { recursive: true });
  }
});
function stream(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(Buffer.from(chunk));
      c.close();
    },
  });
}
it("stages exact bytes and hash into private files, then retains distinct immutable namespaces", async () => {
  const root = await temporary(),
    staged = await stageEvidence(stream("one", "two"), 10);
  roots.push(staged.directory);
  expect(staged.bytes).toBe(6);
  expect(staged.sha256).toBe(
    createHash("sha256").update("onetwo").digest("hex"),
  );
  expect((await fs.stat(staged.file)).mode & 0o777).toBe(0o600);
  expect(await privateAttachmentRoot(root)).toBe(root);
  const first = await retainEvidenceUnderGate(root, staged, 20n),
    second = await retainEvidenceUnderGate(root, staged, 20n);
  expect(first.storageKey).not.toBe(second.storageKey);
  expect(await retainedEvidenceBytes(root)).toBe(12n);
  expect((await fs.stat(path.join(root, first.storageKey))).mode & 0o777).toBe(
    0o400,
  );
  expect(await readVerifiedFile(root, first.storageKey, first)).toEqual(
    Buffer.from("onetwo"),
  );
  expect(await readStagedEvidence(staged)).toEqual(Buffer.from("onetwo"));
});
it("counts retained orphans and partials against quota before copying", async () => {
  const root = await temporary();
  await fs.mkdir(path.join(root, "orphan"));
  await fs.writeFile(path.join(root, "orphan", "partial"), "123");
  const staged = await stageEvidence(stream("ab"), 10);
  roots.push(staged.directory);
  await expect(retainEvidenceUnderGate(root, staged, 4n)).rejects.toMatchObject(
    { code: "EVIDENCE_STORAGE_FULL", status: 507 },
  );
  expect(await retainedEvidenceBytes(root)).toBe(3n);
  expect(await fs.readdir(root)).toEqual(["orphan"]);
});
it("rejects paths, symlinks, same-length tampering and oversized metadata", async () => {
  const root = await temporary(),
    staged = await stageEvidence(stream("abc"), 10);
  roots.push(staged.directory);
  const saved = await retainEvidenceUnderGate(root, staged, 100n);
  await expect(
    readVerifiedFile(root, "../outside", saved),
  ).rejects.toMatchObject({ code: "EVIDENCE_FILE_INVALID" });
  await expect(
    readVerifiedFile(root, saved.storageKey, {
      ...saved,
      bytes: MAX_EVIDENCE_BYTES + 1,
    }),
  ).rejects.toMatchObject({ code: "EVIDENCE_FILE_INVALID" });
  await fs.chmod(path.join(root, saved.storageKey), 0o600);
  await fs.writeFile(path.join(root, saved.storageKey), "xyz");
  await expect(
    readVerifiedFile(root, saved.storageKey, saved),
  ).rejects.toMatchObject({ code: "EVIDENCE_FILE_INVALID" });
  await fs.symlink(staged.file, path.join(root, "unsafe"));
  await expect(retainedEvidenceBytes(root)).rejects.toMatchObject({
    code: "EVIDENCE_UNSAFE_STORAGE",
  });
});
it("cleans staging failures including already locked bodies and cancels oversized streams", async () => {
  const original = fs.mkdtemp.bind(fs),
    created: string[] = [];
  vi.spyOn(fs, "mkdtemp").mockImplementation(async (prefix) => {
    const dir = await original(prefix);
    created.push(dir);
    return dir;
  });
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(Buffer.from("four"));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(stageEvidence(source, 3)).rejects.toMatchObject({
    code: "EVIDENCE_TOO_LARGE",
  });
  expect(cancelled).toBe(true);
  const locked = stream("abc"),
    reader = locked.getReader();
  await expect(stageEvidence(locked, 4)).rejects.toBeInstanceOf(TypeError);
  reader.releaseLock();
  await expect(stageEvidence(stream(), 4)).rejects.toMatchObject({
    code: "EVIDENCE_EMPTY",
  });
  for (const file of created)
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
});
it("aborts a stalled input stream without leaving the private staging directory", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const pending = stageEvidence(source, 10, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await expect(pending).rejects.toMatchObject({
    code: "EVIDENCE_ABORTED",
    status: 408,
  });
  expect(cancelled).toBe(true);
});
it("keeps explicit deployment limits strict and never exceeds the file ceiling", () => {
  expect(readEvidenceLimits()).toMatchObject({
    maxFileBytes: 5242880,
    maxAttempts: 10,
    maxRetainedBytes: 5368709120n,
  });
  vi.stubEnv("DEPOSIT_EVIDENCE_MAX_BYTES", "5242881");
  expect(() => readEvidenceLimits()).toThrow();
  for (const invalid of ["0", "1.5", "1e3", " 2", "02"]) {
    vi.stubEnv("DEPOSIT_EVIDENCE_MAX_BYTES", invalid);
    expect(() => readEvidenceLimits()).toThrow();
  }
});
it("strictly parses upload/list query without dropping prototype or header-shaped keys", () => {
  const leaseId = "11111111-1111-4111-8111-111111111111";
  expect(
    parseEvidenceListQuery(
      new URLSearchParams({ leaseId, offset: "0", limit: "25" }),
    ),
  ).toEqual({ leaseId, offset: 0, limit: 25 });
  expect(
    parseEvidenceUploadQuery(
      new URLSearchParams({ leaseId, originalName: "ใบเสร็จ.png" }),
      "image/png",
    ),
  ).toMatchObject({
    leaseId,
    originalName: "ใบเสร็จ.png",
    declaredMimeType: "image/png",
  });
  for (const suffix of [
    "&leaseId=" + leaseId,
    "&__proto__=x",
    "&declaredMimeType=image/png",
    "&offset=0",
  ])
    expect(() =>
      parseEvidenceUploadQuery(
        new URLSearchParams(
          "leaseId=" + leaseId + "&originalName=x.png" + suffix,
        ),
        "image/png",
      ),
    ).toThrow();
  expect(() =>
    parseEvidenceListQuery(
      new URLSearchParams("leaseId=" + leaseId + "&limit=1e2"),
    ),
  ).toThrow();
});
it("removes only the completed unaccepted OS staging input", async () => {
  const staged = await stageEvidence(stream("data"), 10);
  await discardStagedEvidence(staged);
  await expect(fs.stat(staged.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});
