import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  unlink,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyPdfAssets } from "../../scripts/verify-pdf-assets.mjs";

const fonts = ["thai", "latin"].map(
  (subset) =>
    `node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-${subset}-400-normal.woff`,
);
async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taky-pdf-assets-"));
  const traces = [];
  try {
    for (const font of fonts) {
      for (const base of [root, path.join(root, ".next/standalone")]) {
        const file = path.join(base, font);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(
          file,
          `Synthetic artifact bytes for ${path.basename(font)}`,
        );
      }
    }
    for (const route of ["invoices", "receipts"]) {
      const file = path.join(
        root,
        ".next/server/app/api/v1",
        route,
        "[id]/pdf/route.js.nft.json",
      );
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          files: fonts.map((font) =>
            path.relative(path.dirname(file), path.join(root, font)),
          ),
        }),
      );
      traces.push(file);
    }
    await work(root, traces);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("verifies both route traces and identical regular standalone font bytes", () =>
  fixture(async (root) => {
    const result = await verifyPdfAssets({ projectRoot: root });
    assert.equal(result.verified, true);
    assert.deepEqual(result.routes, ["invoices", "receipts"]);
    assert.equal(result.fonts.length, 2);
    assert(
      result.fonts.every(
        (font) => font.bytes > 0 && /^[a-f0-9]{64}$/.test(font.sha256),
      ),
    );
  }));
test("rejects a font omitted from either PDF route trace", () =>
  fixture(async (root, traces) => {
    await writeFile(traces[1], JSON.stringify({ files: [] }));
    await assert.rejects(
      verifyPdfAssets({ projectRoot: root }),
      /trace omits font: receipts/,
    );
  }));
test("rejects missing and changed standalone copies", () =>
  fixture(async (root) => {
    const copied = path.join(root, ".next/standalone", fonts[0]);
    await writeFile(copied, "Changed synthetic bytes");
    await assert.rejects(
      verifyPdfAssets({ projectRoot: root }),
      /differs from source/,
    );
    await unlink(copied);
    await assert.rejects(
      verifyPdfAssets({ projectRoot: root }),
      /Missing PDF font asset/,
    );
  }));
test("rejects a standalone symlink even when its target bytes match", () =>
  fixture(async (root) => {
    const copied = path.join(root, ".next/standalone", fonts[0]);
    await unlink(copied);
    await symlink(path.join(root, fonts[0]), copied);
    await assert.rejects(
      verifyPdfAssets({ projectRoot: root }),
      /must be a regular file/,
    );
  }));
