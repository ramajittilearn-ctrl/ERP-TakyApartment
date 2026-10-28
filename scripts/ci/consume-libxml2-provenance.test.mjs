import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { extractZip, validateArtifactMetadata, validateManifest, validateWorkflowRun } from './consume-libxml2-provenance.mjs';

const patch = Buffer.from('fixture patch bytes');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const debVer = '2.12.7+dfsg+really2.9.14-2.1+deb13u3';
const debOrigVer = '2.12.7+dfsg+really2.9.14';
const ubuVer = '2.9.13+dfsg-1ubuntu0.12';
const ubuOrigVer = '2.9.13+dfsg';
const env = { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: 'a'.repeat(40), PULL_REQUEST_HEAD_SHA: 'b'.repeat(40) };

function fixtureFiles() {
  const files = new Map();
  const sourceArtifacts = {};
  for (const [directory, version, origVersion] of [['debian-source', debVer, debOrigVer], ['ubuntu-source', ubuVer, ubuOrigVer]]) {
    const names = [`libxml2_${version}.dsc`, `libxml2_${origVersion}.orig.tar.xz`, `libxml2_${version}.debian.tar.xz`];
    const records = [];
    names.forEach((name, index) => {
      const bytes = Buffer.from(`${directory}-${index}`);
      files.set(`${directory}/${name}`, bytes);
      records.push({ name, sha256: hash(bytes) });
    });
    files.set(`${directory}/SHA256SUMS`, Buffer.from(records.map((item) => `${item.sha256}  ${item.name}`).join('\n') + '\n'));
    sourceArtifacts[directory] = records;
  }
  files.set('debian/patches/CVE-2026-6653.patch', patch);
  files.set('metadata/debian-trixie.InRelease', Buffer.from('signed release bytes'));
  files.set('metadata/debian-trixie.Sources.apt-cache', Buffer.from('authenticated source index bytes'));
  const keyring = Buffer.from('pinned keyring package bytes');
  files.set('metadata/debian-archive-keyring_2023.3+deb12u2_all.deb', keyring);
  const manifest = {
    schemaVersion: 1,
    workflow: { runId: '42', runAttempt: 2, eventName: 'pull_request', eventSha: env.GITHUB_SHA, checkedOutRevision: env.GITHUB_SHA, pullRequestHeadSha: env.PULL_REQUEST_HEAD_SHA },
    verification: { authenticatedReleaseMetadata: true, dscSignaturesAndListedHashes: true },
    debian: { source: 'libxml2', version: debVer, suite: 'trixie', snapshot: '20261027T000000Z', uri: 'https://snapshot.debian.org/archive/debian/20261027T000000Z', releaseInReleaseSha256: hash(files.get('metadata/debian-trixie.InRelease')), aptAuthenticatedSourcesIndexSha256: hash(files.get('metadata/debian-trixie.Sources.apt-cache')), sourceArtifacts: sourceArtifacts['debian-source'] },
    ubuntuJammyPatchSource: { source: 'libxml2', version: ubuVer, suite: 'jammy-security', snapshot: '20260622T130000Z', uri: 'https://snapshot.ubuntu.com/ubuntu/20260622T130000Z', patchPath: 'debian/patches/CVE-2026-6653.patch', patchSha256: hash(patch), sourceArtifacts: sourceArtifacts['ubuntu-source'] },
    debianArchiveKeyringBootstrap: { keyringPackageVersion: '2023.3+deb12u2', keyringPackageSha256: hash(keyring) },
  };
  files.set('provenance.json', Buffer.from(JSON.stringify(manifest)));
  return files;
}

function zip(files) {
  const entries = [...files];
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, bytes] of entries) {
    const nameBytes = Buffer.from(name);
    const compressed = deflateRawSync(bytes);
    const crc = crc32(bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(bytes.length, 22); head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, compressed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE((3 << 8) | 20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(compressed.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(nameBytes.length, 28); dir.writeUInt32LE(((0x8000 | 0o600) << 16) >>> 0, 38); dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += head.length + nameBytes.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

test('accepts exact run-bound provenance and validates every source hash', () => {
  const files = fixtureFiles();
  assert.equal(validateManifest(files, env, hash(patch)).debian.version, debVer);
  const archive = extractZip(zip(files));
  assert.equal(validateManifest(archive, env, hash(patch)).workflow.runAttempt, 2);
});

test('rejects run, attempt, event, merge revision, PR head and artifact content tampering', () => {
  const files = fixtureFiles();
  for (const [key, value] of [['GITHUB_RUN_ID', '43'], ['GITHUB_RUN_ATTEMPT', '1'], ['GITHUB_EVENT_NAME', 'push'], ['GITHUB_SHA', 'c'.repeat(40)], ['PULL_REQUEST_HEAD_SHA', 'd'.repeat(40)]]) {
    assert.throws(() => validateManifest(files, { ...env, [key]: value }, hash(patch)), /Provenance manifest/);
  }
  const altered = fixtureFiles();
  altered.set('debian-source/libxml2_' + debVer + '.dsc', Buffer.from('tampered'));
  assert.throws(() => validateManifest(altered, env, hash(patch)), /SHA-256 mismatch/);
  const wrongPatch = fixtureFiles();
  wrongPatch.set('debian/patches/CVE-2026-6653.patch', Buffer.from('wrong patch'));
  assert.throws(() => validateManifest(wrongPatch, env, hash(patch)), /patch path or digest mismatch/);
});

test('rejects path traversal, duplicate entries and corrupted ZIP data', () => {
  const fixture = fixtureFiles();
  assert.throws(() => extractZip(zip([...fixture, ['x/../escape', Buffer.from('x')]])), /Unsafe ZIP entry path/);
  assert.throws(() => extractZip(zip([...fixture, ['provenance.json', Buffer.from('{}')]])), /Duplicate ZIP entry path/);
  const damaged = zip(fixture);
  damaged[35] ^= 0xff;
  assert.throws(() => extractZip(damaged), /integrity|header|decompression|filenames/i);
});

test('rejects incomplete provenance evidence and changed manifest claims', () => {
  const files = fixtureFiles();
  files.delete('metadata/debian-trixie.Sources.apt-cache');
  assert.throws(() => extractZip(zip(files)), /Required provenance artifact entry/);
  const wrong = fixtureFiles();
  const manifest = JSON.parse(wrong.get('provenance.json'));
  manifest.debian.snapshot = 'rolling';
  wrong.set('provenance.json', Buffer.from(JSON.stringify(manifest)));
  assert.throws(() => validateManifest(wrong, env, hash(patch)), /Unexpected Debian source package identity/);
});

test('binds downloaded artifact metadata to the exact run, attempt, repository, digest and PR head', () => {
  const run = { id: 42, run_attempt: 2, event: 'pull_request', head_sha: env.PULL_REQUEST_HEAD_SHA, repository: { full_name: 'owner/repo' }, head_repository: { id: 9 } };
  assert.equal(validateWorkflowRun(run, env, 'owner/repo', '42', 2), run);
  assert.throws(() => validateWorkflowRun({ ...run, id: 43 }, env, 'owner/repo', '42', 2), /run identity/);
  assert.throws(() => validateWorkflowRun({ ...run, run_attempt: 1 }, env, 'owner/repo', '42', 2), /run identity/);
  assert.throws(() => validateWorkflowRun({ ...run, event: 'push' }, env, 'owner/repo', '42', 2), /run identity/);
  assert.throws(() => validateWorkflowRun({ ...run, repository: { full_name: 'fork/repo' } }, env, 'owner/repo', '42', 2), /run identity/);
  assert.throws(() => validateWorkflowRun({ ...run, head_sha: env.GITHUB_SHA }, env, 'owner/repo', '42', 2), /PR run head/);
  const digest = 'a'.repeat(64);
  const artifact = { id: 123, name: 'libxml2-source-provenance-42-2', expired: false, digest: `sha256:${digest}`, workflow_run: { id: 42, head_sha: run.head_sha, head_repository_id: 9 } };
  assert.equal(validateArtifactMetadata(artifact, '123', artifact.name, '42', run, digest), artifact);
  assert.throws(() => validateArtifactMetadata({ ...artifact, digest: 'sha256:' + 'b'.repeat(64) }, '123', artifact.name, '42', run, digest), /digest/);
  assert.throws(() => validateArtifactMetadata({ ...artifact, id: 124 }, '123', artifact.name, '42', run, digest), /missing, expired, or misnamed/);
  assert.throws(() => validateArtifactMetadata({ ...artifact, workflow_run: { ...artifact.workflow_run, id: 43 } }, '123', artifact.name, '42', run, digest), /does not belong/);
  const pushEnv = { ...env, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'c'.repeat(40), PULL_REQUEST_HEAD_SHA: '' };
  const pushRun = { ...run, event: 'push', head_sha: pushEnv.GITHUB_SHA };
  assert.equal(validateWorkflowRun(pushRun, pushEnv, 'owner/repo', '42', 2), pushRun);
  assert.throws(() => validateWorkflowRun({ ...pushRun, head_sha: env.PULL_REQUEST_HEAD_SHA }, pushEnv, 'owner/repo', '42', 2), /push run head/);
});
