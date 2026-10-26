import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import net from "node:net";
import {
  loadRemediationPlan,
  attestRemediationDatabase,
  attestPlanBeforeCleanupRegistration,
} from "./remediation-plan.mjs";
import { browserTargetProxy } from "./browser-target-proxy.mjs";
import { acquireRemediationRunLock } from "./remediation-run-lock.mjs";

const reproduce = process.argv[2] === "--reproduce";
const preparedIndex = process.argv.indexOf("--prepared-run");
const preparedRun =
  preparedIndex === -1 ? undefined : process.argv[preparedIndex + 1];
if (
  preparedIndex !== -1 &&
  (!preparedRun || !/^[a-f0-9]{24}$/.test(preparedRun))
)
  throw new Error("--prepared-run requires a planned isolated run identifier");
if (preparedRun && reproduce)
  throw new Error("Choose prepared-run or reproduce");
const grepIndex = process.argv.indexOf("--grep");
const grep = grepIndex === -1 ? undefined : process.argv[grepIndex + 1];
if (grepIndex !== -1 && (!grep || grep.startsWith("--")))
  throw new Error("--grep requires a test title expression");
const failSetup = process.argv[2] === "--fail-setup";
const billingSetup = process.argv[2] === "--billing-setup";
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
const preparedPlan = preparedRun
  ? await loadRemediationPlan(preparedRun)
  : undefined;
const reproductionEnv = reproduce
  ? parse(await readFile(".local/remediation.env"))
  : undefined;
const runId =
  preparedRun ??
  (reproduce ? reproductionEnv.E2E_RUN_ID : randomBytes(12).toString("hex"));
if (!runId || !/^[a-f0-9]{24}$/.test(runId))
  throw new Error("Missing isolated run identity");
for (const port of [3820, 3822])
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
const evidence = `evidence/remediation/browser-${runId}`;
await mkdir(evidence, { recursive: true });
if (!reproduce)
  await writeFile(
    `${evidence}/attempt-started.json`,
    JSON.stringify({ runId, started: new Date().toISOString() }),
    { flag: "wx" },
  );
const releaseRunLock = await acquireRemediationRunLock(runId);
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
let validatedPlan;
let browserStarted = false;
try {
  if (!reproduce && !preparedRun)
    await run("node", ["scripts/provision-remediation.mjs", "browser", runId]);
  const plan = preparedPlan ?? (await loadRemediationPlan(runId));
  const identity = await attestPlanBeforeCleanupRegistration(
    plan,
    attestRemediationDatabase,
    (validated) => {
      validatedPlan = validated;
    },
  );
  Object.assign(process.env, plan.env);
  await writeFile(
    `${evidence}/database-identity.json`,
    JSON.stringify({ runId, ...identity }),
    { flag: "wx" },
  );
  if (!reproduce) {
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
  else {
    process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = `${evidence}/results.json`;
    process.env.PLAYWRIGHT_HTML_OUTPUT_DIR = `${evidence}/playwright-report`;
    browserStarted = true;
    await logged(
      "browser",
      "npx",
      "playwright",
      "test",
      "--output",
      `${evidence}/test-results`,
      ...(grep
        ? ["--grep", grep]
        : billingSetup
          ? [
              "--grep",
              "ADMIN completes a fictional monthly billing flow in the UI",
            ]
          : process.argv[2] === "--target-check"
            ? [
                "--grep",
                "invoice loading|API contexts|browser rejects|unauthenticated pages|real login",
              ]
            : []),
    );
  }
  succeeded = true;
} finally {
  if (server) {
    server.kill("SIGTERM");
    const exit = await closed;
    for (const [key, value] of Object.entries(process.env))
      if (/PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(key) && value)
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
    await writeFile(
      `${evidence}/execution.json`,
      JSON.stringify({ runId, browserStarted, succeeded }),
      { flag: "wx" },
    );
    if (validatedPlan) {
      await logged(
        "validator",
        "docker",
        "compose",
        "-p",
        validatedPlan.project,
        "-f",
        validatedPlan.composePath,
        "logs",
        "--no-color",
        "evidence-validator",
      );
      await logged(
        "cleanup",
        "docker",
        "compose",
        "-p",
        validatedPlan.project,
        "-f",
        validatedPlan.composePath,
        "down",
        "--remove-orphans",
      );
    }
  }
  console.info(
    JSON.stringify({ runId, succeeded, evidence, volumes: "retained" }),
  );
  await releaseRunLock();
}
