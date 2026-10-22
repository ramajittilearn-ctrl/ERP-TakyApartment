import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../../operations/cli.mjs", import.meta.url));
const now = Date.parse("2026-10-23T12:00:00.000Z");

async function heartbeat(contents) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "taky-heartbeat-"));
  try {
    const clock = path.join(directory, "clock.mjs");
    await fs.writeFile(clock, `Date.now = () => ${now};\n`);
    if (contents !== undefined)
      await fs.writeFile(path.join(directory, "heartbeat.json"), contents);
    return spawnSync(
      process.execPath,
      ["--import", pathToFileURL(clock).href, cli, "heartbeat"],
      {
        env: { ...process.env, BACKUP_DIR: directory },
        encoding: "utf8",
        timeout: 10000,
      },
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

for (const [name, contents] of [
  ["missing file", undefined],
  ["malformed JSON", "{"],
  ["missing timestamp", "{}"],
  ["invalid timestamp", JSON.stringify({ at: "not-a-date" })],
  ["null record", "null"],
  ["null timestamp", JSON.stringify({ at: null })],
  ["array timestamp", JSON.stringify({ at: [new Date(now).toISOString()] })],
  [
    "stale timestamp",
    JSON.stringify({ at: new Date(now - 1200001).toISOString() }),
  ],
  ["future timestamp", JSON.stringify({ at: new Date(now + 1).toISOString() })],
]) {
  test(`heartbeat command rejects ${name}`, async () => {
    const result = await heartbeat(contents);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).event, "operations_failed");
  });
}

for (const [name, age] of [
  ["current timestamp", 0],
  ["recent timestamp", 60000],
  ["exactly twenty-minute-old timestamp", 1200000],
]) {
  test(`heartbeat command accepts ${name}`, async () => {
    const result = await heartbeat(
      JSON.stringify({ at: new Date(now - age).toISOString() }),
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });
}
