import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import net from "node:net";

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
const subnet =
  process.env.REMEDIATION_SUBNET ??
  (kind === "browser" ? "10.250.241.0/24" : "10.250.240.0/24");
const subnetMatch = /^(10)\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(24|28)$/.exec(
  subnet,
);
if (
  !subnetMatch ||
  subnetMatch.slice(1, 5).some((part) => Number(part) > 255) ||
  Number(subnetMatch[4]) % (subnetMatch[5] === "24" ? 256 : 16) !== 0
)
  throw new Error(
    "REMEDIATION_SUBNET must be a private 10.x IPv4 /24 or /28 network",
  );
if (!planOnly) {
  await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(port, "127.0.0.1", () => socket.close(resolve));
  });
}
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
};
await mkdir(".local", { recursive: true });
await mkdir("evidence/remediation", { recursive: true });
const compose = {
  name: project,
  services: {
    db: {
      image: "postgres:17-bookworm",
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
      volume: `${project}_database`,
      origin: values.APP_ORIGIN,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
await writeFile(
  ".local/remediation.env",
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
await writeFile(".local/remediation-compose.json", JSON.stringify(compose), {
  mode: 0o600,
});
if (planOnly) {
  console.info(
    JSON.stringify({
      project,
      runId,
      role,
      port,
      subnet,
      composePath,
      plannedOnly: true,
    }),
  );
  process.exit(0);
}
const result = spawnSync(
  "docker",
  ["compose", "-f", composePath, "up", "-d", "--wait"],
  { encoding: "utf8" },
);
await writeFile(
  `evidence/remediation/provision-${runId}.log`,
  `command: docker compose -f ${composePath} up -d --wait\n${result.stdout}${result.stderr}\nexitCode=${result.status}\n`,
);
console.info(
  JSON.stringify({ project, runId, role, port, exitCode: result.status }),
);
process.exitCode = result.status ?? 1;
