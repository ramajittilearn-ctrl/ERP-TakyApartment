import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { join, resolve } from "node:path";
import { cleanupFailedRemediationProject } from "./remediation-compose.mjs";
import { publishLegacyEnvironmentOnSuccess } from "./remediation-pointer.mjs";
import { acquireRemediationRunLock } from "./remediation-run-lock.mjs";

const kind = process.argv[2];
if (!["integration", "browser"].includes(kind))
  throw new Error("Choose integration or browser");
const port = kind === "browser" ? 55452 : 55451;
const runId = process.argv[3] ?? randomBytes(12).toString("hex");
if (!/^[a-f0-9]{24}$/.test(runId))
  throw new Error("Invalid isolated run identifier");
const role = `${kind === "browser" ? "e2e" : "int"}_${runId}`;
const project = `taky-remediation-${kind}-${runId}`;
const planOnly = process.argv.includes("--plan-only");
const attachmentDirectoryName = `remediation-evidence-${runId}`;
const validatorToken = randomBytes(32).toString("hex");
const subnet =
  process.env.REMEDIATION_SUBNET ??
  (kind === "browser" ? "10.250.241.0/24" : "10.250.240.0/24");
const evidenceSubnet =
  process.env.REMEDIATION_VALIDATOR_SUBNET ?? "10.250.242.0/28";
const bridgeSubnet = process.env.REMEDIATION_BRIDGE_SUBNET ?? "10.250.243.0/28";
function subnetRange(value, variable) {
  const match = /^(10)\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(24|28)$/.exec(value);
  if (
    !match ||
    match.slice(1, 5).some((part) => Number(part) > 255) ||
    Number(match[4]) % (match[5] === "24" ? 256 : 16) !== 0
  )
    throw new Error(
      `${variable} must be a private 10.x IPv4 /24 or /28 network`,
    );
  const first = match
    .slice(1, 5)
    .reduce((total, octet) => total * 256 + Number(octet), 0);
  const size = 2 ** (32 - Number(match[5]));
  return { first, last: first + size - 1 };
}
function overlaps(left, right) {
  return left.first <= right.last && right.first <= left.last;
}
function existingNetworkRange(cidr) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(
    cidr,
  );
  if (!match || match.slice(1, 5).some((part) => Number(part) > 255))
    throw new Error("Could not verify Docker network subnet availability");
  const prefix = Number(match[5]);
  if (prefix > 32)
    throw new Error("Could not verify Docker network subnet availability");
  const first = match
    .slice(1, 5)
    .reduce((total, octet) => total * 256 + Number(octet), 0);
  const size = 2 ** (32 - prefix);
  return { first, last: first + size - 1 };
}
const databaseRange = subnetRange(subnet, "REMEDIATION_SUBNET");
const evidenceRange =
  kind === "browser"
    ? subnetRange(evidenceSubnet, "REMEDIATION_VALIDATOR_SUBNET")
    : undefined;
const bridgeRange =
  kind === "browser"
    ? subnetRange(bridgeSubnet, "REMEDIATION_BRIDGE_SUBNET")
    : undefined;
if (
  evidenceRange &&
  (overlaps(databaseRange, evidenceRange) ||
    overlaps(databaseRange, bridgeRange) ||
    overlaps(evidenceRange, bridgeRange))
)
  throw new Error("Remediation service subnets must not overlap");
function rejectDockerNetworkCollisions() {
  const listed = spawnSync("docker", ["network", "ls", "-q"], {
    encoding: "utf8",
  });
  if (listed.status !== 0)
    throw new Error("Could not verify Docker network subnet availability");
  for (const id of listed.stdout.trim().split(/\s+/).filter(Boolean)) {
    const inspected = spawnSync("docker", ["network", "inspect", id], {
      encoding: "utf8",
    });
    if (inspected.status !== 0)
      throw new Error("Could not verify Docker network subnet availability");
    const [network] = JSON.parse(inspected.stdout);
    for (const existing of network?.IPAM?.Config ?? []) {
      if (!existing.Subnet) continue;
      const existingRange = existingNetworkRange(existing.Subnet);
      if (
        overlaps(databaseRange, existingRange) ||
        (evidenceRange && overlaps(evidenceRange, existingRange)) ||
        (bridgeRange && overlaps(bridgeRange, existingRange))
      )
        throw new Error(
          `Remediation subnets overlap existing Docker network ${network.Name}`,
        );
    }
  }
}
if (!planOnly) rejectDockerNetworkCollisions();
if (!planOnly) {
  for (const requiredPort of kind === "browser" ? [port, 3835] : [port])
    await new Promise((resolve, reject) => {
      const socket = net.createServer();
      socket.once("error", reject);
      socket.listen(requiredPort, "127.0.0.1", () => socket.close(resolve));
    });
}
await mkdir(".local", { recursive: true });
const localDirectory = resolve(".local");
const localInfo = await lstat(localDirectory);
if (!localInfo.isDirectory() || localInfo.isSymbolicLink())
  throw new Error("The local project directory must be a real directory");
const attachmentDir = join(
  await realpath(localDirectory),
  attachmentDirectoryName,
);
const password = randomBytes(24).toString("hex");
const values = {
  DATABASE_URL: `postgresql://${role}:${password}@127.0.0.1:${port}/taky_phase2_test`,
  POSTGRES_DB: "taky_phase2_test",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  TEST_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
  TEST_STAFF_PASSWORD: randomBytes(24).toString("hex"),
  APP_ORIGIN: "http://127.0.0.1:3820",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3820",
  COOKIE_SECURE: "false",
  E2E_RUN_ID: runId,
  E2E_PROOF_SECRET: randomBytes(32).toString("hex"),
  REMEDIATION_PROJECT: project,
  SCREENSHOT_DIR: `evidence/remediation/browser-${runId}/screenshots`,
  ...(kind === "browser"
    ? {
        ATTACHMENT_DIR: attachmentDir,
        EVIDENCE_VALIDATOR_ORIGIN: "http://127.0.0.1:3835",
        EVIDENCE_VALIDATOR_TOKEN: validatorToken,
      }
    : {}),
};
if (kind === "browser") {
  await mkdir(attachmentDir, { mode: 0o700 });
  await chmod(attachmentDir, 0o700);
  const attachmentInfo = await lstat(attachmentDir);
  if (
    !attachmentInfo.isDirectory() ||
    attachmentInfo.isSymbolicLink() ||
    (attachmentInfo.mode & 0o777) !== 0o700 ||
    (process.getuid && attachmentInfo.uid !== process.getuid()) ||
    (await realpath(attachmentDir)) !== attachmentDir
  )
    throw new Error(
      "Could not create a private run-specific evidence directory",
    );
}
await mkdir("evidence/remediation", { recursive: true });
const compose = {
  name: project,
  services: {
    db: {
      image: "postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe",
      environment: {
        POSTGRES_DB: "taky_phase2_test",
        POSTGRES_USER: role,
        POSTGRES_PASSWORD: password,
      },
      ports: [`127.0.0.1:${port}:5432`],
      volumes: ["database:/var/lib/postgresql/data"],
      healthcheck: {
        test: ["CMD-SHELL", `pg_isready -U ${role} -d taky_phase2_test`],
        interval: "1s",
        timeout: "3s",
        retries: 30,
      },
    },
    ...(kind === "browser"
      ? {
          "evidence-validator": {
            build: { context: "../operations/evidence-validator" },
            environment: { EVIDENCE_VALIDATOR_TOKEN: validatorToken },
            networks: ["evidence-validation"],
            mem_limit: "512m",
            memswap_limit: "512m",
            cpus: 1,
            pids_limit: 64,
            read_only: true,
            tmpfs: ["/tmp:size=32m,mode=1777,noexec,nosuid,nodev"],
            cap_drop: ["ALL"],
            security_opt: ["no-new-privileges:true"],
          },
          "validator-host-bridge": {
            image: "node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf",
            user: "1000:1000",
            command: [
              "node",
              "-e",
              "const n=require('node:net');n.createServer(c=>{const u=n.connect(3835,'evidence-validator',()=>c.pipe(u));u.on('error',()=>c.destroy());c.on('error',()=>u.destroy());u.pipe(c)}).listen(3835,'0.0.0.0')",
            ],
            networks: ["evidence-validation", "validator-publish"],
            ports: ["127.0.0.1:3835:3835"],
            mem_limit: "64m",
            memswap_limit: "64m",
            cpus: 0.25,
            pids_limit: 32,
            read_only: true,
            tmpfs: ["/tmp:size=8m,mode=1777,noexec,nosuid,nodev"],
            cap_drop: ["ALL"],
            security_opt: ["no-new-privileges:true"],
          },
        }
      : {}),
  },
  networks: {
    default: {
      ipam: {
        config: [
          {
            subnet,
          },
        ],
      },
    },
    ...(kind === "browser"
      ? {
          "evidence-validation": {
            internal: true,
            ipam: { config: [{ subnet: evidenceSubnet }] },
          },
          "validator-publish": {
            ipam: { config: [{ subnet: bridgeSubnet }] },
            driver_opts: {
              "com.docker.network.bridge.enable_ip_masquerade": "false",
            },
          },
        }
      : {}),
  },
  volumes: { database: {} },
};
await writeFile(
  `.local/remediation-${runId}.env`,
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
const composePath = `.local/remediation-${runId}-compose.json`;
await writeFile(composePath, JSON.stringify(compose), {
  mode: 0o600,
  flag: "wx",
});
await writeFile(
  `evidence/remediation/${kind}-${runId}.json`,
  JSON.stringify(
    {
      project,
      runId,
      role,
      database: "taky_phase2_test",
      host: "127.0.0.1",
      port,
      subnet,
      ...(kind === "browser" ? { evidenceSubnet } : {}),
      ...(kind === "browser" ? { bridgeSubnet } : {}),
      volume: `${project}_database`,
      origin: values.APP_ORIGIN,
      ...(kind === "browser"
        ? {
            evidenceDirectory: attachmentDir,
            validatorOrigin: values.EVIDENCE_VALIDATOR_ORIGIN,
            validatorNetwork: {
              name: "evidence-validation",
              internal: true,
              attachedToDatabaseNetwork: false,
            },
            validatorHostBridge: {
              network: "validator-publish",
              hostBinding: "127.0.0.1:3835",
              outboundMasquerading: false,
              outboundFirewallEnforced: false,
            },
          }
        : {}),
    },
    null,
    2,
  ),
  { flag: "wx" },
);
if (planOnly) {
  console.info(
    JSON.stringify({
      project,
      runId,
      role,
      port,
      subnet,
      ...(kind === "browser" ? { evidenceSubnet } : {}),
      ...(kind === "browser" ? { bridgeSubnet } : {}),
      composePath,
      plannedOnly: true,
    }),
  );
  process.exit(0);
}
const releaseRunLock = await acquireRemediationRunLock(runId, ".", {
  allowSameRun: true,
});
try {
  const result = spawnSync(
    "docker",
    ["compose", "-f", composePath, "up", "-d", "--wait"],
    { encoding: "utf8" },
  );
  await writeFile(
    `evidence/remediation/provision-${runId}.log`,
    `command: docker compose -f ${composePath} up -d --wait\n${result.stdout}${result.stderr}\nexitCode=${result.status}\n`,
  );
  if (result.status !== 0) {
    const cleanup = cleanupFailedRemediationProject(project, composePath);
    await writeFile(
      `evidence/remediation/cleanup-${runId}.log`,
      `command: docker compose -p ${project} -f ${composePath} down --remove-orphans\n${cleanup.stdout}${cleanup.stderr}\nexitCode=${cleanup.status}\n`,
    );
  }
  await publishLegacyEnvironmentOnSuccess(result.status, values);
  console.info(
    JSON.stringify({ project, runId, role, port, exitCode: result.status }),
  );
  process.exitCode = result.status ?? 1;
} finally {
  await releaseRunLock();
}
