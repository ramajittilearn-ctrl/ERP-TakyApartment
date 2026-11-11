import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { parse } from "dotenv";

const base = parse(await fs.readFile(".env.test"));
const config = parse(await fs.readFile(".local/test/operations.env"));
assert.equal(base.POSTGRES_DB, "taky_phase2_test");
assert.equal(config.LAN_HOST, "127.0.0.1");
assert.equal(config.HTTPS_PORT, "3443");
const compose = [
  "compose",
  "--env-file",
  ".env.test",
  "--env-file",
  ".local/test/operations.env",
  "-p",
  "taky-phase25-test",
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.test.yml",
  "-f",
  "docker-compose.operations.yml",
  "-f",
  "docker-compose.https.yml",
];
function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync("docker", [...compose, ...args], {
    encoding: "utf8",
    maxBuffer: 8000000,
  });
  if (!allowFailure && result.status !== 0)
    throw new Error(
      `Isolated Docker verification command failed (${result.status}): ${result.stderr.slice(-1500)}`,
    );
  return result;
}
function ops(command, ...args) {
  return docker([
    "exec",
    "-T",
    "operations",
    "node",
    "operations/cli.mjs",
    command,
    ...args,
  ]).stdout.trim();
}
function sourceInventory() {
  return JSON.parse(
    docker([
      "exec",
      "-T",
      "operations",
      "node",
      "--input-type=module",
      "-e",
      "import {inventory} from './operations/database.mjs'; console.log(JSON.stringify(await inventory()));",
    ]).stdout,
  );
}
const evidence = {
  startedAt: new Date().toISOString(),
  project: "taky-phase25-test",
  tests: [],
};
function pass(name, detail) {
  evidence.tests.push({ name, result: "PASS", detail });
  console.info(`PASS: ${name}`);
}
await fs.mkdir(".local/test/certificates", { recursive: true });
docker([
  "cp",
  "caddy:/data/caddy/pki/authorities/local/root.crt",
  ".local/test/certificates/root.crt",
]);
const ca = await fs.readFile(".local/test/certificates/root.crt");
const origin = "https://127.0.0.1:3443";
async function request(
  url,
  { method = "GET", data, cookie, requestOrigin = origin } = {},
) {
  return new Promise((resolve, reject) => {
    const body = data === undefined ? undefined : JSON.stringify(data);
    const req = https.request(
      origin + url,
      {
        ca,
        method,
        headers: {
          Origin: requestOrigin,
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
let marker, tenant, lease, attachmentId;
try {
  assert.equal((await request("/api/health/")).status, 200);
  pass(
    "trusted HTTPS readiness",
    "Certificate chain and 127.0.0.1 name validated using exported public root; validation never disabled",
  );
  docker(["exec", "-T", "app", "node", "node_modules/tsx/dist/cli.mjs", "scripts/test-users.ts"]);
  const login = await request("/api/auth/login/", {
    method: "POST",
    data: { identifier: "test-admin", password: base.TEST_ADMIN_PASSWORD },
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers["set-cookie"][0];
  for (const expected of ["Secure", "HttpOnly", "SameSite=strict"])
    assert.ok(setCookie.includes(expected));
  const cookie = setCookie.split(";")[0];
  assert.equal(
    (await request("/api/v1/rooms/", { cookie })).body.data.length,
    15,
  );
  assert.equal(
    (
      await request("/api/v1/rooms/", {
        method: "POST",
        cookie,
        requestOrigin: "https://wrong.local",
        data: {},
      })
    ).status,
    403,
  );
  pass(
    "HTTPS admin login, Secure/HttpOnly/SameSite cookie and CSRF",
    "Demo credentials used only in separate test database; all 15 rooms returned",
  );
  const staff = await request("/api/auth/login/", {
    method: "POST",
    data: { identifier: "test-staff", password: base.TEST_STAFF_PASSWORD },
  });
  assert.equal(staff.status, 200);
  const staffCookie = staff.headers["set-cookie"][0].split(";")[0];
  assert.equal(
    (
      await request("/api/v1/rooms/", {
        method: "POST",
        cookie: staffCookie,
        data: {},
      })
    ).status,
    403,
  );
  await request("/api/auth/logout/", { method: "POST", cookie: staffCookie });
  assert.equal(
    (await request("/api/v1/rooms/", { cookie: staffCookie })).status,
    401,
  );
  pass(
    "HTTPS staff authorization and logout revocation",
    "Configuration mutation denied; revoked cookie rejected",
  );
  const rooms = (await request("/api/v1/rooms/", { cookie })).body.data;
  const suffix = randomUUID().slice(0, 8);
  const t = await request("/api/v1/tenants/", {
    method: "POST",
    cookie,
    data: {
      name: `Demo recovery ${suffix}`,
      phone: "",
      email: "",
      address: "",
      notes: "Demo before backup",
      isDemo: true,
    },
  });
  assert.equal(t.status, 201);
  tenant = t.body.data;
  const l = await request("/api/v1/leases/", {
    method: "POST",
    cookie,
    data: {
      number: `DEMO-DR-${suffix}`,
      roomId: rooms.find((r) => r.number === "104").id,
      tenantId: tenant.id,
      startDate: "2026-10-01",
      endDate: "2027-09-30",
      rent: "3500.25",
      deposit: "7000.50",
      status: "DRAFT",
      isDemo: true,
    },
  });
  assert.equal(l.status, 201);
  lease = l.body.data;
  marker = `demo-recovery-${randomUUID()}.txt`;
  const content = `Demo private attachment ${suffix}`,
    hash = createHash("sha256").update(content).digest("hex");
  docker([
    "exec",
    "-T",
    "app",
    "node",
    "-e",
    `require('fs').writeFileSync('/app/storage/attachments/${marker}',${JSON.stringify(content)},{flag:'wx',mode:384})`,
  ]);
  attachmentId = randomUUID();
  const attachmentSql = `INSERT INTO "Attachment" (id,"storageKey","originalName","mimeType",bytes,sha256,"uploadedById","tenantId","createdAt","updatedAt") SELECT '${attachmentId}','${marker}','Demo recovery.txt','text/plain',${Buffer.byteLength(content)},'${hash}',id,'${tenant.id}',now(),now() FROM "User" WHERE username='test-admin';`;
  docker([
    "exec",
    "-T",
    "operations",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    attachmentSql,
  ]);
  const beforeBackup = sourceInventory();
  const backup = JSON.parse(ops("backup").split("\n")[0]);
  assert.equal(backup.status, "SUCCEEDED");
  assert.ok(backup.verifiedAt);
  const archive = await fs.readFile(path.join(config.BACKUP_DIR, backup.file));
  assert.equal(
    createHash("sha256").update(archive).digest("hex"),
    backup.checksum,
  );
  assert.equal(archive.includes(Buffer.from(content)), false);
  const backupId = backup.file.match(/[a-f0-9-]{36}(?=\.taky)/)[0];
  const stored = JSON.parse(
    docker([
      "exec",
      "-T",
      "operations",
      "psql",
      "-X",
      "-Atc",
      `SELECT json_build_object('bytes',bytes,'checksum',checksum,'status',status,'verified',"verifiedAt" IS NOT NULL) FROM "BackupHistory" WHERE id='${backupId}';`,
    ]).stdout,
  );
  assert.deepEqual(stored, {
    bytes: backup.bytes,
    checksum: backup.checksum,
    status: "SUCCEEDED",
    verified: true,
  });
  assert.notEqual(
    docker(
      [
        "exec",
        "-T",
        "operations",
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `BEGIN; UPDATE "BackupHistory" SET bytes=-1 WHERE id='${backupId}'; ROLLBACK;`,
      ],
      { allowFailure: true },
    ).status,
    0,
  );
  pass(
    "backup history metadata and database size constraint",
    "Persisted encrypted checksum/size/status/verification time match; negative archive size rejected",
  );
  pass(
    "encrypted consistent backup and automatic isolated PostgreSQL restore",
    {
      file: backup.file,
      checksum: backup.checksum,
      bytes: backup.bytes,
      rooms: beforeBackup.rooms.count,
      tenants: beforeBackup.tenants.count,
      leases: beforeBackup.leases.count,
      attachments: beforeBackup.attachments.length,
    },
  );
  assert.equal((await request("/api/health/")).status, 200);
  assert.deepEqual(sourceInventory(), beforeBackup);
  pass(
    "backup preserves normal application operation",
    "HTTPS readiness and source domain fingerprints unchanged",
  );
  assert.equal(
    docker(
      [
        "exec",
        "-T",
        "--env",
        "BACKUP_KEY_FILE=/run/secrets/missing-test-key",
        "operations",
        "node",
        "operations/cli.mjs",
        "backup",
      ],
      { allowFailure: true },
    ).status,
    1,
  );
  const journal = JSON.parse(ops("status"));
  assert.ok(
    journal.some((r) => r.status === "FAILED" && r.error.startsWith("key:")),
  );
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(path.join(config.BACKUP_DIR, backup.file)))
      .digest("hex"),
    backup.checksum,
  );
  pass(
    "failed backup creation records failure and preserves last known-good archive",
    "Missing key deliberately injected only in isolated worker invocation",
  );
  docker([
    "exec",
    "-T",
    "operations",
    "node",
    "operations/cli.mjs",
    "verify",
    backup.file,
  ]);
  const snapshotBeforeRestore = sourceInventory();
  const drill = spawnSync(
    process.execPath,
    ["scripts/ops.mjs", "restore-test", backup.file, "--test"],
    { encoding: "utf8", maxBuffer: 8000000 },
  );
  if (drill.status !== 0)
    throw new Error(
      `Isolated restore drill failed: ${drill.stderr.slice(-2000)}`,
    );
  assert.deepEqual(sourceInventory(), snapshotBeforeRestore);
  const receipt = JSON.parse(
    await fs.readFile(
      path.join(config.BACKUP_DIR, "receipts", `${backup.file}.docker.json`),
      "utf8",
    ),
  );
  assert.equal(receipt.checksum, backup.checksum);
  assert.deepEqual(receipt.inventory, beforeBackup);
  pass("restore into separate Docker volumes without changing source", {
    rooms: receipt.inventory.rooms.count,
    tenants: receipt.inventory.tenants.count,
    leases: receipt.inventory.leases.count,
    attachments: receipt.attachments,
  });
  docker([
    "exec",
    "-T",
    "--env",
    "BACKUP_REMOTE=missing-test-remote:path",
    "operations",
    "node",
    "operations/cli.mjs",
    "retry",
  ]);
  let record = JSON.parse(
    await fs.readFile(
      path.join(
        config.BACKUP_DIR,
        "records",
        `${backup.file.match(/[a-f0-9-]{36}(?=\.taky)/)[0]}.json`,
      ),
      "utf8",
    ),
  );
  assert.ok(record.uploadError);
  assert.equal(record.uploadedAt, undefined);
  await fs.access(path.join(config.BACKUP_DIR, backup.file));
  pass(
    "failed cloud delivery preserves verified local archive and retry state",
    "Missing remote deliberately injected; local archive unchanged",
  );
  docker([
    "exec",
    "-T",
    "--env",
    "BACKUP_REMOTE=:local:/backups/cloud-test",
    "operations",
    "node",
    "operations/cli.mjs",
    "retry",
  ]);
  record = JSON.parse(
    await fs.readFile(
      path.join(config.BACKUP_DIR, "records", `${record.id}.json`),
      "utf8",
    ),
  );
  assert.ok(record.uploadedAt);
  assert.equal(record.uploadError, undefined);
  assert.equal(
    createHash("sha256")
      .update(
        await fs.readFile(
          path.join(config.BACKUP_DIR, "cloud-test", backup.file),
        ),
      )
      .digest("hex"),
    backup.checksum,
  );
  pass(
    "rclone retry, atomic final name and remote ciphertext verification",
    "Real rclone local backend used; Google Drive authorization/upload NOT RUN",
  );
  const lockReady = path.join(config.BACKUP_DIR, "lock-test.ready");
  const holder = spawn(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "operations",
      "flock",
      "/backups/.job.lock",
      "node",
      "-e",
      "require('fs').writeFileSync('/backups/lock-test.ready','ready');setTimeout(()=>{},3000)",
    ],
    { stdio: "ignore" },
  );
  const held = new Promise((resolve) => holder.once("close", resolve));
  for (let i = 0; i < 30; i++) {
    try {
      await fs.access(lockReady);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await fs.access(lockReady);
  assert.equal(
    docker(
      ["exec", "-T", "operations", "node", "operations/cli.mjs", "backup"],
      { allowFailure: true },
    ).status,
    75,
  );
  await held;
  await fs.unlink(lockReady);
  pass(
    "overlapping backup rejected by kernel lock",
    "Second command exits 75 while the first lock is held",
  );
  const inspect = spawnSync(
    "docker",
    [
      "inspect",
      "taky-phase25-test-db-1",
      "taky-phase25-test-app-1",
      "taky-phase25-test-caddy-1",
    ],
    { encoding: "utf8" },
  );
  assert.equal(inspect.status, 0);
  const containers = JSON.parse(inspect.stdout);
  assert.deepEqual(containers[0].HostConfig.PortBindings || {}, {});
  assert.deepEqual(containers[1].HostConfig.PortBindings || {}, {});
  assert.deepEqual(Object.keys(containers[2].HostConfig.PortBindings), [
    "443/tcp",
  ]);
  assert.equal(
    containers[2].HostConfig.PortBindings["443/tcp"][0].HostIp,
    "127.0.0.1",
  );
  pass(
    "only private HTTPS listener published",
    "App HTTP and PostgreSQL have no host port; test proxy binds loopback",
  );
  const beforeRestart = sourceInventory();
  docker(["restart", "db", "app", "caddy", "operations"]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await request("/api/health/")).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(ready, true);
  assert.deepEqual(sourceInventory(), beforeRestart);
  assert.equal(
    (await request("/api/v1/rooms/", { cookie })).body.data.length,
    15,
  );
  assert.equal(
    docker([
      "exec",
      "-T",
      "app",
      "node",
      "-e",
      `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/storage/attachments/${marker}')).digest('hex'))`,
    ]).stdout.trim(),
    hash,
  );
  pass(
    "HTTPS/database/session/attachments survive container restarts",
    "Certificate trust, pre-restart session and exact domain data hashes retained",
  );
  docker([
    "exec",
    "-T",
    "operations",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `DELETE FROM "Attachment" WHERE id='${attachmentId}' AND "tenantId"='${tenant.id}';`,
  ]);
  docker([
    "exec",
    "-T",
    "app",
    "node",
    "-e",
    `require('fs').unlinkSync('/app/storage/attachments/${marker}')`,
  ]);
  marker = null;
  assert.equal(
    (await request(`/api/v1/leases/${lease.id}/`, { method: "DELETE", cookie }))
      .status,
    200,
  );
  lease = null;
  assert.equal(
    (
      await request(`/api/v1/tenants/${tenant.id}/`, {
        method: "DELETE",
        cookie,
      })
    ).status,
    200,
  );
  tenant = null;
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  evidence.error = error.message;
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(
    ".local/test/verification.json",
    JSON.stringify(evidence, null, 2) + "\n",
    { mode: 0o600 },
  );
}
