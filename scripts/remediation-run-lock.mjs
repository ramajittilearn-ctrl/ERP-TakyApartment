import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const lockName = "remediation-browser-run.lock";

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function acquireRemediationRunLock(
  runId,
  directory = ".",
  { allowSameRun = false } = {},
) {
  if (!/^[a-f0-9]{24}$/.test(runId))
    throw new Error("Invalid isolated run identity");
  const localPath = resolve(directory, ".local");
  await mkdir(localPath, { recursive: true });
  const localInfo = await lstat(localPath);
  if (!localInfo.isDirectory() || localInfo.isSymbolicLink())
    throw new Error("The local project directory must be a real directory");
  const localDirectory = await realpath(localPath);
  const lockPath = join(localDirectory, lockName);
  const lockId = randomBytes(16).toString("hex");
  const record = { pid: process.pid, runId, lockId };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeFile(join(lockPath, "owner.json"), JSON.stringify(record), {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        try {
          const owner = JSON.parse(
            await readFile(join(lockPath, "owner.json"), "utf8"),
          );
          if (owner.lockId === lockId)
            await rm(lockPath, { recursive: true, force: true });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try {
        const info = await lstat(lockPath);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("Unsafe remediation run lock", { cause: error });
        owner = JSON.parse(
          await readFile(join(lockPath, "owner.json"), "utf8"),
        );
      } catch (cause) {
        throw new Error("A remediation browser run lock is unreadable", {
          cause,
        });
      }
      if (processIsAlive(owner.pid)) {
        if (allowSameRun && owner.runId === runId) return async () => {};
        throw new Error(
          `Another remediation browser run is active (${owner.runId})`,
          { cause: error },
        );
      }
      await rm(lockPath, { recursive: true, force: true });
    }
  }
  throw new Error("Could not acquire remediation browser run lock");
}
