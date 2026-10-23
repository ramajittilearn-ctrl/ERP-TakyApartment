const { spawnSync } = require('node:child_process');

module.exports = function baselineSetup({ root, env, record }) {
  for (const [command, args, timeout] of [
    ['node_modules/.bin/prisma', ['migrate', 'deploy'], 120000],
    ['node_modules/.bin/tsx', ['prisma/seed.ts'], 120000],
    ['node_modules/.bin/tsx', ['scripts/test-users.ts'], 120000],
  ]) {
    record(`Stage: ${command} ${args.join(' ')}\n`);
    const result = spawnSync(command, args, {
      cwd: root, env, encoding: 'utf8', timeout, killSignal: 'SIGTERM',
      maxBuffer: 16 * 1024 * 1024,
    });
    record(result.stdout || '');
    record(result.stderr || '');
    if (result.error) record(`${result.error.message}\n`);
    record(`Stage exit: ${result.status}; signal: ${result.signal || 'none'}\n`);
    if (result.error || result.status !== 0) return result.status || 1;
  }
  return 0;
};
