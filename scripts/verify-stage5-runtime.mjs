#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runId = randomBytes(12).toString("hex");
const project = `taky-stage5-${runId}`;
const ownerLabel = "com.taky.stage5.run";
const CADDY_IMAGE =
  "caddy@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f";
const outRoot = resolve(
  process.env.STAGE5_ARTIFACT_ROOT ?? "/tmp/taky-stage5-artifacts",
);
const artifactDir = join(outRoot, runId);
const inheritedComposeKeys = /^(?:DOCKER_|COMPOSE_|STAGE5_|POSTGRES_|TEST_|PG)/;
const composeSpecificKeys = new Set([
  "APP_ORIGIN",
  "APP_BIND_IP",
  "APP_PORT",
  "COOKIE_SECURE",
  "DATABASE_URL",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_WORK_TREE",
  "HTTPS_PORT",
  "LAN_HOST",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "SESSION_SECRET",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
]);
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !inheritedComposeKeys.test(key) && !composeSpecificKeys.has(key),
  ),
);
const state = {
  runId,
  project,
  startedAt: new Date().toISOString(),
  status: "running",
  source: {},
  resources: [],
  checks: [],
  failures: [],
  cleanup: "not-started",
};
let envFile;
let envDirectory;
let port;
let appImageId;
let caddyContainer;
let cleanupAllowed = false;
let generatedSecrets = [];

function docker(args, options = {}) {
  return execFileSync("docker", ["--context", "default", ...args], {
    cwd: root,
    env: childEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}
function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    env: childEnv,
    encoding: "utf8",
  });
}
function compose(args, options = {}) {
  return docker(
    [
      "compose",
      "--project-name",
      project,
      "--env-file",
      envFile,
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.stage5-runtime.yml",
      "-f",
      "docker-compose.stage5-runtime-networks.yml",
      ...args,
    ],
    options,
  );
}
function parseComposeVersion(rawVersion) {
  const version = rawVersion.trim();
  const match =
    /^(?:Docker Compose version\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/i.exec(
      version,
    );
  assert.ok(match, `unable to parse Docker Compose version: ${version}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  assert.ok(
    major > 2 || (major === 2 && (minor > 24 || (minor === 24 && patch >= 4))),
    `Stage 5 requires Docker Compose >=2.24.4 for !override support (found ${version})`,
  );
  return version;
}
function runChecked(label, command, args, env = childEnv) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024,
  });
  const row = {
    label,
    command,
    args: args.map((value) =>
      value.startsWith("--")
        ? value
        : value.replace(/(password|secret|token)=.*/i, "$1=[redacted]"),
    ),
    exitCode: result.status,
    signal: result.signal ?? null,
  };
  if (result.status !== 0) {
    const childOutput = [
      result.error
        ? `spawnError: ${result.error.code ?? "unknown"}: ${result.error.message}`
        : "",
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const diagnostic = sanitizeDiagnostic(
      childOutput,
      result.error?.code === "ENOBUFS" ||
        /maxbuffer|enobufs/i.test(result.error?.message ?? ""),
    );
    row.failureDiagnostic = diagnostic.text;
    row.diagnosticTruncated = diagnostic.truncated;
    state.checks.push(row);
    throw new Error(
      `${label} failed with exit ${result.status ?? result.signal}`,
    );
  }
  state.checks.push(row);
  return result.stdout;
}
function sanitizeDiagnostic(input, processOutputTruncated = false) {
  const maxLines = 120;
  const maxBytes = 16 * 1024;
  let truncated = processOutputTruncated;
  let output = String(input);
  for (const secret of generatedSecrets)
    if (secret) output = output.replaceAll(secret, "[REDACTED]");
  output = output
    .replace(
      /((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]*/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:GET|POST)\s+\/api\/auth\/login\/?[^\s]*/gi,
      "[AUTH LOGIN ROUTE]",
    )
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, "[REDACTED]")
    .replace(/(taky_session=)[^;\s"'&]+/gi, "$1[REDACTED]")
    .replace(
      /("(?:password|passwd|secret|client_secret|token|tokenhash|access_token|accesstoken|refresh_token|cookie|set-cookie|session|sessionid|sessiontoken|authorization|api_key|apikey)"\s*:\s*")[^"]*(")/gi,
      "$1[REDACTED]$2",
    )
    .replace(
      /\b(password|passwd|secret|client_secret|token|tokenhash|access_token|refresh_token|cookie|session|sessionid|sessiontoken|authorization|api_key|apikey)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^&\s,;}]+)/gi,
      "$1=[REDACTED]",
    );
  let lines = output.split(/\r?\n/);
  if (lines.length > maxLines) {
    const firstCount = Math.floor((maxLines - 1) / 2);
    const lastCount = maxLines - firstCount - 1;
    const omitted = lines.length - firstCount - lastCount;
    lines = [
      ...lines.slice(0, firstCount),
      `[${omitted} diagnostic lines omitted]`,
      ...lines.slice(-lastCount),
    ];
    truncated = true;
  }
  let bytes = Buffer.from(lines.join("\n"), "utf8");
  if (bytes.length > maxBytes) {
    const marker = Buffer.from("\n[diagnostic bytes omitted]\n", "utf8");
    const payloadBytes = maxBytes - marker.length;
    const firstBytes = Math.floor(payloadBytes / 2);
    const lastBytes = payloadBytes - firstBytes;
    bytes = Buffer.concat([
      bytes.subarray(0, firstBytes),
      marker,
      bytes.subarray(bytes.length - lastBytes),
    ]);
    truncated = true;
  }
  return { text: bytes.toString("utf8"), truncated };
}
function assertRenderedEqual(actual, expected, label) {
  assert.ok(actual === expected, `Compose rendered unexpected ${label}`);
}
function assertRenderedLabels(labels, expected, resource) {
  for (const [key, value] of Object.entries(expected))
    assertRenderedEqual(labels?.[key], value, `${resource} label ${key}`);
}
function assertMounts(service, expected, name) {
  const mounts = service.volumes ?? [];
  assert.equal(mounts.length, expected.length, `${name} has unexpected mounts`);
  for (const item of expected) {
    const match = mounts.find((mount) => mount.target === item.target);
    assert.ok(match, `${name} is missing expected mount ${item.target}`);
    assertRenderedEqual(match.type, item.type, `${name} mount type`);
    assertRenderedEqual(match.source, item.source, `${name} mount source`);
    if (item.read_only !== undefined)
      assertRenderedEqual(
        match.read_only,
        item.read_only,
        `${name} mount mode`,
      );
  }
}
function verifyComposeConfig(config, env, revision, tree) {
  assertRenderedEqual(config.name, project, "project name");
  assert.deepEqual(Object.keys(config.services).sort(), ["app", "caddy", "db"]);
  assert.deepEqual(Object.keys(config.networks).sort(), [
    "db-private",
    "ingress",
    "proxy-private",
  ]);
  assert.deepEqual(Object.keys(config.volumes).sort(), [
    "attachments",
    "caddy_config",
    "caddy_data",
    "database",
  ]);
  for (const name of ["db-private", "proxy-private"]) {
    assertRenderedEqual(config.networks[name].internal, true, `${name} mode`);
    assertRenderedEqual(
      config.networks[name].driver,
      "bridge",
      `${name} driver`,
    );
  }
  assertRenderedEqual(
    config.networks.ingress.driver,
    "bridge",
    "ingress network driver",
  );
  assert.notEqual(
    config.networks.ingress.internal,
    true,
    "ingress network must be non-internal",
  );
  const runLabels = { [ownerLabel]: runId };
  for (const name of ["db", "app", "caddy"])
    assertRenderedLabels(config.services[name].labels, runLabels, name);
  for (const name of ["db-private", "proxy-private", "ingress"])
    assertRenderedLabels(
      config.networks[name].labels,
      runLabels,
      `${name} network`,
    );
  for (const [name, volume] of Object.entries(config.volumes))
    assertRenderedLabels(volume.labels, runLabels, `${name} volume`);

  const db = config.services.db;
  assertRenderedEqual(
    db.image,
    "postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe",
    "pinned database image",
  );
  assert.deepEqual(db.ports ?? [], [], "database must not publish a host port");
  assert.deepEqual(Object.keys(db.networks ?? {}), ["db-private"]);
  assertMounts(
    db,
    [
      {
        type: "volume",
        source: "database",
        target: "/var/lib/postgresql/data",
      },
    ],
    "database",
  );
  assertRenderedEqual(
    db.environment.POSTGRES_DB,
    env.POSTGRES_DB,
    "database name",
  );
  assertRenderedEqual(
    db.environment.POSTGRES_USER,
    env.POSTGRES_USER,
    "database user",
  );
  assertRenderedEqual(
    db.environment.POSTGRES_PASSWORD,
    env.POSTGRES_PASSWORD,
    "database password",
  );

  const app = config.services.app;
  assert.deepEqual(app.ports ?? [], [], "app must not publish a host port");
  assert.deepEqual(Object.keys(app.networks ?? {}).sort(), [
    "db-private",
    "proxy-private",
  ]);
  assertMounts(
    app,
    [
      {
        type: "volume",
        source: "attachments",
        target: "/app/storage/attachments",
      },
    ],
    "app",
  );
  assertRenderedEqual(app.command.join(" "), "node server.js", "app command");
  assert.ok(app.build, "app must build from the checked out source tree");
  assertRenderedEqual(app.build.context, root, "application build context");
  assertRenderedLabels(
    app.build.labels,
    {
      "org.opencontainers.image.revision": revision,
      "org.opencontainers.image.tree": tree,
      [ownerLabel]: runId,
    },
    "app image",
  );
  assertRenderedEqual(
    app.environment.APP_ORIGIN,
    env.APP_ORIGIN,
    "application origin",
  );
  assertRenderedEqual(
    app.environment.DATABASE_URL,
    env.DATABASE_URL,
    "application database URL",
  );
  assertRenderedEqual(
    app.environment.SESSION_SECRET,
    env.SESSION_SECRET,
    "session secret",
  );
  assertRenderedEqual(
    app.environment.STAGE5_RUN_ID,
    runId,
    "application run ID",
  );
  assertRenderedEqual(
    app.environment.STAGE5_DATABASE_NAME,
    env.POSTGRES_DB,
    "application DB identity",
  );
  assertRenderedEqual(
    app.environment.STAGE5_DATABASE_USER,
    env.POSTGRES_USER,
    "application DB role",
  );
  assertRenderedEqual(
    app.environment.COOKIE_SECURE,
    "true",
    "secure-cookie setting",
  );
  const url = new URL(app.environment.DATABASE_URL);
  assertRenderedEqual(url.protocol, "postgresql:", "database URL scheme");
  assertRenderedEqual(url.hostname, "db", "database URL host");
  assertRenderedEqual(url.username, env.POSTGRES_USER, "database URL user");
  assertRenderedEqual(
    url.password,
    env.POSTGRES_PASSWORD,
    "database URL password",
  );
  assertRenderedEqual(url.pathname, `/${env.POSTGRES_DB}`, "database URL name");
  assertRenderedEqual(
    url.searchParams.get("schema"),
    "public",
    "database URL schema",
  );

  const caddy = config.services.caddy;
  assertRenderedEqual(caddy.image, CADDY_IMAGE, "immutable Caddy image");
  assert.deepEqual(Object.keys(caddy.networks ?? {}).sort(), [
    "ingress",
    "proxy-private",
  ]);
  assert.deepEqual(caddy.ports, [
    {
      mode: "ingress",
      host_ip: "127.0.0.1",
      published: env.STAGE5_HTTPS_PORT,
      target: 443,
      protocol: "tcp",
    },
  ]);
  assertRenderedEqual(
    caddy.environment.LAN_HOST,
    env.STAGE5_HOST,
    "TLS hostname",
  );
  assertMounts(
    caddy,
    [
      {
        type: "bind",
        source: join(root, "operations/Caddyfile"),
        target: "/etc/caddy/Caddyfile",
        read_only: true,
      },
      { type: "volume", source: "caddy_data", target: "/data" },
      { type: "volume", source: "caddy_config", target: "/config" },
    ],
    "Caddy",
  );
}
async function selectPort() {
  const server = createServer();
  await new Promise((ok, fail) =>
    server.once("error", fail).listen(0, "127.0.0.1", ok),
  );
  const address = server.address();
  await new Promise((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok())),
  );
  assert.ok(address && typeof address === "object");
  return address.port;
}
async function assertPortFree(candidate) {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(candidate, "127.0.0.1", resolve),
  );
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function waitForPublishedPort(candidate) {
  const attempts = 20;
  const retryDelayMs = 500;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const socket = createConnection({ host: "127.0.0.1", port: candidate });
        const finish = (error) => {
          socket.destroy();
          if (error) reject(error);
          else resolve();
        };
        socket.setTimeout(1000, () => finish(new Error("connect timeout")));
        socket.once("connect", () => finish());
        socket.once("error", finish);
      });
      return { host: "127.0.0.1", port: candidate, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts)
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(
    `published Caddy port 127.0.0.1:${candidate} did not accept TCP connections after ${attempts} attempts (${lastError?.code ?? lastError?.message ?? "unknown"})`,
  );
}
function inspectLabels(kind, id) {
  return JSON.parse(
    docker([kind, "inspect", id, "--format", "{{json .Config.Labels}}"]),
  );
}
function captureOwnedNetworks() {
  const networkIds = docker([
    "network",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const networks = networkIds.map(
    (id) => JSON.parse(docker(["network", "inspect", id]))[0],
  );
  assert.equal(
    networks.length,
    3,
    "run must own exactly three Compose networks",
  );
  const byComposeName = new Map(
    networks.map((network) => [
      network.Labels?.["com.docker.compose.network"],
      network,
    ]),
  );
  const expectedServices = {
    "db-private": ["app", "db"],
    "proxy-private": ["app", "caddy"],
    ingress: ["caddy"],
  };
  for (const [name, expected] of Object.entries(expectedServices)) {
    const network = byComposeName.get(name);
    assert.ok(network, `owned ${name} network missing`);
    assert.equal(network.Labels?.[ownerLabel], runId);
    assert.equal(network.Labels?.["com.docker.compose.project"], project);
    assert.equal(network.Driver, "bridge");
    assert.equal(network.Internal, name !== "ingress");
    const attachedServices = Object.keys(network.Containers ?? {}).map((id) => {
      const labels = inspectLabels("container", id);
      assert.equal(labels[ownerLabel], runId);
      assert.equal(labels["com.docker.compose.project"], project);
      return labels["com.docker.compose.service"];
    });
    assert.deepEqual(attachedServices.sort(), expected);
  }
  state.networks = networks.map((network) => ({
    composeName: network.Labels["com.docker.compose.network"],
    dockerName: network.Name,
    driver: network.Driver,
    internal: network.Internal,
    ownerRunId: network.Labels[ownerLabel],
    composeProject: network.Labels["com.docker.compose.project"],
    attachedServices: Object.keys(network.Containers ?? {})
      .map((id) => inspectLabels("container", id)["com.docker.compose.service"])
      .sort(),
  }));
}
async function writeEvidence() {
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  await chmod(artifactDir, 0o700);
  await writeFile(
    join(artifactDir, "run-summary.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    { mode: 0o600 },
  );
}
async function cleanup(success) {
  state.cleanup = "label-preflight";
  const containers = docker([
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const volumes = docker([
    "volume",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const networks = docker([
    "network",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const owned = [];
  for (const id of containers) {
    const labels = inspectLabels("container", id);
    if (labels[ownerLabel] !== runId)
      throw new Error(`container ownership mismatch for ${id}; retained`);
    owned.push({ type: "container", id });
  }
  for (const full of volumes) {
    const labels = JSON.parse(
      docker(["volume", "inspect", full, "--format", "{{json .Labels}}"]),
    );
    if (labels?.[ownerLabel] !== runId)
      throw new Error(`volume ownership mismatch for ${full}; retained`);
    owned.push({ type: "volume", id: full });
  }
  for (const full of networks) {
    const labels = JSON.parse(
      docker(["network", "inspect", full, "--format", "{{json .Labels}}"]),
    );
    if (labels?.[ownerLabel] !== runId)
      throw new Error(`network ownership mismatch for ${full}; retained`);
    owned.push({ type: "network", id: full });
  }
  state.resources = owned;
  await captureOwnedContainerLogs(
    owned.filter((item) => item.type === "container"),
  );
  state.cleanup = success
    ? "removing-owned-success-resources"
    : "removing-owned-containers-network-retaining-volumes";
  for (const item of owned.filter((x) => x.type === "container"))
    docker(["rm", "-f", item.id]);
  for (const item of owned.filter((x) => x.type === "network"))
    docker(["network", "rm", item.id]);
  if (success && appImageId) {
    const labels = JSON.parse(
      docker([
        "image",
        "inspect",
        appImageId,
        "--format",
        "{{json .Config.Labels}}",
      ]),
    );
    if (labels?.[ownerLabel] !== runId)
      throw new Error(
        "app image ownership mismatch; image and volumes retained",
      );
    docker(["image", "rm", appImageId]);
    state.images.appImageCleanup = "owned-image-removed-after-success";
  } else if (appImageId) {
    state.images.appImageCleanup = "retained-after-failure";
  }
  if (success)
    for (const item of owned.filter((x) => x.type === "volume"))
      docker(["volume", "rm", item.id]);
  state.cleanup = success
    ? "owned-resources-removed"
    : "owned-containers-network-removed-volumes-retained";
}

async function captureOwnedContainerLogs(containers) {
  if (containers.length === 0) return;
  const directory = join(artifactDir, "failure-logs");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const paths = [];
  for (const [index, item] of containers.entries()) {
    const result = spawnSync(
      "docker",
      ["--context", "default", "logs", "--tail", "300", item.id],
      {
        cwd: root,
        env: childEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 512 * 1024,
      },
    );
    let output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    for (const secret of generatedSecrets)
      if (secret) output = output.replaceAll(secret, "[REDACTED]");
    output = output
      .replace(
        /((?:PASSWORD|SECRET|TOKEN|COOKIE|SESSION)=)[^\s]+/gi,
        "$1[REDACTED]",
      )
      .replace(/(taky_session=)[a-f0-9]{32,}/gi, "$1[REDACTED]")
      .replace(
        /("(?:password|secret|token|cookie|session|authorization)"\s*:\s*")[^"]*(")/gi,
        "$1[REDACTED]$2",
      )
      .replace(
        /((?:cookie|set-cookie|authorization)\s*:\s*)[^\r\n]+/gi,
        "$1[REDACTED]",
      );
    output = Buffer.from(output, "utf8")
      .subarray(0, 256 * 1024)
      .toString("utf8");
    const path = join(directory, `container-${index + 1}.log`);
    await writeFile(
      path,
      `${output}${result.status === 0 ? "" : `\n[log capture exited ${result.status ?? result.signal}]\n`}`,
      { mode: 0o600 },
    );
    paths.push(path);
  }
  state.ownedContainerLogFiles = paths.map((path) =>
    path.slice(artifactDir.length + 1),
  );
}

try {
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  assert.equal(
    status,
    "",
    "Stage 5 runtime verification requires a clean source checkout",
  );
  const revision = git(["rev-parse", "HEAD"]).trim();
  const tree = git(["rev-parse", "HEAD^{tree}"]).trim();
  const prHeadSha = process.env.PR_HEAD_SHA ?? revision;
  assert.match(prHeadSha, /^[a-f0-9]{40}$/);
  state.source = {
    pullRequestHeadSha: prHeadSha,
    checkoutCommit: revision,
    checkoutTree: tree,
  };
  const composeVersion = parseComposeVersion(
    docker(["compose", "version", "--short"]),
  );
  port = await selectPort();
  await assertPortFree(port);
  const context = JSON.parse(docker(["context", "inspect", "default"]))[0];
  const daemonEndpoint = context?.Endpoints?.docker?.Host;
  assert.ok(
    typeof daemonEndpoint === "string" && daemonEndpoint.startsWith("unix://"),
    "Stage 5 requires the local default Docker Unix-socket context",
  );
  const daemonIdentity = docker([
    "info",
    "--format",
    "{{.ID}}|{{.ServerVersion}}|{{.DockerRootDir}}",
  ])
    .trim()
    .split("|");
  assert.equal(daemonIdentity.length, 3);
  assert.ok(daemonIdentity[0] && daemonIdentity[1] && daemonIdentity[2]);
  state.docker = {
    context: "default",
    composeVersion,
    endpoint: daemonEndpoint,
    engineId: daemonIdentity[0],
    serverVersion: daemonIdentity[1],
    dockerRootDir: daemonIdentity[2],
  };
  const hostname = "127.0.0.1";
  const origin = `https://${hostname}:${port}`;
  const dbName = `stage5_${runId.slice(0, 12)}`;
  const dbUser = `stage5_${runId.slice(0, 8)}`;
  const password = randomBytes(24).toString("hex");
  const sessionSecret = randomBytes(32).toString("hex");
  const adminPassword = randomBytes(24).toString("hex");
  const staffPassword = randomBytes(24).toString("hex");
  const adminUsername = `stage5-admin-${runId.slice(0, 8)}`;
  const staffUsername = `stage5-staff-${runId.slice(0, 8)}`;
  generatedSecrets = [
    password,
    sessionSecret,
    adminPassword,
    staffPassword,
    adminUsername,
    staffUsername,
  ];
  const env = {
    STAGE5_PROJECT: project,
    STAGE5_RUN_ID: runId,
    STAGE5_SOURCE_REVISION: revision,
    STAGE5_SOURCE_TREE: tree,
    STAGE5_PR_HEAD_SHA: prHeadSha,
    STAGE5_HOST: hostname,
    STAGE5_HTTPS_PORT: String(port),
    APP_ORIGIN: origin,
    POSTGRES_DB: dbName,
    POSTGRES_USER: dbUser,
    POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgresql://${dbUser}:${password}@db:5432/${dbName}?schema=public`,
    SESSION_SECRET: sessionSecret,
    STAGE5_ADMIN_USERNAME: adminUsername,
    STAGE5_STAFF_USERNAME: staffUsername,
  };
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  envDirectory = await mkdtemp(join(tmpdir(), "taky-stage5-env-"));
  await chmod(envDirectory, 0o700);
  envFile = join(envDirectory, "run.env");
  await writeFile(
    envFile,
    `${Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  for (const [kind, args] of [
    [
      "container",
      ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`],
    ],
    [
      "volume",
      [
        "volume",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ],
    ],
    [
      "network",
      [
        "network",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ],
    ],
    [
      "app-image",
      ["image", "ls", "-q", "--filter", `reference=${project}-app`],
    ],
  ]) {
    assert.equal(
      docker(args).trim(),
      "",
      `randomized project ${project} already has ${kind} resources`,
    );
  }
  const config = JSON.parse(compose(["config", "--format", "json"]));
  verifyComposeConfig(config, env, revision, tree);
  cleanupAllowed = true;
  state.checks.push({
    label: "compose-preflight",
    result:
      "only db/app/caddy; app and db have no host ports; Caddy bound to loopback",
  });

  compose(["build", "app"]);
  state.checks.push({
    label: "source-bound app image build",
    result: "passed",
  });
  appImageId = docker([
    "image",
    "inspect",
    `${project}-app`,
    "--format",
    "{{.Id}}",
  ]);
  appImageId = appImageId.trim();
  const appLabels = JSON.parse(
    docker([
      "image",
      "inspect",
      appImageId,
      "--format",
      "{{json .Config.Labels}}",
    ]),
  );
  assert.equal(appLabels["org.opencontainers.image.revision"], revision);
  assert.equal(appLabels["org.opencontainers.image.tree"], tree);
  assert.equal(appLabels[ownerLabel], runId);
  state.images = {
    appImageId,
    caddyImageReference: config.services.caddy.image,
    databaseImageReference: config.services.db.image,
  };
  compose(["up", "-d", "--wait", "db"]);
  const dbContainer = docker([
    "ps",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    "label=com.docker.compose.service=db",
  ]).trim();
  assert.ok(dbContainer, "fresh database container missing after startup");
  assert.equal(inspectLabels("container", dbContainer)[ownerLabel], runId);
  state.images.databaseImageId = docker([
    "inspect",
    dbContainer,
    "--format",
    "{{.Image}}",
  ]).trim();
  const identityOutput = compose([
    "run",
    "--rm",
    "--no-deps",
    "app",
    "node",
    "scripts/stage5/check-db-identity.mjs",
  ]);
  state.databaseIdentity = JSON.parse(identityOutput.trim().split("\n").at(-1));
  state.checks.push({
    label: "fresh database identity checked before migration",
    result: "passed",
  });
  const migrationContainer = `${project}-migrate`;
  compose([
    "run",
    "-d",
    "--no-deps",
    "--name",
    migrationContainer,
    "app",
    "node",
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
  ]);
  state.resources.push({ type: "container", id: migrationContainer });
  const migrateExit = docker(["wait", migrationContainer]).trim();
  assert.equal(migrateExit, "0", "prisma migrate deploy must succeed");
  state.checks.push({ label: "prisma migrate deploy", result: "passed" });
  docker(["rm", migrationContainer]);
  const migrationOutput = compose([
    "run",
    "--rm",
    "--no-deps",
    "app",
    "node",
    "scripts/stage5/check-migrations.mjs",
  ]);
  const migrationEvidence = JSON.parse(
    migrationOutput.trim().split("\n").at(-1),
  );
  state.migrations = migrationEvidence.migrations;
  assert.ok(state.migrations.length > 0);
  state.checks.push({
    label: "migration source/name/checksum/status comparison",
    result: "passed",
    migrations: state.migrations.length,
  });

  const bootstrapName = `${project}-bootstrap`;
  compose(
    [
      "run",
      "-d",
      "--no-deps",
      "--name",
      bootstrapName,
      "-e",
      "TEST_ADMIN_PASSWORD",
      "-e",
      "TEST_STAFF_PASSWORD",
      "app",
      "node",
      "node_modules/tsx/dist/cli.mjs",
      "scripts/stage5/bootstrap-users.ts",
    ],
    {
      env: {
        ...childEnv,
        TEST_ADMIN_PASSWORD: adminPassword,
        TEST_STAFF_PASSWORD: staffPassword,
      },
    },
  );
  const bootstrapExit = docker(["wait", bootstrapName]).trim();
  assert.equal(bootstrapExit, "0", "synthetic account bootstrap must succeed");
  state.checks.push({
    label: "fresh database synthetic user bootstrap",
    result: "passed",
  });
  docker(["rm", bootstrapName]);
  await assertPortFree(port);
  compose(["up", "-d", "--wait", "app", "caddy"]);
  state.checks.push({
    label: "app and loopback TLS proxy startup",
    result: "passed",
  });
  captureOwnedNetworks();
  caddyContainer = compose(["ps", "-q", "caddy"]).trim();
  assert.ok(caddyContainer);
  assert.equal(inspectLabels("container", caddyContainer)[ownerLabel], runId);
  const caddyImageId = docker([
    "inspect",
    caddyContainer,
    "--format",
    "{{.Image}}",
  ]).trim();
  state.images.caddyImageId = caddyImageId;
  const publishedPorts = JSON.parse(
    docker([
      "inspect",
      caddyContainer,
      "--format",
      "{{json .NetworkSettings.Ports}}",
    ]),
  );
  const actualBinding = publishedPorts?.["443/tcp"];
  assert.ok(Array.isArray(actualBinding) && actualBinding.length === 1);
  assert.equal(actualBinding[0].HostIp, "127.0.0.1");
  assert.equal(actualBinding[0].HostPort, String(port));
  state.caddyPortBinding = {
    containerPort: "443/tcp",
    hostIp: actualBinding[0].HostIp,
    hostPort: actualBinding[0].HostPort,
  };
  state.checks.push({
    label: "owned Caddy loopback port binding",
    result: "passed",
    ...state.caddyPortBinding,
  });
  state.checks.push({
    label: "published Caddy TCP readiness",
    result: "passed",
    ...(await waitForPublishedPort(port)),
  });
  const caPath = join(artifactDir, "caddy-root-ca.crt");
  docker([
    "cp",
    `${caddyContainer}:/data/caddy/pki/authorities/local/root.crt`,
    caPath,
  ]);
  await chmod(caPath, 0o600);
  const nssHome = join(artifactDir, "browser-home");
  const nssDb = join(nssHome, ".pki", "nssdb");
  await mkdir(nssDb, { recursive: true, mode: 0o700 });
  runChecked("initialize isolated Chromium NSS database", "certutil", [
    "-N",
    "--empty-password",
    "-d",
    `sql:${nssDb}`,
  ]);
  runChecked(
    "trust run-local Caddy CA in isolated Chromium profile",
    "certutil",
    [
      "-A",
      "-d",
      `sql:${nssDb}`,
      "-n",
      "Stage5 local Caddy CA",
      "-t",
      "C,,",
      "-i",
      caPath,
    ],
  );
  const tlsEnv = {
    ...childEnv,
    NODE_EXTRA_CA_CERTS: caPath,
    NODE_TLS_REJECT_UNAUTHORIZED: "1",
    HOME: nssHome,
    APP_ORIGIN: origin,
    STAGE5_HOST: hostname,
    STAGE5_RUN_ID: runId,
    STAGE5_ARTIFACT_DIR: artifactDir,
    STAGE5_ADMIN_USERNAME: env.STAGE5_ADMIN_USERNAME,
    STAGE5_STAFF_USERNAME: env.STAGE5_STAFF_USERNAME,
    TEST_ADMIN_PASSWORD: adminPassword,
    TEST_STAFF_PASSWORD: staffPassword,
  };
  runChecked(
    "Node HTTPS API billing/payment/PDF scenario with hostname validation",
    process.execPath,
    ["scripts/stage5/scenario.mjs"],
    tlsEnv,
  );
  const scenario = JSON.parse(
    await readFile(join(artifactDir, "scenario-summary.json"), "utf8"),
  );
  const auditIds = JSON.stringify({
    billingPeriodId: scenario.fixture.billingPeriodId,
    invoiceId: scenario.invoice.id,
  });
  const auditOutput = compose([
    "run",
    "--rm",
    "--no-deps",
    "-e",
    `STAGE5_AUDIT_IDS=${auditIds}`,
    "app",
    "node",
    "scripts/stage5/check-audit.mjs",
  ]);
  state.audit = JSON.parse(auditOutput.trim().split("\n").at(-1));
  state.checks.push({
    label: "financial and payment command audit evidence",
    result: "passed",
  });
  runChecked(
    "Chromium HTTPS navigation with isolated NSS CA trust and hostname validation",
    process.execPath,
    ["scripts/stage5/browser-check.mjs"],
    { ...tlsEnv, HOME: nssHome },
  );
  const pdfEvidence = [
    {
      file: "invoice.pdf",
      number: scenario.invoice.number,
      labels: scenario.invoice.labels,
    },
    {
      file: "invoice-after-source-change.pdf",
      number: scenario.invoice.number,
      labels: scenario.invoice.labels,
    },
    {
      file: "receipt.pdf",
      number: scenario.receipt.number,
      labels: scenario.receipt.labels,
    },
    {
      file: "receipt-after-source-change.pdf",
      number: scenario.receipt.number,
      labels: scenario.receipt.labels,
    },
  ];
  for (const evidence of pdfEvidence) {
    const { file } = evidence;
    const pdf = join(artifactDir, file);
    runChecked(`${file} structure`, "qpdf", ["--check", pdf]);
    const metadata = runChecked(`${file} metadata`, "pdfinfo", [pdf]);
    const pageCount = metadata.match(/^Pages:\s+(\d+)$/m);
    assert.ok(pageCount, `${file} must report its page count`);
    assert.equal(
      Number(pageCount[1]),
      1,
      `${file} must fit on exactly one page`,
    );
    const pageSize = metadata.match(
      /^Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)$/m,
    );
    assert.ok(pageSize, `${file} must be A4`);
    assert.ok(Math.abs(Number(pageSize[1]) - 595.28) < 1);
    assert.ok(Math.abs(Number(pageSize[2]) - 841.89) < 1);
    const text = runChecked(`${file} text extraction`, "pdftotext", [
      "-layout",
      pdf,
      "-",
    ]);
    assert.match(
      text,
      /[\u0E00-\u0E7F]/,
      `${file} extracted text must contain Thai glyphs`,
    );
    const normalizedText = text.replace(/\s+/g, " ");
    assert.ok(
      normalizedText.includes(evidence.number),
      `${file} must contain its document number`,
    );
    assert.ok(
      normalizedText.includes("1,050.01"),
      `${file} must contain exact expected amount 1,050.01`,
    );
    for (const label of Object.values(evidence.labels))
      if (label)
        assert.ok(
          normalizedText.includes(label),
          `${file} must contain frozen label ${label}`,
        );
    for (const changedLabel of [
      scenario.sourceMutation.propertyName,
      scenario.sourceMutation.tenantName,
    ])
      assert.ok(
        !normalizedText.includes(changedLabel),
        `${file} must not contain changed live label`,
      );
    const prefix = file.replace(".pdf", "");
    const png = join(artifactDir, `${prefix}-page.png`);
    runChecked(`${file} rendered first page`, "pdftoppm", [
      "-f",
      "1",
      "-l",
      "1",
      "-png",
      "-singlefile",
      pdf,
      join(artifactDir, prefix),
    ]);
    const ocr = runChecked(`${file} Thai OCR glyph verification`, "tesseract", [
      png,
      "stdout",
      "-l",
      "tha+eng",
    ]);
    assert.match(
      ocr,
      /[\u0E00-\u0E7F]/,
      `${file} rendered page OCR must contain Thai glyphs`,
    );
    state.checks.push({
      label: `${file}-content-and-thai-glyphs`,
      documentNumber: evidence.number,
      exactAmount: "1,050.01",
      frozenLabelsVerified: true,
      extractedTextContainsThai: true,
      renderedOcrContainsThai: true,
      bahtGlyphVisualConfirmation: "pending",
    });
  }
  state.checks.push(
    ...scenario.checks.map((check) => ({
      label: check.name,
      evidence: check.evidence,
    })),
  );
  state.status = "passed";
  state.finishedAt = new Date().toISOString();
} catch (error) {
  state.status = "failed";
  state.failures.push({
    message: error instanceof Error ? error.message : "Unknown failure",
  });
  state.finishedAt = new Date().toISOString();
} finally {
  try {
    if (cleanupAllowed) await cleanup(state.status === "passed");
    else state.cleanup = "not-started-no-owned-resources-created";
  } catch (error) {
    state.cleanup = "ownership-check-failed-resources-retained";
    state.failures.push({
      message: error instanceof Error ? error.message : "Cleanup failed",
    });
    state.status = "failed";
  }
  state.artifactDirectory = artifactDir;
  if (envFile) {
    try {
      await unlink(envFile);
    } catch {
      state.status = "failed";
      state.cleanup = "generated-credential-file-removal-failed";
      state.failures.push({
        message:
          "Generated credential file could not be removed; temporary credentials may remain",
      });
    }
  }
  if (envDirectory) {
    try {
      await rmdir(envDirectory);
    } catch {
      state.status = "failed";
      if (state.cleanup === "owned-resources-removed")
        state.cleanup = "temporary-credential-directory-removal-failed";
      state.failures.push({
        message:
          "Temporary credential directory could not be removed; inspect local runner cleanup",
      });
    }
  }
  await writeEvidence();
  if (state.status !== "passed") process.exitCode = 1;
  else
    process.stdout.write(
      `Stage 5 runtime verification passed. Evidence: ${artifactDir}\n`,
    );
}
