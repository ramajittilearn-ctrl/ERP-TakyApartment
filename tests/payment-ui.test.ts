import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  amountLabel,
  bangkokNow,
  bangkokTimestamp,
  canonicalAmount,
  minorText,
  minorUnits,
} from "../src/features/payments/form";
import {
  PaymentApiError,
  paymentRequest,
} from "../src/features/payments/client";
import {
  bindActor,
  clearJournal,
  dismissSettled,
  journalSnapshot,
  retryAttempt,
  submitAttempt,
  subscribeJournal,
} from "../src/features/payments/journal";

const actor = "11111111-1111-4111-8111-111111111111";
const payment = {
  id: "22222222-2222-4222-8222-222222222222",
  reference: "PAY-TEST",
  leaseId: "33333333-3333-4333-8333-333333333333",
  amount: "0.30",
  method: "CASH",
  status: "PENDING",
  version: 1,
  receivedAt: "2026-10-22T17:00:00.000Z",
  createdAt: "2026-10-22T17:01:00.000Z",
  recordedById: actor,
  confirmedAt: null,
  confirmedById: null,
  cancelledAt: null,
  cancelledById: null,
  cancelReason: null,
  externalReference: null,
  receivingAccountKey: null,
  allocations: [],
  receipt: null,
  reversal: null,
};
const input = {
  actorId: actor,
  path: "payments",
  key: "stable-key",
  operation: "create" as const,
  body: {
    commandKey: "stable-key",
    amount: "0.30",
    receivedAt: "2026-10-23T00:00:00+07:00",
  },
};
const settle = () =>
  vi.waitFor(() =>
    expect(journalSnapshot(actor)?.state).not.toBe("submitting"),
  );
afterEach(() => {
  clearJournal();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("payment form exact money and explicit Bangkok time", () => {
  it("normalizes lexical money without rounding and sums exact minor units", () => {
    expect(canonicalAmount("1")).toBe("1.00");
    expect(canonicalAmount("1.2")).toBe("1.20");
    expect(minorText(minorUnits("0.10") + minorUnits("0.20"))).toBe("0.30");
    expect(amountLabel(canonicalAmount("999999999999.99"))).toBe(
      "999,999,999,999.99 บาท",
    );
    expect(minorText(minorUnits("0.10") - minorUnits("0.30"))).toBe("-0.20");
  });
  it.each([
    "",
    "0",
    "0.00",
    "01",
    "-1",
    "+1",
    "1e2",
    "1,000",
    "0.001",
    "1000000000000.00",
    "1.",
  ])("rejects invalid amount %s", (value) =>
    expect(() => canonicalAmount(value)).toThrow(),
  );
  it("uses Bangkok midnight independently of workstation timezone", () => {
    expect(bangkokTimestamp("2026-10-23T00:00")).toBe(
      "2026-10-23T00:00:00+07:00",
    );
    expect(new Date(bangkokTimestamp("2026-10-23T00:00")).toISOString()).toBe(
      "2026-10-22T17:00:00.000Z",
    );
    expect(bangkokNow(new Date("2026-10-22T17:00:00Z"))).toBe(
      "2026-10-23T00:00",
    );
    expect(bangkokTimestamp("2028-02-29T23:59")).toContain("+07:00");
  });
  it.each([
    "2026-02-29T12:00",
    "2026-04-31T12:00",
    "2026-10-23T24:00",
    "2026-13-01T12:00",
    "2026-10-23T00:00Z",
  ])("rejects invalid wall time %s", (value) =>
    expect(() => bangkokTimestamp(value)).toThrow(),
  );
});

describe("payment transport", () => {
  it("retains exact serialized body, explicit cookies, no-store and server errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "STALE_VERSION", message: "Changed" },
        }),
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const body = JSON.stringify({
      amount: "999999999999.99",
      commandKey: "Key-Cased",
    });
    await expect(
      paymentRequest({
        path: "payments/id/confirm",
        schema: z.unknown(),
        body,
      }),
    ).rejects.toMatchObject({
      code: "STALE_VERSION",
      status: 409,
      message: "Changed",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/payments/id/confirm/",
      expect.objectContaining({
        method: "POST",
        body,
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  it("rejects malformed and schema-invalid success instead of pretending it saved", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>proxy</html>"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: 42 })));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      paymentRequest({ path: "payments", schema: z.string() }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      paymentRequest({ path: "payments", schema: z.string() }),
    ).rejects.toBeInstanceOf(PaymentApiError);
  });
});

describe("volatile financial command journal", () => {
  it("keeps the same body/key after response loss, unsubscribe/navigation and exact retry", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost after commit"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: payment })));
    vi.stubGlobal("fetch", fetcher);
    const listener = vi.fn();
    const unsubscribe = subscribeJournal(listener);
    submitAttempt(input);
    unsubscribe();
    await settle();
    expect(journalSnapshot(actor)?.state).toBe("uncertain");
    bindActor(actor);
    expect(journalSnapshot(actor)?.body).toBe(JSON.stringify(input.body));
    submitAttempt({ ...input, key: "wrong-new-key" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    retryAttempt(actor);
    await settle();
    expect(journalSnapshot(actor)?.state).toBe("success");
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(journalSnapshot(actor)?.key).toBe("stable-key");
    dismissSettled(actor);
    expect(journalSnapshot(actor)).toBeNull();
  });
  it("settles an in-flight POST after the view unmounts and ignores double submission", async () => {
    let resolve: (value: Response) => void = () => {
      throw new Error("not started");
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const unsubscribe = subscribeJournal(vi.fn());
    submitAttempt(input);
    unsubscribe();
    submitAttempt(input);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify({ data: payment })));
    await settle();
    expect(journalSnapshot(actor)).toMatchObject({
      state: "success",
      result: payment,
    });
  });
  it("fences late settlement after logout/pagehide or account change", async () => {
    let resolve: (value: Response) => void = () => {
      throw new Error("not started");
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    submitAttempt(input);
    clearJournal();
    bindActor("other-actor");
    resolve(new Response(JSON.stringify({ data: payment })));
    await new Promise((done) => setTimeout(done, 10));
    expect(journalSnapshot(actor)).toBeNull();
    expect(journalSnapshot("other-actor")).toBeNull();
  });
  it("preserves an idempotency conflict and prevents a new-key fallback", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "IDEMPOTENCY_CONFLICT",
            message: "Conflicting intent",
          },
        }),
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    submitAttempt(input);
    await settle();
    dismissSettled(actor);
    submitAttempt({ ...input, key: "fresh-key" });
    expect(journalSnapshot(actor)).toMatchObject({
      state: "rejected",
      code: "IDEMPOTENCY_CONFLICT",
      key: "stable-key",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([403, 422])(
    "keeps the original uncertain intent after retry rejection %s, then settles exact replay",
    async (status) => {
      const code = status === 403 ? "FORBIDDEN" : "VALIDATION";
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(new Error("committed response lost"))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: { code, message: "Retry denied" } }),
            { status },
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: payment })));
      vi.stubGlobal("fetch", fetcher);
      submitAttempt(input);
      await settle();
      retryAttempt(actor);
      await settle();
      expect(journalSnapshot(actor)).toMatchObject({
        state: "uncertain",
        mayHaveCommitted: true,
        key: input.key,
        body: JSON.stringify(input.body),
      });
      const unresolved = journalSnapshot(actor);
      expect(unresolved?.state === "uncertain" && unresolved.message).toContain(
        code,
      );
      dismissSettled(actor);
      submitAttempt({ ...input, key: "new-key" });
      expect(fetcher).toHaveBeenCalledTimes(2);
      retryAttempt(actor);
      await settle();
      expect(journalSnapshot(actor)?.state).toBe("success");
      expect(fetcher.mock.calls.map((call) => call[1].body)).toEqual(
        Array(3).fill(JSON.stringify(input.body)),
      );
      dismissSettled(actor);
      expect(journalSnapshot(actor)).toBeNull();
    },
  );

  it("treats non-JSON HTTP failure as uncertain rather than a safe rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>error</html>", { status: 502 })),
    );
    submitAttempt(input);
    await settle();
    expect(journalSnapshot(actor)?.state).toBe("uncertain");
  });
});

describe("journal document lifecycle", () => {
  it("keeps an unload warning across view unsubscribe and clears on pagehide including late responses", async () => {
    vi.resetModules();
    const browser = new EventTarget();
    vi.stubGlobal("window", browser);
    const journal = await import("../src/features/payments/journal");
    let resolve: (value: Response) => void = () => {
      throw new Error("not started");
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const unsubscribe = journal.subscribeJournal(vi.fn());
    journal.submitAttempt(input);
    unsubscribe();
    const before = new Event("beforeunload", { cancelable: true });
    browser.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    browser.dispatchEvent(new Event("pagehide"));
    expect(journal.journalSnapshot(actor)).toBeNull();
    const after = new Event("beforeunload", { cancelable: true });
    browser.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    resolve(new Response(JSON.stringify({ data: payment })));
    await new Promise((done) => setTimeout(done, 10));
    expect(journal.journalSnapshot(actor)).toBeNull();
    journal.clearJournal();
  });
});
