import { createUser } from "../../src/server/auth";
import { db } from "../../src/server/db";

async function main() {
  const runId = process.env.STAGE5_RUN_ID;
  const expectedDatabase = process.env.STAGE5_DATABASE_NAME;
  const expectedRole = process.env.STAGE5_DATABASE_USER;
  const adminPassword = process.env.TEST_ADMIN_PASSWORD;
  const staffPassword = process.env.TEST_STAFF_PASSWORD;
  if (
    !runId ||
    !/^[a-f0-9]{24}$/.test(runId) ||
    !expectedDatabase ||
    !expectedRole ||
    !adminPassword ||
    !staffPassword
  )
    throw new Error(
      "Stage 5 synthetic user bootstrap configuration is invalid",
    );

  const identity = await db.$queryRawUnsafe<{ name: string; role: string }[]>(
    "SELECT current_database() AS name, current_user AS role",
  );
  if (
    !Array.isArray(identity) ||
    identity.length !== 1 ||
    identity[0].name !== expectedDatabase ||
    identity[0].role !== expectedRole
  )
    throw new Error("Stage 5 bootstrap refused unexpected database identity");
  if ((await db.user.count()) !== 0)
    throw new Error("Stage 5 bootstrap requires a fresh empty database");

  const suffix = runId.slice(0, 8);
  const admin = await createUser(
    {
      username: `stage5-admin-${suffix}`,
      email: `stage5-admin-${suffix}@example.invalid`,
      name: "Synthetic Stage 5 Administrator",
      password: adminPassword,
      role: "ADMIN",
    },
    true,
  );
  const staff = await createUser(
    {
      username: `stage5-staff-${suffix}`,
      email: `stage5-staff-${suffix}@example.invalid`,
      name: "Synthetic Stage 5 Staff",
      password: staffPassword,
      role: "STAFF",
    },
    false,
    admin,
  );

  process.stdout.write(
    `${JSON.stringify({ runId, database: expectedDatabase, role: expectedRole, admin: admin.username, staff: staff.username })}\n`,
  );
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Synthetic bootstrap failed",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
