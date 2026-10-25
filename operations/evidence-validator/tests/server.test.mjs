import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "node:http";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createValidatorServer } from "../server.mjs";
import { ValidationFailure } from "../process.mjs";
import { MAX_BYTES } from "../validate.mjs";

const TOKEN = "a".repeat(64);
const bytes = Buffer.from("synthetic HTTP lifecycle input");
const result = { valid: true, mimeType: "image/png", bytes: bytes.length };

async function setup(validate, options = {}) {
  const temporaryRoot = await mkdtemp("/tmp/taky-validator-http-test-");
  const server = createValidatorServer({
    token: TOKEN,
    validate,
    temporaryRoot,
    ...options,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    temporaryRoot,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}

async function drained(directory) {
  for (let i = 0; i < 100; i++) {
    if ((await readdir(directory)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(await readdir(directory), []);
}

function post(origin, body = bytes, headers = {}) {
  return fetch(origin + "/validate", {
    method: "POST",
    body,
    headers: { "x-taky-validator-token": TOKEN, ...headers },
  });
}

test("rejects missing configuration and invalid deadlines", () => {
  for (const token of [undefined, "", "a".repeat(63), "A".repeat(64)])
    assert.throws(() => createValidatorServer({ token }));
  assert.throws(() =>
    createValidatorServer({ token: TOKEN, deadlineMs: 8001 }),
  );
});

test("authentication, duplicate credentials and route rejection do no parser or file work", async () => {
  let calls = 0;
  const app = await setup(async () => {
    calls++;
    return result;
  });
  try {
    assert.equal(
      (
        await post(app.origin, bytes, {
          "x-taky-validator-token": "b".repeat(64),
        })
      ).status,
      401,
    );
    const duplicate = await new Promise((resolve, reject) => {
      const req = request(
        app.origin + "/validate",
        {
          method: "POST",
          headers: [
            "x-taky-validator-token",
            TOKEN,
            "X-Taky-Validator-Token",
            TOKEN,
            "Content-Length",
            String(bytes.length),
          ],
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end(bytes);
    });
    assert.equal(duplicate, 401);
    assert.equal((await fetch(app.origin + "/validate")).status, 405);
    assert.equal(
      (await fetch(app.origin + "/validate?file=/etc/passwd")).status,
      404,
    );
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(app.temporaryRoot), []);
  } finally {
    await app.close();
  }
});

test("two active operations reject a third immediately and release after cleanup", async () => {
  let started = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let signalStarted;
  const bothStarted = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const app = await setup(async () => {
    if (++started === 2) signalStarted();
    await gate;
    return result;
  });
  try {
    const first = post(app.origin);
    const second = post(app.origin);
    await bothStarted;
    const excess = await post(app.origin);
    assert.equal(excess.status, 503);
    assert.deepEqual(await excess.json(), { error: "VALIDATOR_BUSY" });
    assert.equal(started, 2);
    release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    await drained(app.temporaryRoot);
    assert.equal((await post(app.origin)).status, 200);
    assert.equal(started, 3);
    await drained(app.temporaryRoot);
  } finally {
    release();
    await app.close();
  }
});

test("declared and streamed size limits reject without acceptance and remove inputs", async () => {
  let calls = 0;
  const app = await setup(async () => {
    calls++;
    return result;
  });
  try {
    assert.equal(
      (await post(app.origin, Buffer.alloc(MAX_BYTES + 1))).status,
      413,
    );
    assert.equal(
      (await post(app.origin, bytes, { "content-encoding": "gzip" })).status,
      415,
    );
    const streamed = await new Promise((resolve, reject) => {
      const req = request(
        app.origin + "/validate",
        { method: "POST", headers: { "x-taky-validator-token": TOKEN } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.write(Buffer.alloc(MAX_BYTES));
      req.end(Buffer.alloc(1));
    });
    assert.equal(streamed, 413);
    assert.equal(calls, 0);
    await drained(app.temporaryRoot);
  } finally {
    await app.close();
  }
});

test("parser failure is generic and releases its admission and temporary input", async () => {
  let calls = 0;
  const app = await setup(async () => {
    if (++calls === 1)
      throw new Error(
        "private filename and parser diagnostics must not escape",
      );
    return result;
  });
  try {
    const failed = await post(app.origin);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: "VALIDATOR_UNAVAILABLE" });
    await drained(app.temporaryRoot);
    const accepted = await post(app.origin);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), result);
    await drained(app.temporaryRoot);
  } finally {
    await app.close();
  }
});

test("deadline aborts parser work and frees its permit after the parser settles", async () => {
  let aborted = false;
  let calls = 0;
  const app = await setup(
    async (_path, signal) => {
      if (++calls > 1) return result;
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new ValidationFailure(408, "VALIDATION_TIMEOUT"));
          },
          { once: true },
        ),
      );
    },
    { deadlineMs: 50 },
  );
  try {
    const failed = await post(app.origin);
    assert.equal(failed.status, 408);
    assert.equal(aborted, true);
    await drained(app.temporaryRoot);
    assert.equal((await post(app.origin)).status, 200);
    await drained(app.temporaryRoot);
  } finally {
    await app.close();
  }
});

test("disconnect aborts parser work and never leaks the staged file", async () => {
  let parsing;
  const parseStarted = new Promise((resolve) => {
    parsing = resolve;
  });
  let stopped;
  const stop = new Promise((resolve) => {
    stopped = resolve;
  });
  const app = await setup(
    async (_path, signal) =>
      new Promise((_resolve, reject) => {
        parsing();
        signal.addEventListener(
          "abort",
          () => {
            stopped();
            reject(new ValidationFailure(408, "VALIDATION_TIMEOUT"));
          },
          { once: true },
        );
      }),
  );
  try {
    const req = request(app.origin + "/validate", {
      method: "POST",
      headers: { "x-taky-validator-token": TOKEN },
    });
    req.on("error", () => {});
    req.end(bytes);
    await parseStarted;
    req.destroy();
    await stop;
    await drained(app.temporaryRoot);
  } finally {
    await app.close();
  }
});
