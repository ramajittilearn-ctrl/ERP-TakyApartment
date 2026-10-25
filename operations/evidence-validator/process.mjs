import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export class ValidationFailure extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function runValidation(path, signal) {
  if (signal.aborted)
    return Promise.reject(new ValidationFailure(408, "VALIDATION_TIMEOUT"));
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=96",
        fileURLToPath(new URL("./worker.mjs", import.meta.url)),
        path,
      ],
      {
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: "/usr/bin:/bin",
          NODE_ENV: "production",
          LANG: "C.UTF-8",
          HOME: "/tmp",
        },
      },
    );
    let output = "";
    let outputBytes = 0;
    let diagnostics = 0;
    let rejected = false;
    let settled = false;
    const kill = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") child.kill("SIGKILL");
      }
    };
    const abort = () => {
      rejected = true;
      kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 512) {
        rejected = true;
        kill();
      } else output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk.length;
      if (diagnostics > 16 * 1024) {
        rejected = true;
        kill();
      }
    });
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    child.once("error", () => {
      signal.removeEventListener("abort", abort);
      fail(new ValidationFailure(503, "VALIDATOR_UNAVAILABLE"));
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        fail(new ValidationFailure(408, "VALIDATION_TIMEOUT"));
        return;
      }
      if (rejected || code !== 0) {
        fail(
          new ValidationFailure(
            code === 2 ? 422 : 503,
            code === 2 ? "VALIDATION_REJECTED" : "VALIDATOR_UNAVAILABLE",
          ),
        );
        return;
      }
      let result;
      try {
        result = JSON.parse(output);
      } catch {
        fail(new ValidationFailure(503, "VALIDATOR_UNAVAILABLE"));
        return;
      }
      if (
        !result ||
        Object.keys(result).sort().join(",") !== "bytes,mimeType,valid" ||
        result.valid !== true ||
        !["application/pdf", "image/png", "image/jpeg"].includes(
          result.mimeType,
        ) ||
        !Number.isInteger(result.bytes) ||
        result.bytes < 1 ||
        result.bytes > 5 * 1024 * 1024
      ) {
        fail(new ValidationFailure(503, "VALIDATOR_UNAVAILABLE"));
        return;
      }
      if (!settled) {
        settled = true;
        resolve(result);
      }
    });
    if (signal.aborted) abort();
  });
}
