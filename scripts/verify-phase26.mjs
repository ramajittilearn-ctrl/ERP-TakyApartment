import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

// Dedicated test project only. Never select the normal deployment here.
process.umask(0o077);
const project = "taky-phase26-test";
const directory = path.resolve(".local/phase26");
const base = parse(await fs.readFile(".env.test"));
assert.equal(base.POSTGRES_DB, "taky_phase2_test");
await fs.mkdir(path.join(directory, "rclone"), { recursive: true });
await fs.mkdir(path.join(directory, "backups"), { recursive: true });
async function exclusive(file, content) {
  try {
    await fs.writeFile(file, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
await exclusive(
  path.join(directory, "backup.key"),
  randomBytes(32).toString("base64") + "\n",
);
await exclusive(
  path.join(directory, "operations.env"),
  Object.entries({
    LAN_HOST: "127.0.0.1",
    APP_BIND_IP: "127.0.0.1",
    HTTPS_PORT: "3543",
    BACKUP_DIR: path.join(directory, "backups"),
    BACKUP_KEY_PATH: path.join(directory, "backup.key"),
    RCLONE_CONFIG_DIR: path.join(directory, "rclone"),
    BACKUP_REMOTE: "",
  })
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n",
);
const config = parse(await fs.readFile(path.join(directory, "operations.env")));
assert.equal(config.HTTPS_PORT, "3543");
assert.equal(config.LAN_HOST, "127.0.0.1");
assert.equal(config.BACKUP_DIR, path.join(directory, "backups"));
assert.equal(config.BACKUP_REMOTE, "");
const compose = [
  "compose",
  "--env-file",
  ".env.test",
  "--env-file",
  path.join(directory, "operations.env"),
  "-p",
  project,
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.test.yml",
  "-f",
  "docker-compose.operations.yml",
  "-f",
  "docker-compose.https.yml",
];
function docker(args, composeCommand = true) {
  const result = spawnSync(
    "docker",
    [...(composeCommand ? compose : []), ...args],
    { encoding: "utf8", maxBuffer: 8000000 },
  );
  if (result.status !== 0)
    throw new Error(`Docker check failed: ${result.stderr.slice(-2000)}`);
  return result.stdout.trim();
}
const checks = [];
function pass(name, result) {
  checks.push({ name, status: "PASS", result });
  console.info(`PASS: ${name}`);
}
const sql = (query) =>
  docker([
    "exec",
    "-T",
    "db",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    base.POSTGRES_USER,
    "-d",
    base.POSTGRES_DB,
    "-Atc",
    query,
  ]);
const fingerprint = () =>
  sql(
    `SELECT json_build_object('rooms',(SELECT md5(string_agg(t::text,'' ORDER BY id)) FROM "Room" t),'tenants',(SELECT md5(string_agg(t::text,'' ORDER BY id)) FROM "Tenant" t),'leases',(SELECT md5(string_agg(t::text,'' ORDER BY id)) FROM "Lease" t));`,
  );
const before = fingerprint();
docker(["up", "-d", "--no-build", "--wait"]);
assert.equal(fingerprint(), before);
pass("HTTPS Compose startup preserves room, tenant and lease records", {
  project,
  origin: "https://127.0.0.1:3543",
});
const origin = "https://127.0.0.1:3543";
const ca = docker([
  "exec",
  "-T",
  "caddy",
  "cat",
  "/data/caddy/pki/authorities/local/root.crt",
]);
const agent = new https.Agent({ ca });
async function request(
  url,
  { method = "GET", data, cookie, selectedOrigin = origin } = {},
) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : undefined;
    const req = https.request(
      new URL(url, origin),
      {
        agent,
        method,
        headers: {
          Origin: selectedOrigin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        let content = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          content += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            content,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const login = await request("/api/auth/login/", {
  method: "POST",
  data: { identifier: "test-admin", password: base.TEST_ADMIN_PASSWORD },
});
assert.equal(login.status, 200);
const cookieHeader = login.headers["set-cookie"]?.[0];
assert.match(cookieHeader, /; Secure/i);
assert.match(cookieHeader, /HttpOnly/i);
assert.match(cookieHeader, /SameSite=strict/i);
const cookie = cookieHeader.split(";")[0];
assert.equal((await request("/api/v1/rooms/", { cookie })).status, 200);
assert.equal(
  JSON.parse((await request("/api/v1/rooms/", { cookie })).content).data.length,
  15,
);
assert.equal(
  (
    await request("/api/v1/tenants/", {
      method: "POST",
      data: {},
      cookie,
      selectedOrigin: "http://127.0.0.1:3400",
    })
  ).status,
  403,
);
pass(
  "trusted local CA HTTPS login, secure session and exact-origin rejection",
  "Secure, HttpOnly, SameSite=strict; 15 authenticated rooms; HTTP-origin write rejected",
);
const database = JSON.parse(docker(["inspect", `${project}-db-1`], false))[0];
const app = JSON.parse(docker(["inspect", `${project}-app-1`], false))[0];
assert.deepEqual(database.HostConfig.PortBindings, {});
assert.deepEqual(app.HostConfig.PortBindings, {});
pass(
  "database and application ports remain private behind HTTPS",
  "Only Caddy publishes localhost:3543",
);
const migrations = sql(
  'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name;',
).split("\n");
assert.equal(migrations.length, 5);
assert.ok(migrations.includes("202610170003_occupancy_integrity"));
pass("all five preserved/additive migrations applied", migrations);
const backup = JSON.parse(
  docker([
    "exec",
    "-T",
    "operations",
    "node",
    "operations/cli.mjs",
    "backup",
  ]).split("\n")[0],
);
assert.equal(backup.status, "SUCCEEDED");
assert.ok(backup.verifiedAt);
assert.equal(fingerprint(), before);
pass(
  "Phase 2.5 encrypted backup restores the Phase 2.6 schema and linked records",
  {
    status: backup.status,
    bytes: backup.bytes,
    verifiedAt: backup.verifiedAt,
    checksum: backup.checksum,
  },
);
const evidence = {
  phase: "2.6",
  verifiedAt: new Date().toISOString(),
  checks,
  limitations: [
    "Google Drive OAuth/upload and physical second-device certificate trust were not tested.",
    "Normal deployment and the original demonstration database were not migrated by this test.",
  ],
};
await fs.writeFile(
  "docs/phase-2.6-verification.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
agent.destroy();
