#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MAX_ZIP_BYTES = 300 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
const MAX_TOTAL_BYTES = 900 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const REPOSITORY = 'ramajittilearn-ctrl/ERP-TakyApartment';
const ROOT = { package: 'postgresql-17', version: '17.11-1.pgdg14+2', architecture: 'amd64', origin: 'apt.postgresql.org' };
const ALLOWED_ORIGINS = new Set(['debian-forky', 'pgdg-forky']);

function fail(message) { throw new Error(message); }
function required(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0) fail('Missing required input ' + key);
  return value;
}
function positiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) fail('Invalid ' + label);
  return Number(value);
}
function normalizeDigest(value) {
  const digest = String(value).replace(/^sha256:/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) fail('Invalid SHA-256 digest format');
  return digest;
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
export function githubApiBase(value = 'https://api.github.com') {
  let url;
  try { url = new URL(value); } catch { fail('Invalid GitHub API base URL'); }
  if (url.protocol !== 'https:' || url.origin !== 'https://api.github.com' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    fail('GitHub API base URL must be the canonical HTTPS api.github.com origin');
  }
  return url.origin;
}
function u16(b, p) { if (p < 0 || p + 2 > b.length) fail('Truncated ZIP structure'); return b.readUInt16LE(p); }
function u32(b, p) { if (p < 0 || p + 4 > b.length) fail('Truncated ZIP structure'); return b.readUInt32LE(p); }
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function safeName(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) fail('Unsafe ZIP entry path');
  const directory = name.endsWith('/');
  const components = (directory ? name.slice(0, -1) : name).split('/');
  if (components.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) fail('Unsafe ZIP entry path');
  const valid = directory
    ? name === 'metadata/' || name === 'packages/'
    : name === 'provenance.json' || name === 'status.json' ||
      (name.startsWith('metadata/') && !name.slice(9).includes('/') && /^[A-Za-z0-9_.+-]+$/.test(name.slice(9))) ||
      (name.startsWith('packages/') && !name.slice(9).includes('/') && /^[a-z0-9][a-z0-9+.-]*_(?:[0-9]+%3a)?[A-Za-z0-9.+~_-]+_(?:amd64|all)\.deb$/.test(name.slice(9)));
  if (!valid) fail('Unexpected ZIP entry path: ' + name);
  return directory;
}

export function extractZip(zip) {
  if (!Buffer.isBuffer(zip) || zip.length < 22 || zip.length > MAX_ZIP_BYTES) fail('ZIP size is outside the allowed range');
  const lower = Math.max(0, zip.length - 22 - 65535);
  let eocd = -1;
  for (let i = zip.length - 22; i >= lower; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + u16(zip, i + 20) === zip.length) { eocd = i; break; }
  }
  if (eocd < 0) fail('ZIP end-of-central-directory record is missing');
  const disk = u16(zip, eocd + 4), centralDisk = u16(zip, eocd + 6);
  const diskCount = u16(zip, eocd + 8), count = u16(zip, eocd + 10);
  const centralSize = u32(zip, eocd + 12), centralOffset = u32(zip, eocd + 16);
  if (disk || centralDisk || diskCount !== count || count < 1 || count > MAX_ENTRIES ||
      count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff ||
      centralOffset + centralSize !== eocd) fail('Unsupported or invalid ZIP directory');
  const entries = [], names = new Set();
  let cursor = centralOffset, total = 0;
  for (let i = 0; i < count; i += 1) {
    if (u32(zip, cursor) !== 0x02014b50) fail('Invalid ZIP central directory entry');
    const madeBy = u16(zip, cursor + 4), flags = u16(zip, cursor + 8), method = u16(zip, cursor + 10);
    const crc = u32(zip, cursor + 16), compressedSize = u32(zip, cursor + 20), size = u32(zip, cursor + 24);
    const nameLength = u16(zip, cursor + 28), extraLength = u16(zip, cursor + 30), commentLength = u16(zip, cursor + 32);
    const diskStart = u16(zip, cursor + 34), attributes = u32(zip, cursor + 38), localOffset = u32(zip, cursor + 42);
    const nameStart = cursor + 46, next = nameStart + nameLength + extraLength + commentLength;
    if (next > centralOffset + centralSize || diskStart || compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail('Invalid or split ZIP entry');
    if ((flags & 0x41) !== 0 || (method !== 0 && method !== 8)) fail('Encrypted or unsupported ZIP entry');
    if (size > MAX_ENTRY_BYTES || (total += size) > MAX_TOTAL_BYTES) fail('ZIP expands beyond configured size limits');
    let name;
    try { name = new globalThis.TextDecoder('utf-8', { fatal: true }).decode(zip.subarray(nameStart, nameStart + nameLength)); }
    catch { fail('ZIP entry filename is not valid UTF-8'); }
    const directory = safeName(name);
    if (names.has(name)) fail('Duplicate ZIP entry path: ' + name);
    names.add(name);
    const host = madeBy >>> 8, mode = attributes >>> 16, type = mode & 0xf000;
    if (host === 3 && (type !== 0 && type !== 0x8000 && type !== 0x4000 || directory !== (type === 0x4000))) fail('ZIP contains non-regular entry');
    entries.push({ name, directory, flags, method, crc, compressedSize, size, localOffset, nameBytes: zip.subarray(nameStart, nameStart + nameLength) });
    cursor = next;
  }
  if (cursor !== centralOffset + centralSize) fail('ZIP central directory has trailing data');
  const files = new Map(), spans = [];
  for (const e of entries) {
    if (e.directory) continue;
    const p = e.localOffset;
    if (u32(zip, p) !== 0x04034b50 || u16(zip, p + 6) !== e.flags || u16(zip, p + 8) !== e.method) fail('Invalid ZIP local header');
    const nameLength = u16(zip, p + 26), extraLength = u16(zip, p + 28), nameStart = p + 30, dataStart = nameStart + nameLength + extraLength;
    if (dataStart > zip.length || !zip.subarray(nameStart, nameStart + nameLength).equals(e.nameBytes)) fail('ZIP local and central headers disagree');
    const dataEnd = dataStart + e.compressedSize;
    if (dataEnd > centralOffset || dataEnd > zip.length) fail('ZIP entry is out of bounds');
    spans.push([dataStart, dataEnd]);
    let bytes;
    try { bytes = e.method === 0 ? Buffer.from(zip.subarray(dataStart, dataEnd)) : inflateRawSync(zip.subarray(dataStart, dataEnd), { maxOutputLength: MAX_ENTRY_BYTES }); }
    catch { fail('ZIP decompression failed: ' + e.name); }
    if (bytes.length !== e.size || crc32(bytes) !== e.crc) fail('ZIP entry integrity check failed: ' + e.name);
    files.set(e.name, bytes);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i += 1) if (spans[i][0] < spans[i - 1][1]) fail('ZIP entry data overlaps');
  for (const name of ['provenance.json', 'status.json', 'metadata/debian-forky.InRelease', 'metadata/pgdg-forky.InRelease']) {
    if (!files.has(name)) fail('Required provenance artifact entry is missing: ' + name);
  }
  return files;
}

function parseJson(files, name) {
  const bytes = files.get(name);
  if (!bytes || bytes.length > MAX_JSON_BYTES) fail('Missing or oversized JSON: ' + name);
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail('Invalid JSON: ' + name); }
}

function expectedArchiveName(item) {
  const version = item.version.replace(/^([0-9]+):/, '$1%3a');
  return `${item.package}_${version}_${item.architecture}.deb`;
}

function validatePackageLocation(item) {
  if (!/^[a-z0-9][a-z0-9+.-]*$/.test(item.package || '') ||
      !/^(?:[0-9]+:)?[A-Za-z0-9.+~_-]+$/.test(item.version || '') ||
      !['amd64', 'all'].includes(item.architecture) ||
      !/^pool\/(?:[A-Za-z0-9.+~_-]+\/)*[A-Za-z0-9.+~_-]+\.deb$/.test(item.filename || '') ||
      item.filename.split('/').some((part) => part === '.' || part === '..')) {
    fail('Malformed signed package identity or Filename path');
  }
  const signedVersion = item.version.replace(/^[0-9]+:/, '');
  const signedBasename = `${item.package}_${signedVersion}_${item.architecture}.deb`;
  if (!item.filename.endsWith('/' + signedBasename)) fail('Signed Filename does not match package identity');
  const baseByOrigin = {
    'debian-forky': 'https://deb.debian.org/debian',
    'pgdg-forky': 'https://apt.postgresql.org/pub/repos/apt',
  };
  const base = baseByOrigin[item.origins?.[0]];
  let uri;
  try { uri = new URL(item.aptUri); } catch { fail('Invalid package download URI'); }
  if (!base || uri.protocol !== 'https:' || uri.origin !== new URL(base).origin || uri.username || uri.password || uri.search || uri.hash) {
    fail('Package download URI origin is not allowlisted');
  }
  const basePath = new URL(base).pathname;
  if (!uri.pathname.startsWith(basePath + '/') || /%(?:2f|5c)/i.test(uri.pathname)) fail('Package download URI escapes its repository path');
  let relativePath;
  try { relativePath = decodeURIComponent(uri.pathname.slice(basePath.length + 1)); }
  catch { fail('Package download URI has invalid percent encoding'); }
  if (relativePath !== item.filename) fail('Package download URI differs from signed Filename');
}

export function validateManifest(files, env) {
  const manifest = parseJson(files, 'provenance.json');
  const status = parseJson(files, 'status.json');
  const runId = required(env, 'GITHUB_RUN_ID');
  const attempt = positiveInteger(required(env, 'GITHUB_RUN_ATTEMPT'), 'GITHUB_RUN_ATTEMPT');
  const eventName = required(env, 'GITHUB_EVENT_NAME');
  const eventSha = required(env, 'GITHUB_SHA').toLowerCase();
  const prHead = env.PULL_REQUEST_HEAD_SHA || '';
  if (manifest.schemaVersion !== 1 || manifest.status !== 'PASS' || status.status !== 'PASS' ||
      status.manifestSha256 !== sha256(files.get('provenance.json'))) fail('Forky provenance status or manifest digest is invalid');
  const workflow = manifest.workflow || {};
  for (const [field, expected] of [['GITHUB_REPOSITORY', REPOSITORY], ['GITHUB_RUN_ID', runId],
    ['GITHUB_RUN_ATTEMPT', String(attempt)], ['GITHUB_EVENT_NAME', eventName], ['GITHUB_SHA', eventSha]]) {
    if (String(workflow[field] ?? '') !== expected) fail('Provenance workflow binding mismatch: ' + field);
  }
  if (String(workflow.GITHUB_SHA).toLowerCase() !== eventSha) fail('Provenance checkout revision differs from this run');
  if (eventName === 'pull_request') {
    if (!/^[a-f0-9]{40}$/i.test(prHead) || String(workflow.PULL_REQUEST_HEAD_SHA || '').toLowerCase() !== prHead.toLowerCase()) fail('Provenance PR head does not match this run');
  } else if (prHead || workflow.PULL_REQUEST_HEAD_SHA) fail('Unexpected PR head for non-PR run');
  const closure = manifest.dependencyClosure;
  if (closure?.rootPackage?.name !== ROOT.package || closure.rootPackage.version !== ROOT.version ||
      closure.rootPackage.architecture !== ROOT.architecture || closure.rootPackage.requiredOrigin !== ROOT.origin ||
      !Array.isArray(closure.packages) || closure.packages.length === 0) fail('Forky PostgreSQL root package identity is not pinned');
  if (manifest.debianForky?.release?.codename !== 'forky' || manifest.debianForky?.release?.origin !== 'Debian' ||
      manifest.pgdgForky?.release?.codename !== 'forky-pgdg' || manifest.pgdgForky?.release?.origin !== 'apt.postgresql.org') fail('Forky signed repository identity mismatch');
  const seenIds = new Set(), seenFiles = new Set(), packageFiles = [...files.keys()].filter((n) => n.startsWith('packages/'));
  if (packageFiles.length !== closure.packages.length) fail('Package file count differs from authenticated closure');
  for (const item of closure.packages) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256 || '') ||
        !Number.isSafeInteger(item.size) || item.size < 1 || !Array.isArray(item.origins) || item.origins.length !== 1 ||
        !ALLOWED_ORIGINS.has(item.origins[0]) ||
        typeof item.filename !== 'string' || typeof item.aptUri !== 'string') fail('Malformed or untrusted package closure row');
    validatePackageLocation(item);
    const id = item.package + ':' + item.architecture;
    const file = 'packages/' + expectedArchiveName(item);
    if (seenIds.has(id) || seenFiles.has(file)) fail('Duplicate package identity or filename in closure');
    seenIds.add(id); seenFiles.add(file);
    const bytes = files.get(file);
    if (!bytes || bytes.length !== item.size || sha256(bytes) !== item.sha256) fail('Package bytes differ from authenticated Packages metadata: ' + item.filename);
    const rootMatches = item.package === ROOT.package && item.architecture === ROOT.architecture;
    if (rootMatches && (item.version !== ROOT.version || item.origins[0] !== 'pgdg-forky')) fail('Pinned PostgreSQL package is not from PGDG Forky');
    if (item.origins[0] === 'pgdg-forky' && !rootMatches) {
      // PGDG may provide PostgreSQL extension/runtime libraries; provenance selects them only through its signed index.
    }
  }
  const roots = closure.packages.filter((p) => p.package === ROOT.package && p.architecture === ROOT.architecture);
  if (roots.length !== 1) fail('Expected exactly one pinned PostgreSQL root package');
  if (packageFiles.some((name) => !seenFiles.has(name))) fail('Artifact contains an undeclared package file');
  for (const [key, expected] of [['runtimeVerification', false], ['imageSelection', false], ['scannerClearance', false], ['cveDisposition', false], ['productionClearance', false]]) {
    if (manifest.clearance?.[key] !== expected) fail('Forky provenance must not assert clearance: ' + key);
  }
  return manifest;
}

function validateWorkflowRun(run, env, runId, attempt) {
  if (String(run.id) !== runId || String(run.run_attempt) !== String(attempt) ||
      run.event !== required(env, 'GITHUB_EVENT_NAME') ||
      String(run.repository?.full_name).toLowerCase() !== REPOSITORY.toLowerCase()) fail('GitHub workflow run identity mismatch');
  const head = env.GITHUB_EVENT_NAME === 'pull_request' ? env.PULL_REQUEST_HEAD_SHA : env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/i.test(head || '') || String(run.head_sha).toLowerCase() !== head.toLowerCase()) fail('GitHub workflow run head mismatch');
  return run;
}
function validateArtifactMetadata(artifact, artifactId, name, run, digest) {
  if (!artifact || String(artifact.id) !== artifactId || artifact.expired || artifact.name !== name ||
      String(artifact.workflow_run?.id) !== String(run.id) ||
      String(artifact.workflow_run?.head_sha).toLowerCase() !== String(run.head_sha).toLowerCase()) fail('Same-run Forky provenance artifact is missing or mismatched');
  if (artifact.workflow_run?.head_repository_id && run.head_repository?.id &&
      String(artifact.workflow_run.head_repository_id) !== String(run.head_repository.id)) fail('Artifact repository identity mismatch');
  if (artifact.digest && normalizeDigest(artifact.digest) !== digest) fail('GitHub artifact metadata digest mismatch');
  return artifact;
}
async function readLimited(response, limit, label) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit || !response.body) fail(label + ' response exceeds limit or is empty');
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); fail(label + ' response exceeds limit'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
async function fetchLimited(url, headers, limit, label) {
  let current = new URL(url);
  const h = new globalThis.Headers(headers);
  for (let i = 0; i <= 5; i += 1) {
    const response = await fetch(current, { headers: h, redirect: 'manual', signal: globalThis.AbortSignal.timeout(20000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (i === 5 || !response.headers.get('location')) fail(label + ' redirected too many times');
      const next = new URL(response.headers.get('location'), current);
      if (next.protocol !== 'https:' || current.protocol !== 'https:') fail(label + ' attempted a non-HTTPS redirect');
      if (next.origin !== current.origin) h.delete('authorization');
      current = next;
      continue;
    }
    if (!response.ok) fail(label + ' failed with HTTP ' + response.status);
    return readLimited(response, limit, label);
  }
  fail(label + ' request did not complete');
}
async function fetchArtifact(env, artifactId, digest, name, runId, attempt) {
  const api = githubApiBase(env.GITHUB_API_URL || 'https://api.github.com');
  const headers = { authorization: 'Bearer ' + required(env, 'GITHUB_TOKEN'), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const repoPath = REPOSITORY.split('/').map(encodeURIComponent).join('/');
  let run;
  try { run = JSON.parse((await fetchLimited(api + '/repos/' + repoPath + '/actions/runs/' + runId, headers, MAX_JSON_BYTES, 'Workflow run metadata')).toString('utf8')); }
  catch (e) { if (e instanceof SyntaxError) fail('Invalid workflow run metadata JSON'); throw e; }
  validateWorkflowRun(run, env, runId, attempt);
  let listing;
  try { listing = JSON.parse((await fetchLimited(api + '/repos/' + repoPath + '/actions/runs/' + runId + '/artifacts?per_page=100', headers, MAX_JSON_BYTES, 'Artifact metadata')).toString('utf8')); }
  catch (e) { if (e instanceof SyntaxError) fail('Invalid artifact metadata JSON'); throw e; }
  validateArtifactMetadata((listing.artifacts || []).find((item) => String(item.id) === artifactId), artifactId, name, run, digest);
  const url = api + '/repos/' + repoPath + '/actions/artifacts/' + artifactId + '/zip';
  const zip = await fetchLimited(url, headers, MAX_ZIP_BYTES, 'Forky provenance ZIP');
  if (sha256(zip) !== digest) fail('Downloaded artifact ZIP digest mismatch');
  return zip;
}
async function validateDestination(destination, runnerTemp) {
  const root = await fs.realpath(runnerTemp), parent = await fs.realpath(path.dirname(destination));
  if (parent !== root && !parent.startsWith(root + path.sep)) fail('Output directory must remain inside RUNNER_TEMP');
  try { await fs.lstat(destination); fail('Output directory already exists'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  return parent;
}
export async function consume(env = process.env) {
  if ((env.GITHUB_REPOSITORY || '').toLowerCase() !== REPOSITORY.toLowerCase()) fail('Unexpected GitHub repository');
  const runId = required(env, 'GITHUB_RUN_ID'), attempt = positiveInteger(required(env, 'GITHUB_RUN_ATTEMPT'), 'GITHUB_RUN_ATTEMPT');
  const artifactId = required(env, 'SOURCE_ARTIFACT_ID');
  if (!/^[1-9][0-9]*$/.test(artifactId)) fail('Invalid artifact ID');
  const digest = normalizeDigest(required(env, 'SOURCE_ARTIFACT_DIGEST'));
  const name = 'forky-pgdg-provenance-' + runId + '-' + attempt;
  const destination = path.resolve(required(env, 'OUTPUT_DIR')), runnerTemp = path.resolve(required(env, 'RUNNER_TEMP'));
  const parent = await validateDestination(destination, runnerTemp);
  const zip = await fetchArtifact(env, artifactId, digest, name, runId, attempt);
  const files = extractZip(zip), manifest = validateManifest(files, env);
  const staging = path.join(parent, '.' + path.basename(destination) + '.staging-' + process.pid + '-' + crypto.randomBytes(8).toString('hex'));
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    for (const [name, bytes] of files) {
      const out = path.join(staging, name);
      await fs.mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
      await fs.writeFile(out, bytes, { mode: 0o600, flag: 'wx' });
    }
    const verified = {
      schemaVersion: 1, sourceArtifact: { id: artifactId, name, digest: 'sha256:' + digest },
      repository: REPOSITORY, runId, runAttempt: attempt, eventName: env.GITHUB_EVENT_NAME,
      eventSha: env.GITHUB_SHA, pullRequestHeadSha: env.PULL_REQUEST_HEAD_SHA || null,
      manifestSha256: sha256(files.get('provenance.json')),
      rootPackage: ROOT, packageCount: manifest.dependencyClosure.packages.length,
      packages: manifest.dependencyClosure.packages.map((p) => ({ package: p.package, version: p.version, architecture: p.architecture, filename: p.filename, sha256: p.sha256, size: p.size, origin: p.indexOrigin })).sort((a, b) => a.filename.localeCompare(b.filename)),
      files: [...files].map(([file, bytes]) => ({ file, sha256: sha256(bytes), size: bytes.length })).sort((a, b) => a.file.localeCompare(b.file)),
    };
    await fs.writeFile(path.join(staging, 'verified-inputs.json'), JSON.stringify(verified, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.writeFile(path.join(staging, 'source-artifact.zip'), zip, { mode: 0o600, flag: 'wx' });
    await fs.rename(staging, destination);
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }).catch(() => {}); throw error; }
  return { destination, digest, packageCount: manifest.dependencyClosure.packages.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  consume().then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch((error) => { process.stderr.write(String(error?.message || error) + '\n'); process.exitCode = 1; });
}
