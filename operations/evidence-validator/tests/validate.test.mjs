import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  assertPdfGraphSafe,
  evidenceMime,
  MAX_BYTES,
  MAX_PIXELS,
  RejectedEvidence,
  validateEvidenceFile,
} from "../validate.mjs";
import { runValidation } from "../process.mjs";

async function withInput(bytes, check) {
  const directory = await mkdtemp("/tmp/taky-validator-test-");
  const path = join(directory, "input");
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    await check(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [format, mimeType] of [
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
]) {
  test(`fully decodes genuine ${format} and rejects truncation and appended payload`, async () => {
    const image = sharp({
      create: { width: 2, height: 3, channels: 3, background: "#123456" },
    });
    const bytes = await image[format]().toBuffer();
    assert.equal(evidenceMime(bytes), mimeType);
    await withInput(bytes, async (path) => {
      assert.deepEqual(await validateEvidenceFile(path), {
        valid: true,
        mimeType,
        bytes: bytes.length,
      });
    });
    await withInput(bytes.subarray(0, bytes.length - 5), async (path) => {
      await assert.rejects(validateEvidenceFile(path), RejectedEvidence);
    });
    assert.throws(
      () =>
        evidenceMime(
          Buffer.concat([bytes, Buffer.from("<script>extra payload</script>")]),
        ),
      RejectedEvidence,
    );
    assert.throws(
      () => evidenceMime(Buffer.concat([bytes, bytes])),
      RejectedEvidence,
    );
  });
}

test("forces raster decoder errors instead of accepting a structurally plausible corrupt image", async () => {
  const bytes = await sharp({
    create: { width: 3, height: 2, channels: 3, background: "#abcdef" },
  })
    .png()
    .toBuffer();
  const corrupt = Buffer.from(bytes);
  let offset = 8;
  while (corrupt.toString("ascii", offset + 4, offset + 8) !== "IDAT")
    offset += corrupt.readUInt32BE(offset) + 12;
  corrupt[offset + 8] ^= 0x3f;
  assert.equal(evidenceMime(corrupt), "image/png");
  await withInput(corrupt, async (path) =>
    assert.rejects(validateEvidenceFile(path), RejectedEvidence),
  );
});

test("rejects a genuine raster exceeding eight million pixels before raw decoding", async () => {
  const bytes = await sharp({
    create: { width: 4001, height: 2000, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  assert(4001 * 2000 > MAX_PIXELS);
  assert(bytes.length < MAX_BYTES);
  await withInput(bytes, async (path) =>
    assert.rejects(validateEvidenceFile(path), RejectedEvidence),
  );
});

test("checks PDF prefix and final marker without claiming that envelopes validate PDF structure", () => {
  const bytes = Buffer.from("%PDF-1.7\nnot a complete PDF\n%%EOF\r\n");
  assert.equal(evidenceMime(bytes), "application/pdf");
  assert.throws(
    () => evidenceMime(Buffer.concat([Buffer.from("MZ"), bytes])),
    RejectedEvidence,
  );
  assert.throws(
    () =>
      evidenceMime(Buffer.concat([bytes, Buffer.from("<html>second payload")])),
    RejectedEvidence,
  );
  assert.throws(
    () => evidenceMime(Buffer.from("%PDF-1.7\nno final marker")),
    RejectedEvidence,
  );
});

test("rejects empty, unsupported and oversized inputs", () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("GIF89a"),
    Buffer.alloc(MAX_BYTES + 1),
  ]) {
    assert.throws(() => evidenceMime(bytes), RejectedEvidence);
  }
});

function graph(value) {
  return { version: 2, qpdf: [{ jsonversion: 2 }, { "obj:1 0 R": { value } }] };
}

test("accepts only JSON version two qpdf graphs with no restricted actions", () => {
  assert.doesNotThrow(() =>
    assertPdfGraphSafe(graph({ "/Type": "/Catalog", "/Pages": "2 0 R" })),
  );
  for (const bad of [null, [], {}, { qpdf: [{ jsonversion: 1 }, {}] }])
    assert.throws(() => assertPdfGraphSafe(bad), RejectedEvidence);
});

for (const name of [
  "/JavaScript",
  "/JS",
  "/AA",
  "/OpenAction",
  "/Launch",
  "/SubmitForm",
  "/ImportData",
  "/RichMedia",
  "/EmbeddedFiles",
  "/EmbeddedFile",
  "/Filespec",
  "/XFA",
]) {
  test(`rejects restricted PDF name ${name} as a key or value, including escaped spelling`, () => {
    assert.throws(
      () => assertPdfGraphSafe(graph({ [name]: "1 0 R" })),
      RejectedEvidence,
    );
    assert.throws(
      () => assertPdfGraphSafe(graph({ "/S": name })),
      RejectedEvidence,
    );
    const escaped = "/" + "#" + name.charCodeAt(1).toString(16) + name.slice(2);
    assert.throws(
      () => assertPdfGraphSafe(graph({ [escaped]: "1 0 R" })),
      RejectedEvidence,
    );
  });
}

test("bounds qpdf graph nesting and object count", () => {
  let nested = {};
  for (let i = 0; i < 70; i++) nested = { nested };
  assert.throws(() => assertPdfGraphSafe(graph(nested)), RejectedEvidence);
  assert.throws(
    () => assertPdfGraphSafe(graph(new Array(100_001).fill(0))),
    RejectedEvidence,
  );
});

test("an aborted parser process is awaited and rejected without diagnostics", async () => {
  const bytes = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
  await withInput(bytes, async (path) => {
    const controller = new globalThis.AbortController();
    const result = runValidation(path, controller.signal);
    controller.abort();
    await assert.rejects(
      result,
      (error) => error.status === 408 && error.code === "VALIDATION_TIMEOUT",
    );
  });
});
