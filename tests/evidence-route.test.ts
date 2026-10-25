import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  actor: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "ADMIN",
    name: "Synthetic",
    username: "synthetic",
  },
  requireActor: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
  download: vi.fn(),
}));
vi.mock("@/server/evidence", () => ({
  uploadDepositEvidence: mock.upload,
  listDepositEvidence: mock.list,
  getDepositEvidenceDownload: mock.download,
}));
vi.mock("@/server/http", async () => ({
  ...(await vi.importActual("../src/server/http")),
  requireActor: mock.requireActor,
}));
vi.mock("@/server/errors", async () => import("../src/server/errors"));
vi.mock(
  "@/server/evidence/contracts",
  async () => import("../src/server/evidence/contracts"),
);
vi.mock(
  "@/server/evidence/query",
  async () => import("../src/server/evidence/query"),
);
import { GET, POST } from "../src/app/api/v1/deposit-evidence/route";
import { GET as DOWNLOAD } from "../src/app/api/v1/deposit-evidence/[id]/download/route";
import { AppError } from "../src/server/errors";
const leaseId = "22222222-2222-4222-8222-222222222222";
function request(extra = "", headers: Record<string, string> = {}) {
  return new Request(
    `http://127.0.0.1:3820/api/v1/deposit-evidence/?leaseId=${leaseId}&originalName=proof.png${extra}`,
    {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3820",
        "content-type": "image/png",
        ...headers,
      },
      body: new Uint8Array([1, 2, 3]),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3820");
  mock.requireActor.mockResolvedValue(mock.actor);
  mock.upload.mockResolvedValue({ id: leaseId });
  mock.list.mockResolvedValue({ items: [] });
});
afterEach(() => vi.unstubAllEnvs());
it("passes raw bytes and authenticated identity through the strict upload boundary", async () => {
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const data = mock.upload.mock.calls[0][0];
  expect(data.actor).toBe(mock.actor);
  expect(data.metadata).toEqual({
    leaseId,
    originalName: "proof.png",
    declaredMimeType: "image/png",
  });
  expect(new Uint8Array(await new Response(data.body).arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3]),
  );
});
it("denies unauthenticated, STAFF and forged-origin upload before service bytes are consumed", async () => {
  mock.requireActor.mockRejectedValueOnce(
    new AppError(401, "UNAUTHENTICATED", "Login"),
  );
  expect((await POST(request())).status).toBe(401);
  mock.requireActor.mockResolvedValueOnce({ ...mock.actor, role: "STAFF" });
  expect((await POST(request())).status).toBe(403);
  expect(
    (await POST(request("", { origin: "http://forged.invalid" }))).status,
  ).toBe(403);
  expect(mock.upload).not.toHaveBeenCalled();
});
it("rejects query injection, repeated metadata, over-limit headers and compressed transport", async () => {
  for (const suffix of [
    "&leaseId=" + leaseId,
    "&__proto__=x",
    "&actorId=" + leaseId,
    "&declaredMimeType=image/png",
  ])
    expect((await POST(request(suffix))).status).toBe(422);
  expect(
    (await POST(request("", { "content-length": "5242881" }))).status,
  ).toBe(413);
  expect((await POST(request("", { "content-encoding": "gzip" }))).status).toBe(
    415,
  );
  expect(mock.upload).not.toHaveBeenCalled();
});
it("strictly filters accepted evidence listing and serves verified downloads as attachments", async () => {
  expect(
    (
      await GET(
        new Request(
          `http://127.0.0.1:3820/api/v1/deposit-evidence/?leaseId=${leaseId}&limit=25`,
        ),
      )
    ).status,
  ).toBe(200);
  expect(mock.list).toHaveBeenCalledWith(mock.actor, {
    leaseId,
    offset: 0,
    limit: 25,
  });
  expect(
    (
      await GET(
        new Request(
          `http://127.0.0.1:3820/api/v1/deposit-evidence/?leaseId=${leaseId}&limit=2&limit=3`,
        ),
      )
    ).status,
  ).toBe(422);
  mock.download.mockResolvedValue({
    metadata: { originalName: "ใบเสร็จ.png", mimeType: "image/png", bytes: 3 },
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.close();
      },
    }),
  });
  const response = await DOWNLOAD(
    new Request("http://127.0.0.1:3820/api/v1/deposit-evidence/x/download/"),
    { params: Promise.resolve({ id: leaseId }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("attachment;");
  expect(response.headers.get("content-disposition")).toContain(
    encodeURIComponent("ใบเสร็จ.png"),
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.arrayBuffer()).toHaveProperty("byteLength", 3);
  expect(
    (
      await DOWNLOAD(
        new Request(
          "http://127.0.0.1:3820/api/v1/deposit-evidence/x/download/?path=evil",
        ),
        { params: Promise.resolve({ id: leaseId }) },
      )
    ).status,
  ).toBe(422);
});
