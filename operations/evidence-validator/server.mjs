import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_BYTES } from "./validate.mjs";
import { runValidation, ValidationFailure } from "./process.mjs";

function response(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  });
  res.end(JSON.stringify(data));
}

function headerValues(req, name) {
  const values = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() === name)
      values.push(req.rawHeaders[index + 1]);
  }
  return values;
}

function authorized(req, secret) {
  const values = headerValues(req, "x-taky-validator-token");
  return (
    values.length === 1 &&
    /^[a-f0-9]{64}$/.test(values[0]) &&
    timingSafeEqual(Buffer.from(values[0], "ascii"), secret)
  );
}

async function writeAll(file, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes.subarray(offset));
    if (bytesWritten < 1)
      throw new ValidationFailure(503, "VALIDATOR_UNAVAILABLE");
    offset += bytesWritten;
  }
}

function readInput(req, file, signal) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    let writing = Promise.resolve();
    const cleanup = () => {
      req.off("data", data);
      req.off("end", end);
      req.off("error", fail);
      req.off("aborted", aborted);
      signal.removeEventListener("abort", aborted);
      req.once("error", () => {});
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      req.pause();
      cleanup();
      writing.finally(() => reject(error)).catch(() => {});
    };
    const aborted = () =>
      fail(new ValidationFailure(408, "VALIDATION_TIMEOUT"));
    const data = (chunk) => {
      req.pause();
      size += chunk.length;
      if (size > MAX_BYTES) {
        fail(new ValidationFailure(413, "VALIDATION_REJECTED"));
        return;
      }
      writing = writing.then(() => writeAll(file, chunk));
      writing
        .then(() => {
          if (!settled) req.resume();
        })
        .catch(fail);
    };
    const end = () => {
      writing
        .then(() => {
          if (settled) return;
          settled = true;
          cleanup();
          if (size < 1)
            reject(new ValidationFailure(422, "VALIDATION_REJECTED"));
          else resolve(size);
        })
        .catch(fail);
    };
    req.on("data", data);
    req.once("end", end);
    req.once("error", fail);
    req.once("aborted", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export function createValidatorServer({
  token,
  validate = runValidation,
  deadlineMs = 8000,
  temporaryRoot = "/tmp",
}) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new Error("Validator secret configuration required");
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 8000)
    throw new Error("Invalid validator deadline");
  const secret = Buffer.from(token, "ascii");
  let active = 0;
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      response(res, 200, { ready: true });
      return;
    }
    if (req.url !== "/validate") {
      response(res, 404, { error: "VALIDATION_REJECTED" });
      return;
    }
    if (req.method !== "POST") {
      response(res, 405, { error: "VALIDATION_REJECTED" });
      return;
    }
    if (!authorized(req, secret)) {
      response(res, 401, { error: "UNAUTHORIZED" });
      return;
    }
    if (active >= 2) {
      response(res, 503, { error: "VALIDATOR_BUSY" });
      return;
    }
    const encodings = headerValues(req, "content-encoding");
    if (
      encodings.length > 1 ||
      (encodings.length === 1 && encodings[0] !== "identity")
    ) {
      response(res, 415, { error: "VALIDATION_REJECTED" });
      return;
    }
    const lengths = headerValues(req, "content-length");
    if (
      lengths.length > 1 ||
      (lengths.length &&
        (!/^\d+$/.test(lengths[0]) || Number(lengths[0]) > MAX_BYTES))
    ) {
      response(res, 413, { error: "VALIDATION_REJECTED" });
      return;
    }
    active++;
    const controller = new globalThis.AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    timer.unref();
    const disconnect = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once("close", disconnect);
    req.once("aborted", disconnect);
    let directory;
    let file;
    try {
      directory = await mkdtemp(join(temporaryRoot, "taky-validator-"));
      file = await open(
        join(directory, "input"),
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      const bytes = await readInput(req, file, controller.signal);
      await file.close();
      file = undefined;
      if (controller.signal.aborted)
        throw new ValidationFailure(408, "VALIDATION_TIMEOUT");
      const result = await validate(
        join(directory, "input"),
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new ValidationFailure(408, "VALIDATION_TIMEOUT");
      if (
        !result ||
        Object.keys(result).sort().join(",") !== "bytes,mimeType,valid" ||
        result.valid !== true ||
        result.bytes !== bytes ||
        !["application/pdf", "image/png", "image/jpeg"].includes(
          result.mimeType,
        )
      )
        throw new ValidationFailure(503, "VALIDATOR_UNAVAILABLE");
      response(res, 200, result);
    } catch (error) {
      const failure =
        error instanceof ValidationFailure
          ? error
          : new ValidationFailure(503, "VALIDATOR_UNAVAILABLE");
      response(res, failure.status, { error: failure.code });
    } finally {
      clearTimeout(timer);
      res.off("close", disconnect);
      req.off("aborted", disconnect);
      try {
        await file?.close();
        if (directory) await rm(directory, { recursive: true, force: true });
      } catch {
        // The container's disposable tmpfs remains bounded if cleanup fails.
      } finally {
        active--;
      }
    }
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1;
  server.headersTimeout = 8000;
  server.requestTimeout = 8000;
  server.keepAliveTimeout = 1000;
  server.on("clientError", (_error, socket) => {
    if (socket.writable)
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.umask(0o077);
  await access("/usr/bin/qpdf", constants.X_OK);
  import.meta.resolve("sharp");
  const server = createValidatorServer({
    token: process.env.EVIDENCE_VALIDATOR_TOKEN,
  });
  server.listen(3835, "0.0.0.0");
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
