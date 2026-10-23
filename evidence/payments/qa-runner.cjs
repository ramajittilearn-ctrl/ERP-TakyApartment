const fs = require('node:fs');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const base = '/private/tmp/taky-payment-qa2';
const root = '/private/tmp/taky-payment-development';
const mode = process.argv[2] || 'preflight';
const permitted = {
  preflight: null,
  rehearsal: ['node_modules/.bin/tsx', 'tests/integration/payments-migration-rehearsal.ts'],
  integration: ['node_modules/.bin/vitest', 'run', '--config', 'vitest.integration.config.ts', 'tests/integration/payments.test.ts'],
  'baseline-setup': null,
  'baseline-integration': ['node_modules/.bin/vitest', 'run', '--config', 'vitest.integration.config.ts', '--exclude', 'tests/integration/payments.test.ts'],
};
const attempt = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
let privateEnv = {};
let output = '';
function clean(value) {
  let result = String(value || '');
  for (const [key, secret] of Object.entries(privateEnv)) {
    if (secret && (key.includes('PASSWORD') || key.includes('SECRET') || key.endsWith('_URL'))) {
      result = result.replaceAll(secret, '[redacted synthetic credential]');
    }
  }
  return result.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[synthetic database URL]');
}
function record(value) { output += clean(value); }
(async () => {
  if (!Object.hasOwn(permitted, mode) || process.argv.length > 3) throw new Error('Unsupported QA command');
  privateEnv = Object.fromEntries(fs.readFileSync(base + '/private.env', 'utf8').trim().split('\n').filter(Boolean).map(line => {
    const i = line.indexOf('=');
    if (i < 1) throw new Error('Invalid private QA environment');
    return [line.slice(0, i), line.slice(i + 1)];
  }));
  const identity = JSON.parse(fs.readFileSync(base + '/identity.json', 'utf8'));
  const url = new URL(privateEnv.DATABASE_URL);
  if (url.hostname !== identity.host || Number(url.port || 5432) !== Number(identity.port)) throw new Error('Synthetic database endpoint mismatch');
  const baseline = mode.startsWith('baseline-');
  if (baseline && (identity.database !== 'taky_phase2_test' || url.pathname !== '/taky_phase2_test' || url.search)) throw new Error('Baseline requires exact isolated database taky_phase2_test');
  if (mode === 'baseline-setup') {
    for (const key of ['SESSION_SECRET', 'TEST_ADMIN_PASSWORD', 'TEST_STAFF_PASSWORD']) {
      if (!privateEnv[key]) throw new Error(`Missing private QA field: ${key}`);
    }
  }
  const { Client } = createRequire(root + '/package.json')('pg');
  const client = new Client({ connectionString: privateEnv.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 10000 });
  let response;
  try {
    await client.connect();
    response = await client.query("SELECT current_database() AS database, current_user AS role, (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') AS public_tables");
  } finally { await client.end(); }
  if (response.rows[0].database !== identity.database || response.rows[0].role !== identity.role) throw new Error('Synthetic database identity mismatch');
  record(JSON.stringify({ verified: true, ...response.rows[0], host: identity.host, port: identity.port }) + '\n');
  if ((mode === 'rehearsal' || mode === 'baseline-setup') && response.rows[0].public_tables !== 0) throw new Error('Setup/rehearsal requires pristine database');
  if (mode === 'preflight') return;
  const env = { ...process.env, ...privateEnv, DOTENV_CONFIG_PATH: '/dev/null' };
  if (mode === 'baseline-setup') {
    process.exitCode = require('./baseline-setup.cjs')({ root, env, record });
    return;
  }
  const [command, ...args] = permitted[mode];
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 600000, killSignal: 'SIGTERM', maxBuffer: 32 * 1024 * 1024 });
  record(result.stdout || '');
  record(result.stderr || '');
  if (result.error) record(result.error.message + '\n');
  record(`Command exit: ${result.status}; signal: ${result.signal || 'none'}\n`);
  process.exitCode = result.error ? 1 : (result.status ?? 1);
})().catch(error => { record(String(error) + '\n'); process.exitCode = 1; }).finally(() => {
  const safeMode = Object.hasOwn(permitted, mode) ? mode : 'unsupported';
  const artifact = root + '/evidence/payments/qa-' + safeMode + '-' + attempt + '.log';
  record(`QA outcome: ${process.exitCode || 0}\n`);
  fs.writeFileSync(artifact, output, { flag: 'wx' });
  fs.copyFileSync(artifact, root + '/evidence/payments/qa-' + safeMode + '.log');
  console.info('Immutable QA evidence: ' + artifact);
  process.stdout.write(output);
});
