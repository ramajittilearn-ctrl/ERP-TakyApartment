import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { nextTick } from "node:process";
import { PassThrough, Writable } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireAttachmentPublicationSession,
  withAttachmentPublicationSession,
} from "../../operations/publication.mjs";
import { filesUnder, copyFiles, chownTree } from "../../operations/archive.mjs";

function fakeSession({ ready = true, respond = true, wrongPid = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const commands = [];
  let closed = false;
  const finish = () => {
    if (!closed) {
      closed = true;
      nextTick(() => child.emit("close", 0));
    }
  };
  child.kill = () => {
    finish();
    return true;
  };
  child.stdin = new Writable({
    write(chunk, encoding, done) {
      const text = chunk.toString();
      commands.push(text);
      if (text.includes("TAKY_PUBLICATION_READY") && ready)
        nextTick(() =>
          child.stdout.write(
            JSON.stringify(["TAKY_PUBLICATION_READY", 123, "synthetic_role"]) +
              "\n",
          ),
        );
      const check = /'TAKY_PUBLICATION_CHECK',(\d+),/.exec(text);
      if (check && respond)
        nextTick(() =>
          child.stdout.write(
            JSON.stringify([
              "TAKY_PUBLICATION_CHECK",
              Number(check[1]),
              wrongPid ? 999 : 123,
            ]) + "\n",
          ),
        );
      if (text.includes("pg_advisory_unlock")) finish();
      done();
    },
  });
  return {
    child,
    commands,
    options: {
      spawnProcess: () => child,
      acquisitionTimeoutMs: 40,
      checkTimeoutMs: 40,
      heartbeatMs: 10,
      closeTimeoutMs: 40,
    },
  };
}

test("callback starts only after a session lock acknowledgment and closes after final ownership round trip", async () => {
  const f = fakeSession();
  const result = await withAttachmentPublicationSession(async (session) => {
    assert.equal(session.backendPid, 123);
    assert.equal(session.role, "synthetic_role");
    assert.equal(session.signal.aborted, false);
    await session.assertAlive();
    return "complete";
  }, f.options);
  assert.equal(result, "complete");
  assert.match(f.commands[0], /pg_advisory_lock\(73422195\)/);
  assert.doesNotMatch(f.commands.join(""), /73422193|BEGIN|REPEATABLE/);
  assert.equal(
    f.commands.filter((q) => q.includes("TAKY_PUBLICATION_CHECK")).length,
    2,
  );
  assert.equal(
    f.commands.filter((q) => q.includes("pg_advisory_unlock")).length,
    1,
  );
});
test("acquisition has a bounded failure and never invokes protected work", async () => {
  const f = fakeSession({ ready: false });
  let invoked = false;
  await assert.rejects(
    withAttachmentPublicationSession(() => {
      invoked = true;
    }, f.options),
    /session lost/,
  );
  assert.equal(invoked, false);
});
test("protected callback failure still releases its dedicated session", async () => {
  const f = fakeSession();
  await assert.rejects(
    withAttachmentPublicationSession(() => {
      throw new Error("synthetic copy failure");
    }, f.options),
    /synthetic copy failure/,
  );
  assert.equal(
    f.commands.filter((q) => q.includes("pg_advisory_unlock")).length,
    1,
  );
});
test("unexpected lock-owner loss aborts protected work and cannot return a successful set", async () => {
  const f = fakeSession();
  await assert.rejects(
    withAttachmentPublicationSession(async ({ signal }) => {
      nextTick(() => f.child.emit("close", 1));
      await new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
      return "must not publish";
    }, f.options),
    /session lost/,
  );
});
test("a silent or replaced backend fails a real ownership round trip", async () => {
  for (const behavior of [{ respond: false }, { wrongPid: true }]) {
    const f = fakeSession(behavior);
    const session = await acquireAttachmentPublicationSession(f.options);
    await assert.rejects(session.assertAlive(), /session lost/);
    assert.equal(session.signal.aborted, true);
    await session.close();
  }
});
test("a live but stalled protected task cannot retain the session past its bounded lifetime", async () => {
  const f = fakeSession();
  await assert.rejects(
    withAttachmentPublicationSession(
      async ({ signal }) => {
        await new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      },
      { ...f.options, holdTimeoutMs: 30 },
    ),
    /session lost/,
  );
});
test("all retained regular orphans and destination partials are copied without inventing metadata or deleting source bytes", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "taky-publication-files-"),
  );
  try {
    const source = path.join(root, "source"),
      destination = path.join(root, "copy");
    await fs.mkdir(source);
    for (const name of ["accepted", "orphan", "destination.partial"])
      await fs.writeFile(path.join(source, name), name);
    const before = await filesUnder(source);
    const signal = new globalThis.AbortController().signal;
    await copyFiles(source, destination, before, { signal });
    assert.deepEqual(await filesUnder(destination), before);
    assert.deepEqual(await filesUnder(source), before);
    const controller = new globalThis.AbortController();
    controller.abort(new Error("synthetic ownership loss"));
    await assert.rejects(
      copyFiles(source, path.join(root, "rejected"), before, {
        signal: controller.signal,
      }),
      /synthetic ownership loss/,
    );
    await assert.rejects(
      filesUnder(source, "", { signal: controller.signal }),
      /synthetic ownership loss/,
    );
    assert.deepEqual(await filesUnder(source), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("restored attachment ownership is recursive, keeps private modes, and rejects links", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taky-restore-owner-"));
  try {
    const destination = path.join(root, "attachments"),
      nested = path.join(destination, "nested"),
      file = path.join(nested, "evidence.bin");
    await fs.mkdir(nested, { recursive: true, mode: 0o755 });
    await fs.chmod(destination, 0o755);
    await fs.writeFile(file, "synthetic evidence", { mode: 0o644 });
    await chownTree(destination, process.getuid(), process.getgid());
    for (const [target, mode] of [
      [destination, 0o700],
      [nested, 0o700],
      [file, 0o600],
    ]) {
      const stat = await fs.lstat(target);
      assert.equal(stat.uid, process.getuid());
      assert.equal(stat.gid, process.getgid());
      assert.equal(stat.mode & 0o777, mode);
    }
    await fs.symlink(file, path.join(destination, "linked-evidence"));
    await assert.rejects(
      chownTree(destination, process.getuid(), process.getgid()),
      /link or special file/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
