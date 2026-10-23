import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  actor: {
    id: "abcd1234-1234-4123-8123-123456789abc",
    role: "ADMIN",
    name: "Synthetic",
    username: "synthetic",
  },
  post: vi.fn(),
  list: vi.fn(),
  requireActor: vi.fn(),
}));
vi.mock("@/server/expenses", async () => ({
  ...(await vi.importActual("../src/server/expenses/contracts")),
  postExpense: mock.post,
  listExpenses: mock.list,
  createExpense: vi.fn(),
}));
vi.mock("@/server/http", async () => ({
  ...(await vi.importActual("../src/server/http")),
  requireActor: mock.requireActor,
}));
vi.mock(
  "@/server/expenses/query",
  async () => import("../src/server/expenses/query"),
);
import { POST } from "../src/app/api/v1/expenses/[id]/post/route";
import { GET } from "../src/app/api/v1/expenses/route";
import { AppError } from "../src/server/errors";
const id = "abcd1234-1234-4123-8123-123456789abc";
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown, origin = "http://127.0.0.1:3820") =>
  new Request(`http://127.0.0.1:3820/api/v1/expenses/${id}/post/`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_ORIGIN = "http://127.0.0.1:3820";
  mock.requireActor.mockResolvedValue(mock.actor);
  mock.post.mockResolvedValue({ id, status: "POSTED" });
});
describe("expense mutation boundary", () => {
  it("uses path identity and validated version, then sends no-store envelope", async () => {
    const response = await POST(
      request({ expectedVersion: 1, commandKey: "valid-key" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mock.post).toHaveBeenCalledWith(mock.actor, {
      expenseId: id,
      expectedVersion: 1,
      commandKey: "valid-key",
    });
    expect(await response.json()).toEqual({ data: { id, status: "POSTED" } });
  });
  it("rejects identity injection and forged origin", async () => {
    expect(
      (
        await POST(
          request({
            expectedVersion: 1,
            commandKey: "valid-key",
            expenseId: id,
          }),
          context,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await POST(
          request(
            { expectedVersion: 1, commandKey: "valid-key" },
            "http://forged.invalid",
          ),
          context,
        )
      ).status,
    ).toBe(403);
    expect(mock.post).not.toHaveBeenCalled();
  });
  it("propagates actual service authorization denial", async () => {
    mock.post.mockRejectedValue(
      new AppError(403, "FORBIDDEN", "Expense permission denied"),
    );
    const response = await POST(
      request({ expectedVersion: 1, commandKey: "valid-key" }),
      context,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Expense permission denied" },
    });
  });
  it("rejects unauthenticated access and duplicate list query", async () => {
    mock.requireActor.mockRejectedValueOnce(
      new AppError(401, "UNAUTHENTICATED", "Login required"),
    );
    expect(
      (await GET(new Request("http://127.0.0.1:3820/api/v1/expenses/"))).status,
    ).toBe(401);
    expect(
      (
        await GET(
          new Request("http://127.0.0.1:3820/api/v1/expenses/?limit=2&limit=3"),
        )
      ).status,
    ).toBe(422);
    expect(mock.list).not.toHaveBeenCalled();
  });
});
