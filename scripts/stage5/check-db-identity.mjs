import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const runId = process.env.STAGE5_RUN_ID;
const expectedDatabase = process.env.STAGE5_DATABASE_NAME;
const expectedRole = process.env.STAGE5_DATABASE_USER;
assert.match(runId ?? "", /^[a-f0-9]{24}$/);
assert.ok(expectedDatabase && expectedRole);
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const identity = await client.query(
    `SELECT current_database() AS name, current_user AS role,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS table_count`,
  );
  assert.equal(identity.rows.length, 1);
  assert.equal(identity.rows[0].name, expectedDatabase);
  assert.equal(identity.rows[0].role, expectedRole);
  assert.equal(identity.rows[0].table_count, 0);
  process.stdout.write(
    `${JSON.stringify({ runId, database: expectedDatabase, role: expectedRole, fresh: true })}\n`,
  );
} finally {
  await client.end();
}
