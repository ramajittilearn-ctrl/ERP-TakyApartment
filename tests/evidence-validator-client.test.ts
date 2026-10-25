import { afterEach, expect, it, vi } from "vitest";
import {
  evidenceValidatorConfiguration,
  validateStagedEvidence,
} from "../src/server/evidence/formats";
import {
  discardStagedEvidence,
  stageEvidence,
  type StagedEvidence,
} from "../src/server/evidence/storage";
const staged: StagedEvidence[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const input of staged.splice(0)) await discardStagedEvidence(input);
});
async function input() {
  const value = await stageEvidence(
    new ReadableStream({
      start(c) {
        c.enqueue(Buffer.from("png"));
        c.close();
      },
    }),
    10,
  );
  staged.push(value);
  return value;
}
function configured() {
  vi.stubEnv("EVIDENCE_VALIDATOR_ORIGIN", "http://127.0.0.1:3835");
  vi.stubEnv("EVIDENCE_VALIDATOR_TOKEN", "a".repeat(64));
}
it("requires explicit exact validator configuration and never accepts arbitrary URLs", () => {
  configured();
  expect(evidenceValidatorConfiguration().url.href).toBe(
    "http://127.0.0.1:3835/validate",
  );
  for (const origin of [
    "https://127.0.0.1:3835",
    "http://example.invalid:3835",
    "http://127.0.0.1:9999",
    "http://user:pass@127.0.0.1:3835",
    "http://127.0.0.1:3835/path",
    "http://127.0.0.1:3835/?a=1",
    "http://127.0.0.1:3835/#a",
  ]) {
    vi.stubEnv("EVIDENCE_VALIDATOR_ORIGIN", origin);
    expect(() => evidenceValidatorConfiguration()).toThrow();
  }
});
it("sends exact staged bytes with private authentication and disallows redirects", async () => {
  configured();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ valid: true, mimeType: "image/png", bytes: 3 }),
    );
  vi.stubGlobal("fetch", fetcher);
  expect(await validateStagedEvidence(await input(), "image/png")).toEqual({
    valid: true,
    mimeType: "image/png",
    bytes: 3,
  });
  const [url, request] = fetcher.mock.calls[0];
  expect(url.href).toBe("http://127.0.0.1:3835/validate");
  expect(request).toMatchObject({
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "image/png",
      "x-taky-validator-token": "a".repeat(64),
    },
  });
  expect(Buffer.from(request.body)).toEqual(Buffer.from("png"));
});
it.each([
  { valid: true, mimeType: "image/png", bytes: 4 },
  { valid: true, mimeType: "application/pdf", bytes: 3 },
  { valid: true, mimeType: "image/png", bytes: 3, unsafe: true },
  { valid: false, mimeType: "image/png", bytes: 3 },
])(
  "fails closed for mismatched or unrecognized validator results",
  async (result) => {
    configured();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(result)));
    await expect(
      validateStagedEvidence(await input(), "image/png"),
    ).rejects.toBeInstanceOf(Error);
  },
);
it("bounds response bytes and ignores private parser error data", async () => {
  configured();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("x".repeat(1025), {
          headers: { "content-type": "application/json" },
        }),
      ),
  );
  await expect(
    validateStagedEvidence(await input(), "image/png"),
  ).rejects.toMatchObject({
    status: 503,
    code: "EVIDENCE_VALIDATOR_UNAVAILABLE",
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("sensitive parser details", { status: 422 }),
      ),
  );
  await expect(
    validateStagedEvidence(await input(), "image/png"),
  ).rejects.toMatchObject({ status: 422, code: "EVIDENCE_FORMAT" });
});
it("does not contact a missing validator and respects caller abort", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("EVIDENCE_VALIDATOR_ORIGIN", "");
  vi.stubEnv("EVIDENCE_VALIDATOR_TOKEN", "");
  await expect(
    validateStagedEvidence(await input(), "image/png"),
  ).rejects.toMatchObject({ status: 503 });
  expect(fetcher).not.toHaveBeenCalled();
  configured();
  const controller = new AbortController();
  controller.abort();
  await expect(
    validateStagedEvidence(await input(), "image/png", controller.signal),
  ).rejects.toMatchObject({ status: 408 });
  expect(fetcher).not.toHaveBeenCalled();
});
