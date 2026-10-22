import { db } from "../src/server/db";
import { createUser } from "../src/server/auth";
async function main() {
  if (!process.env.DATABASE_URL?.endsWith("/taky_phase2_test"))
    throw new Error("Refusing test fixtures outside dedicated test database");
  const admin =
    (await db.user.findUnique({ where: { username: "test-admin" } })) ??
    (await createUser(
      {
        username: "test-admin",
        email: "admin@example.invalid",
        name: "ผู้ดูแลทดสอบ Demo",
        password: process.env.TEST_ADMIN_PASSWORD,
        role: "ADMIN",
      },
      true,
    ));
  if (!(await db.user.findUnique({ where: { username: "test-staff" } })))
    await createUser(
      {
        username: "test-staff",
        email: "staff@example.invalid",
        name: "เจ้าหน้าที่ทดสอบ Demo",
        password: process.env.TEST_STAFF_PASSWORD,
        role: "STAFF",
      },
      false,
      admin,
    );
  console.info("Isolated test accounts ready; no production records changed.");
}
main()
  .catch(() => {
    console.error("Test account setup failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
