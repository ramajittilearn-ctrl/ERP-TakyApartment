'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');

const root = '/private/tmp/taky-receipt-pdf';
const base = '/private/tmp/taky-payment-qa2';
const expected = Object.freeze({
  database: 'taky_payment_test_2b5214bd52_routes1',
  role: 'taky_qa_2b5214bd52',
  project: 'taky-payment-qa2-isolated',
  host: '127.0.0.1',
  port: 55489,
});
const attempt = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
let privateEnv = Object.create(null);
let sessionSecret = '';
let output = '';
function clean(value) {
  let result = String(value ?? '');
  const secrets = Object.entries(privateEnv)
    .filter(([key]) => /PASSWORD|SECRET|URL/.test(key))
    .map(([, value]) => value);
  secrets.push(sessionSecret);
  if (privateEnv.DATABASE_URL) {
    try {
      const url = new URL(privateEnv.DATABASE_URL);
      secrets.push(url.password, decodeURIComponent(url.password));
    } catch {
      // Keep the full configured value redacted even when validation rejects it.
    }
  }
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(secret, '[redacted synthetic credential]');
  }
  return result.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[synthetic database URL]');
}
function record(value) { output += clean(value); }
function readOwnedFile(file, ownerOnly) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()) {
    throw new Error('QA configuration must be a regular file owned by the current user');
  }
  if (ownerOnly && (stat.mode & 0o077) !== 0) {
    throw new Error('Private QA environment must deny group and other access');
  }
  return fs.readFileSync(file, 'utf8');
}

(async () => {
  if (process.argv.length !== 3 || !['preflight', 'integration'].includes(process.argv[2])) {
    throw new Error('Use exactly preflight or integration');
  }
  for (const line of readOwnedFile(base + '/private.env', true).split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    if (separator < 1 || !/^[A-Z][A-Z0-9_]*$/.test(key) || Object.hasOwn(privateEnv, key)) {
      throw new Error('Invalid or duplicate private QA environment field');
    }
    privateEnv[key] = line.slice(separator + 1);
  }
  const identity = JSON.parse(readOwnedFile(base + '/identity.json', false));
  for (const [key, value] of Object.entries(expected)) {
    if (identity[key] !== value) throw new Error('Pinned synthetic database identity metadata mismatch');
  }
  const url = new URL(privateEnv.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== expected.host ||
      url.port !== String(expected.port) || url.pathname !== '/' + expected.database ||
      decodeURIComponent(url.username) !== expected.role || !url.password || url.search || url.hash) {
    throw new Error('Pinned synthetic database connection mismatch');
  }
  sessionSecret = privateEnv.SESSION_SECRET || randomBytes(48).toString('hex');
  if (sessionSecret.length < 32) throw new Error('Synthetic session secret is too short');

  const { Client } = createRequire(root + '/package.json')('pg');
  const client = new Client({
    connectionString: privateEnv.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  let actual;
  try {
    await client.connect();
    const response = await client.query('SELECT current_database() AS database, current_user AS role');
    actual = response.rows[0];
  } finally { await client.end(); }
  if (actual?.database !== expected.database || actual?.role !== expected.role) {
    throw new Error('Actual PostgreSQL database or role does not match the pinned synthetic target');
  }
  record(JSON.stringify({ verified: true, ...expected, mode: process.argv[2] }) + '\n');
  if (process.argv[2] === 'preflight') return;

  const env = {
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: '/private/tmp',
    LANG: 'en_US.UTF-8',
    CI: '1',
    NODE_ENV: 'test',
    DATABASE_URL: privateEnv.DATABASE_URL,
    SESSION_SECRET: sessionSecret,
    DOTENV_CONFIG_PATH: '/dev/null',
  };
  const args = ['node_modules/vitest/vitest.mjs', 'run', '--config',
    'vitest.integration.config.ts', 'tests/integration/receipt-pdf.test.ts'];
  const result = spawnSync(process.execPath, args, {
    cwd: root, env, encoding: 'utf8', timeout: 600000,
    killSignal: 'SIGTERM', maxBuffer: 32 * 1024 * 1024,
  });
  record(result.stdout);
  record(result.stderr);
  if (result.error) record(result.error.message + '\n');
  record(`Command exit: ${result.status}; signal: ${result.signal || 'none'}\n`);
  process.exitCode = result.error ? 1 : (result.status ?? 1);
})().catch(error => {
  record(String(error) + '\n');
  process.exitCode = 1;
}).finally(() => {
  const directory = root + '/evidence/receipt-pdf';
  fs.mkdirSync(directory, { recursive: true });
  const artifact = directory + '/database-qa-' + attempt + '.log';
  record(`QA outcome: ${process.exitCode || 0}\n`);
  fs.writeFileSync(artifact, output, { flag: 'wx', mode: 0o600 });
  console.info('Immutable QA evidence: ' + artifact);
  process.stdout.write(output);
});
