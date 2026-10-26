import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const runId = process.env.STAGE5_RUN_ID;
assert.match(runId ?? "", /^[a-f0-9]{24}$/);
const expectedDatabase = process.env.STAGE5_DATABASE_NAME;
const expectedRole = process.env.STAGE5_DATABASE_USER;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const identity = await client.query(
    "SELECT current_database() AS name, current_user AS role",
  );
  assert.equal(identity.rows.length, 1);
  assert.equal(identity.rows[0].name, expectedDatabase);
  assert.equal(identity.rows[0].role, expectedRole);

  const migrationDir = join(process.cwd(), "prisma", "migrations");
  const names = (await readdir(migrationDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expected = await Promise.all(
    names.map(async (migration_name) => {
      const sql = await readFile(
        join(migrationDir, migration_name, "migration.sql"),
      );
      return {
        migration_name,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
  const result = await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at, logs
     FROM "_prisma_migrations" ORDER BY migration_name`,
  );
  const succeeded = result.rows
    .filter((row) => row.finished_at && !row.rolled_back_at)
    .map(({ migration_name, checksum }) => ({ migration_name, checksum }))
    .sort((left, right) =>
      left.migration_name.localeCompare(right.migration_name),
    );
  assert.deepEqual(
    succeeded,
    expected,
    "database migration names/checksums must exactly match source and all be successful",
  );
  assert.equal(
    result.rows.filter((row) => row.rolled_back_at || !row.finished_at).length,
    0,
    "migration history contains an incomplete or rolled-back attempt",
  );
  process.stdout.write(
    `${JSON.stringify({ runId, database: expectedDatabase, role: expectedRole, migrations: expected })}\n`,
  );
} finally {
  await client.end();
}
