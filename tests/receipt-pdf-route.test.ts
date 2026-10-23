import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/server/errors";
import { receiptPdfFixture } from "./fixtures/receipt-pdf";

const boundary = vi.hoisted(() => ({
  actor: vi.fn(),
  receipt: vi.fn(),
  render: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "synthetic" }) }),
}));
vi.mock("../src/server/auth", () => ({
  COOKIE: "taky_session",
  sessionActor: boundary.actor,
}));
vi.mock("@/server/http", async () => import("../src/server/http"));
vi.mock("@/server/payments", () => ({ getReceipt: boundary.receipt }));
vi.mock("@/server/payments/pdf", async () => ({
  ...(await import("../src/server/payments/pdf")),
  renderReceiptPdf: boundary.render,
}));
import { GET } from "../src/app/api/v1/receipts/[id]/pdf/route";

const fixture = receiptPdfFixture();
const actor = {
  id: fixture.snapshot.issuedBy.id,
  role: "ADMIN",
  name: "Synthetic",
  username: "synthetic",
};
const bytes = Buffer.from("%PDF-1.3\nSynthetic test bytes");
function request(query = "", id = fixture.id) {
  return GET(
    new Request(`http://synthetic.invalid/api/v1/receipts/${id}/pdf/${query}`),
    { params: Promise.resolve({ id }) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  boundary.actor.mockResolvedValue(actor);
  boundary.receipt.mockResolvedValue(fixture);
  boundary.render.mockResolvedValue(bytes);
});

describe("receipt PDF HTTP boundary", () => {
  it.each(["ADMIN", "STAFF"])(
    "passes %s identity through the real HTTP adapter to the receipt service",
    async (role) => {
      boundary.actor.mockResolvedValue({ ...actor, role });
      const response = await request();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        'inline; filename="Receipt_REC-202610-0042.pdf"',
      );
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      expect(boundary.receipt).toHaveBeenCalledWith(
        { ...actor, role },
        fixture.id,
      );
      expect(boundary.render).toHaveBeenCalledWith(fixture);
    },
  );
  it("selects attachment only for the explicit download query", async () => {
    const response = await request("?download=1");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Receipt_REC-202610-0042.pdf"',
    );
  });
  it.each([
    "?download=0",
    "?download=",
    "?download=1&download=1",
    "?other=1",
    "?download=1&other=2",
  ])("rejects invalid query %s before receipt loading", async (query) => {
    const response = await request(query);
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(boundary.receipt).not.toHaveBeenCalled();
  });
  it("rejects malformed identity before receipt loading", async () => {
    expect((await request("", "not-a-uuid")).status).toBe(422);
    expect(boundary.receipt).not.toHaveBeenCalled();
  });
  it("returns unauthenticated JSON rather than a PDF", async () => {
    boundary.actor.mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(boundary.receipt).not.toHaveBeenCalled();
  });
  it.each([
    [403, "FORBIDDEN"],
    [404, "PAYMENT_NOT_FOUND"],
    [409, "RECEIPT_SNAPSHOT_MISMATCH"],
  ])(
    "preserves domain failure %s %s without rendering",
    async (status, code) => {
      boundary.receipt.mockRejectedValue(
        new AppError(Number(status), String(code), "Synthetic denied"),
      );
      const response = await request();
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(boundary.render).not.toHaveBeenCalled();
    },
  );
  it("sanitizes renderer failures and never returns a partial PDF", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    boundary.render.mockRejectedValue(
      new Error("SENSITIVE SYNTHETIC REFERENCE"),
    );
    const response = await request();
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("SENSITIVE");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SENSITIVE");
    log.mockRestore();
  });
});
