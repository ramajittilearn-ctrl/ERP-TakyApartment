'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const root = '/private/tmp/taky-development';
const localRequire = createRequire(path.join(root, 'package.json'));
const runId = '4896c4d1e00a0ca6939fd8bc';
const role = `int_${runId}`;
const project = `taky-remediation-integration-${runId}`;
const mode = process.argv[2];
const modes = ['validate-plan', 'preflight', 'setup', 'integration'];
const attempt = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
const expected = { project, runId, role, database: 'taky_phase2_test', host: '127.0.0.1', port: 55451, subnet: '10.253.244.0/28', volume: `${project}_database`, origin: 'http://127.0.0.1:3820' };
let secrets = [];
let output = '';
let lock;
function clean(value) {
  let text = String(value || '');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[synthetic database URL]');
}
function record(value) { output += clean(value); }
function privateFile(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || (info.mode & 0o077)) throw new Error('Private plan file required');
  return fs.readFileSync(file, 'utf8');
}
function loadPlan() {
  try {
    const { parse } = localRequire('dotenv');
    const { z } = localRequire('zod');
    const hex = length => z.string().regex(new RegExp(`^[a-f0-9]{${length}}$`));
    const env = z.object({
      DATABASE_URL: z.string(), POSTGRES_DB: z.literal(expected.database),
      SESSION_SECRET: hex(64), TEST_ADMIN_PASSWORD: hex(48), TEST_STAFF_PASSWORD: hex(48),
      APP_ORIGIN: z.literal(expected.origin), PLAYWRIGHT_BASE_URL: z.literal(expected.origin), COOKIE_SECURE: z.literal('false'),
      E2E_RUN_ID: z.literal(runId), E2E_PROOF_SECRET: hex(64), REMEDIATION_PROJECT: z.literal(project),
      SCREENSHOT_DIR: z.literal(`evidence/remediation/browser-${runId}/screenshots`),
    }).strict().parse(parse(privateFile(path.join(root, `.local/remediation-${runId}.env`))));
    secrets = Object.entries(env).filter(([key]) => /PASSWORD|SECRET|DATABASE_URL/.test(key)).map(([, value]) => value);
    const url = new URL(env.DATABASE_URL);
    const password = decodeURIComponent(url.password);
    secrets.push(password);
    if (url.protocol !== 'postgresql:' || url.hostname !== expected.host || url.port !== String(expected.port) || url.pathname !== `/${expected.database}` || url.username !== role || url.search || url.hash || !/^[a-f0-9]{48}$/.test(password)) throw new Error('Endpoint mismatch');
    const compose = JSON.parse(privateFile(path.join(root, `.local/remediation-${runId}-compose.json`)));
    const wantedCompose = {
      name: project, services: { db: {
        image: 'postgres:17-bookworm', environment: { POSTGRES_DB: expected.database, POSTGRES_USER: role, POSTGRES_PASSWORD: password },
        ports: ['127.0.0.1:55451:5432'], volumes: ['database:/var/lib/postgresql/data'],
        healthcheck: { test: ['CMD-SHELL', `pg_isready -U ${role} -d ${expected.database}`], interval: '1s', timeout: '3s', retries: 30 },
      } }, networks: { default: { ipam: { config: [{ subnet: expected.subnet }] } } }, volumes: { database: {} },
    };
    const publicPlan = JSON.parse(fs.readFileSync(path.join(root, `evidence/remediation/integration-${runId}.json`), 'utf8'));
    if (!isDeepStrictEqual(compose, wantedCompose) || !isDeepStrictEqual(publicPlan, expected)) throw new Error('Plan mismatch');
    return env;
  } catch { throw new Error('Missing, unsafe or mismatched exact isolated plan'); }
}
async function attest(env) {
  const { Client } = localRequire('pg');
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    const response = await client.query("SELECT current_database() AS database, current_user AS role, (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') AS public_tables");
    const actual = response.rows[0];
    if (actual?.database !== expected.database || actual.role !== role) throw new Error('Identity mismatch');
    record(`${JSON.stringify({ attested: true, ...actual, host: expected.host, port: expected.port })}\n`);
    return actual;
  } catch { throw new Error('Exact isolated database attestation failed before mutation'); }
  finally { await client.end(); }
}
function stage(env, command, args, timeout) {
  record(`Stage: ${command} ${args.join(' ')}\n`);
  const childEnv = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '/private/tmp', TMPDIR: process.env.TMPDIR || '/private/tmp', LANG: 'en_US.UTF-8', ...env, DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'test', CI: 'true', NO_COLOR: '1' };
  const result = spawnSync(command, args, { cwd: root, env: childEnv, encoding: 'utf8', timeout, killSignal: 'SIGTERM', maxBuffer: 32 * 1024 * 1024 });
  record(result.stdout); record(result.stderr);
  record(`Stage outcome: ${JSON.stringify({ exitCode: result.status, signal: result.signal, error: result.error?.code || null })}\n`);
  if (result.error || result.status !== 0) throw new Error('QA stage failed; no later stage executed');
}
(async () => {
  if (!modes.includes(mode) || process.argv.length !== 3) throw new Error('Use validate-plan, preflight, setup or integration');
  const env = loadPlan();
  record(`${JSON.stringify({ mode, attempt, ...expected, planValidated: true })}\n`);
  if (mode === 'validate-plan') return;
  lock = fs.openSync('/private/tmp/taky-combined-db-qa/active.lock', 'wx', 0o600);
  const actual = await attest(env);
  if (mode === 'preflight') return;
  if (mode === 'setup') {
    if (actual.public_tables !== 0) throw new Error('Setup requires zero public tables; no reset is permitted');
    stage(env, 'node_modules/.bin/prisma', ['migrate', 'deploy'], 120000);
    stage(env, 'node_modules/.bin/tsx', ['prisma/seed.ts'], 120000);
    stage(env, 'node_modules/.bin/tsx', ['scripts/test-users.ts'], 120000);
  } else {
    stage(env, 'node_modules/.bin/vitest', ['run', '--config', 'vitest.integration.config.ts', '--exclude', 'tests/integration/payments.test.ts', '--exclude', 'tests/integration/payment-routes.test.ts'], 600000);
  }
})().catch(error => { record(`${clean(error.message)}\n`); process.exitCode = 1; }).finally(() => {
  if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync('/private/tmp/taky-combined-db-qa/active.lock'); }
  record(`Outcome: ${process.exitCode || 0}\n`);
  const directory = path.join(root, 'evidence/agent-uat');
  fs.mkdirSync(directory, { recursive: true });
  const label = modes.includes(mode) ? mode : 'unsupported';
  const artifact = path.join(directory, `combined-db-${label}-${attempt}.log`);
  fs.writeFileSync(artifact, clean(output), { flag: 'wx', mode: 0o600 });
  console.info(`Immutable evidence: ${artifact}`);
  process.stdout.write(clean(output));
});
