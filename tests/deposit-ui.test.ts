import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DepositLedgerDto } from "../src/server/deposits/contracts";
import {
  commandTransport,
  depositAmount,
  depositCommand,
  depositMoneyLabel,
  depositOccurredAt,
  type DepositDraft,
} from "../src/features/deposits/form";
import {
  bindDepositActor,
  depositJournal,
  dismissDepositAttempt,
  retryDepositAttempt,
  submitDepositAttempt,
} from "../src/features/deposits/journal";
const actorId = "11111111-1111-4111-8111-111111111111";
const leaseId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const entryId = "44444444-4444-4444-8444-444444444444";
const otherActorId = "55555555-5555-4555-8555-555555555555";
function ledger(): DepositLedgerDto {
  return {
    leaseId,
    contractualRequirement: "1000.00",
    dataQualityIssues: [],
    account: {
      version: 2,
      reviewState: "REVIEWED",
      reviewedById: actorId,
      reviewedAt: "2026-10-25T00:00:00.000Z",
      legacyDigest: "abc",
      reviewReason: "Verified",
      evidenceId,
      openingAmount: "0.00",
    },
    unverifiedLegacy: {
      rows: [],
      count: 0,
      grossReceived: "0.00",
      grossRefunded: "0.00",
      grossDeducted: "0.00",
    },
    items: [],
    total: 0,
    offset: 0,
    limit: 50,
    totals: {
      grossReceipts: "1000.00",
      grossRefunds: "0.00",
      grossDeductions: "0.00",
      grossOpening: "0.00",
      reversedReceipts: "0.00",
      reversedRefunds: "0.00",
      reversedDeductions: "0.00",
      reversedOpening: "0.00",
      netReceipts: "1000.00",
      netRefunds: "0.00",
      netDeductions: "0.00",
      netOpening: "0.00",
      heldLiability: "1000.00",
    },
    asOfPostedAt: "2026-10-25T00:00:00.000Z",
  };
}
const draft: DepositDraft = {
  amount: "100.01",
  occurredAt: "2026-10-25T09:30",
  reason: "Verified synthetic funds",
  evidenceId,
  method: "BANK_TRANSFER",
  receivingAccountKey: "account-1",
  externalReference: "IN-1",
  payeeName: "Synthetic payee",
  outgoingReference: "OUT-1",
  destination: "Synthetic destination",
  verified: true,
};
const identity = {
  leaseId,
  expectedVersion: 1,
  commandKey: "synthetic-command-1",
  entryId,
};
const input = {
  actorId,
  leaseId,
  operation: "receipts" as const,
  key: "synthetic-command-1",
  path: `/api/v1/leases/${leaseId}/deposits/receipts/`,
  body: { ...identity, evidenceId, amount: "100.01" },
};
const envelope = (data: unknown) => Response.json({ data });
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  bindDepositActor(otherActorId);
  bindDepositActor(actorId);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it("uses canonical decimal strings including large exact values, with zero limited to review", () => {
  expect(depositAmount("999999999999.99")).toBe("999999999999.99");
  expect(depositAmount("1.2")).toBe("1.20");
  expect(depositAmount("0", true)).toBe("0.00");
  expect(depositMoneyLabel("99999999999999999999.99")).toBe(
    "99,999,999,999,999,999,999.99 บาท",
  );
  for (const value of [
    "0",
    "0.00",
    "1e3",
    "NaN",
    "Infinity",
    "01.00",
    "1.001",
    " 1.00",
    "1,000.00",
    "1000000000000.00",
  ])
    expect(() => depositAmount(value)).toThrow();
  expect(depositOccurredAt("2026-10-25T09:30")).toBe(
    "2026-10-25T09:30:00+07:00",
  );
  expect(() => depositOccurredAt("2026-02-30T09:30")).toThrow();
});
it("builds all strict method-specific commands without leaking incoming bank fields into refund", () => {
  const review = depositCommand("review", { ...draft, amount: "0" }, identity);
  expect(review).toMatchObject({
    openingAmount: "0.00",
    expectedVersion: 1,
    verified: true,
  });
  const receipt = depositCommand("receipts", draft, identity);
  expect(receipt).toMatchObject({
    amount: "100.01",
    method: "BANK_TRANSFER",
    receivingAccountKey: "account-1",
    externalReference: "IN-1",
  });
  expect(receipt).not.toHaveProperty("outgoingReference");
  const refund = depositCommand("refunds", draft, identity);
  expect(refund).toMatchObject({
    payeeName: "Synthetic payee",
    outgoingReference: "OUT-1",
    destination: "Synthetic destination",
    settlementReviewed: true,
  });
  expect(refund).not.toHaveProperty("receivingAccountKey");
  const deduction = depositCommand("deductions", draft, identity);
  expect(deduction).not.toHaveProperty("method");
  const reversal = depositCommand("reverse", draft, identity);
  expect(reversal).not.toHaveProperty("amount");
  const transported = commandTransport("reverse", reversal);
  expect(transported.path).toBe(`/api/v1/deposit-entries/${entryId}/reverse/`);
  expect(transported.body).not.toHaveProperty("entryId");
  expect(transported.body).toMatchObject({
    leaseId,
    commandKey: identity.commandKey,
    expectedVersion: 1,
  });
  const cash = depositCommand(
    "receipts",
    { ...draft, method: "CASH" },
    identity,
  );
  expect(cash).not.toHaveProperty("receivingAccountKey");
  expect(() =>
    depositCommand("deductions", { ...draft, verified: false }, identity),
  ).toThrow();
  expect(() =>
    depositCommand("refunds", { ...draft, amount: "0" }, identity),
  ).toThrow();
});
it("freezes body, key and version through an uncertain response and exact replay; blocks a fresh command", async () => {
  const requests: string[] = [];
  let financialCalls = 0;
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).includes("deposit-session"))
      return envelope({ id: actorId, role: "ADMIN" });
    requests.push(String(init?.body));
    if (++financialCalls === 1) throw new TypeError("Synthetic lost response");
    return envelope(ledger());
  });
  const body = { ...input.body };
  submitDepositAttempt({ ...input, body });
  body.expectedVersion = 999;
  await vi.waitFor(() =>
    expect(depositJournal(actorId)?.state).toBe("uncertain"),
  );
  submitDepositAttempt({ ...input, key: "new-command-must-not-send" });
  dismissDepositAttempt(actorId);
  expect(depositJournal(actorId)?.state).toBe("uncertain");
  retryDepositAttempt(actorId);
  await vi.waitFor(() =>
    expect(depositJournal(actorId)?.state).toBe("success"),
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]).toBe(requests[0]);
  expect(JSON.parse(requests[1])).toMatchObject({
    expectedVersion: 1,
    commandKey: input.key,
  });
  expect(
    fetcher.mock.calls.filter(([url]) =>
      String(url).includes("deposit-session"),
    ),
  ).toHaveLength(2);
});
it("checks the actual session actor before replay and sends no financial body after identity change", async () => {
  let sessionActor = actorId;
  let posts = 0;
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("deposit-session"))
      return envelope({ id: sessionActor, role: "ADMIN" });
    posts++;
    throw new TypeError("Synthetic uncertain response");
  });
  submitDepositAttempt(input);
  await vi.waitFor(() =>
    expect(depositJournal(actorId)?.state).toBe("uncertain"),
  );
  sessionActor = otherActorId;
  retryDepositAttempt(actorId);
  await vi.waitFor(() =>
    expect(depositJournal(actorId)?.state).toBe("uncertain"),
  );
  expect(posts).toBe(1);
  bindDepositActor(otherActorId);
  expect(depositJournal(otherActorId)).toBeNull();
  expect(depositJournal(actorId)).toBeNull();
});
it("does not submit a financial body when the current actor was demoted", async () => {
  fetcher.mockResolvedValue(envelope({ id: actorId, role: "STAFF" }));
  submitDepositAttempt(input);
  await vi.waitFor(() =>
    expect(depositJournal(actorId)?.state).toBe("rejected"),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe("/api/v1/deposit-session/");
});
it("distinguishes definite initial rejection from uncertainty and never downgrades prior uncertainty", async () => {
  let first = true;
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("deposit-session"))
      return envelope({ id: actorId, role: "ADMIN" });
    if (first) {
      first = false;
      return Response.json(
        { error: { code: "VERSION_CONFLICT", message: "Version changed" } },
        { status: 409 },
      );
    }
    return new Response("not-json", { status: 200 });
  });
  submitDepositAttempt(input);
  await vi.waitFor(() =>
    expect(depositJournal(actorId)?.state).toBe("rejected"),
  );
  dismissDepositAttempt(actorId);
  expect(depositJournal(actorId)).toBeNull();
  submitDepositAttempt(input);
  await vi.waitFor(() =>
    expect(depositJournal(actorId)?.state).toBe("uncertain"),
  );
  first = true;
  retryDepositAttempt(actorId);
  await vi.waitFor(() =>
    expect(depositJournal(actorId)?.state).toBe("uncertain"),
  );
});
