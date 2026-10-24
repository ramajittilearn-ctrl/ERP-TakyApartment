import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  amountLabel,
  canonicalAmount,
  minorText,
  minorUnits,
} from "../src/features/expenses/form";
import {
  ExpenseApiError,
  expenseRequest,
} from "../src/features/expenses/client";
import {
  bindActor,
  clearJournal,
  dismissSettled,
  journalSnapshot,
  retryAttempt,
  submitAttempt,
  subscribeJournal,
} from "../src/features/expenses/journal";

const actor = "11111111-1111-4111-8111-111111111111";
const payment = {
  id: "22222222-2222-4222-8222-222222222222",
  propertyId: "33333333-3333-4333-8333-333333333333",
  categoryId: "44444444-4444-4444-8444-444444444444",
  description: "Synthetic",
  vendor: "Synthetic vendor",
  amount: "0.30",
  occurredAt: "2026-10-24",
  method: "CASH",
  note: null,
  categoryName: "Synthetic category",
  categoryKind: "OPEX",
  version: 1,
  possibleDuplicateCount: 0,
  recordedById: actor,
  createdAt: "2026-10-24T00:00:00.000Z",
  correctionOfId: null,
  status: "PENDING",
};
const input = {
  actorId: actor,
  path: "expenses",
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

describe("expense exact money", () => {
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
});

describe("expense transport", () => {
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
      expenseRequest({
        path: "expenses/id/confirm",
        schema: z.unknown(),
        body,
      }),
    ).rejects.toMatchObject({
      code: "STALE_VERSION",
      status: 409,
      message: "Changed",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/expenses/id/confirm/",
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
      expenseRequest({ path: "expenses", schema: z.string() }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      expenseRequest({ path: "expenses", schema: z.string() }),
    ).rejects.toBeInstanceOf(ExpenseApiError);
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
      result: { kind: "expense", value: payment },
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
    const journal = await import("../src/features/expenses/journal");
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

it("settles category commands with category DTOs rather than expense casts", async () => {
  const category = {
    id: actor,
    name: "Synthetic",
    kind: "OPEX",
    active: true,
    version: 1,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: category }))),
  );
  submitAttempt({
    ...input,
    path: "expense-categories",
    operation: "categoryCreate",
    body: { name: "Synthetic", kind: "OPEX", commandKey: input.key },
  });
  await settle();
  expect(journalSnapshot(actor)).toMatchObject({
    state: "success",
    result: { kind: "category", value: category },
  });
});
