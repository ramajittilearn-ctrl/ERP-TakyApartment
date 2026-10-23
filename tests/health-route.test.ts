import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  target: vi.fn(),
  proof: vi.fn(),
}));
vi.mock("@/server/db", () => ({ db: { $queryRaw: mocks.query } }));
vi.mock("@/server/browser-test-target", () => ({
  browserTestTarget: mocks.target,
  targetProof: mocks.proof,
}));
import { GET } from "../src/app/api/health/route";

const secret = "synthetic-private-message-url-password-nonce";
const request = () =>
  new Request("http://127.0.0.1/api/health/", {
    headers: { "X-Taky-Test-Challenge": "a".repeat(64) },
  });
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("E2E_RUN_ID", "test-run");
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.query.mockResolvedValueOnce([{ value: 1 }]);
  mocks.target.mockReturnValue({
    database: "synthetic",
    role: "synthetic",
    runId: "run",
    secret,
  });
  mocks.proof.mockReturnValue("synthetic-proof");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function expectUnavailable() {
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
}
describe("health failure diagnostics", () => {
  it("keeps production failures generic without logging diagnostics", async () => {
    vi.stubEnv("E2E_RUN_ID", "");
    mocks.query.mockReset().mockRejectedValue(new Error(secret));
    await expectUnavailable();
    expect(log).not.toHaveBeenCalled();
    expect(mocks.target).not.toHaveBeenCalled();
  });
  it("records the failed probe and a safe connection code without exception details", async () => {
    mocks.query
      .mockReset()
      .mockRejectedValue(
        Object.assign(new Error(secret), { code: "ECONNREFUSED" }),
      );
    await expectUnavailable();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: "e2e_health_failed",
        stage: "probe",
        errorClass: "Error",
        code: "ECONNREFUSED",
      }),
    );
    expect(mocks.target).not.toHaveBeenCalled();
  });
  it("records configuration failure without revealing validation messages", async () => {
    mocks.target.mockImplementation(() => {
      throw new Error(secret);
    });
    await expectUnavailable();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: "e2e_health_failed",
        stage: "target-config",
        errorClass: "Error",
      }),
    );
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("records identity query failure with a validated Prisma code", async () => {
    const error = Object.assign(new Error(secret), {
      name: "PrismaClientKnownRequestError",
      code: "P2024",
    });
    mocks.query.mockRejectedValueOnce(error);
    await expectUnavailable();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: "e2e_health_failed",
        stage: "identity",
        errorClass: "PrismaClientKnownRequestError",
        code: "P2024",
      }),
    );
  });
  it("fails closed on an actual identity mismatch", async () => {
    mocks.query.mockResolvedValueOnce([{ database: "wrong", role: "wrong" }]);
    await expectUnavailable();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: "e2e_health_failed",
        stage: "identity",
        errorClass: "Error",
      }),
    );
    expect(mocks.proof).not.toHaveBeenCalled();
  });
  it.each([
    Object.assign(new Error(secret), { name: secret, code: secret }),
    secret,
    null,
  ])(
    "never copies arbitrary thrown names, codes, or values into diagnostics %#",
    async (error) => {
      mocks.query.mockReset().mockRejectedValue(error);
      await expectUnavailable();
      expect(log).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          event: "e2e_health_failed",
          stage: "probe",
          errorClass: "Unknown",
        }),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    },
  );
  it("keeps successful identity proof and cache headers unchanged", async () => {
    mocks.query.mockResolvedValueOnce([
      { database: "synthetic", role: "synthetic" },
    ]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      target: {
        runId: "run",
        database: "synthetic",
        role: "synthetic",
        proof: "synthetic-proof",
      },
    });
    expect(log).not.toHaveBeenCalled();
  });
});
