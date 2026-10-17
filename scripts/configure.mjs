import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const password = randomBytes(32).toString("hex");
const secret = randomBytes(32).toString("hex");
const target = process.argv[2] || ".env";
const test = target === ".env.test";
const database = test ? "taky_phase2_test" : "taky";
const port = test ? 3300 : 3000;
const content = `POSTGRES_DB=${database}\nPOSTGRES_USER=taky\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://taky:${password}@db:5432/${database}\nSESSION_SECRET=${secret}\nAPP_ORIGIN=http://127.0.0.1:${port}\nAPP_BIND_IP=127.0.0.1\nAPP_PORT=${port}\nCOOKIE_SECURE=false\nATTACHMENT_DIR=/app/storage/attachments\n${test ? `TEST_ADMIN_PASSWORD=${randomBytes(24).toString("hex")}\nTEST_STAFF_PASSWORD=${randomBytes(24).toString("hex")}\n` : ""}`;
try { writeFileSync(target, content, { flag: "wx", mode: 0o600 }); console.info(`Created ${target} with private random secrets. Existing files are never replaced.`); }
catch (error) { console.error(error.code === "EEXIST" ? "Configuration already exists; preserved unchanged." : "Could not create configuration."); process.exitCode = 1; }
