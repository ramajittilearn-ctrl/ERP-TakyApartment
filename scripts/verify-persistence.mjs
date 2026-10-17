import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.test", quiet: true });
if (!process.env.DATABASE_URL?.endsWith("/taky_phase2_test")) throw new Error("Isolated test database required");
const compose = ["compose", "--env-file", ".env.test", "-p", "taky-phase2-test", "-f", "docker-compose.yml", "-f", "docker-compose.test.yml"];
function run(args) { return execFileSync("docker", [...compose, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
const query = 'SELECT (SELECT count(*) FROM "Room"), (SELECT count(*) FROM "User"), (SELECT md5(string_agg(t::text,\'\' ORDER BY id)) FROM "Room" t), (SELECT md5(string_agg(t::text,\'\' ORDER BY id)) FROM "Tenant" t), (SELECT md5(string_agg(t::text,\'\' ORDER BY id)) FROM "Lease" t);';
const snapshot = () => run(["exec", "-T", "db", "psql", "-U", "taky", "-d", "taky_phase2_test", "-Atc", query]);
const before = snapshot();
const origin = "http://127.0.0.1:3300";
const login = await fetch(`${origin}/api/auth/login/`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "test-admin", password: process.env.TEST_ADMIN_PASSWORD }) });
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
const marker = randomUUID();
const path = `/app/storage/attachments/persistence-test-${marker}.txt`;
run(["exec", "-T", "app", "node", "-e", `require('node:fs').writeFileSync(${JSON.stringify(path)},${JSON.stringify(marker)},{flag:'wx'})`]);
run(["restart", "db", "app"]);
let healthy = false;
for (let i = 0; i < 45; i++) {
  try { if ((await fetch(`${origin}/api/health/`)).ok) { healthy = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(healthy, "App must recover after container restart");
assert.equal(snapshot(), before, "Database records must survive unchanged");
assert.equal(run(["exec", "-T", "app", "node", "-e", `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(path)},'utf8'))`]), marker);
const rooms = await fetch(`${origin}/api/v1/rooms/`, { headers: { Cookie: cookie } });
assert.equal(rooms.status, 200, "Session must survive restart");
assert.equal((await rooms.json()).data.length, 15);
run(["exec", "-T", "app", "node", "-e", `require('node:fs').unlinkSync(${JSON.stringify(path)})`]);
console.info("PASS: database records, 15 rooms, authenticated session and private attachment volume survive container restarts. Test marker removed.");
