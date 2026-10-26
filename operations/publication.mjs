import { spawn } from "node:child_process";
import { setInterval, clearInterval } from "node:timers";
import { createInterface } from "node:readline";

export const ATTACHMENT_PUBLICATION_KEY = 73422195;

export async function acquireAttachmentPublicationSession({
  env = process.env,
  spawnProcess = spawn,
  acquisitionTimeoutMs = 7000,
  checkTimeoutMs = 2000,
  heartbeatMs = 500,
  holdTimeoutMs = 600000,
  closeTimeoutMs = 2000,
} = {}) {
  const controller = new globalThis.AbortController();
  const child = spawnProcess("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-At"], {
    env: { ...env, PGCONNECT_TIMEOUT: "5" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  let acquired = false;
  let closing = false;
  let exited = false;
  let backendPid;
  let role;
  let sequence = 0;
  let pending;
  let heartbeat;
  let holdDeadline;
  let forceKill;
  let rejectReady;
  let resolveReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  function lost() {
    if (closing || controller.signal.aborted) return;
    const error = new Error("Attachment publication session lost");
    controller.abort(error);
    clearInterval(heartbeat);
    clearTimeout(holdDeadline);
    clearTimeout(acquisition);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
    rejectReady(error);
    child.stdin.destroy();
    if (!exited) {
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), closeTimeoutMs);
      forceKill.unref();
    }
  }
  child.on("error", lost);
  child.stdin.on("error", lost);
  child.on("close", () => {
    exited = true;
    clearTimeout(forceKill);
    if (!closing) lost();
    lines.close();
    resolveClosed();
  });
  lines.on("line", (line) => {
    if (closing || !line || line === "SET") return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      lost();
      return;
    }
    if (!Array.isArray(value)) {
      lost();
      return;
    }
    if (
      !acquired &&
      value.length === 3 &&
      value[0] === "TAKY_PUBLICATION_READY" &&
      Number.isSafeInteger(value[1]) &&
      value[1] > 0 &&
      typeof value[2] === "string"
    ) {
      acquired = true;
      backendPid = value[1];
      role = value[2];
      clearTimeout(acquisition);
      resolveReady();
    } else if (
      acquired &&
      pending &&
      value.length === 3 &&
      value[0] === "TAKY_PUBLICATION_CHECK" &&
      value[1] === pending.sequence &&
      value[2] === backendPid
    ) {
      clearTimeout(pending.timer);
      pending.resolve();
      pending = undefined;
    } else lost();
  });
  const acquisition = setTimeout(lost, acquisitionTimeoutMs);
  child.stdin.write(
    `SET lock_timeout='5s';\nSET statement_timeout='5s';\nSELECT pg_advisory_lock(${ATTACHMENT_PUBLICATION_KEY});\nSELECT json_build_array('TAKY_PUBLICATION_READY',pg_backend_pid(),current_user)::text;\n`,
  );
  await ready;
  holdDeadline = setTimeout(lost, holdTimeoutMs);
  function assertAlive() {
    controller.signal.throwIfAborted();
    if (closing || exited)
      return Promise.reject(new Error("Attachment publication session closed"));
    if (pending) return pending.promise;
    const current = ++sequence;
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pending = {
      sequence: current,
      promise,
      resolve,
      reject,
      timer: setTimeout(lost, checkTimeoutMs),
    };
    child.stdin.write(
      `SELECT json_build_array('TAKY_PUBLICATION_CHECK',${current},pg_backend_pid())::text;\n`,
    );
    return promise;
  }
  heartbeat = setInterval(() => {
    Promise.resolve().then(assertAlive).catch(lost);
  }, heartbeatMs);
  return {
    signal: controller.signal,
    backendPid,
    role,
    assertAlive,
    close: async () => {
      if (closing) return closed;
      closing = true;
      clearInterval(heartbeat);
      clearTimeout(holdDeadline);
      clearTimeout(acquisition);
      clearTimeout(forceKill);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Attachment publication session closed"));
        pending = undefined;
      }
      if (!exited) {
        child.stdin.end(
          `SELECT pg_advisory_unlock(${ATTACHMENT_PUBLICATION_KEY});\n\\q\n`,
        );
        forceKill = setTimeout(() => child.kill("SIGKILL"), closeTimeoutMs);
      }
      await closed;
      clearTimeout(forceKill);
    },
  };
}

export async function withAttachmentPublicationSession(work, options) {
  const session = await acquireAttachmentPublicationSession(options);
  try {
    const result = await work(session);
    await session.assertAlive();
    return result;
  } finally {
    await session.close();
  }
}
