#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const PATCH_PATH = 'debian/patches/CVE-2026-6653.patch';
const PATCH_SHA256 = 'b4cc290c275b250c3170259386887a679857d97e760e114f6fb1f0d2c617c82c';
const DEBIAN_VERSION = '2.12.7+dfsg+really2.9.14-2.1+deb13u3';
const DEBIAN_SNAPSHOT = '20261027T000000Z';
const UBUNTU_VERSION = '2.9.13+dfsg-1ubuntu0.12';
const UBUNTU_SNAPSHOT = '20260622T130000Z';

function fail(message) {
  throw new Error(message);
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) fail('Missing required input ' + name);
  return value;
}

function positiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(value)) fail('Invalid ' + name);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail('Invalid ' + name);
  return number;
}

function normalizeDigest(value) {
  const digest = value.replace(/^sha256:/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) fail('Invalid SHA-256 digest format');
  return digest;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUInt16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) fail('Truncated ZIP structure');
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) fail('Truncated ZIP structure');
  return buffer.readUInt32LE(offset);
}

function decodeName(bytes) {
  try {
    return new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('ZIP entry filename is not valid UTF-8');
  }
}

function assertSafeName(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0')) fail('Unsafe ZIP entry path');
  if (/^[A-Za-z]:/.test(name) || name.startsWith('//')) fail('Unsafe ZIP entry path');
  const directory = name.endsWith('/');
  const parts = (directory ? name.slice(0, -1) : name).split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.includes(':'))) fail('Unsafe ZIP entry path');
  return directory;
}

function isAllowedPath(name, directory) {
  if (directory) return ['metadata/', 'debian-source/', 'ubuntu-source/', 'debian/', 'debian/patches/'].includes(name);
  if (name === 'provenance.json' || name === PATCH_PATH) return true;
  if (name === 'debian-source/SHA256SUMS' || name === 'ubuntu-source/SHA256SUMS') return true;
  if (/^debian-source\/libxml2_[^/]+$/.test(name)) return true;
  if (/^ubuntu-source\/libxml2_[^/]+$/.test(name)) return true;
  if (/^metadata\/[^/]+$/.test(name)) return true;
  return false;
}

export function extractZip(zip) {
  if (!Buffer.isBuffer(zip) || zip.length < 22 || zip.length > MAX_ZIP_BYTES) fail('ZIP size is outside the allowed range');
  let eocd = -1;
  const min = Math.max(0, zip.length - 22 - 65535);
  for (let offset = zip.length - 22; offset >= min; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = readUInt16(zip, offset + 20);
      if (offset + 22 + commentLength === zip.length) {
        eocd = offset;
        break;
      }
    }
  }
  if (eocd < 0) fail('ZIP end-of-central-directory record is missing');
  const disk = readUInt16(zip, eocd + 4);
  const centralDisk = readUInt16(zip, eocd + 6);
  const diskEntries = readUInt16(zip, eocd + 8);
  const entryCount = readUInt16(zip, eocd + 10);
  const centralSize = readUInt32(zip, eocd + 12);
  const centralOffset = readUInt32(zip, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) fail('Multi-disk ZIP archives are not supported');
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ZIP64 archives are not supported');
  if (entryCount < 1 || entryCount > MAX_ENTRIES) fail('ZIP entry count is outside the allowed range');
  if (centralOffset + centralSize !== eocd) fail('ZIP central directory bounds are invalid');

  const entries = [];
  const seen = new Set();
  let cursor = centralOffset;
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(zip, cursor) !== 0x02014b50) fail('Invalid ZIP central directory entry');
    const madeBy = readUInt16(zip, cursor + 4);
    const flags = readUInt16(zip, cursor + 8);
    const method = readUInt16(zip, cursor + 10);
    const expectedCrc = readUInt32(zip, cursor + 16);
    const compressedSize = readUInt32(zip, cursor + 20);
    const uncompressedSize = readUInt32(zip, cursor + 24);
    const nameLength = readUInt16(zip, cursor + 28);
    const extraLength = readUInt16(zip, cursor + 30);
    const commentLength = readUInt16(zip, cursor + 32);
    const diskStart = readUInt16(zip, cursor + 34);
    const externalAttributes = readUInt32(zip, cursor + 38);
    const localOffset = readUInt32(zip, cursor + 42);
    const nameStart = cursor + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > centralOffset + centralSize) fail('Truncated ZIP central directory');
    if (diskStart !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) fail('ZIP64 or split archive entry is not supported');
    if ((flags & 1) !== 0 || (flags & 0x40) !== 0) fail('Encrypted ZIP entries are not supported');
    if (method !== 0 && method !== 8) fail('Unsupported ZIP compression method');
    if (uncompressedSize > MAX_ENTRY_BYTES) fail('ZIP entry exceeds the size limit');
    totalSize += uncompressedSize;
    if (totalSize > MAX_TOTAL_BYTES) fail('ZIP archive expands beyond the total size limit');
    const name = decodeName(zip.subarray(nameStart, nameStart + nameLength));
    const directory = assertSafeName(name);
    if (!isAllowedPath(name, directory)) fail('Unexpected ZIP entry path: ' + name);
    if (seen.has(name)) fail('Duplicate ZIP entry path: ' + name);
    seen.add(name);

    const hostSystem = madeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (hostSystem === 3) {
      const fileType = unixMode & 0xf000;
      if (fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) fail('ZIP contains a non-regular entry');
      if (directory !== (fileType === 0x4000)) fail('ZIP directory attributes do not match the path');
    }
    entries.push({ name, directory, flags, method, expectedCrc, compressedSize, uncompressedSize, localOffset, nameBytes: zip.subarray(nameStart, nameStart + nameLength) });
    cursor = next;
  }
  if (cursor !== centralOffset + centralSize) fail('ZIP central directory has unexpected trailing data');

  const intervals = [];
  const files = new Map();
  for (const entry of entries) {
    if (entry.directory) continue;
    const offset = entry.localOffset;
    if (readUInt32(zip, offset) !== 0x04034b50) fail('Invalid ZIP local file header');
    const localFlags = readUInt16(zip, offset + 6);
    const localMethod = readUInt16(zip, offset + 8);
    const localNameLength = readUInt16(zip, offset + 26);
    const localExtraLength = readUInt16(zip, offset + 28);
    if (localFlags !== entry.flags || localMethod !== entry.method) fail('ZIP local and central headers disagree');
    const localNameStart = offset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (localNameEnd + localExtraLength > zip.length) fail('Truncated ZIP local header');
    if (!zip.subarray(localNameStart, localNameEnd).equals(entry.nameBytes)) fail('ZIP local and central filenames disagree');
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > centralOffset || dataEnd > zip.length) fail('ZIP entry data is out of bounds');
    intervals.push([dataStart, dataEnd]);
    const compressed = zip.subarray(dataStart, dataEnd);
    let content;
    try {
      content = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
      fail('ZIP entry decompression failed: ' + entry.name);
    }
    if (content.length !== entry.uncompressedSize || crc32(content) !== entry.expectedCrc) fail('ZIP entry integrity check failed: ' + entry.name);
    files.set(entry.name, content);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index][0] < intervals[index - 1][1]) fail('ZIP entry data overlaps');
  }
  for (const requiredName of ['provenance.json', PATCH_PATH, 'debian-source/SHA256SUMS', 'ubuntu-source/SHA256SUMS', 'metadata/debian-trixie.InRelease', 'metadata/debian-trixie.Sources.apt-cache', 'metadata/debian-archive-keyring_2023.3+deb12u2_all.deb']) {
    if (!files.has(requiredName)) fail('Required provenance artifact entry is missing: ' + requiredName);
  }
  return files;
}

function parseJsonFile(files, name) {
  const bytes = files.get(name);
  if (!bytes || bytes.length > MAX_JSON_BYTES) fail('Required JSON file is missing or oversized: ' + name);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('Invalid JSON file: ' + name);
  }
}

function validateSha256Sums(files, directory) {
  const sums = files.get(directory + '/SHA256SUMS');
  if (!sums) fail('Missing SHA256SUMS in ' + directory);
  const records = new Map();
  for (const line of sums.toString('utf8').split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([a-f0-9]{64})\x20{2}(libxml2_[A-Za-z0-9.+~_-]+)$/.exec(line);
    if (!match || records.has(match[2])) fail('Malformed or duplicate SHA256SUMS line in ' + directory);
    records.set(match[2], match[1]);
  }
  const actual = new Map([...files.keys()].filter((name) => name.startsWith(directory + '/libxml2_')).map((name) => [name.slice(directory.length + 1), sha256(files.get(name))]));
  if (records.size !== 3 || actual.size !== 3) fail('Expected exactly three source artifacts in ' + directory);
  if (records.size !== actual.size) fail('SHA256SUMS file set mismatch in ' + directory);
  for (const [name, digest] of records) if (actual.get(name) !== digest) fail('Source artifact SHA-256 mismatch: ' + directory + '/' + name);
  return [...records].sort(([a], [b]) => a.localeCompare(b)).map(([name, digest]) => ({ name, sha256: digest }));
}

export function validateManifest(files, env, expectedPatchSha = PATCH_SHA256) {
  const manifest = parseJsonFile(files, 'provenance.json');
  if (manifest.schemaVersion !== 1) fail('Unsupported provenance manifest schema');
  const runId = required(env, 'GITHUB_RUN_ID');
  const attempt = positiveInteger(required(env, 'GITHUB_RUN_ATTEMPT'), 'GITHUB_RUN_ATTEMPT');
  const eventName = required(env, 'GITHUB_EVENT_NAME');
  const eventSha = required(env, 'GITHUB_SHA').toLowerCase();
  const pullHead = env.PULL_REQUEST_HEAD_SHA || '';
  const workflow = manifest.workflow;
  if (!workflow || String(workflow.runId) !== runId || workflow.runAttempt !== attempt || workflow.eventName !== eventName || String(workflow.eventSha).toLowerCase() !== eventSha || String(workflow.checkedOutRevision).toLowerCase() !== eventSha) fail('Provenance manifest does not bind to this workflow run/attempt/event checkout');
  if (eventName === 'pull_request') {
    if (!/^[a-f0-9]{40}$/.test(pullHead) || String(workflow.pullRequestHeadSha).toLowerCase() !== pullHead.toLowerCase()) fail('Provenance manifest PR head does not match this run');
  } else if (pullHead !== '' || workflow.pullRequestHeadSha !== null) {
    fail('Unexpected PR-head provenance for a non-PR workflow');
  }
  if (manifest.debian?.source !== 'libxml2' || manifest.debian?.version !== DEBIAN_VERSION || manifest.debian?.suite !== 'trixie' || manifest.debian?.snapshot !== DEBIAN_SNAPSHOT || manifest.debian?.uri !== 'https://snapshot.debian.org/archive/debian/' + DEBIAN_SNAPSHOT) fail('Unexpected Debian source package identity');
  if (manifest.ubuntuJammyPatchSource?.source !== 'libxml2' || manifest.ubuntuJammyPatchSource?.version !== UBUNTU_VERSION || manifest.ubuntuJammyPatchSource?.suite !== 'jammy-security' || manifest.ubuntuJammyPatchSource?.snapshot !== UBUNTU_SNAPSHOT || manifest.ubuntuJammyPatchSource?.uri !== 'https://snapshot.ubuntu.com/ubuntu/' + UBUNTU_SNAPSHOT) fail('Unexpected Ubuntu patch source package identity');
  if (manifest.ubuntuJammyPatchSource.patchPath !== PATCH_PATH || manifest.ubuntuJammyPatchSource.patchSha256 !== expectedPatchSha || sha256(files.get(PATCH_PATH)) !== expectedPatchSha) fail('Ubuntu CVE patch path or digest mismatch');
  if (!manifest.verification?.authenticatedReleaseMetadata || !manifest.verification?.dscSignaturesAndListedHashes) fail('Provenance manifest lacks authenticated source verification');
  for (const [directory, source] of [['debian-source', manifest.debian], ['ubuntu-source', manifest.ubuntuJammyPatchSource]]) {
    const records = validateSha256Sums(files, directory);
    const declared = [...(source.sourceArtifacts || [])].sort((a, b) => a.name.localeCompare(b.name));
    if (JSON.stringify(records) !== JSON.stringify(declared)) fail('Manifest source artifact hashes differ from extracted ' + directory);
    const sourceVersion = directory === 'debian-source' ? DEBIAN_VERSION : UBUNTU_VERSION;
    const expectedNames = ['libxml2_' + sourceVersion + '.dsc', 'libxml2_' + sourceVersion + '.orig.tar.xz', 'libxml2_' + sourceVersion + '.debian.tar.xz'].sort();
    if (JSON.stringify(records.map((entry) => entry.name).sort()) !== JSON.stringify(expectedNames)) fail('Unexpected source archive names in ' + directory);
    const dsc = records.find((entry) => entry.name.endsWith('.dsc'));
    if (!dsc) fail('Source .dsc is missing in ' + directory);
  }
  const inRelease = files.get('metadata/debian-trixie.InRelease');
  if (sha256(inRelease) !== manifest.debian.releaseInReleaseSha256) fail('Debian Trixie InRelease digest mismatch');
  const keyringPackage = [...files.keys()].find((name) => /^metadata\/debian-archive-keyring_[^/]+_all\.deb$/.test(name));
  if (keyringPackage !== 'metadata/debian-archive-keyring_2023.3+deb12u2_all.deb' || manifest.debianArchiveKeyringBootstrap?.keyringPackageVersion !== '2023.3+deb12u2') fail('Unexpected Debian archive keyring bootstrap package identity');
  if (!keyringPackage || sha256(files.get(keyringPackage)) !== manifest.debianArchiveKeyringBootstrap.keyringPackageSha256) fail('Authenticated Debian keyring package digest mismatch');
  const sourceIndex = files.get('metadata/debian-trixie.Sources.apt-cache');
  if (!sourceIndex || sha256(sourceIndex) !== manifest.debian.aptAuthenticatedSourcesIndexSha256) fail('Authenticated Debian source index digest mismatch');
  return manifest;
}

async function readResponseLimited(response, maxBytes, label) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) fail(label + ' response exceeds the size limit');
  if (!response.body) fail(label + ' response body is empty');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      fail(label + ' response exceeds the size limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function fetchLimited(url, options, maxBytes, label) {
  let current = new URL(url);
  const headers = new globalThis.Headers(options.headers || {});
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(current, { method: 'GET', headers, redirect: 'manual', signal: globalThis.AbortSignal.timeout(15000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === 5) fail(label + ' redirected too many times');
      const location = response.headers.get('location');
      if (!location) fail(label + ' redirect lacks a location');
      const next = new URL(location, current);
      if (current.protocol !== 'https:' || next.protocol !== 'https:') fail(label + ' attempted a non-HTTPS redirect');
      if (next.origin !== current.origin) headers.delete('authorization');
      current = next;
      continue;
    }
    if (!response.ok) fail(label + ' request failed with HTTP ' + response.status);
    return await readResponseLimited(response, maxBytes, label);
  }
  fail(label + ' request did not complete');
}

export function validateWorkflowRun(run, env, repo, runId, attempt) {
  const eventName = required(env, 'GITHUB_EVENT_NAME');
  const eventSha = required(env, 'GITHUB_SHA').toLowerCase();
  const pullHeadSha = env.PULL_REQUEST_HEAD_SHA || '';
  if (String(run.id) !== runId || String(run.repository?.full_name).toLowerCase() !== repo.toLowerCase() || String(run.run_attempt) !== attempt || run.event !== eventName) fail('GitHub workflow run identity does not match this candidate job');
  if (eventName === 'pull_request') {
    if (!/^[a-f0-9]{40}$/i.test(pullHeadSha) || String(run.head_sha).toLowerCase() !== pullHeadSha.toLowerCase()) fail('GitHub PR run head does not match this candidate job');
  } else if (String(run.head_sha).toLowerCase() !== eventSha) {
    fail('GitHub push run head does not match this candidate job');
  }
  return run;
}

export function validateArtifactMetadata(artifact, artifactId, artifactName, runId, run, expectedDigest) {
  if (!artifact || String(artifact.id) !== artifactId || artifact.expired || artifact.name !== artifactName) fail('Expected same-run source artifact is missing, expired, or misnamed');
  if (String(artifact.workflow_run?.id) !== runId || String(artifact.workflow_run?.head_sha).toLowerCase() !== String(run.head_sha).toLowerCase()) fail('Artifact does not belong to the expected workflow run/revision');
  if (run.head_repository?.id && String(artifact.workflow_run?.head_repository_id) !== String(run.head_repository.id)) fail('Artifact head repository does not match the workflow run');
  if (artifact.digest && normalizeDigest(artifact.digest) !== expectedDigest) fail('GitHub artifact metadata digest differs from the upload action output');
  return artifact;
}

async function fetchArtifactZip(env, artifactId, expectedDigest, artifactName, repo, runId, attempt) {
  const apiBase = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const apiHeaders = { authorization: 'Bearer ' + required(env, 'GITHUB_TOKEN'), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const repoPath = repo.split('/').map(encodeURIComponent).join('/');
  const runUrl = apiBase + '/repos/' + repoPath + '/actions/runs/' + runId;
  const runBytes = await fetchLimited(runUrl, { headers: apiHeaders }, MAX_JSON_BYTES, 'Workflow run metadata');
  let run;
  try { run = JSON.parse(runBytes.toString('utf8')); } catch { fail('Invalid workflow run metadata JSON'); }
  validateWorkflowRun(run, env, repo, runId, attempt);
  const artifactsUrl = apiBase + '/repos/' + repoPath + '/actions/runs/' + runId + '/artifacts?per_page=100';
  const artifactsBytes = await fetchLimited(artifactsUrl, { headers: apiHeaders }, MAX_JSON_BYTES, 'Artifact metadata');
  let listing;
  try { listing = JSON.parse(artifactsBytes.toString('utf8')); } catch { fail('Invalid artifact metadata JSON'); }
  const artifact = (listing.artifacts || []).find((item) => String(item.id) === artifactId);
  validateArtifactMetadata(artifact, artifactId, artifactName, runId, run, expectedDigest);
  const apiUrl = apiBase + '/repos/' + encodeURIComponent(repo).replace('%2F', '/') + '/actions/artifacts/' + artifactId + '/zip';
  const zip = await fetchLimited(apiUrl, { headers: apiHeaders }, MAX_ZIP_BYTES, 'Source artifact ZIP');
  if (sha256(zip) !== expectedDigest) fail('Downloaded artifact ZIP digest mismatch');
  return zip;
}

async function validateDestination(destination, runnerTemp) {
  const tempRoot = await fs.realpath(runnerTemp);
  const parent = await fs.realpath(path.dirname(destination));
  if (parent !== tempRoot && !parent.startsWith(tempRoot + path.sep)) fail('Output directory must remain inside RUNNER_TEMP');
  try {
    await fs.lstat(destination);
    fail('Output directory already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return parent;
}

export async function consume(env = process.env) {
  const repo = required(env, 'GITHUB_REPOSITORY');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) fail('Invalid repository identifier');
  const artifactId = required(env, 'SOURCE_ARTIFACT_ID');
  if (!/^[1-9][0-9]*$/.test(artifactId)) fail('Invalid artifact ID');
  const expectedDigest = normalizeDigest(required(env, 'SOURCE_ARTIFACT_DIGEST'));
  const runId = required(env, 'GITHUB_RUN_ID');
  const attempt = positiveInteger(required(env, 'GITHUB_RUN_ATTEMPT'), 'GITHUB_RUN_ATTEMPT');
  const artifactName = 'libxml2-source-provenance-' + runId + '-' + attempt;
  const destination = path.resolve(required(env, 'OUTPUT_DIR'));
  const runnerTemp = path.resolve(required(env, 'RUNNER_TEMP'));
  const parent = await validateDestination(destination, runnerTemp);
  const zip = await fetchArtifactZip(env, artifactId, expectedDigest, artifactName, repo, runId, attempt);
  const files = extractZip(zip);
  const manifest = validateManifest(files, env);
  const staging = path.join(parent, '.' + path.basename(destination) + '.staging-' + process.pid + '-' + crypto.randomBytes(8).toString('hex'));
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    for (const [name, bytes] of files) {
      const output = path.join(staging, name);
      await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
      await fs.writeFile(output, bytes, { mode: 0o600, flag: 'wx' });
    }
    const keyringPackageName = [...files.keys()].find((name) => /^metadata\/debian-archive-keyring_[^/]+_all\.deb$/.test(name));
    const verified = {
      schemaVersion: 1,
      sourceArtifact: { id: artifactId, name: artifactName, digest: 'sha256:' + expectedDigest },
      repository: repo,
      runId,
      runAttempt: attempt,
      eventName: manifest.workflow.eventName,
      eventSha: manifest.workflow.eventSha,
      checkedOutRevision: manifest.workflow.checkedOutRevision,
      pullRequestHeadSha: manifest.workflow.pullRequestHeadSha,
      manifestSha256: sha256(files.get('provenance.json')),
      debianSourceVersion: manifest.debian.version,
      debianSnapshot: manifest.debian.snapshot,
      debianInReleaseSha256: manifest.debian.releaseInReleaseSha256,
      debianSourceIndexSha256: manifest.debian.aptAuthenticatedSourcesIndexSha256,
      debianKeyringPackagePath: keyringPackageName,
      debianKeyringPackageSha256: manifest.debianArchiveKeyringBootstrap.keyringPackageSha256,
      patchPath: manifest.ubuntuJammyPatchSource.patchPath,
      patchSha256: manifest.ubuntuJammyPatchSource.patchSha256,
      files: [...files.entries()].map(([name, bytes]) => ({ name, sha256: sha256(bytes), size: bytes.length })).sort((a, b) => a.name.localeCompare(b.name)),
    };
    await fs.writeFile(path.join(staging, 'verified-inputs.json'), JSON.stringify(verified, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.writeFile(path.join(staging, 'source-artifact.zip'), zip, { mode: 0o600, flag: 'wx' });
    await fs.rename(staging, destination);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { destination, digest: expectedDigest, fileCount: files.size };
}

const executedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executedDirectly) {
  consume().then((result) => {
    process.stdout.write(JSON.stringify(result) + '\n');
  }).catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n');
    process.exitCode = 1;
  });
}
