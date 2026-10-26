import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  attestPlanBeforeCleanupRegistration,
  loadRemediationPlan,
} from "../../scripts/remediation-plan.mjs";
import { cleanupFailedRemediationProject } from "../../scripts/remediation-compose.mjs";

const runId = "1234567890abcdef12345678";
const runner = resolve("scripts/run-remediation-browser.mjs");
const provisioner = resolve("scripts/provision-remediation.mjs");
async function fixture(t, provision = true) {
  const directory = await mkdtemp(join(tmpdir(), "taky-preflight-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  await mkdir(bin);
  for (const command of ["node", "npx", "npm", "docker"])
    await writeFile(
      join(bin, command),
      '#!/bin/sh\nprintf "invoked\\n" >> "$COMMAND_MARKER"\nexit 97\n',
      { mode: 0o700 },
    );
  if (provision) {
    const result = spawnSync(
      process.execPath,
      [provisioner, "browser", runId, "--plan-only"],
      {
        cwd: directory,
        env: { ...process.env, REMEDIATION_SUBNET: "10.253.243.0/28" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  return { directory, bin, marker: join(directory, "commands.txt") };
}
async function rejectedWithoutMutation(fixture) {
  const result = spawnSync(
    process.execPath,
    [runner, "--prepared-run", runId],
    {
      cwd: fixture.directory,
      env: {
        ...process.env,
        PATH: fixture.bin,
        COMMAND_MARKER: fixture.marker,
        DATABASE_URL:
          "postgresql://ambient:private-password@192.0.2.1:9999/existing_data",
      },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stderr,
    /Missing, unreadable, unsafe or mismatched isolated plan/,
  );
  assert.ok(!result.stderr.includes("private-password"));
  await assert.rejects(stat(fixture.marker), { code: "ENOENT" });
  await assert.rejects(
    stat(
      join(
        fixture.directory,
        `evidence/remediation/browser-${runId}/attempt-started.json`,
      ),
    ),
    { code: "ENOENT" },
  );
}

test("missing prepared plan cannot execute migration, seed or Docker using ambient credentials", async (t) => {
  await rejectedWithoutMutation(await fixture(t, false));
});

test("valid plan loads only matching private run-specific identity", async (t) => {
  const value = await fixture(t);
  const plan = await loadRemediationPlan(runId, value.directory);
  assert.equal(plan.runId, runId);
  assert.equal(plan.role, `e2e_${runId}`);
  assert.equal(plan.database, "taky_phase2_test");
});

test("validated plan is registered for cleanup before database attestation", async () => {
  const plan = { project: `taky-remediation-browser-${runId}` };
  let cleanupPlan;
  await assert.rejects(
    attestPlanBeforeCleanupRegistration(
      plan,
      async () => {
        assert.equal(cleanupPlan, plan);
        throw new Error("database attestation failed");
      },
      (validated) => {
        cleanupPlan = validated;
      },
    ),
    /database attestation failed/,
  );
  assert.equal(cleanupPlan, plan);
});

test("failed provisioning cleanup targets its generated project without deleting volumes", () => {
  const calls = [];
  const result = cleanupFailedRemediationProject(
    `taky-remediation-browser-${runId}`,
    `.local/remediation-${runId}-compose.json`,
    (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  );
  assert.equal(result.status, 0);
  assert.deepEqual(calls, [
    [
      "docker",
      [
        "compose",
        "-p",
        `taky-remediation-browser-${runId}`,
        "-f",
        `.local/remediation-${runId}-compose.json`,
        "down",
        "--remove-orphans",
      ],
      { encoding: "utf8" },
    ],
  ]);
  assert.ok(!calls[0][1].includes("-v"));
  assert.ok(!calls[0][1].includes("--volumes"));
});

for (const [name, mutate] of [
  [
    "database endpoint",
    (text) => text.replace("127.0.0.1:55452", "192.0.2.2:5432"),
  ],
  ["role", (text) => text.replace(`e2e_${runId}:`, "existing_owner:")],
  [
    "run identity",
    (text) =>
      text.replace(
        `E2E_RUN_ID=${runId}`,
        "E2E_RUN_ID=abcdefabcdefabcdefabcdef",
      ),
  ],
  [
    "origin",
    (text) =>
      text.replace(
        "APP_ORIGIN=http://127.0.0.1:3820",
        "APP_ORIGIN=http://127.0.0.1:3700",
      ),
  ],
  [
    "evidence directory",
    (text) =>
      text.replace(
        `.local/remediation-evidence-${runId}`,
        `.local/remediation-evidence-other`,
      ),
  ],
  [
    "validator origin",
    (text) =>
      text.replace(
        "EVIDENCE_VALIDATOR_ORIGIN=http://127.0.0.1:3835",
        "EVIDENCE_VALIDATOR_ORIGIN=http://127.0.0.1:3701",
      ),
  ],
  [
    "validator token",
    (text) =>
      text.replace(
        /EVIDENCE_VALIDATOR_TOKEN=[a-f0-9]{64}/,
        `EVIDENCE_VALIDATOR_TOKEN=${"b".repeat(64)}`,
      ),
  ],
])
  test(`mismatched ${name} cannot execute a command`, async (t) => {
    const value = await fixture(t);
    const path = join(value.directory, `.local/remediation-${runId}.env`);
    await writeFile(path, mutate(await readFile(path, "utf8")), {
      mode: 0o600,
    });
    await rejectedWithoutMutation(value);
  });

for (const [name, mutate] of [
  [
    "Compose project",
    (compose) => {
      compose.name = "existing-uat";
    },
  ],
  [
    "Compose role",
    (compose) => {
      compose.services.db.environment.POSTGRES_USER = "existing_owner";
    },
  ],
  [
    "Compose published port",
    (compose) => {
      compose.services.db.ports = ["127.0.0.1:3700:5432"];
    },
  ],
  [
    "Compose external mount",
    (compose) => {
      compose.services.db.volumes = ["/existing:/var/lib/postgresql/data"];
    },
  ],
  [
    "validator published port directly",
    (compose) => {
      compose.services["evidence-validator"].ports = ["0.0.0.0:3835:3835"];
    },
  ],
  [
    "validator bridge exposed beyond loopback",
    (compose) => {
      compose.services["validator-host-bridge"].ports = ["0.0.0.0:3835:3835"];
    },
  ],
  [
    "overlapping validator subnet",
    (compose) => {
      compose.networks["evidence-validation"].ipam.config[0].subnet =
        compose.networks.default.ipam.config[0].subnet;
    },
  ],
  [
    "internal database network",
    (compose) => {
      compose.networks.default.internal = true;
    },
  ],
  [
    "masquerading validator publish network",
    (compose) => {
      compose.networks["validator-publish"].driver_opts[
        "com.docker.network.bridge.enable_ip_masquerade"
      ] = "true";
    },
  ],
  [
    "overlapping validator publish subnet",
    (compose) => {
      compose.networks["validator-publish"].ipam.config[0].subnet =
        compose.networks.default.ipam.config[0].subnet;
    },
  ],
  [
    "invalid validator subnet",
    (compose) => {
      compose.networks["evidence-validation"].ipam.config[0].subnet =
        "192.168.1.0/24";
    },
  ],
])
  test(`mismatched ${name} cannot execute cleanup or migration`, async (t) => {
    const value = await fixture(t);
    const path = join(
      value.directory,
      `.local/remediation-${runId}-compose.json`,
    );
    const compose = JSON.parse(await readFile(path, "utf8"));
    mutate(compose);
    await writeFile(path, JSON.stringify(compose), { mode: 0o600 });
    await rejectedWithoutMutation(value);
  });

test("unsafe plan permissions fail before any command", async (t) => {
  const value = await fixture(t);
  await chmod(join(value.directory, `.local/remediation-${runId}.env`), 0o644);
  await rejectedWithoutMutation(value);
});

test("unsafe evidence directory permissions fail before any command", async (t) => {
  const value = await fixture(t);
  await chmod(
    join(value.directory, ".local", `remediation-evidence-${runId}`),
    0o755,
  );
  await rejectedWithoutMutation(value);
});
