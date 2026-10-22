import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { cp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import net from "node:net";
import { browserTargetProxy } from "./browser-target-proxy.mjs";

const reproduce = process.argv[2] === "--reproduce";
const failSetup = process.argv[2] === "--fail-setup";
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
for (const port of [3820, 3822])
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
if (reproduce)
  config({ path: ".local/remediation.env", override: true, quiet: true });
const runId = reproduce
  ? process.env.E2E_RUN_ID
  : randomBytes(12).toString("hex");
if (!runId || !/^[a-f0-9]{24}$/.test(runId))
  throw new Error("Missing isolated run identity");
const evidence = `evidence/remediation/browser-${runId}`;
const composePath = `.local/remediation-${runId}-compose.json`;
await mkdir(evidence, { recursive: true });
const logged = (label, command, ...args) =>
  run("node", [
    "scripts/remediation-log.mjs",
    `${runId}-${label}`,
    command,
    ...args,
  ]);
let server;
let closed;
let proxy;
let serverOutput = "";
let succeeded = false;
try {
  if (!reproduce) {
    await run("node", ["scripts/provision-remediation.mjs", "browser", runId]);
    config({
      path: `.local/remediation-${runId}.env`,
      override: true,
      quiet: true,
    });
    if (failSetup)
      throw new Error("Injected isolated setup failure before migrations");
    await logged("migrate", "npx", "prisma", "migrate", "deploy");
    await logged("seed", "npm", "run", "db:seed");
    await logged("users", "npx", "tsx", "scripts/test-users.ts");
    proxy = browserTargetProxy("http://127.0.0.1:3820");
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(3822, "127.0.0.1", resolve);
    });
  }
  await cp(".next/static", ".next/standalone/.next/static", {
    recursive: true,
  });
  server = spawn("node", [".next/standalone/server.js"], {
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "3820" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  closed = new Promise((resolve) =>
    server.on("close", (code, signal) => resolve({ code, signal })),
  );
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Standalone server exited before readiness");
    try {
      const response = await fetch("http://127.0.0.1:3820/api/health/", {
        redirect: "error",
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for this process to bind its port. */
    }
    await setTimeout(500);
  }
  if (!ready) throw new Error("Standalone readiness timed out");
  console.info(
    `Standalone server ready on http://127.0.0.1:3820; run ${runId}`,
  );
  if (reproduce)
    await logged(
      `invoice-loading-before-${Date.now()}`,
      "node",
      "scripts/reproduce-invoice-loading.mjs",
    );
  else
    await logged(
      "browser",
      "npx",
      "playwright",
      "test",
      ...(process.argv[2] === "--target-check"
        ? [
            "--grep",
            "invoice loading|API contexts|browser rejects|unauthenticated pages|real login",
          ]
        : []),
    );
  succeeded = true;
} finally {
  if (server) {
    server.kill("SIGTERM");
    const exit = await closed;
    for (const [key, value] of Object.entries(process.env))
      if (/PASSWORD|SECRET|DATABASE_URL/.test(key) && value)
        serverOutput = serverOutput.split(value).join("[REDACTED]");
    await writeFile(
      `${evidence}/standalone-${Date.now()}.log`,
      `command: HOSTNAME=127.0.0.1 PORT=3820 node .next/standalone/server.js\n${serverOutput}\n${JSON.stringify(exit)}\n`,
    );
  }
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
  if (!reproduce) {
    if (server)
      try {
        await writeFile(
          `${evidence}/results.json`,
          await readFile("test-results/results.json"),
        );
      } catch {
        /* Reporter may not have started. */
      }
    let provisioned = false;
    try {
      await access(composePath);
      provisioned = true;
    } catch {
      /* Provisioning failed before creating any resource. */
    }
    if (provisioned)
      await logged("cleanup", "docker", "compose", "-f", composePath, "down");
  }
  console.info(
    JSON.stringify({ runId, succeeded, evidence, volumes: "retained" }),
  );
}
