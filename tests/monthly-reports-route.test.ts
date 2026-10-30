import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  actor: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "ADMIN",
    name: "Synthetic test actor",
    username: "synthetic",
  },
  requireActor: vi.fn(),
  monthlyReport: vi.fn(),
}));

vi.mock("@/server/reports", () => ({
  monthlyReport: mock.monthlyReport,
}));
vi.mock(
  "@/server/reports/contracts",
  async () => import("../src/server/reports/contracts"),
);
vi.mock("@/server/http", async () => ({
  ...(await vi.importActual("../src/server/http")),
  requireActor: mock.requireActor,
}));

import { GET } from "../src/app/api/v1/reports/monthly/route";
import { AppError } from "../src/server/errors";

beforeEach(() => {
  vi.clearAllMocks();
  mock.requireActor.mockResolvedValue(mock.actor);
  mock.monthlyReport.mockResolvedValue({ month: "2026-02" });
});

describe("monthly financial report HTTP boundary", () => {
  it("authenticates, validates month, and returns a no-store data envelope", async () => {
    const response = await GET(
      new Request(
        "http://127.0.0.1:3820/api/v1/reports/monthly/?month=2026-02",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { month: "2026-02" } });
    expect(mock.monthlyReport).toHaveBeenCalledWith(mock.actor, "2026-02");
  });

  it("rejects duplicate and unknown query parameters before reading reports", async () => {
    const duplicate = await GET(
      new Request(
        "http://127.0.0.1:3820/api/v1/reports/monthly/?month=2026-02&month=2026-03",
      ),
    );
    const unknown = await GET(
      new Request(
        "http://127.0.0.1:3820/api/v1/reports/monthly/?month=2026-02&propertyId=1",
      ),
    );

    expect(duplicate.status).toBe(422);
    expect(unknown.status).toBe(422);
    expect(mock.monthlyReport).not.toHaveBeenCalled();
  });

  it("returns the current authentication error", async () => {
    mock.requireActor.mockRejectedValueOnce(
      new AppError(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบ"),
    );

    const response = await GET(
      new Request(
        "http://127.0.0.1:3820/api/v1/reports/monthly/?month=2026-02",
      ),
    );

    expect(response.status).toBe(401);
    expect(mock.monthlyReport).not.toHaveBeenCalled();
  });
});
