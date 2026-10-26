import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRemediationPlan } from "../../scripts/remediation-plan.mjs";
import { publishLegacyEnvironmentOnSuccess } from "../../scripts/remediation-pointer.mjs";
import { acquireRemediationRunLock } from "../../scripts/remediation-run-lock.mjs";

const script = resolve("scripts/provision-remediation.mjs");
const runId = "0123456789abcdef01234567";
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "taky-provision-plan-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function plan(directory, subnet, identifier = runId, evidenceSubnet) {
  return spawnSync(
    process.execPath,
    [script, "browser", identifier, "--plan-only"],
    {
      cwd: directory,
      env: {
        ...process.env,
        REMEDIATION_SUBNET: subnet,
        ...(evidenceSubnet
          ? { REMEDIATION_VALIDATOR_SUBNET: evidenceSubnet }
          : {}),
      },
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
  assert.equal(report.evidenceSubnet, "10.250.242.0/28");
  assert.equal(report.bridgeSubnet, "10.250.243.0/28");
  const compose = JSON.parse(
    await readFile(join(directory, report.composePath), "utf8"),
  );
  assert.deepEqual(compose.services.db.ports, ["127.0.0.1:55452:5432"]);
  assert.equal(compose.services.db.environment.POSTGRES_USER, `e2e_${runId}`);
  assert.equal(compose.networks.default.ipam.config[0].subnet, report.subnet);
  assert.equal(compose.name, `taky-remediation-browser-${runId}`);
  const validator = compose.services["evidence-validator"];
  assert.equal(validator.build.context, "../operations/evidence-validator");
  assert.deepEqual(validator.networks, ["evidence-validation"]);
  assert.equal(Object.hasOwn(validator, "ports"), false);
  assert.equal(validator.read_only, true);
  assert.deepEqual(validator.cap_drop, ["ALL"]);
  assert.equal(Object.hasOwn(compose.networks.default, "internal"), false);
  assert.deepEqual(compose.networks.default.ipam.config[0], {
    subnet: report.subnet,
  });
  assert.equal(compose.networks["evidence-validation"].internal, true);
  const bridge = compose.services["validator-host-bridge"];
  assert.equal(bridge.image, "node:22-bookworm-slim");
  assert.deepEqual(bridge.ports, ["127.0.0.1:3835:3835"]);
  assert.deepEqual(bridge.networks, [
    "evidence-validation",
    "validator-publish",
  ]);
  assert.equal(bridge.read_only, true);
  assert.deepEqual(bridge.cap_drop, ["ALL"]);
  assert.equal(bridge.volumes, undefined);
  assert.equal(
    compose.networks["validator-publish"].driver_opts[
      "com.docker.network.bridge.enable_ip_masquerade"
    ],
    "false",
  );
  assert.equal(
    compose.networks["validator-publish"].ipam.config[0].subnet,
    report.bridgeSubnet,
  );
  assert.equal(
    compose.networks["evidence-validation"].ipam.config[0].subnet,
    report.evidenceSubnet,
  );
  const manifest = JSON.parse(
    await readFile(
      join(directory, `evidence/remediation/browser-${runId}.json`),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.validatorNetwork, {
    name: "evidence-validation",
    internal: true,
    attachedToDatabaseNetwork: false,
  });
  assert.deepEqual(manifest.validatorHostBridge, {
    network: "validator-publish",
    hostBinding: "127.0.0.1:3835",
    outboundMasquerading: false,
    outboundFirewallEnforced: false,
  });
  const envPath = join(directory, `.local/remediation-${runId}.env`);
  const envText = await readFile(envPath, "utf8");
  const attachmentDir = join(
    await realpath(join(directory, ".local")),
    `remediation-evidence-${runId}`,
  );
  assert.ok(envText.includes(`ATTACHMENT_DIR=${attachmentDir}\n`));
  assert.match(envText, /EVIDENCE_VALIDATOR_ORIGIN=http:\/\/127\.0\.0\.1:3835/);
  const token = envText.match(/EVIDENCE_VALIDATOR_TOKEN=([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  assert.equal(validator.environment.EVIDENCE_VALIDATOR_TOKEN, token);
  assert.equal((await stat(attachmentDir)).mode & 0o777, 0o700);
  assert.equal(
    (await loadRemediationPlan(runId, directory)).env.ATTACHMENT_DIR,
    attachmentDir,
  );
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  await assert.rejects(stat(join(directory, ".local/remediation.env")), {
    code: "ENOENT",
  });
  assert.equal(
    (await stat(join(directory, report.composePath))).mode & 0o777,
    0o600,
  );
  assert.ok(
    !result.stdout.includes(compose.services.db.environment.POSTGRES_PASSWORD),
  );
  assert.ok(!result.stdout.includes(token));
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

test("database and evidence-validator subnets must be distinct", async (t) => {
  const directory = await fixture(t);
  const result = plan(directory, "10.253.243.0/28", runId, "10.253.243.0/28");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not overlap/);
  await assert.rejects(stat(join(directory, ".local")), { code: "ENOENT" });
});

test("reusing a run identity cannot replace existing credentials or evidence", async (t) => {
  const directory = await fixture(t);
  assert.equal(plan(directory, "10.253.243.0/28").status, 0);
  const paths = [
    `.local/remediation-${runId}.env`,
    `.local/remediation-${runId}-compose.json`,
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
  await assert.rejects(stat(join(directory, ".local/remediation.env")), {
    code: "ENOENT",
  });
});

test("legacy environment pointer is published only after successful provisioning", async (t) => {
  const directory = await fixture(t);
  await mkdir(join(directory, ".local"), { mode: 0o700 });
  const pointerPath = join(directory, ".local/remediation.env");
  const values = { E2E_RUN_ID: runId, DATABASE_URL: "postgresql://isolated" };
  assert.equal(
    await publishLegacyEnvironmentOnSuccess(1, values, pointerPath),
    false,
  );
  await assert.rejects(stat(pointerPath), { code: "ENOENT" });
  assert.equal(
    await publishLegacyEnvironmentOnSuccess(0, values, pointerPath),
    true,
  );
  assert.equal(
    await readFile(pointerPath, "utf8"),
    "E2E_RUN_ID=" + runId + "\nDATABASE_URL=postgresql://isolated\n",
  );
});

test("a later run preserves existing stable environment and Compose pointers", async (t) => {
  const directory = await fixture(t);
  const secondRunId = "fedcba9876543210fedcba98";
  assert.equal(plan(directory, "10.253.243.0/28", runId).status, 0);
  const stableEnvPath = join(directory, ".local/remediation.env");
  await assert.rejects(stat(stableEnvPath), { code: "ENOENT" });
  await publishLegacyEnvironmentOnSuccess(
    0,
    { E2E_RUN_ID: runId },
    stableEnvPath,
  );
  const stableEnvBefore = await readFile(stableEnvPath, "utf8");
  const stableComposePath = join(directory, ".local/remediation-compose.json");
  const stableCompose = '{"owner":"preserve this pointer"}\n';
  await writeFile(stableComposePath, stableCompose, { mode: 0o600 });

  const next = plan(directory, "10.253.244.0/28", secondRunId);
  assert.equal(next.status, 0, next.stderr);
  assert.equal(await readFile(stableEnvPath, "utf8"), stableEnvBefore);
  assert.equal(await readFile(stableComposePath, "utf8"), stableCompose);
});

test("existing run evidence directory is never reused or overwritten", async (t) => {
  const directory = await fixture(t);
  const localDirectory = join(directory, ".local");
  await mkdir(localDirectory, { mode: 0o700 });
  const attachmentDir = join(
    await realpath(localDirectory),
    `remediation-evidence-${runId}`,
  );
  await mkdir(attachmentDir, { mode: 0o700 });
  const marker = join(attachmentDir, "owner-fixture.txt");
  await writeFile(marker, "preserve this existing fixture\n", { mode: 0o600 });

  const result = plan(directory, "10.253.243.0/28");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(
    await readFile(marker, "utf8"),
    "preserve this existing fixture\n",
  );
  await assert.rejects(
    stat(join(directory, `.local/remediation-${runId}.env`)),
    { code: "ENOENT" },
  );
});

test("browser runs serialize on the shared fixed-port lock", async (t) => {
  const directory = await fixture(t);
  const release = await acquireRemediationRunLock(runId, directory);
  await assert.rejects(
    acquireRemediationRunLock("fedcba9876543210fedcba98", directory),
    /Another remediation browser run is active/,
  );
  const borrowed = await acquireRemediationRunLock(runId, directory, {
    allowSameRun: true,
  });
  await borrowed();
  await release();
  const releaseNext = await acquireRemediationRunLock(
    "fedcba9876543210fedcba98",
    directory,
  );
  await releaseNext();
});
