import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: { id: "11111111-1111-4111-8111-111111111111", role: "STAFF" },
  auth: vi.fn(),
  export: vi.fn(),
}));
vi.mock("@/server/expenses", () => ({ exportExpenses: mocks.export }));
vi.mock(
  "@/server/expenses/export",
  async () => import("../src/server/expenses/export"),
);
vi.mock(
  "@/server/expenses/query",
  async () => import("../src/server/expenses/query"),
);
vi.mock("@/server/http", async () => ({
  ...(await vi.importActual("../src/server/http")),
  requireActor: mocks.auth,
}));
import { GET } from "../src/app/api/v1/expenses/export/route";
import { AppError } from "../src/server/errors";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(mocks.actor);
  mocks.export.mockResolvedValue({
    scope: "managed-only",
    generatedAt: "2026-10-24T03:04:05.000Z",
    filters: {},
    excludedLegacyCount: 0,
    totals: { opex: "0.00", capex: "0.00", total: "0.00" },
    items: [],
  });
});
it("returns no-store attachment after authentication with normalized complete filters", async () => {
  const response = await GET(
    new Request("http://synthetic.invalid/api/v1/expenses/export/?kind=OPEX"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe(
    'attachment; filename="expenses-20261024T030405Z.csv"',
  );
  expect(mocks.export).toHaveBeenCalledWith(mocks.actor, { kind: "OPEX" });
  expect(await response.text()).toContain('"summary"');
});
it("rejects malformed and repeated filters before export", async () => {
  for (const query of ["limit=1", "kind=OPEX&kind=CAPEX"])
    expect(
      (
        await GET(
          new Request(
            `http://synthetic.invalid/api/v1/expenses/export/?${query}`,
          ),
        )
      ).status,
    ).toBe(422);
  expect(mocks.export).not.toHaveBeenCalled();
});
it("returns normal JSON denial and all-or-error bound failures", async () => {
  mocks.auth.mockRejectedValueOnce(
    new AppError(401, "UNAUTHENTICATED", "Login required"),
  );
  const denied = await GET(
    new Request("http://synthetic.invalid/api/v1/expenses/export/"),
  );
  expect(denied.status).toBe(401);
  expect(mocks.export).not.toHaveBeenCalled();
  mocks.export.mockRejectedValueOnce(
    new AppError(422, "EXPORT_TOO_LARGE", "Narrow filters"),
  );
  const response = await GET(
    new Request("http://synthetic.invalid/api/v1/expenses/export/"),
  );
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    error: { code: "EXPORT_TOO_LARGE", message: "Narrow filters" },
  });
});
