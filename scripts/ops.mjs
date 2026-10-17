import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { parse } from "dotenv";
import { isIP } from "node:net";

process.umask(0o077);
const args = process.argv.slice(2),
  test = args.includes("--test");
const [command = "status", selected] = args.filter((a) => a !== "--test");
const directory = path.resolve(test ? ".local/test" : ".local");
const environment = test ? ".env.test" : ".env";
const operationsEnv = path.join(directory, "operations.env");
const project = test ? "taky-phase25-test" : "taky-erp";
const base = parse(await fs.readFile(environment));
async function exclusive(file, value) {
  try {
    await fs.writeFile(file, value, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
function docker(
  values,
  { capture = false, allowFailure = false, env = process.env } = {},
) {
  const result = spawnSync("docker", values, {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    env,
  });
  if (result.error)
    throw new Error(`Docker command unavailable: ${result.error.code}`);
  if (result.status !== 0 && !allowFailure)
    throw new Error(`Docker command exited ${result.status}`);
  return capture ? result.stdout.trim() : result.status;
}
const compose = [
  "compose",
  "--env-file",
  environment,
  "--env-file",
  operationsEnv,
  "-p",
  project,
  "-f",
  "docker-compose.yml",
  ...(test ? ["-f", "docker-compose.test.yml"] : []),
  "-f",
  "docker-compose.operations.yml",
  "-f",
  "docker-compose.https.yml",
];
function exec(command, ...values) {
  return docker(
    [
      ...compose,
      "exec",
      "-T",
      "operations",
      "node",
      "operations/cli.mjs",
      command,
      ...values,
    ],
    { capture: true },
  );
}
async function restoreTest(filename) {
  if (!/^taky-\d{8}T\d{6}Z-[a-f0-9-]{36}\.taky\.enc$/.test(filename || ""))
    throw new Error("An exact backup filename is required");
  const restoreProject = `taky-restore-${randomUUID().slice(0, 12)}`;
  const restore = [
    "compose",
    "--env-file",
    operationsEnv,
    "-p",
    restoreProject,
    "-f",
    "docker-compose.restore.yml",
  ];
  const env = {
    ...process.env,
    RESTORE_PASSWORD: randomBytes(32).toString("hex"),
  };
  await fs.mkdir(path.join(directory, "restore-drills"), {
    recursive: true,
    mode: 0o700,
  });
  const record = {
    project: restoreProject,
    file: filename,
    startedAt: new Date().toISOString(),
    status: "RUNNING",
  };
  const recordPath = path.join(
    directory,
    "restore-drills",
    `${restoreProject}.json`,
  );
  await fs.writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
  try {
    docker([...restore, "up", "-d", "--wait", "restore-db"], { env });
    docker(
      [
        ...restore,
        "run",
        "--rm",
        "restore",
        "node",
        "operations/cli.mjs",
        "restore-isolated",
        filename,
      ],
      { env },
    );
    record.status = "SUCCEEDED";
  } catch (error) {
    record.status = "FAILED";
    throw error;
  } finally {
    record.finishedAt = new Date().toISOString();
    await fs.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", {
      mode: 0o600,
    });
    docker([...restore, "down"], { env, allowFailure: true });
  }
  console.info(
    `Restore verified in ${restoreProject}. Its separate volumes are retained for inspection; no production volumes were touched.`,
  );
}
async function main() {
  if (command === "init") {
    await fs.mkdir(path.join(directory, "private"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.mkdir(path.join(directory, "backups"), {
      recursive: true,
      mode: 0o700,
    });
    await exclusive(
      path.join(directory, "private", "backup.key"),
      randomBytes(32).toString("base64") + "\n",
    );
    await fs.mkdir(path.join(directory, "private", "rclone"), {
      recursive: true,
      mode: 0o700,
    });
    await exclusive(
      path.join(directory, "private", "rclone", "rclone.conf"),
      "",
    );
    const host = test ? "127.0.0.1" : new URL(base.APP_ORIGIN).hostname;
    if (
      isIP(host) !== 4 ||
      !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    )
      throw new Error(
        "Configure a private IPv4 application origin before initialization",
      );
    await exclusive(
      operationsEnv,
      `BACKUP_DIR=${directory}/backups\nBACKUP_KEY_PATH=${directory}/private/backup.key\nRCLONE_CONFIG_DIR=${directory}/private/rclone\nBACKUP_REMOTE=\nLAN_HOST=${host}\nAPP_BIND_IP=${test ? "127.0.0.1" : base.APP_BIND_IP}\nHTTPS_PORT=${test ? "3443" : "443"}\n`,
    );
    console.info(
      `Private operations configuration prepared in ${directory}. Existing files preserved. Securely escrow the encryption key before relying on backups.`,
    );
    return;
  }
  const config = parse(await fs.readFile(operationsEnv));
  const privateIp = (value) =>
    isIP(value || "") === 4 &&
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value || "");
  if (
    !privateIp(config.APP_BIND_IP) ||
    !(
      privateIp(config.LAN_HOST) ||
      /^[a-z0-9-]+\.local$/i.test(config.LAN_HOST || "")
    )
  )
    throw new Error(
      "HTTPS must use a private bind IP and a private IP or .local hostname",
    );
  if (command === "up") {
    docker([...compose, "up", "-d", "--build", "--wait"]);
    return;
  }
  if (command === "ps") {
    docker([...compose, "ps"]);
    return;
  }
  if (command === "down") {
    docker([...compose, "down"]);
    return;
  }
  if (command === "logs") {
    docker([...compose, "logs", "--tail=100"]);
    return;
  }
  if (command === "reload") {
    docker([...compose, "up", "-d", "--no-build", "--wait"]);
    docker([
      ...compose,
      "exec",
      "-T",
      "caddy",
      "caddy",
      "reload",
      "--config",
      "/etc/caddy/Caddyfile",
    ]);
    return;
  }
  if (["backup", "status", "retry", "verify"].includes(command)) {
    console.info(exec(command, ...(selected ? [selected] : [])));
    return;
  }
  if (command === "export-ca") {
    const destination = path.join(directory, "certificates");
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    docker([
      ...compose,
      "cp",
      "caddy:/data/caddy/pki/authorities/local/root.crt",
      path.join(destination, "root.crt"),
    ]);
    console.info(
      `Public CA certificate exported to ${destination}/root.crt. Private CA keys remain in the Caddy volume.`,
    );
    return;
  }
  if (command === "rclone-config") {
    if (!process.stdin.isTTY)
      throw new Error(
        "rclone authorization requires an interactive owner terminal",
      );
    docker([
      ...compose,
      "run",
      "--rm",
      "--no-deps",
      "operations",
      "rclone",
      "config",
    ]);
    return;
  }
  if (command === "restore-test") {
    await restoreTest(selected);
    return;
  }
  if (["restore-production", "rollback-production"].includes(command)) {
    if (test || !process.stdin.isTTY)
      throw new Error(
        "Production recovery requires an interactive owner terminal; it cannot run in automated tests",
      );
    await restoreTest(selected);
    const rollbackOnly = command === "rollback-production";
    if (rollbackOnly) {
      const previous = JSON.parse(exec("status")).find(
        (r) =>
          r.file === selected &&
          r.kind === "rollback" &&
          r.status === "SUCCEEDED" &&
          r.verifiedAt &&
          !r.prunedAt,
      );
      if (!previous)
        throw new Error(
          "Select a verified rollback archive from this installation's journal",
        );
    }
    const phrase = `${rollbackOnly ? "ROLLBACK" : "RESTORE"} ${project} FROM ${selected}`;
    console.info(
      rollbackOnly
        ? "The selected rollback archive passed an isolated drill. This operation replaces the normal database and attachments using the existing verified rollback and requires downtime."
        : "Selected restore has passed an isolated drill. This operation replaces the normal database and attachments and requires downtime. A fresh verified rollback backup will be created after writes stop.",
    );
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await prompt.question(`Type exactly ${phrase}\n> `);
    prompt.close();
    if (answer !== phrase)
      throw new Error("Owner confirmation did not match; production unchanged");
    docker([...compose, "stop", "caddy", "app"]);
    let rollback;
    try {
      rollback = rollbackOnly
        ? { file: selected }
        : JSON.parse(exec("rollback").split("\n")[0]);
    } catch (error) {
      docker([...compose, "up", "-d", "--wait"]);
      throw error;
    }
    console.info(`Verified rollback archive: ${rollback.file}`);
    docker([...compose, "stop", "operations"]);
    try {
      docker([
        ...compose,
        "run",
        "--rm",
        "--no-deps",
        "--env",
        "RESTORE_MODE=production",
        "--env",
        `OWNER_RESTORE_CONFIRMATION=${selected}`,
        "--env",
        `ROLLBACK_BACKUP=${rollback.file}`,
        "--volume",
        `${project}_attachments:/restore-attachments`,
        "operations",
        "node",
        "operations/cli.mjs",
        "restore-production",
        selected,
      ]);
      docker([...compose, "up", "-d", "--wait"]);
    } catch (error) {
      console.error(
        `Recovery failed; services remain stopped. Preserve all volumes and recover using verified rollback archive ${rollback.file}. See docs/backup-restore.md.`,
      );
      throw error;
    }
    return;
  }
  throw new Error(
    "Use init, up, reload, down, ps, logs, backup, status, retry, verify <filename>, restore-test <filename>, export-ca, rclone-config, restore-production <filename> or rollback-production <filename>; --test selects isolated Phase 2.5 configuration",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
