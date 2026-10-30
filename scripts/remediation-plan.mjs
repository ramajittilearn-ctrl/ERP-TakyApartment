import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
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
    ATTACHMENT_DIR: z.string(),
    EVIDENCE_VALIDATOR_ORIGIN: z.literal("http://127.0.0.1:3835"),
    EVIDENCE_VALIDATOR_TOKEN: privateHex(64),
  })
  .strict();
const composeSchema = z
  .object({
    name: z.string(),
    services: z
      .object({
        db: z
          .object({
            image: z.literal("postgres:17.11-alpine3.24@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"),
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
        "evidence-validator": z
          .object({
            build: z
              .object({
                context: z.literal("../operations/evidence-validator"),
              })
              .strict(),
            environment: z
              .object({ EVIDENCE_VALIDATOR_TOKEN: privateHex(64) })
              .strict(),
            networks: z.tuple([z.literal("evidence-validation")]),
            mem_limit: z.literal("512m"),
            memswap_limit: z.literal("512m"),
            cpus: z.literal(1),
            pids_limit: z.literal(64),
            read_only: z.literal(true),
            tmpfs: z.tuple([
              z.literal("/tmp:size=32m,mode=1777,noexec,nosuid,nodev"),
            ]),
            cap_drop: z.tuple([z.literal("ALL")]),
            security_opt: z.tuple([z.literal("no-new-privileges:true")]),
          })
          .strict(),
        "validator-host-bridge": z
          .object({
            image: z.literal("node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf"),
            user: z.literal("1000:1000"),
            command: z.tuple([
              z.literal("node"),
              z.literal("-e"),
              z.literal(
                "const n=require('node:net');n.createServer(c=>{const u=n.connect(3835,'evidence-validator',()=>c.pipe(u));u.on('error',()=>c.destroy());c.on('error',()=>u.destroy());u.pipe(c)}).listen(3835,'0.0.0.0')",
              ),
            ]),
            networks: z.tuple([
              z.literal("evidence-validation"),
              z.literal("validator-publish"),
            ]),
            ports: z.tuple([z.literal("127.0.0.1:3835:3835")]),
            mem_limit: z.literal("64m"),
            memswap_limit: z.literal("64m"),
            cpus: z.literal(0.25),
            pids_limit: z.literal(32),
            read_only: z.literal(true),
            tmpfs: z.tuple([
              z.literal("/tmp:size=8m,mode=1777,noexec,nosuid,nodev"),
            ]),
            cap_drop: z.tuple([z.literal("ALL")]),
            security_opt: z.tuple([z.literal("no-new-privileges:true")]),
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
        "evidence-validation": z
          .object({
            internal: z.literal(true),
            ipam: z
              .object({
                config: z.tuple([z.object({ subnet: z.string() }).strict()]),
              })
              .strict(),
          })
          .strict(),
        "validator-publish": z
          .object({
            ipam: z
              .object({
                config: z.tuple([z.object({ subnet: z.string() }).strict()]),
              })
              .strict(),
            driver_opts: z
              .object({
                "com.docker.network.bridge.enable_ip_masquerade":
                  z.literal("false"),
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
    const localDirectory = resolve(directory, ".local");
    const localInfo = await lstat(localDirectory);
    if (!localInfo.isDirectory() || localInfo.isSymbolicLink())
      throw new Error("The local project directory must be a real directory");
    const attachmentDir = join(
      await realpath(localDirectory),
      `remediation-evidence-${runId}`,
    );
    const attachmentInfo = await lstat(attachmentDir);
    if (
      !attachmentInfo.isDirectory() ||
      attachmentInfo.isSymbolicLink() ||
      (attachmentInfo.mode & 0o777) !== 0o700 ||
      (process.getuid && attachmentInfo.uid !== process.getuid()) ||
      (await realpath(attachmentDir)) !== attachmentDir
    )
      throw new Error("Private evidence directory required");
    const subnet = compose.networks.default.ipam.config[0].subnet;
    const evidenceSubnet =
      compose.networks["evidence-validation"].ipam.config[0].subnet;
    const bridgeSubnet =
      compose.networks["validator-publish"].ipam.config[0].subnet;
    const network = /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(24|28)$/.exec(
      subnet,
    );
    const evidenceNetwork =
      /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(24|28)$/.exec(evidenceSubnet);
    const bridgeNetwork = /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(24|28)$/.exec(
      bridgeSubnet,
    );
    const range = (match) => {
      if (
        !match ||
        match.slice(1, 4).some((part) => Number(part) > 255) ||
        Number(match[3]) % (match[4] === "24" ? 256 : 16) !== 0
      )
        return undefined;
      const first =
        10 * 256 ** 3 +
        match
          .slice(1, 4)
          .reduce((total, octet) => total * 256 + Number(octet), 0);
      const size = 2 ** (32 - Number(match[4]));
      return { first, last: first + size - 1 };
    };
    const dbRange = range(network);
    const validatorRange = range(evidenceNetwork);
    const bridgeRange = range(bridgeNetwork);
    const subnetOverlap =
      dbRange &&
      validatorRange &&
      bridgeRange &&
      ((dbRange.first <= validatorRange.last &&
        validatorRange.first <= dbRange.last) ||
        (dbRange.first <= bridgeRange.last &&
          bridgeRange.first <= dbRange.last) ||
        (validatorRange.first <= bridgeRange.last &&
          bridgeRange.first <= validatorRange.last));
    if (
      env.E2E_RUN_ID !== runId ||
      env.REMEDIATION_PROJECT !== project ||
      env.SCREENSHOT_DIR !==
        `evidence/remediation/browser-${runId}/screenshots` ||
      env.ATTACHMENT_DIR !== attachmentDir ||
      env.EVIDENCE_VALIDATOR_ORIGIN !== "http://127.0.0.1:3835" ||
      env.EVIDENCE_VALIDATOR_TOKEN !==
        compose.services["evidence-validator"].environment
          .EVIDENCE_VALIDATOR_TOKEN ||
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
      compose.services["evidence-validator"].environment
        .EVIDENCE_VALIDATOR_TOKEN !== env.EVIDENCE_VALIDATOR_TOKEN ||
      compose.services["validator-host-bridge"].ports[0] !==
        "127.0.0.1:3835:3835" ||
      compose.services.db.healthcheck.test[1] !==
        `pg_isready -h 127.0.0.1 -U ${role} -d taky_phase2_test` ||
      !network ||
      !evidenceNetwork ||
      !bridgeNetwork ||
      !dbRange ||
      !validatorRange ||
      !bridgeRange ||
      subnetOverlap
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

export async function attestPlanBeforeCleanupRegistration(
  plan,
  attest,
  registerCleanupPlan,
) {
  registerCleanupPlan(plan);
  return attest(plan);
}
