import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  cleanup: vi.fn(),
  query: vi.fn(),
  user: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  verify: vi.fn(),
  cookie: vi.fn(),
}));

vi.mock("../src/server/db", () => ({
  db: {
    loginThrottle: { deleteMany: boundary.cleanup },
    $queryRaw: boundary.query,
    user: { findFirst: boundary.user },
    auditLog: { create: boundary.audit },
    $transaction: boundary.transaction,
  },
}));
vi.mock("argon2", () => ({
  default: {
    argon2id: 2,
    hash: vi.fn().mockResolvedValue("synthetic-dummy-hash"),
    verify: boundary.verify,
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: boundary.cookie }),
}));
vi.mock("@/server/auth", async () => import("../src/server/auth"));
vi.mock("@/server/http", async () => import("../src/server/http"));

import { POST } from "../src/app/api/auth/login/route";

const identifier = "synthetic-owner";
const password = "synthetic-password-never-real";
const origin = "http://auth-regression.invalid";
const internalError = {
  error: {
    code: "INTERNAL",
    message: "ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง",
  },
};

function request(headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/auth/login`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ identifier, password }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(
    "SESSION_SECRET",
    "synthetic-test-only-secret-at-least-32-characters",
  );
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("COOKIE_SECURE", "true");
  boundary.cleanup.mockResolvedValue({ count: 0 });
  boundary.query.mockResolvedValue([{ attempts: 1 }]);
  boundary.user.mockResolvedValue({
    id: "synthetic-user-id",
    passwordHash: "synthetic-user-hash",
    disabled: false,
  });
  boundary.verify.mockResolvedValue(true);
  boundary.audit.mockResolvedValue({ id: "synthetic-audit-id" });
  boundary.transaction.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("login request security boundaries", () => {
  it.each([
    ["https://auth-regression.invalid", "false", true],
    ["HTTPS://auth-regression.invalid", "false", true],
    ["https://auth-regression.invalid", undefined, true],
    ["HTTPS://auth-regression.invalid", undefined, true],
    ["https://auth-regression.invalid", "ture", true],
    ["HTTPS://auth-regression.invalid", "ture", true],
    ["http://127.0.0.1:3999", "false", false],
    ["http://127.0.0.1:3999", undefined, false],
    ["http://127.0.0.1:3999", "true", true],
    ["https://auth-regression.invalid", "true", true],
  ])(
    "uses APP_ORIGIN=%s and COOKIE_SECURE=%s to set secure=%s",
    async (appOrigin, flag, secure) => {
      vi.stubEnv("APP_ORIGIN", appOrigin);
      vi.stubEnv("COOKIE_SECURE", flag);
      const response = await POST(
        request({
          origin: new URL(appOrigin).origin,
          forwarded: "proto=http;host=forged.invalid",
          "x-forwarded-proto": "http",
        }),
      );
      expect(response.status).toBe(200);
      expect(boundary.cookie).toHaveBeenCalledWith(
        "taky_session",
        expect.stringMatching(/^[a-f0-9]{64}$/),
        expect.objectContaining({ secure }),
      );
    },
  );

  it("ignores forged HTTPS forwarding headers for configured HTTP development", async () => {
    vi.stubEnv("COOKIE_SECURE", "false");
    const response = await POST(
      request({
        forwarded: "proto=https;host=forged.invalid",
        "x-forwarded-proto": "https",
      }),
    );
    expect(response.status).toBe(200);
    expect(boundary.cookie).toHaveBeenCalledWith(
      "taky_session",
      expect.any(String),
      expect.objectContaining({ secure: false }),
    );
  });

  it.each([null, "https://forged.invalid"])(
    "rejects an invalid origin %s before creating a session or cookie",
    async (callerOrigin) => {
      vi.stubEnv("APP_ORIGIN", "https://auth-regression.invalid");
      const invalidRequest = request();
      if (callerOrigin === null) invalidRequest.headers.delete("origin");
      else invalidRequest.headers.set("origin", callerOrigin);
      const response = await POST(invalidRequest);
      expect(response.status).toBe(403);
      expect(boundary.query).not.toHaveBeenCalled();
      expect(boundary.transaction).not.toHaveBeenCalled();
      expect(boundary.cookie).not.toHaveBeenCalled();
    },
  );

  it("returns success and sets a protected session cookie after storage succeeds", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { authenticated: true } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(boundary.cookie.mock.calls).toEqual([
      [
        "taky_session",
        expect.stringMatching(/^[a-f0-9]{64}$/),
        {
          httpOnly: true,
          sameSite: "strict",
          secure: true,
          path: "/",
          maxAge: 28800,
        },
      ],
    ]);
  });

  it("keeps the same identifier bucket while callers rotate forged forwarding headers", async () => {
    const counts = new Map<unknown, number>();
    boundary.query.mockImplementation(
      async (_sql: TemplateStringsArray, key: unknown) => {
        const attempts = (counts.get(key) ?? 0) + 1;
        counts.set(key, attempts);
        return [{ attempts }];
      },
    );
    boundary.verify.mockResolvedValue(false);
    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = await POST(
        request({
          forwarded: `for=192.0.2.${attempt};proto=https;host=forged.invalid`,
          "x-forwarded-for": `198.51.100.${attempt}, 127.0.0.1`,
          "x-real-ip": `203.0.113.${attempt}`,
        }),
      );
      expect(response.status).toBe(attempt <= 5 ? 401 : 429);
      expect(await response.json()).toEqual({
        error:
          attempt <= 5
            ? {
                code: "INVALID_CREDENTIALS",
                message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
              }
            : {
                code: "RATE_LIMITED",
                message: "ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที",
              },
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(boundary.cookie.mock.calls).toEqual([]);
    expect(boundary.user).toHaveBeenCalledTimes(5);
    expect(boundary.verify).toHaveBeenCalledTimes(5);
  });

  it.each(["cleanup", "query"] satisfies ("cleanup" | "query")[])(
    "fails closed before credential verification when throttle %s storage fails",
    async (stage) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      boundary[stage].mockRejectedValue(
        new Error(`synthetic-private-db-url ${password} ${identifier}`),
      );
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual(internalError);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(boundary.user.mock.calls).toEqual([]);
      expect(boundary.verify.mock.calls).toEqual([]);
      expect(boundary.transaction.mock.calls).toEqual([]);
      expect(boundary.cookie.mock.calls).toEqual([]);
      expect(log.mock.calls).toEqual([
        ['{"event":"request_failed","type":"Error"}'],
      ]);
    },
  );

  it("returns a generic error and no cookie when session transaction fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    boundary.transaction.mockRejectedValue(
      new Error(`synthetic-session-token ${password} ${identifier}`),
    );
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(internalError);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(boundary.cookie.mock.calls).toEqual([]);
    expect(boundary.verify.mock.calls).toEqual([
      ["synthetic-user-hash", password],
    ]);
    expect(log.mock.calls).toEqual([
      ['{"event":"request_failed","type":"Error"}'],
    ]);
  });
});
