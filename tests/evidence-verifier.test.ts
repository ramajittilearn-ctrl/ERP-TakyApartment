import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "../src/server/db";
import { lockAndVerifyDepositEvidence } from "../src/server/evidence/service";
import {
  discardStagedEvidence,
  retainEvidenceUnderGate,
  stageEvidence,
} from "../src/server/evidence/storage";
const roots: string[] = [];
async function writable(root: string) {
  const stat = await fs.lstat(root);
  await fs.chmod(root, stat.isDirectory() ? 0o700 : 0o600);
  if (stat.isDirectory())
    for (const name of await fs.readdir(root))
      await writable(path.join(root, name));
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    await writable(root);
    await fs.rm(root, { recursive: true });
  }
});
async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "taky-evidence-verify-")),
  );
  roots.push(root);
  vi.stubEnv("ATTACHMENT_DIR", root);
  const staged = await stageEvidence(
    new ReadableStream({
      start(c) {
        c.enqueue(Buffer.from("proof"));
        c.close();
      },
    }),
    10,
  );
  const retained = await retainEvidenceUnderGate(root, staged, 100n);
  await discardStagedEvidence(staged);
  const leaseId = randomUUID(),
    id = randomUUID(),
    attachmentId = randomUUID(),
    actor = randomUUID(),
    now = new Date();
  const row = {
    id,
    leaseId,
    attachmentId,
    uploadedById: actor,
    acceptedAt: now,
    attachment: {
      id: attachmentId,
      storageKey: retained.storageKey,
      originalName: "proof.png",
      mimeType: "image/png",
      bytes: BigInt(retained.bytes),
      sha256: retained.sha256,
      uploadedById: actor,
      leaseId,
      tenantId: null,
      paymentId: null,
      expenseId: null,
      createdAt: now,
      updatedAt: now,
    },
  };
  vi.spyOn(db, "$queryRaw").mockResolvedValue([]);
  vi.spyOn(db.depositEvidence, "findUnique").mockResolvedValue(row);
  return { row, root, retained };
}
it("locks metadata and requires actual same-lease retained bytes before returning an evidence identity", async () => {
  const f = await fixture();
  expect(
    await lockAndVerifyDepositEvidence(db, {
      leaseId: f.row.leaseId,
      evidenceId: f.row.id,
    }),
  ).toEqual({ evidenceId: f.row.id, attachmentId: f.row.attachmentId });
  expect(db.$queryRaw).toHaveBeenCalledTimes(2);
});
it("rejects cross-lease metadata and same-length modified retained files", async () => {
  const f = await fixture();
  await expect(
    lockAndVerifyDepositEvidence(db, {
      leaseId: randomUUID(),
      evidenceId: f.row.id,
    }),
  ).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
  const file = path.join(f.root, f.retained.storageKey);
  await fs.chmod(file, 0o600);
  await fs.writeFile(file, "other");
  await expect(
    lockAndVerifyDepositEvidence(db, {
      leaseId: f.row.leaseId,
      evidenceId: f.row.id,
    }),
  ).rejects.toMatchObject({ code: "EVIDENCE_FILE_INVALID" });
});
it("does not treat metadata as evidence when the retained file is missing", async () => {
  const f = await fixture();
  const file = path.join(f.root, f.retained.storageKey);
  await fs.chmod(path.dirname(file), 0o700);
  await fs.unlink(file);
  await expect(
    lockAndVerifyDepositEvidence(db, {
      leaseId: f.row.leaseId,
      evidenceId: f.row.id,
    }),
  ).rejects.toMatchObject({ code: "EVIDENCE_FILE_INVALID" });
});
