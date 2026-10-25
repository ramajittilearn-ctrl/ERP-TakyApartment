'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');

const root = "/Users/ramajittipasutanavin/Documents/\u0e1b\u0e25\u0e39\u0e01\u0e2b\u0e2d\u0e1e\u0e31\u0e01/ERP/.local/worktrees/recovered-payment-finite";
const qa = "/Users/ramajittipasutanavin/Documents/\u0e1b\u0e25\u0e39\u0e01\u0e2b\u0e2d\u0e1e\u0e31\u0e01/ERP/.local/development-recovered-20261025/.local/qa/finite-helper";
const base = "/Users/ramajittipasutanavin/Documents/\u0e1b\u0e25\u0e39\u0e01\u0e2b\u0e2d\u0e1e\u0e31\u0e01/ERP/.local/development-recovered-20261025/.local/qa/postgres";
const expected = Object.freeze({
  database: 'taky_payment_test_2b5214bd52_routes1',
  role: 'taky_qa_2b5214bd52', project: 'taky-phase4-recovery-20261025',
  host: '127.0.0.1', port: 55489,
});
const targets = Object.freeze({
  integration: 'taky_payment_test_2b5214bd52_finite2',
  rehearsal: 'taky_payment_test_2b5214bd52_finite_rehearsal2',
  blocker: 'taky_payment_test_2b5214bd52_finite_blocker2',
  allocBlocker: 'taky_payment_test_2b5214bd52_finite_alloc_blocker2',
});
const modes = ['validate-plan', 'preflight', 'create-integration', 'create-rehearsal', 'create-blocker', 'create-alloc-blocker', 'setup', 'integration', 'rehearsal', 'blocker', 'alloc-blocker'];
const mode = process.argv[2];
const attempt = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
const lockPath = qa + '/operation.lock';
let privateEnv = Object.create(null);
let sessionSecret = '';
let output = '';
let lockStat;
function clean(value) {
  let result = String(value ?? '');
  const secrets = Object.entries(privateEnv).filter(([key]) => /PASSWORD|SECRET|URL/.test(key)).map(([, value]) => value);
  secrets.push(sessionSecret);
  try {
    const url = new URL(privateEnv.DATABASE_URL);
    secrets.push(url.password, decodeURIComponent(url.password));
  } catch {}
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) result = result.replaceAll(secret, '[redacted synthetic credential]');
  return result.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[synthetic database URL]');
}
function record(value) { output += clean(value); }
function readOwnedFile(file, ownerOnly) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw new Error('QA configuration must be a regular file owned by the current user');
  if (ownerOnly && (stat.mode & 0o077) !== 0) throw new Error('Private QA configuration must deny group and other access');
  return fs.readFileSync(file, 'utf8');
}
function loadPlan() {
  if (process.argv.length !== 3 || !modes.includes(mode)) throw new Error('Unsupported QA command');
  for (const line of readOwnedFile(base + '/private.env', true).split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i);
    if (i < 1 || !/^[A-Z][A-Z0-9_]*$/.test(key) || Object.hasOwn(privateEnv, key)) throw new Error('Invalid or duplicate private QA field');
    privateEnv[key] = line.slice(i + 1);
  }
  const identity = JSON.parse(readOwnedFile(base + '/identity.json', false));
  for (const [key, value] of Object.entries(expected)) if (identity[key] !== value) throw new Error('Pinned QA2 identity metadata mismatch');
  const url = new URL(privateEnv.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== expected.host || url.port !== String(expected.port) || url.pathname !== '/' + expected.database || decodeURIComponent(url.username) !== expected.role || !url.password || url.search || url.hash) throw new Error('Pinned QA2 URL mismatch');
  sessionSecret = privateEnv.SESSION_SECRET || randomBytes(48).toString('hex');
  if (sessionSecret.length < 32) throw new Error('Synthetic session secret too short');
  return url;
}
function acquireLock() {
  const fd = fs.openSync(lockPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, attempt, mode }) + '\n');
    lockStat = fs.fstatSync(fd);
  } finally { fs.closeSync(fd); }
}
function releaseLock() {
  if (!lockStat) return;
  const current = fs.lstatSync(lockPath);
  if (current.dev !== lockStat.dev || current.ino !== lockStat.ino || current.isSymbolicLink()) throw new Error('Operation lock ownership changed; manual inspection required');
  fs.unlinkSync(lockPath);
}
async function connected(url, work) {
  const { Client } = createRequire(root + '/package.json')('pg');
  const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 10000, query_timeout: 10000 });
  try {
    await client.connect();
    const actual = (await client.query('SELECT current_database() AS database, current_user AS role')).rows[0];
    if (actual?.database !== url.pathname.slice(1) || actual?.role !== expected.role) throw new Error('Actual synthetic database or role mismatch');
    record(JSON.stringify({ attested: true, ...actual, host: expected.host, port: expected.port }) + '\n');
    return await work(client);
  } finally { await client.end(); }
}
function runChild(args, url, timeoutMs) {
  const env = {
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: '/private/tmp', LANG: 'en_US.UTF-8', CI: '1', NODE_ENV: 'test',
    DATABASE_URL: url.href, SESSION_SECRET: sessionSecret, DOTENV_CONFIG_PATH: '/dev/null',
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    const chunks = [];
    let hardKill;
    const killGroup = signal => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const stop = () => {
      killGroup('SIGTERM');
      hardKill ??= setTimeout(() => killGroup('SIGKILL'), 5000);
    };
    const capture = chunk => {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) { overflow = true; stop(); return; }
      chunks.push(chunk);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); clearTimeout(hardKill); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      if (timedOut || overflow) killGroup('SIGKILL');
      record(Buffer.concat(chunks).toString());
      record(`Child exit: ${code}; signal: ${signal || 'none'}; timeout: ${timedOut}; outputLimit: ${overflow}\n`);
      resolve(timedOut || overflow ? 1 : (code ?? 1));
    });
  });
}
(async () => {
  const source = loadPlan();
  record(JSON.stringify({ mode, source: expected, targets, planValidated: true }) + '\n');
  if (mode === 'validate-plan') return;
  acquireLock();
  await connected(source, async client => {
    if (!mode.startsWith('create-')) return;
    const database = mode === 'create-integration' ? targets.integration : mode === 'create-blocker' ? targets.blocker : mode === 'create-alloc-blocker' ? targets.allocBlocker : targets.rehearsal;
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
    if (exists.rowCount !== 0) throw new Error('Target database already exists; no reset or reuse for creation');
    // Both identifiers are fixed constants, never supplied by an argument or environment.
    const create = mode === 'create-integration'
      ? 'CREATE DATABASE "taky_payment_test_2b5214bd52_finite2" OWNER "taky_qa_2b5214bd52"'
      : mode === 'create-blocker'
        ? 'CREATE DATABASE "taky_payment_test_2b5214bd52_finite_blocker2" OWNER "taky_qa_2b5214bd52"'
        : mode === 'create-alloc-blocker'
          ? 'CREATE DATABASE "taky_payment_test_2b5214bd52_finite_alloc_blocker2" OWNER "taky_qa_2b5214bd52"'
          : 'CREATE DATABASE "taky_payment_test_2b5214bd52_finite_rehearsal2" OWNER "taky_qa_2b5214bd52"';
    await client.query(create);
    record(`Created isolated database: ${database}\n`);
  });
  if (mode === 'preflight' || mode.startsWith('create-')) return;
  const target = new URL(source.href);
  target.pathname = '/' + (mode === 'rehearsal' ? targets.rehearsal : mode === 'blocker' ? targets.blocker : mode === 'alloc-blocker' ? targets.allocBlocker : targets.integration);
  await connected(target, async client => {
    const tables = (await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'")).rows[0]?.count;
    if (mode !== 'integration' && tables !== 0) throw new Error('Setup and rehearsal require a pristine target; no reset allowed');
    if (mode === 'integration') {
      const applied = (await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows.map(row => row.migration_name);
      if (applied.length !== 16 || applied.at(-1) !== '202610240002_payment_finite_amounts') throw new Error('Integration requires the expected sixteen applied migrations including finite payment checks');
    }
  });
  const args = mode === 'setup'
    ? ['node_modules/prisma/build/index.js', 'migrate', 'deploy']
    : mode === 'rehearsal' || mode === 'blocker' || mode === 'alloc-blocker'
      ? ['--import', 'tsx', 'tests/integration/payment-finite-migration-rehearsal.ts', mode === 'rehearsal' ? 'preserve' : mode]
      : ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts', 'tests/integration/payment-finite.test.ts'];
  process.exitCode = await runChild(args, target, mode === 'setup' ? 120000 : 600000);
})().catch(error => { record(String(error) + '\n'); process.exitCode = 1; }).finally(() => {
  try {
    const directory = root + '/evidence/financial-nan';
    fs.mkdirSync(directory, { recursive: true });
    const artifact = directory + '/database-qa-' + attempt + '.log';
    record(`QA outcome: ${process.exitCode || 0}\n`);
    fs.writeFileSync(artifact, output, { flag: 'wx', mode: 0o600 });
    console.info('Immutable QA evidence: ' + artifact);
    process.stdout.write(output);
  } finally { releaseLock(); }
});
