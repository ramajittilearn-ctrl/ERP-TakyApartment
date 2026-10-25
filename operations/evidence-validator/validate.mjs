import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { spawn } from "node:child_process";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PIXELS = 8_000_000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 32 * 1024;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PDF_WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const FORBIDDEN_NAMES = new Set([
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
]);

export class RejectedEvidence extends Error {}
export class ParserUnavailable extends Error {}

function reject() {
  throw new RejectedEvidence("Evidence rejected");
}

function pngEnvelope(bytes) {
  let offset = 8;
  let chunks = 0;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_BYTES || length + 12 > bytes.length - offset) reject();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) reject();
    if (chunks === 0 && (type !== "IHDR" || length !== 13)) reject();
    if (type === "acTL" || type === "fcTL" || type === "fdAT") reject();
    offset += length + 12;
    chunks++;
    if (chunks > 100_000) reject();
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.length) reject();
      return;
    }
  }
  reject();
}

function jpegEnvelope(bytes) {
  let offset = 2;
  let scan = false;
  let sawScan = false;
  while (offset < bytes.length) {
    if (scan) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
      if (offset >= bytes.length) reject();
    } else if (bytes[offset] !== 0xff) reject();
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) reject();
    const marker = bytes[offset++];
    if (scan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    scan = false;
    if (marker === 0xd9) {
      if (!sawScan || offset !== bytes.length) reject();
      return;
    }
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      reject();
    if (marker === 1) continue;
    if (offset + 2 > bytes.length) reject();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) reject();
    offset += length;
    if (marker === 0xda) {
      scan = true;
      sawScan = true;
    }
  }
  reject();
}

export function evidenceMime(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BYTES)
    reject();
  if (bytes.subarray(0, 8).equals(PNG)) {
    pngEnvelope(bytes);
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    jpegEnvelope(bytes);
    return "image/jpeg";
  }
  if (/^%PDF-[12]\.[0-9]/.test(bytes.subarray(0, 8).toString("ascii"))) {
    const end = bytes.lastIndexOf(Buffer.from("%%EOF"));
    if (
      end < 8 ||
      !bytes.subarray(end + 5).every((byte) => PDF_WHITESPACE.has(byte))
    )
      reject();
    return "application/pdf";
  }
  reject();
}

function normalizedName(value) {
  return value.replace(/#([0-9a-f]{2})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

export function assertPdfGraphSafe(graph) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) reject();
  if (
    !Array.isArray(graph.qpdf) ||
    graph.qpdf.length < 2 ||
    graph.qpdf[0]?.jsonversion !== 2
  )
    reject();
  const stack = [[graph, 0]];
  let nodes = 0;
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (++nodes > 100_000 || depth > 64) reject();
    if (typeof item === "string") {
      if (FORBIDDEN_NAMES.has(normalizedName(item))) reject();
    } else if (item && typeof item === "object") {
      for (const [key, value] of Object.entries(item)) {
        if (FORBIDDEN_NAMES.has(normalizedName(key))) reject();
        stack.push([value, depth + 1]);
      }
    }
  }
}

async function qpdf(args, outputLimit = MAX_DIAGNOSTIC_BYTES) {
  return new Promise((resolve, fail) => {
    const child = spawn("/usr/bin/qpdf", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > outputLimit) {
        overflow = true;
        child.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_DIAGNOSTIC_BYTES) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
    child.once("error", () =>
      fail(new ParserUnavailable("Parser unavailable")),
    );
    child.once("close", (code, signal) => {
      if (overflow || signal) {
        fail(new RejectedEvidence("Parser limit"));
        return;
      }
      resolve({ code, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

async function validatePdf(path) {
  if ((await qpdf(["--check", path])).code !== 0) reject();
  const encrypted = await qpdf(["--is-encrypted", path]);
  if (encrypted.code !== 2) reject();
  const result = await qpdf(
    ["--json=2", "--json-stream-data=none", path],
    MAX_JSON_BYTES,
  );
  if (result.code !== 0) reject();
  let graph;
  try {
    graph = JSON.parse(result.stdout);
  } catch {
    reject();
  }
  assertPdfGraphSafe(graph);
}

async function validateRaster(bytes, mimeType) {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new ParserUnavailable("Parser unavailable");
  }
  sharp.cache(false);
  sharp.concurrency(1);
  try {
    const options = {
      failOn: "warning",
      limitInputPixels: MAX_PIXELS,
      sequentialRead: true,
    };
    const metadata = await sharp(bytes, options).metadata();
    if (metadata.format !== (mimeType === "image/png" ? "png" : "jpeg"))
      reject();
    if (
      !Number.isInteger(metadata.width) ||
      !Number.isInteger(metadata.height) ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width * metadata.height > MAX_PIXELS ||
      (metadata.pages ?? 1) !== 1
    )
      reject();
    const decoded = await sharp(bytes, options)
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== metadata.width ||
      decoded.info.height !== metadata.height ||
      decoded.info.channels < 1 ||
      decoded.info.channels > 4 ||
      decoded.data.length !==
        metadata.width * metadata.height * decoded.info.channels
    )
      reject();
  } catch (error) {
    if (error instanceof ParserUnavailable) throw error;
    reject();
  }
}

export async function validateEvidenceFile(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) reject();
    bytes = await handle.readFile();
    if (bytes.length !== stat.size) reject();
  } finally {
    await handle.close();
  }
  const mimeType = evidenceMime(bytes);
  if (mimeType === "application/pdf") await validatePdf(path);
  else await validateRaster(bytes, mimeType);
  return { valid: true, mimeType, bytes: bytes.length };
}
