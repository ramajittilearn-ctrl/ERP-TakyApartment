import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { extractZip, fetchLimited, githubApiBase, validateManifest } from './consume-forky-pgdg-provenance.mjs';

const env = {
  GITHUB_REPOSITORY: 'ramajittilearn-ctrl/ERP-TakyApartment',
  GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_SHA: 'a'.repeat(40), PULL_REQUEST_HEAD_SHA: 'b'.repeat(40),
};
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const nameBytes = Buffer.from(name), compressed = deflateRawSync(bytes), crc = crc32(bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(8, 8); head.writeUInt32LE(crc, 14); head.writeUInt32LE(compressed.length, 18);
    head.writeUInt32LE(bytes.length, 22); head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, compressed);
    const row = Buffer.alloc(46);
    row.writeUInt32LE(0x02014b50); row.writeUInt16LE((3 << 8) | 20, 4); row.writeUInt16LE(20, 6);
    row.writeUInt16LE(0x800, 8); row.writeUInt16LE(8, 10); row.writeUInt32LE(crc, 16);
    row.writeUInt32LE(compressed.length, 20); row.writeUInt32LE(bytes.length, 24);
    row.writeUInt16LE(nameBytes.length, 28); row.writeUInt32LE(((0x8000 | 0o600) << 16) >>> 0, 38);
    row.writeUInt32LE(offset, 42);
    central.push(row, nameBytes);
    offset += head.length + nameBytes.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE([...files].length, 8); end.writeUInt16LE([...files].length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function fixture() {
  const files = new Map();
  const rootBytes = Buffer.from('authenticated postgresql package fixture');
  const item = {
    package: 'postgresql-17', version: '17.11-1.pgdg14+2', architecture: 'amd64',
    filename: 'pool/main/p/postgresql-17/postgresql-17_17.11-1.pgdg14+2_amd64.deb',
    aptUri: 'https://apt.postgresql.org/pub/repos/apt/pool/main/p/postgresql-17/postgresql-17_17.11-1.pgdg14+2_amd64.deb', origins: ['pgdg-forky'],
    sha256: sha256(rootBytes), size: rootBytes.length,
  };
  files.set('packages/postgresql-17_17.11-1.pgdg14+2_amd64.deb', rootBytes);
  files.set('metadata/debian-forky.InRelease', Buffer.from('signed Debian Release evidence'));
  files.set('metadata/pgdg-forky.InRelease', Buffer.from('signed PGDG Release evidence'));
  const manifest = {
    schemaVersion: 1, status: 'PASS',
    workflow: {
      GITHUB_REPOSITORY: env.GITHUB_REPOSITORY, GITHUB_RUN_ID: env.GITHUB_RUN_ID,
      GITHUB_RUN_ATTEMPT: env.GITHUB_RUN_ATTEMPT, GITHUB_EVENT_NAME: env.GITHUB_EVENT_NAME,
      GITHUB_SHA: env.GITHUB_SHA, PULL_REQUEST_HEAD_SHA: env.PULL_REQUEST_HEAD_SHA,
    },
    debianForky: { release: { codename: 'forky', origin: 'Debian' } },
    pgdgForky: { release: { codename: 'forky-pgdg', origin: 'apt.postgresql.org' } },
    dependencyClosure: {
      rootPackage: { name: 'postgresql-17', version: '17.11-1.pgdg14+2', architecture: 'amd64', requiredOrigin: 'apt.postgresql.org' },
      packages: [item],
    },
    clearance: { runtimeVerification: false, imageSelection: false, scannerClearance: false, cveDisposition: false, productionClearance: false },
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  files.set('provenance.json', manifestBytes);
  files.set('status.json', Buffer.from(JSON.stringify({ status: 'PASS', manifestSha256: sha256(manifestBytes) })));
  return files;
}

test('accepts same-run manifest and exact package bytes, and extracts a safe ZIP', () => {
  const files = fixture();
  assert.equal(validateManifest(files, env).dependencyClosure.packages.length, 1);
  assert.equal(validateManifest(extractZip(zip(files)), env).workflow.GITHUB_RUN_ID, '42');
});

test('accepts Debian all-architecture epoch packages with APT-escaped local names', () => {
  const files = fixture(), manifest = JSON.parse(files.get('provenance.json'));
  const bytes = Buffer.from('authenticated Debian all-architecture package');
  manifest.dependencyClosure.packages.push({
    package: 'libaudit-common', version: '1:4.1.2-1', architecture: 'all',
    filename: 'pool/main/a/audit/libaudit-common_4.1.2-1_all.deb',
    aptUri: 'https://deb.debian.org/debian/pool/main/a/audit/libaudit-common_4.1.2-1_all.deb',
    origins: ['debian-forky'], sha256: sha256(bytes), size: bytes.length,
  });
  files.set('packages/libaudit-common_1%3a4.1.2-1_all.deb', bytes);
  const tildeBytes = Buffer.from('authenticated prerelease-version package');
  manifest.dependencyClosure.packages.push({
    package: 'libfoo', version: '1.2~rc1-1', architecture: 'amd64',
    filename: 'pool/main/libf/libfoo/libfoo_1.2~rc1-1_amd64.deb',
    aptUri: 'https://deb.debian.org/debian/pool/main/libf/libfoo/libfoo_1.2~rc1-1_amd64.deb',
    origins: ['debian-forky'], sha256: sha256(tildeBytes), size: tildeBytes.length,
  });
  files.set('packages/libfoo_1.2~rc1-1_amd64.deb', tildeBytes);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  files.set('provenance.json', manifestBytes);
  files.set('status.json', Buffer.from(JSON.stringify({ status: 'PASS', manifestSha256: sha256(manifestBytes) })));
  assert.equal(validateManifest(files, env).dependencyClosure.packages.length, 3);
  assert.equal(validateManifest(extractZip(zip(files)), env).dependencyClosure.packages.length, 3);
});

test('rejects run identity, manifest digest, package byte, origin, and clearance changes', () => {
  const mismatch = fixture();
  assert.throws(() => validateManifest(mismatch, { ...env, GITHUB_RUN_ATTEMPT: '1' }), /workflow binding/);
  const badStatus = fixture();
  badStatus.set('status.json', Buffer.from(JSON.stringify({ status: 'PASS', manifestSha256: '0'.repeat(64) })));
  assert.throws(() => validateManifest(badStatus, env), /manifest digest/);
  const badPackage = fixture();
  badPackage.set('packages/postgresql-17_17.11-1.pgdg14+2_amd64.deb', Buffer.from('tampered'));
  assert.throws(() => validateManifest(badPackage, env), /Package bytes differ/);
  const badOrigin = fixture(), originManifest = JSON.parse(badOrigin.get('provenance.json'));
  originManifest.dependencyClosure.packages[0].origins = ['debian-forky'];
  const originBytes = Buffer.from(JSON.stringify(originManifest));
  badOrigin.set('provenance.json', originBytes);
  badOrigin.set('status.json', Buffer.from(JSON.stringify({ status: 'PASS', manifestSha256: sha256(originBytes) })));
  assert.throws(() => validateManifest(badOrigin, env), /Package download URI origin/);
  const badClearance = fixture(), clearManifest = JSON.parse(badClearance.get('provenance.json'));
  clearManifest.clearance.productionClearance = true;
  const clearBytes = Buffer.from(JSON.stringify(clearManifest));
  badClearance.set('provenance.json', clearBytes);
  badClearance.set('status.json', Buffer.from(JSON.stringify({ status: 'PASS', manifestSha256: sha256(clearBytes) })));
  assert.throws(() => validateManifest(badClearance, env), /must not assert clearance/);
});

test('rejects ZIP traversal, extra files, and corrupt entry bytes', () => {
  const files = fixture();
  assert.throws(() => extractZip(zip([...files, ['packages/../escape.deb', Buffer.from('x')]])), /Unsafe ZIP/);
  assert.throws(() => extractZip(zip([...files, ['unexpected.txt', Buffer.from('x')]])), /Unexpected ZIP/);
  const corrupt = zip(files);
  corrupt[40] ^= 0xff;
  assert.throws(() => extractZip(corrupt), /ZIP|entry|header/);
});

test('rejects malformed signed paths, URI origins, encoded separators, and root Architecture all', () => {
  for (const mutate of [
    (item) => { item.filename = 'pool/../escape.deb'; },
    (item) => { item.aptUri = 'https://evil.example/pool/main/p/postgresql-17/package.deb'; },
    (item) => { item.aptUri = 'https://apt.postgresql.org/pub/repos/apt/pool%2fmain/p/postgresql-17/package.deb'; },
    (item) => { item.architecture = 'all'; item.filename = 'pool/main/p/postgresql-17/postgresql-17_17.11-1.pgdg14+2_all.deb'; },
  ]) {
    const files = fixture(), manifest = JSON.parse(files.get('provenance.json'));
    mutate(manifest.dependencyClosure.packages[0]);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    files.set('provenance.json', manifestBytes);
    files.set('status.json', Buffer.from(JSON.stringify({ status: 'PASS', manifestSha256: sha256(manifestBytes) })));
    assert.throws(() => validateManifest(files, env));
  }
});

test('requires HTTPS GitHub API origin before any authenticated request', () => {
  assert.equal(githubApiBase('https://api.github.com/'), 'https://api.github.com');
  for (const value of [
    'http://github.example.test', 'https://user:secret@github.example.test',
    'https://github.example.test', 'https://api.github.com:8443',
    'https://github.example.test/api/v3', 'https://github.example.test/?token=secret',
    'https://github.example.test/#fragment', 'not a URL',
  ]) assert.throws(() => githubApiBase(value), /GitHub API base URL/);
});

test('uses a longer bounded timeout for large artifact downloads than API metadata', async () => {
  const originalFetch = globalThis.fetch, originalTimeout = globalThis.AbortSignal.timeout;
  const observedTimeouts = [];
  globalThis.fetch = async () => new globalThis.Response('ok');
  globalThis.AbortSignal.timeout = (milliseconds) => {
    observedTimeouts.push(milliseconds);
    return new globalThis.AbortController().signal;
  };
  try {
    await fetchLimited('https://api.github.com/metadata', {}, 100, 'metadata');
    await fetchLimited('https://api.github.com/artifact.zip', {}, 100, 'artifact', 5 * 60_000);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.AbortSignal.timeout = originalTimeout;
  }
  assert.deepEqual(observedTimeouts, [20_000, 300_000]);
});
