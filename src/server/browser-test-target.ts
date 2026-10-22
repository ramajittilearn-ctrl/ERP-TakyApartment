import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const BROWSER_TEST_ORIGIN = "http://127.0.0.1:3820";
type ProxySettings = {
  server: string;
  bypass?: string;
  username?: string;
  password?: string;
};
export function assertBrowserTestOptions(options: {
  baseURL?: string;
  connectOptions?: unknown;
  proxy?: ProxySettings;
  contextOptions: { baseURL?: string; proxy?: ProxySettings };
  launchOptions: { args?: string[] };
}) {
  const approvedProxy = (value: ProxySettings | undefined) =>
    value?.server === "http://127.0.0.1:3822" &&
    !value.bypass &&
    !value.username &&
    !value.password;
  if (
    options.connectOptions !== undefined ||
    options.baseURL !== BROWSER_TEST_ORIGIN ||
    !approvedProxy(options.proxy) ||
    ("baseURL" in options.contextOptions &&
      options.contextOptions.baseURL !== BROWSER_TEST_ORIGIN) ||
    ("proxy" in options.contextOptions &&
      !approvedProxy(options.contextOptions.proxy)) ||
    JSON.stringify(options.launchOptions.args) !==
      JSON.stringify(["--proxy-bypass-list=<-loopback>"])
  )
    throw new Error("Unauthorized effective browser proxy or launch override");
}
export function browserTestTarget(
  env: Record<string, string | undefined> = process.env,
) {
  const runId = z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .parse(env.E2E_RUN_ID);
  const secret = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(env.E2E_PROOF_SECRET);
  const url = new URL(z.string().parse(env.DATABASE_URL));
  if (
    env.PLAYWRIGHT_BASE_URL !== BROWSER_TEST_ORIGIN ||
    env.APP_ORIGIN !== BROWSER_TEST_ORIGIN ||
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55452" ||
    url.pathname !== "/taky_phase2_test" ||
    url.username !== `e2e_${runId}` ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Browser tests require the dedicated origin and fresh database role",
    );
  return {
    origin: BROWSER_TEST_ORIGIN,
    runId,
    secret,
    database: "taky_phase2_test",
    role: url.username,
  };
}

export function assertBrowserDestination(value: string, baseURL: string) {
  if (baseURL !== BROWSER_TEST_ORIGIN)
    throw new Error("Unauthorized effective browser baseURL");
  const url = new URL(value, baseURL);
  if (url.origin !== baseURL || url.username || url.password)
    throw new Error("Unauthorized browser destination");
  return url.href;
}

export const targetIdentitySchema = z.object({
  runId: z.string(),
  database: z.string(),
  role: z.string(),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
});
export function targetProof(
  secret: string,
  nonce: string,
  identity: { runId: string; database: string; role: string },
) {
  return createHmac("sha256", secret)
    .update(JSON.stringify({ nonce, ...identity }))
    .digest("hex");
}
export function verifyTargetProof(
  value: unknown,
  nonce: string,
  target: ReturnType<typeof browserTestTarget>,
) {
  const actual = targetIdentitySchema.parse(value);
  if (
    actual.runId !== target.runId ||
    actual.database !== target.database ||
    actual.role !== target.role
  )
    throw new Error("Connected browser database identity mismatch");
  const expected = targetProof(target.secret, nonce, {
    runId: actual.runId,
    database: actual.database,
    role: actual.role,
  });
  if (
    !timingSafeEqual(
      Buffer.from(actual.proof, "hex"),
      Buffer.from(expected, "hex"),
    )
  )
    throw new Error("Connected browser target proof mismatch");
}
