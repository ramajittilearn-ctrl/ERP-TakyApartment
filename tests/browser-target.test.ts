import { describe, expect, it } from "vitest";
import {
  browserTestTarget,
  assertBrowserDestination,
  assertBrowserTestOptions,
  targetProof,
  verifyTargetProof,
} from "../src/server/browser-test-target";

const runId = "a".repeat(24);
const env = {
  E2E_RUN_ID: runId,
  E2E_PROOF_SECRET: "b".repeat(64),
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3820",
  APP_ORIGIN: "http://127.0.0.1:3820",
  DATABASE_URL: `postgresql://e2e_${runId}:synthetic@127.0.0.1:55452/taky_phase2_test`,
};
describe("browser target safety", () => {
  it("accepts only the dedicated target and relative same-origin destinations", () => {
    const target = browserTestTarget(env);
    expect(assertBrowserDestination("/billing/", target.origin)).toBe(
      `${target.origin}/billing/`,
    );
  });
  for (const [key, value] of [
    ["PLAYWRIGHT_BASE_URL", undefined],
    ["PLAYWRIGHT_BASE_URL", "http://127.0.0.1:3700"],
    ["PLAYWRIGHT_BASE_URL", "http://localhost:3820"],
    ["PLAYWRIGHT_BASE_URL", "https://production.invalid"],
    ["APP_ORIGIN", "http://127.0.0.1:3300"],
    ["DATABASE_URL", env.DATABASE_URL.replace(":55452", ":55451")],
    ["DATABASE_URL", env.DATABASE_URL.replace("127.0.0.1", "localhost")],
    ["DATABASE_URL", env.DATABASE_URL.replace("taky_phase2_test", "owner_uat")],
    ["DATABASE_URL", env.DATABASE_URL.replace(`e2e_${runId}`, "owner")],
    ["DATABASE_URL", `${env.DATABASE_URL}?options=override`],
    ["E2E_PROOF_SECRET", undefined],
    ["E2E_RUN_ID", "ambiguous"],
  ])
    it(`rejects unauthorized or missing ${key}=${value?.includes("postgresql") ? "invalid database" : value}`, () => {
      expect(() => browserTestTarget({ ...env, [key!]: value })).toThrow();
    });
  it("rejects effective project overrides and off-origin redirect destinations", () => {
    for (const value of [
      "http://127.0.0.1:3700/",
      "//production.invalid/",
      "http://user:pass@127.0.0.1:3820/",
    ])
      expect(() => assertBrowserDestination(value, env.APP_ORIGIN)).toThrow();
    expect(() =>
      assertBrowserDestination("/", "http://127.0.0.1:3700"),
    ).toThrow();
  });
  it("requires a nonce-bound proof of the actual database and current role", () => {
    const target = browserTestTarget(env);
    const identity = { runId, database: target.database, role: target.role };
    const proof = targetProof(target.secret, "nonce", identity);
    expect(() =>
      verifyTargetProof({ ...identity, proof }, "nonce", target),
    ).not.toThrow();
    expect(() =>
      verifyTargetProof({ ...identity, proof }, "replay", target),
    ).toThrow();
    expect(() =>
      verifyTargetProof({ ...identity, role: "owner", proof }, "nonce", target),
    ).toThrow();
    expect(() =>
      verifyTargetProof(
        { ...identity, proof: "0".repeat(64) },
        "nonce",
        target,
      ),
    ).toThrow();
    expect(() =>
      verifyTargetProof({ status: "ok" }, "nonce", target),
    ).toThrow();
  });
});

const approvedOptions = {
  baseURL: "http://127.0.0.1:3820",
  proxy: { server: "http://127.0.0.1:3822" },
  contextOptions: {},
  launchOptions: { args: ["--proxy-bypass-list=<-loopback>"] },
};
it("rejects effective options that remove or bypass the isolation proxy", () => {
  expect(() => assertBrowserTestOptions(approvedOptions)).not.toThrow();
  for (const contextOptions of [
    { proxy: undefined },
    { proxy: { server: "http://127.0.0.1:3822", bypass: "*" } },
    { proxy: { server: "http://127.0.0.1:9999" } },
    { baseURL: undefined },
    { baseURL: "http://127.0.0.1:3700" },
  ])
    expect(() =>
      assertBrowserTestOptions({ ...approvedOptions, contextOptions }),
    ).toThrow();
  expect(() =>
    assertBrowserTestOptions({ ...approvedOptions, proxy: undefined }),
  ).toThrow();
  expect(() =>
    assertBrowserTestOptions({
      ...approvedOptions,
      launchOptions: { args: ["--no-proxy-server"] },
    }),
  ).toThrow();
});

it("rejects remote browser connections that would reinterpret loopback on another host", () => {
  expect(() =>
    assertBrowserTestOptions({
      ...approvedOptions,
      connectOptions: { wsEndpoint: "ws://remote.invalid" },
    }),
  ).toThrow();
});
