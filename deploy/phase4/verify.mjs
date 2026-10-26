import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
function child(command, args) {
  return spawnSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}
function privateIp(value) {
  if (net.isIP(value) !== 4) return false;
  const [a,b] = value.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
try {
  const args = process.argv.slice(2);
  assert(args.length >= 2 && args.length <= 6 && args.length % 2 === 0, 'Supply one to three explicit --env-file paths');
  const files = [];
  for (let i = 0; i < args.length; i += 2) {
    assert(args[i] === '--env-file' && args[i+1] && !args[i+1].startsWith('-'), 'Only explicit --env-file arguments are accepted');
    const file = path.resolve(args[i+1]), stat = lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Environment files must be regular files');
    if (typeof process.getuid === 'function') assert(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'Environment files must be private and owned by the operator');
    files.push('--env-file', file);
  }
  const manifest = JSON.parse(readFileSync(path.join(root,'deploy/phase4/manifest.json'),'utf8'));
  for (const [file, expected] of Object.entries(manifest.frozenInputs)) {
    const result = child('git',['rev-parse','HEAD:'+file]);
    assert(result.status === 0 && result.stdout.trim() === expected, 'Release feature baseline differs from accepted Phase4 inputs');
  }
  const allowedPreparation = file => file.startsWith('deploy/phase4/') || file === 'docker-compose.phase4-release.yml';
  const allDiff = child('git',['diff','--name-only',manifest.featureBaseline]);
  const allExtra = child('git',['ls-files','--others','--exclude-standard']);
  assert(allDiff.status === 0 && allExtra.status === 0, 'Cannot verify release checkout');
  assert([...allDiff.stdout.split('\n'), ...allExtra.stdout.split('\n')].filter(Boolean).every(allowedPreparation), 'Changes outside release preparation are not allowed');
  const diff = child('git',['diff','--name-only',manifest.featureBaseline,'--',...Object.keys(manifest.frozenInputs)]);
  const extra = child('git',['ls-files','--others','--exclude-standard','--',...Object.keys(manifest.frozenInputs)]);
  assert(diff.status === 0 && !diff.stdout.trim() && extra.status === 0 && !extra.stdout.trim(), 'Accepted feature inputs have local changes');
  const result = child('docker',['compose','--project-directory',root,...files,...manifest.composeFiles.flatMap(f=>['-f',path.join(root,f)]),'config','--format','json']);
  assert(result.status === 0, 'Compose rendering failed; inspect configuration privately, not in release assets');
  let config;
  try { config = JSON.parse(result.stdout); } catch { throw new Error('Compose returned invalid configuration'); }
  const services = config.services;
  const names = ['app','operations','evidence-validator','db','caddy'];
  for (const name of names) {
    assert(services[name], 'A required release service is missing');
    assert(/^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$/.test(services[name].image), 'All five runtime images must use sha256 digests');
    assert(!services[name].build, 'Release services must not rebuild at startup');
  }
  assert(JSON.stringify(services.app.command) === JSON.stringify(['node','server.js']), 'App startup must not run migrations or seed');
  for (const name of ['app','db','operations','evidence-validator']) assert(!services[name].ports?.length, 'Only HTTPS ingress may publish a host port');
  assert(services.app.environment.COOKIE_SECURE === 'true', 'Secure cookies are required');
  const origin = new URL(services.app.environment.APP_ORIGIN);
  assert(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/', 'Canonical HTTPS origin required');
  assert(privateIp(origin.hostname) || origin.hostname === 'localhost' || /^[a-z0-9.-]+\.local$/i.test(origin.hostname), 'Canonical origin must address the private LAN');
  const ports = services.caddy.ports || [];
  assert(ports.length === 1 && privateIp(ports[0].host_ip) && Number(ports[0].target) === 443 && Number(ports[0].published) === Number(origin.port || 443), 'Publish only matching HTTPS on an explicit private interface');
  const validator = services['evidence-validator'];
  assert(config.networks.evidence_validation.internal === true, 'Validator network must remain internal');
  assert(Object.keys(validator.networks).length === 1 && Object.hasOwn(validator.networks, 'evidence_validation'), 'Validator may join only its private validation network');
  assert(Object.hasOwn(services.app.networks, 'private') && Object.hasOwn(services.app.networks, 'evidence_validation'), 'App must reach both private services and validator');
  assert(validator.read_only && Number(validator.mem_limit) === 536870912 && Number(validator.memswap_limit) === 536870912 && Number(validator.cpus) === 1 && Number(validator.pids_limit) === 64, 'Validator resource and filesystem limits differ');
  assert(validator.cap_drop.includes('ALL') && validator.security_opt.includes('no-new-privileges:true'), 'Validator privilege limits required');
  assert(!validator.volumes?.length, 'Validator must not mount retained files or host paths');
  assert(services.app.environment.EVIDENCE_VALIDATOR_ORIGIN === 'http://evidence-validator:3835', 'Private validator origin required');
  const token = services.app.environment.EVIDENCE_VALIDATOR_TOKEN;
  assert(/^[a-f0-9]{64}$/.test(token) && token === validator.environment.EVIDENCE_VALIDATOR_TOKEN, 'Matching private validator credentials required');
  console.log(JSON.stringify({ configurationValid:true, acceptedFeatureInputsUnchanged:true, digestPinnedServices:names, automaticMigration:false, automaticSeed:false, productionTargetVerified:false, imageAvailabilityVerified:false, actualUpgradeRehearsalVerified:false }));
} catch (error) {
  // Only our fixed assertions are public. System/parser errors may contain private config.
  const message = error?.name === 'AssertionError' ? String(error.message).split('\n')[0] : 'Release verification failed; inspect inputs privately';
  console.error(JSON.stringify({configurationValid:false,message}));
  process.exitCode = 1;
}
