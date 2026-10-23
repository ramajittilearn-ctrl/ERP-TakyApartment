import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/provision-remediation.mjs");
const runId = "0123456789abcdef01234567";
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "taky-provision-plan-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function plan(directory, subnet, identifier = runId) {
  return spawnSync(
    process.execPath,
    [script, "browser", identifier, "--plan-only"],
    {
      cwd: directory,
      env: { ...process.env, REMEDIATION_SUBNET: subnet },
      encoding: "utf8",
    },
  );
}

test("plan-only creates a fresh scoped private project without Docker or port binding", async (t) => {
  const directory = await fixture(t);
  const result = plan(directory, "10.253.243.0/28");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.plannedOnly, true);
  assert.equal(report.subnet, "10.253.243.0/28");
  const compose = JSON.parse(
    await readFile(join(directory, report.composePath), "utf8"),
  );
  assert.deepEqual(compose.services.db.ports, ["127.0.0.1:55452:5432"]);
  assert.equal(compose.services.db.environment.POSTGRES_USER, `e2e_${runId}`);
  assert.equal(compose.networks.default.ipam.config[0].subnet, report.subnet);
  assert.equal(compose.name, `taky-remediation-browser-${runId}`);
  const envPath = join(directory, `.local/remediation-${runId}.env`);
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.equal(
    (await stat(join(directory, report.composePath))).mode & 0o777,
    0o600,
  );
  assert.ok(
    !result.stdout.includes(compose.services.db.environment.POSTGRES_PASSWORD),
  );
});

test("invalid or misaligned subnets fail before creating project files", async (t) => {
  const directory = await fixture(t);
  for (const subnet of [
    "192.168.1.0/24",
    "10.253.243.1/28",
    "10.999.1.0/24",
    "10.253.243.0/16",
  ]) {
    const result = plan(directory, subnet);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /REMEDIATION_SUBNET/);
  }
  await assert.rejects(stat(join(directory, ".local")), { code: "ENOENT" });
});

test("reusing a run identity cannot replace existing credentials or evidence", async (t) => {
  const directory = await fixture(t);
  assert.equal(plan(directory, "10.253.243.0/28").status, 0);
  const paths = [
    `.local/remediation-${runId}.env`,
    `.local/remediation-${runId}-compose.json`,
    ".local/remediation.env",
    `evidence/remediation/browser-${runId}.json`,
  ];
  const before = await Promise.all(
    paths.map((path) => readFile(join(directory, path), "utf8")),
  );
  const repeated = plan(directory, "10.253.244.0/28");
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /EEXIST/);
  const after = await Promise.all(
    paths.map((path) => readFile(join(directory, path), "utf8")),
  );
  assert.deepEqual(after, before);
});
