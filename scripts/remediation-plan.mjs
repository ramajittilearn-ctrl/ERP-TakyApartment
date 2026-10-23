import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "dotenv";
import { z } from "zod";
import pg from "pg";

const origin = "http://127.0.0.1:3820";
const privateHex = (length) =>
  z.string().regex(new RegExp(`^[a-f0-9]{${length}}$`));
const envSchema = z
  .object({
    DATABASE_URL: z.string(),
    POSTGRES_DB: z.literal("taky_phase2_test"),
    SESSION_SECRET: privateHex(64),
    TEST_ADMIN_PASSWORD: privateHex(48),
    TEST_STAFF_PASSWORD: privateHex(48),
    APP_ORIGIN: z.literal(origin),
    PLAYWRIGHT_BASE_URL: z.literal(origin),
    COOKIE_SECURE: z.literal("false"),
    E2E_RUN_ID: privateHex(24),
    E2E_PROOF_SECRET: privateHex(64),
    REMEDIATION_PROJECT: z.string(),
    SCREENSHOT_DIR: z.string(),
  })
  .strict();
const composeSchema = z
  .object({
    name: z.string(),
    services: z
      .object({
        db: z
          .object({
            image: z.literal("postgres:17-bookworm"),
            environment: z
              .object({
                POSTGRES_DB: z.literal("taky_phase2_test"),
                POSTGRES_USER: z.string(),
                POSTGRES_PASSWORD: privateHex(48),
              })
              .strict(),
            ports: z.tuple([z.literal("127.0.0.1:55452:5432")]),
            volumes: z.tuple([z.literal("database:/var/lib/postgresql/data")]),
            healthcheck: z
              .object({
                test: z.tuple([z.literal("CMD-SHELL"), z.string()]),
                interval: z.literal("1s"),
                timeout: z.literal("3s"),
                retries: z.literal(30),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    networks: z
      .object({
        default: z
          .object({
            ipam: z
              .object({
                config: z.tuple([z.object({ subnet: z.string() }).strict()]),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    volumes: z.object({ database: z.object({}).strict() }).strict(),
  })
  .strict();

export async function loadRemediationPlan(runId, directory = ".") {
  if (!/^[a-f0-9]{24}$/.test(runId))
    throw new Error("Invalid isolated plan identity");
  const envPath = join(directory, `.local/remediation-${runId}.env`);
  const composePath = join(
    directory,
    `.local/remediation-${runId}-compose.json`,
  );
  try {
    for (const path of [envPath, composePath]) {
      const info = await stat(path);
      if (!info.isFile() || (info.mode & 0o077) !== 0)
        throw new Error("Private plan required");
    }
    const env = envSchema.parse(parse(await readFile(envPath)));
    const compose = composeSchema.parse(
      JSON.parse(await readFile(composePath, "utf8")),
    );
    const url = new URL(env.DATABASE_URL);
    const role = `e2e_${runId}`;
    const project = `taky-remediation-browser-${runId}`;
    const subnet = compose.networks.default.ipam.config[0].subnet;
    const network = /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(24|28)$/.exec(
      subnet,
    );
    if (
      env.E2E_RUN_ID !== runId ||
      env.REMEDIATION_PROJECT !== project ||
      env.SCREENSHOT_DIR !==
        `evidence/remediation/browser-${runId}/screenshots` ||
      url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "55452" ||
      url.pathname !== "/taky_phase2_test" ||
      url.username !== role ||
      url.search ||
      url.hash ||
      decodeURIComponent(url.password) !==
        compose.services.db.environment.POSTGRES_PASSWORD ||
      compose.name !== project ||
      compose.services.db.environment.POSTGRES_USER !== role ||
      compose.services.db.healthcheck.test[1] !==
        `pg_isready -U ${role} -d taky_phase2_test` ||
      !network ||
      network.slice(1, 4).some((part) => Number(part) > 255) ||
      Number(network[3]) % (network[4] === "24" ? 256 : 16) !== 0
    )
      throw new Error("Plan identity mismatch");
    return {
      runId,
      env,
      composePath,
      role,
      database: "taky_phase2_test",
      project,
    };
  } catch {
    // Do not expose parsed credentials in validation exceptions.
    throw new Error("Missing, unreadable, unsafe or mismatched isolated plan");
  }
}

export async function attestRemediationDatabase(plan) {
  const client = new pg.Client({
    connectionString: plan.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT current_database() AS database, current_user AS role",
    );
    const identity = result.rows[0];
    if (identity?.database !== plan.database || identity.role !== plan.role)
      throw new Error("Isolated database identity mismatch");
    return { database: identity.database, role: identity.role };
  } catch {
    throw new Error(
      "Isolated database identity attestation failed before mutations",
    );
  } finally {
    await client.end();
  }
}
