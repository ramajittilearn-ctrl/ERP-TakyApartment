import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../src/server/errors";

const boundary = vi.hoisted(() => ({
  actor: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  reverse: vi.fn(),
  receipt: vi.fn(),
  balances: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "synthetic-token" }) }),
}));
vi.mock("../src/server/auth", () => ({
  COOKIE: "taky_session",
  sessionActor: boundary.actor,
}));
vi.mock("@/server/http", async () => import("../src/server/http"));
vi.mock(
  "@/server/payments/query",
  async () => import("../src/server/payments/query"),
);
vi.mock("@/server/payments", async () => ({
  ...(await import("../src/server/payments/contracts")),
  createPayment: boundary.create,
  listPayments: boundary.list,
  getPayment: boundary.get,
  confirmPayment: boundary.confirm,
  cancelPendingPayment: boundary.cancel,
  reversePayment: boundary.reverse,
  getReceipt: boundary.receipt,
  listOutstandingBalances: boundary.balances,
}));
import { GET as list, POST as create } from "../src/app/api/v1/payments/route";
import { GET as detail } from "../src/app/api/v1/payments/[id]/route";
import { POST as confirm } from "../src/app/api/v1/payments/[id]/confirm/route";
import { POST as cancel } from "../src/app/api/v1/payments/[id]/cancel/route";
import { POST as reverse } from "../src/app/api/v1/payments/[id]/reverse/route";
import { GET as receipt } from "../src/app/api/v1/receipts/[id]/route";
import { GET as balances } from "../src/app/api/v1/outstanding-balances/route";
import {
  parseBalanceListQuery,
  parsePaymentListQuery,
} from "../src/server/payments/query";

const origin = "http://payment-route.invalid";
const id = "bd9a39ad-09b6-4fd1-8582-018eeb187733";
const invoiceId = "3c11e7d7-7aba-4dfd-a846-7002d3b634bf";
const actor = { id, role: "ADMIN", name: "Synthetic", username: "synthetic" };
const ctx = (value = id) => ({ params: Promise.resolve({ id: value }) });
const createBody = {
  leaseId: id.toUpperCase(),
  amount: "12.34",
  method: "CASH",
  receivedAt: "2026-10-23T12:00:00+07:00",
  commandKey: "CaseSensitive-Key",
};
const confirmBody = {
  expectedVersion: 1,
  commandKey: "CaseSensitive-Key",
  allocations: [{ invoiceId, expectedVersion: 2, amount: "12.34" }],
};
const reasonBody = {
  expectedVersion: 1,
  commandKey: "CaseSensitive-Key",
  reason: "Documented reason",
};
function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/v1/payments`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const mutations = [
  {
    name: "create",
    run: (request: Request) => create(request),
    body: createBody,
    mock: boundary.create,
  },
  {
    name: "confirm",
    run: (request: Request) => confirm(request, ctx()),
    body: confirmBody,
    mock: boundary.confirm,
  },
  {
    name: "cancel",
    run: (request: Request) => cancel(request, ctx()),
    body: reasonBody,
    mock: boundary.cancel,
  },
  {
    name: "reverse",
    run: (request: Request) => reverse(request, ctx()),
    body: reasonBody,
    mock: boundary.reverse,
  },
];
const reads = [
  {
    name: "list",
    run: () => list(new Request(`${origin}/api/v1/payments`)),
    mock: boundary.list,
    input: { offset: 0, limit: 50 },
  },
  {
    name: "detail",
    run: () => detail(new Request(origin), ctx()),
    mock: boundary.get,
    input: id,
  },
  {
    name: "receipt",
    run: () => receipt(new Request(origin), ctx()),
    mock: boundary.receipt,
    input: id,
  },
  {
    name: "balances",
    run: () => balances(new Request(`${origin}/api/v1/outstanding-balances`)),
    mock: boundary.balances,
    input: { offset: 0, limit: 50 },
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", origin);
  boundary.actor.mockResolvedValue(actor);
  for (const op of [...mutations, ...reads])
    op.mock.mockResolvedValue({ synthetic: op.name });
});

async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ error: { code } });
}
describe("payment HTTP boundaries", () => {
  it.each(mutations)(
    "adapts $name with authenticated actor and exact input",
    async (op) => {
      const response = await op.run(req(op.body));
      expect(response.status).toBe(op.name === "create" ? 201 : 200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ data: { synthetic: op.name } });
      expect(op.mock).toHaveBeenCalledExactlyOnceWith(
        actor,
        op.name === "create"
          ? { ...op.body, leaseId: id }
          : { ...op.body, paymentId: id },
      );
    },
  );
  it.each(reads)("adapts $name read with no-store and actor", async (op) => {
    const response = await op.run();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { synthetic: op.name } });
    expect(op.mock).toHaveBeenCalledExactlyOnceWith(actor, op.input);
  });
  it.each(mutations)(
    "rejects $name missing or foreign Origin before service",
    async (op) => {
      for (const value of ["", "https://foreign.invalid"]) {
        await error(
          await op.run(req(op.body, { origin: value })),
          403,
          "ORIGIN",
        );
      }
      expect(op.mock).not.toHaveBeenCalled();
      expect(boundary.actor).not.toHaveBeenCalled();
    },
  );
  it.each(mutations)("rejects unauthenticated $name mutation", async (op) => {
    boundary.actor.mockResolvedValue(null);
    await error(await op.run(req(op.body)), 401, "UNAUTHENTICATED");
    expect(op.mock).not.toHaveBeenCalled();
  });
  it.each(reads)("rejects unauthenticated $name read", async (op) => {
    boundary.actor.mockResolvedValue(null);
    await error(await op.run(), 401, "UNAUTHENTICATED");
    expect(op.mock).not.toHaveBeenCalled();
  });
  it.each(mutations)(
    "rejects $name unknown fields and missing commandKey",
    async (op) => {
      await error(
        await op.run(req({ ...op.body, actorId: id })),
        422,
        "VALIDATION",
      );
      const { commandKey: _key, ...body } = op.body;
      await error(
        await op.run(req(body, { "idempotency-key": "HeaderKey-Only" })),
        422,
        "VALIDATION",
      );
      expect(op.mock).not.toHaveBeenCalled();
    },
  );
  it.each(mutations)("enforces $name JSON boundaries", async (op) => {
    await error(
      await op.run(req(op.body, { "content-type": "text/plain" })),
      415,
      "CONTENT_TYPE",
    );
    await error(
      await op.run(
        new Request(origin, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: "{",
        }),
      ),
      400,
      "JSON",
    );
    // No Content-Length is supplied; readJson must enforce the actual streamed byte count.
    await error(
      await op.run(
        new Request(origin, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ padding: "x".repeat(16385) }),
        }),
      ),
      413,
      "BODY_TOO_LARGE",
    );
    expect(op.mock).not.toHaveBeenCalled();
  });
  it.each(mutations.filter((op) => op.name !== "create"))(
    "rejects $name body paymentId even matching path",
    async (op) => {
      await error(
        await op.run(req({ ...op.body, paymentId: id })),
        422,
        "VALIDATION",
      );
      expect(op.mock).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed UUID paths for every detail/action", async () => {
    for (const handler of [confirm, cancel, reverse])
      await error(
        await handler(
          req(handler === confirm ? confirmBody : reasonBody),
          ctx("invalid"),
        ),
        422,
        "VALIDATION",
      );
    for (const handler of [detail, receipt])
      await error(
        await handler(new Request(origin), ctx("invalid")),
        422,
        "VALIDATION",
      );
    for (const mock of [
      boundary.confirm,
      boundary.cancel,
      boundary.reverse,
      boundary.get,
      boundary.receipt,
    ])
      expect(mock).not.toHaveBeenCalled();
  });
  it("preserves full confirm refinement after path reconstruction", async () => {
    await error(
      await confirm(
        req({
          ...confirmBody,
          allocations: [
            ...confirmBody.allocations,
            {
              ...confirmBody.allocations[0],
              invoiceId: invoiceId.toUpperCase(),
            },
          ],
        }),
        ctx(),
      ),
      422,
      "VALIDATION",
    );
    await error(
      await confirm(req({ ...confirmBody, allocations: [] }), ctx()),
      422,
      "VALIDATION",
    );
    await error(
      await confirm(
        req({
          ...confirmBody,
          allocations: Array.from(
            { length: 101 },
            () => confirmBody.allocations[0],
          ),
        }),
        ctx(),
      ),
      422,
      "VALIDATION",
    );
    expect(boundary.confirm).not.toHaveBeenCalled();
  });
  it.each(["12", "12.3", "12.345", 12.34, "0.00", "-1.00"])(
    "rejects noncanonical positive money %s",
    async (amount) => {
      await error(
        await create(req({ ...createBody, amount })),
        422,
        "VALIDATION",
      );
      expect(boundary.create).not.toHaveBeenCalled();
    },
  );
  it("preserves bank identity constraints", async () => {
    await error(
      await create(req({ ...createBody, method: "BANK_TRANSFER" })),
      422,
      "VALIDATION",
    );
    await error(
      await create(req({ ...createBody, externalReference: "bank" })),
      422,
      "VALIDATION",
    );
    expect(boundary.create).not.toHaveBeenCalled();
  });
  it("preserves a domain error's exact envelope", async () => {
    boundary.confirm.mockRejectedValue(
      new AppError(409, "STALE_VERSION", "Reload first"),
    );
    const response = await confirm(req(confirmBody), ctx());
    expect(await response.json()).toEqual({
      error: { code: "STALE_VERSION", message: "Reload first" },
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("maps Prisma conflicts without metadata", async () => {
    boundary.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("private SQL", {
        code: "P2034",
        clientVersion: "test",
        meta: { secret: "private" },
      }),
    );
    await error(await create(req(createBody)), 409, "CONFLICT");
  });
  it("sanitizes unexpected errors and diagnostics", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    boundary.get.mockRejectedValue(new Error("private account and SQL"));
    const response = await detail(new Request(origin), ctx());
    await error(response.clone(), 500, "INTERNAL");
    expect(await response.text()).not.toContain("private");
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: "request_failed", type: "Error" }),
    );
    log.mockRestore();
  });
  it("rejects bad query before calling either read service", async () => {
    await error(
      await list(new Request(`${origin}?limit=1&limit=1`)),
      422,
      "VALIDATION",
    );
    await error(
      await balances(new Request(`${origin}?status=ISSUED`)),
      422,
      "VALIDATION",
    );
    expect(boundary.list).not.toHaveBeenCalled();
    expect(boundary.balances).not.toHaveBeenCalled();
  });
});
describe("payment URL adaptation with actual domain schemas", () => {
  it("uses domain defaults and converts bounded integer text", () => {
    expect(parsePaymentListQuery(new URLSearchParams())).toEqual({
      offset: 0,
      limit: 50,
    });
    expect(
      parsePaymentListQuery(
        new URLSearchParams({
          leaseId: id.toUpperCase(),
          status: "CANCELLED",
          offset: "100000",
          limit: "100",
        }),
      ),
    ).toEqual({ leaseId: id, status: "CANCELLED", offset: 100000, limit: 100 });
    expect(
      parseBalanceListQuery(new URLSearchParams({ offset: "0", limit: "1" })),
    ).toEqual({ offset: 0, limit: 1 });
  });
  it.each([
    "",
    " ",
    "+1",
    "-1",
    "01",
    "1.0",
    "1e1",
    "0x10",
    "Infinity",
    "9007199254740992",
  ])("rejects noncanonical pagination %s", (value) => {
    for (const parse of [parsePaymentListQuery, parseBalanceListQuery])
      expect(() => parse(new URLSearchParams({ offset: value }))).toThrow();
  });
  it.each([
    "limit=0",
    "limit=101",
    "offset=100001",
    "unknown=1",
    "leaseId=invalid",
    "offset=0&offset=0",
    "leaseId=&leaseId=",
  ])("rejects query %s", (query) => {
    for (const parse of [parsePaymentListQuery, parseBalanceListQuery])
      expect(() => parse(new URLSearchParams(query))).toThrow();
  });
  it("rejects invalid payment status and status on balance query", () => {
    expect(() =>
      parsePaymentListQuery(new URLSearchParams({ status: "ISSUED" })),
    ).toThrow();
    expect(() =>
      parseBalanceListQuery(new URLSearchParams({ status: "PENDING" })),
    ).toThrow();
  });
});
