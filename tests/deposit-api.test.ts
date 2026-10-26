import { afterEach, beforeEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  actor: vi.fn(),
  review: vi.fn(),
  receipt: vi.fn(),
  deduction: vi.fn(),
  refund: vi.fn(),
  reverse: vi.fn(),
  ledger: vi.fn(),
  document: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "synthetic-cookie" }) }),
}));
vi.mock("../src/server/auth", () => ({
  COOKIE: "taky_session",
  sessionActor: boundary.actor,
}));
vi.mock("@/server/http", async () => import("../src/server/http"));
vi.mock(
  "@/server/deposit-api/boundary",
  async () => import("../src/server/deposit-api/boundary"),
);
vi.mock(
  "@/server/deposits/contracts",
  async () => import("../src/server/deposits/contracts"),
);
vi.mock("@/server/deposit-api/service", () => ({
  depositService: {
    reviewDepositAccount: boundary.review,
    recordDepositReceipt: boundary.receipt,
    recordDepositDeduction: boundary.deduction,
    recordDepositRefund: boundary.refund,
    reverseDepositEntry: boundary.reverse,
    getLeaseDepositLedger: boundary.ledger,
    getDepositDocument: boundary.document,
  },
}));
import { POST } from "../src/app/api/v1/leases/[id]/deposits/[action]/route";
import { GET } from "../src/app/api/v1/leases/[id]/deposits/route";
import { POST as REVERSE } from "../src/app/api/v1/deposit-entries/[id]/reverse/route";
import { GET as SESSION } from "../src/app/api/v1/deposit-session/route";

const leaseId = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
const actor = {
  id: "33333333-3333-4333-8333-333333333333",
  role: "ADMIN",
  name: "Synthetic",
  username: "synthetic",
};
const base = {
  expectedVersion: 3,
  evidenceId: "44444444-4444-4444-8444-444444444444",
  commandKey: "synthetic-command-1",
  reason: "Synthetic verified evidence",
};
const receipt = {
  ...base,
  amount: "100.01",
  occurredAt: "2026-10-25T09:00:00+07:00",
  verified: true,
  method: "CASH",
};
function request(
  body: unknown = receipt,
  headers: Record<string, string> = {},
  query = "",
) {
  return new Request(
    `http://127.0.0.1:3820/api/v1/leases/${leaseId}/deposits/receipts/${query}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3820",
        "x-taky-deposit-actor": actor.id,
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}
function context(action = "receipts", id = leaseId) {
  return { params: Promise.resolve({ id, action }) };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3820");
  boundary.actor.mockResolvedValue(actor);
  for (const fn of [
    boundary.receipt,
    boundary.review,
    boundary.refund,
    boundary.deduction,
    boundary.reverse,
    boundary.ledger,
    boundary.document,
  ])
    fn.mockResolvedValue({ accepted: true });
});
afterEach(() => vi.unstubAllEnvs());
it("authenticates and rejects STAFF or wrong Origin before reading a financial body", async () => {
  const wrongOrigin = request(receipt, { origin: "http://evil.invalid" });
  expect((await POST(wrongOrigin, context())).status).toBe(403);
  expect(wrongOrigin.bodyUsed).toBe(false);
  expect(boundary.actor).not.toHaveBeenCalled();
  boundary.actor.mockResolvedValue({ ...actor, role: "STAFF" });
  const staff = request();
  expect((await POST(staff, context())).status).toBe(403);
  expect(staff.bodyUsed).toBe(false);
  boundary.actor.mockResolvedValue(null);
  expect((await POST(request(), context())).status).toBe(401);
  expect(boundary.receipt).not.toHaveBeenCalled();
});
it("passes the exact strict canonical command with path identity and retains command key/version", async () => {
  const response = await POST(request(), context());
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(boundary.receipt).toHaveBeenCalledExactlyOnceWith(actor, {
    ...receipt,
    leaseId,
    occurredAt: "2026-10-25T02:00:00.000Z",
  });
});
it("rejects a missing actor binding or a session switched after preflight before reading the command", async () => {
  for (const value of [
    "",
    "bad-actor",
    "55555555-5555-4555-8555-555555555555",
    `${actor.id}, ${actor.id}`,
  ]) {
    const input = request(receipt, { "x-taky-deposit-actor": value });
    expect((await POST(input, context())).status).toBe(403);
    expect(input.bodyUsed).toBe(false);
  }
  boundary.actor.mockResolvedValue({
    ...actor,
    id: "55555555-5555-4555-8555-555555555555",
  });
  const switched = request();
  expect((await POST(switched, context())).status).toBe(403);
  expect(switched.bodyUsed).toBe(false);
  expect(boundary.receipt).not.toHaveBeenCalled();
});
it("rejects forged identity, extra fields, bad amounts, query injection and bounded JSON violations", async () => {
  for (const body of [
    { ...receipt, leaseId },
    { ...receipt, actorId: actor.id },
    { ...receipt, amount: "1e2" },
    { ...receipt, amount: "0.00" },
    { ...receipt, verified: false },
  ])
    expect((await POST(request(body), context())).status).toBe(422);
  expect(
    (await POST(request(receipt, {}, "?actorId=bad"), context())).status,
  ).toBe(422);
  expect(
    (await POST(request(receipt, { "content-type": "text/plain" }), context()))
      .status,
  ).toBe(415);
  const invalidHeaders: Record<string, string>[] = [
    { "content-type": "application/json-invalid" },
    { "content-type": "application/json, text/html" },
    { "content-encoding": "gzip" },
  ];
  for (const headers of invalidHeaders)
    expect((await POST(request(receipt, headers), context())).status).toBe(415);
  for (const length of ["-1", "1.5", "1, 2", "NaN"])
    expect(
      (await POST(request(receipt, { "content-length": length }), context()))
        .status,
    ).toBe(413);
  expect(
    (await POST(request(receipt, { "content-length": "20000" }), context()))
      .status,
  ).toBe(413);
  expect(
    (await POST(request(), context("receipts", "not-a-uuid"))).status,
  ).toBe(422);
  expect(boundary.receipt).not.toHaveBeenCalled();
});
it("allows explicit zero opening through review and preserves distinct refund fields", async () => {
  expect(
    (
      await POST(
        request({ ...base, openingAmount: "0.00", verified: true }),
        context("review"),
      )
    ).status,
  ).toBe(200);
  expect(boundary.review).toHaveBeenCalledWith(actor, {
    ...base,
    openingAmount: "0.00",
    verified: true,
    leaseId,
  });
  const refund = {
    ...base,
    amount: "20.00",
    occurredAt: receipt.occurredAt,
    settlementReviewed: true,
    method: "BANK_TRANSFER",
    payeeName: "Synthetic payee",
    outgoingReference: "OUT-123",
    destination: "Synthetic destination",
  };
  expect((await POST(request(refund), context("refunds"))).status).toBe(201);
  expect(boundary.refund.mock.calls[0][1]).toMatchObject({
    outgoingReference: "OUT-123",
    destination: "Synthetic destination",
    payeeName: "Synthetic payee",
  });
  expect(boundary.refund.mock.calls[0][1]).not.toHaveProperty(
    "receivingAccountKey",
  );
});
it("keeps ledger pagination strict and does not derive totals from displayed rows", async () => {
  const url = `http://127.0.0.1:3820/api/v1/leases/${leaseId}/deposits/`;
  expect(
    (await GET(new Request(`${url}?offset=50&limit=25`), context())).status,
  ).toBe(200);
  expect(boundary.ledger).toHaveBeenCalledWith(actor, {
    leaseId,
    offset: 50,
    limit: 25,
  });
  for (const query of [
    "limit=1&limit=2",
    "limit=01",
    "offset=1e2",
    "__proto__=x",
    "leaseId=x",
    "limit=101",
  ])
    expect((await GET(new Request(`${url}?${query}`), context())).status).toBe(
      422,
    );
});
it("takes reversal entry from the path and requires lease/version/evidence in its body", async () => {
  const body = {
    ...base,
    leaseId,
    occurredAt: receipt.occurredAt,
    verified: true,
  };
  expect(
    (await REVERSE(request(body), { params: Promise.resolve({ id: entryId }) }))
      .status,
  ).toBe(201);
  expect(boundary.reverse.mock.calls[0][1]).toMatchObject({
    ...base,
    leaseId,
    entryId,
    verified: true,
  });
  expect(
    (
      await REVERSE(request({ ...body, entryId }), {
        params: Promise.resolve({ id: entryId }),
      })
    ).status,
  ).toBe(422);
});
it("returns only the current authenticated actor id/role in a no-store preflight", async () => {
  const response = await SESSION(
    new Request("http://127.0.0.1:3820/api/v1/deposit-session/"),
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    data: { id: actor.id, role: "ADMIN" },
  });
  boundary.actor.mockResolvedValue(null);
  expect(
    (
      await SESSION(
        new Request("http://127.0.0.1:3820/api/v1/deposit-session/"),
      )
    ).status,
  ).toBe(401);
});
