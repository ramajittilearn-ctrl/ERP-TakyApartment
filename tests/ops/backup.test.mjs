import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import {
  encrypt,
  decrypt,
  readKey,
  run,
  sha256,
  safeRelative,
  filesUnder,
  unpack,
} from "../../operations/archive.mjs";
import {
  retentionCandidates,
  latestWeeklySlot,
  weeklyDue,
  selectedFile,
  atomicJson,
} from "../../operations/backup.mjs";
import { restoreProduction } from "../../operations/production-restore.mjs";

async function temporary(work) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "taky-ops-test-"));
  try {
    await work(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
test("AES-256-GCM round trip preserves bytes and uses a fresh nonce", () =>
  temporary(async (directory) => {
    const source = path.join(directory, "source"),
      one = path.join(directory, "one"),
      two = path.join(directory, "two"),
      restored = path.join(directory, "restored");
    const key = randomBytes(32),
      content = randomBytes(150000);
    await fs.writeFile(source, content);
    await encrypt(source, one, key);
    await encrypt(source, two, key);
    assert.notEqual(await sha256(one), await sha256(two));
    await decrypt(one, restored, key);
    assert.deepEqual(await fs.readFile(restored), content);
    assert.equal((await fs.stat(one)).mode & 0o077, 0);
  }));
test("wrong keys and damaged header, nonce, ciphertext and tag never leave plaintext", () =>
  temporary(async (directory) => {
    const source = path.join(directory, "source"),
      encrypted = path.join(directory, "encrypted"),
      restored = path.join(directory, "restored");
    const key = randomBytes(32);
    await fs.writeFile(source, randomBytes(4096));
    await encrypt(source, encrypted, key);
    await assert.rejects(
      decrypt(encrypted, restored, randomBytes(32)),
      /authentication failed/,
    );
    for (const index of [0, 17, 100, (await fs.stat(encrypted)).size - 1]) {
      const bytes = await fs.readFile(encrypted);
      bytes[index] ^= 1;
      const corrupt = path.join(directory, `corrupt-${index}`);
      await fs.writeFile(corrupt, bytes);
      await assert.rejects(decrypt(corrupt, restored, key));
      await assert.rejects(fs.access(restored));
    }
  }));
test("keys must be random-length canonical base64, not passwords", () =>
  temporary(async (directory) => {
    const file = path.join(directory, "key");
    await fs.writeFile(file, "password");
    await assert.rejects(readKey(file));
    const key = randomBytes(32);
    await fs.writeFile(file, key.toString("base64") + "\n");
    assert.deepEqual(await readKey(file), key);
  }));
test("paths reject traversal and links; ordinary Thai filenames retain hashes", () =>
  temporary(async (directory) => {
    for (const value of [
      "../private",
      "/absolute",
      "a/../b",
      "a\\b",
      "a\nb",
      "./a",
      "a//b",
    ])
      assert.equal(safeRelative(value), false);
    await fs.writeFile(path.join(directory, "เอกสาร.txt"), "Demo attachment");
    assert.equal((await filesUnder(directory))[0].path, "เอกสาร.txt");
    await fs.symlink("เอกสาร.txt", path.join(directory, "link"));
    await assert.rejects(filesUnder(directory), /links/);
    assert.throws(() => selectedFile("../../database"));
  }));
test("encrypted manifest verifies database and attachment content; altered manifests fail", () =>
  temporary(async (directory) => {
    const source = path.join(directory, "set");
    await fs.mkdir(path.join(source, "attachments"), { recursive: true });
    const dump = path.join(source, "database.dump");
    await fs.writeFile(
      dump,
      "Unit fixture only; PostgreSQL restore is tested separately",
    );
    await fs.writeFile(
      path.join(source, "attachments", "demo.txt"),
      "Demo content",
    );
    const manifest = {
      version: 1,
      inventory: {},
      database: {
        sha256: await sha256(dump),
        bytes: (await fs.stat(dump)).size,
      },
      attachments: await filesUnder(path.join(source, "attachments")),
    };
    await atomicJson(path.join(source, "manifest.json"), manifest);
    const tar = path.join(directory, "set.tar.gz"),
      key = randomBytes(32),
      encrypted = path.join(directory, "set.enc");
    await run("tar", [
      "-czf",
      tar,
      "-C",
      source,
      "manifest.json",
      "database.dump",
      "attachments",
    ]);
    await encrypt(tar, encrypted, key);
    const good = path.join(directory, "good");
    await fs.mkdir(good);
    assert.equal((await unpack(encrypted, key, good)).manifest.version, 1);
    manifest.database.sha256 = "0".repeat(64);
    await atomicJson(path.join(source, "manifest.json"), manifest);
    await run("tar", [
      "-czf",
      tar,
      "-C",
      source,
      "manifest.json",
      "database.dump",
      "attachments",
    ]);
    const bad = path.join(directory, "bad.enc"),
      target = path.join(directory, "bad");
    await encrypt(tar, bad, key);
    await fs.mkdir(target);
    await assert.rejects(unpack(bad, key, target), /checksum mismatch/);
  }));
test("retention keeps latest twelve successful weekly sets and all pending uploads", () => {
  const all = Array.from({ length: 15 }, (_, i) => ({
    id: randomUUID(),
    kind: "weekly",
    status: "SUCCEEDED",
    createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    verifiedAt: "yes",
    uploadedAt: "yes",
  }));
  const pending = all[0];
  delete pending.uploadedAt;
  all.push({
    id: "failed-new",
    kind: "weekly",
    status: "FAILED",
    createdAt: "2027-01-01T00:00:00Z",
  });
  assert.deepEqual(
    new Set(retentionCandidates(all).map((r) => r.id)),
    new Set([all[1].id, all[2].id]),
  );
  assert.equal(retentionCandidates(all.slice(0, 1)).length, 0);
});
test("Sunday 02:00 Bangkok, catch-up, successful slot and failed-attempt backoff", () => {
  const before = new Date("2026-10-17T18:59:59Z"),
    due = new Date("2026-10-17T19:00:00Z");
  assert.equal(latestWeeklySlot(before), "2026-10-10T19:00:00.000Z");
  assert.equal(latestWeeklySlot(due), "2026-10-17T19:00:00.000Z");
  assert.equal(weeklyDue([], due), true);
  assert.equal(
    weeklyDue(
      [
        {
          kind: "weekly",
          status: "SUCCEEDED",
          verifiedAt: "yes",
          scheduledFor: latestWeeklySlot(due),
          createdAt: due.toISOString(),
        },
      ],
      due,
    ),
    false,
  );
  assert.equal(
    weeklyDue(
      [{ kind: "weekly", status: "FAILED", createdAt: due.toISOString() }],
      new Date(due.getTime() + 1000),
    ),
    false,
  );
  assert.equal(
    weeklyDue(
      [{ kind: "weekly", status: "FAILED", createdAt: due.toISOString() }],
      new Date(due.getTime() + 3600001),
    ),
    true,
  );
});
test("production restore refuses absent owner confirmation before any database access", async () => {
  await assert.rejects(
    restoreProduction("not-a-backup"),
    /explicit owner confirmation/,
  );
});
