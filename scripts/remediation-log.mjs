import { spawn } from "node:child_process";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: ".local/remediation.env", quiet: true });
const [label, command, ...args] = process.argv.slice(2);
if (!label || !/^[a-z0-9-]+$/.test(label) || !command)
  throw new Error(
    "Usage: node scripts/remediation-log.mjs label command [args]",
  );
const directory = resolve("evidence/remediation");
await mkdir(directory, { recursive: true });
const secrets = Object.entries(process.env)
  .filter(([key, value]) => /PASSWORD|SECRET|DATABASE_URL/.test(key) && value)
  .map(([, value]) => value);
const redact = (value) => {
  let result = value;
  for (const secret of secrets)
    result = result.split(secret).join("[REDACTED]");
  return result.replace(/postgresql:\/\/[^\s"']+/g, "postgresql://[REDACTED]");
};
const started = new Date().toISOString();
const file = resolve(directory, `${label}.log`);
const header = {
  started,
  command: redact([command, ...args].join(" ")),
  runId: process.env.E2E_RUN_ID ?? "integration/static",
  app: process.env.APP_ORIGIN ?? "unset",
  database: process.env.DATABASE_URL
    ? ((url) => ({
        host: url.hostname,
        port: url.port,
        name: url.pathname,
        role: url.username,
      }))(new URL(process.env.DATABASE_URL))
    : "unset",
};
const child = spawn(command, args, {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});
child.on("error", (error) => {
  output += error.message;
});
const code = await new Promise((done) =>
  child.on("close", (exitCode) => done(exitCode ?? 1)),
);
const finished = new Date().toISOString();
await writeFile(
  file,
  `${JSON.stringify(header)}\n${redact(output)}\n${JSON.stringify({ finished, exitCode: code })}\n`,
);
await appendFile(
  resolve(directory, "commands.jsonl"),
  `${JSON.stringify({ ...header, finished, exitCode: code, log: `${label}.log` })}\n`,
);
process.stdout.write(redact(output));
process.stdout.write(`\nEvidence: ${file}; exit ${code}\n`);
process.exitCode = code;
