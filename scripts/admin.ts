import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createUser } from "../src/server/auth";
import { db } from "../src/server/db";

async function main() {
  if (!process.stdin.isTTY)
    throw new Error(
      "Use an interactive terminal: docker compose exec app npm run admin:setup",
    );
  if (await db.user.count())
    throw new Error(
      "First-run setup is already complete. Use the authenticated ADMIN users API for additional accounts.",
    );
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    const username = await prompt.question("Username: ");
    const email = await prompt.question("Email: ");
    const name = await prompt.question("Display name: ");
    process.stdout.write("Password (12–128 characters, hidden): ");
    muted = true;
    const password = await prompt.question("");
    muted = false;
    process.stdout.write("\nConfirm password (hidden): ");
    muted = true;
    const confirmation = await prompt.question("");
    muted = false;
    process.stdout.write("\n");
    if (password !== confirmation) throw new Error("Passwords do not match");
    await createUser({ username, email, name, password, role: "ADMIN" }, true);
    console.info(
      "Administrator created. Sign in using the configured APP_ORIGIN.",
    );
  } finally {
    muted = false;
    prompt.close();
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Setup failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
