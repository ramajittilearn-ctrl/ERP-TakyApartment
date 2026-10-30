import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  actor: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "ADMIN",
    name: "Synthetic test actor",
    username: "synthetic",
  },
  requireActor: vi.fn(),
  dashboard: vi.fn(),
}));

vi.mock("@/server/dashboard", () => ({ dashboard: mock.dashboard }));
vi.mock(
  "@/server/dashboard/contracts",
  async () => import("../src/server/dashboard/contracts"),
);
vi.mock("@/server/http", async () => ({
  ...(await vi.importActual("../src/server/http")),
  requireActor: mock.requireActor,
}));

import { GET } from "../src/app/api/v1/dashboard/route";

beforeEach(() => {
  vi.clearAllMocks();
  mock.requireActor.mockResolvedValue(mock.actor);
  mock.dashboard.mockResolvedValue({ month: "2027-03" });
});

describe("dashboard HTTP boundary", () => {
  it("authenticates, validates month, and returns a no-store envelope", async () => {
    const response = await GET(
      new Request("http://127.0.0.1:3820/api/v1/dashboard/?month=2027-03"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { month: "2027-03" } });
    expect(mock.dashboard).toHaveBeenCalledWith(mock.actor, "2027-03");
  });

  it("rejects repeated and unknown query parameters", async () => {
    const duplicate = await GET(
      new Request(
        "http://127.0.0.1:3820/api/v1/dashboard/?month=2027-03&month=2027-04",
      ),
    );
    const unknown = await GET(
      new Request(
        "http://127.0.0.1:3820/api/v1/dashboard/?month=2027-03&propertyId=1",
      ),
    );

    expect(duplicate.status).toBe(422);
    expect(unknown.status).toBe(422);
    expect(mock.dashboard).not.toHaveBeenCalled();
  });
});
