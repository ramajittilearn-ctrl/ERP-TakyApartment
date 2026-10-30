#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'ramajittilearn-ctrl/ERP-TakyApartment';
const BASE = 'debian:forky-slim@sha256:98af9d99779532814d4b51c34d50df8d8886286a2a1ab9625a62db59b9cf1b2d';
const EXPECTED = {
  'org.opencontainers.image.base.name': BASE,
  'io.taky.candidate.only': 'true',
  'io.taky.postgresql.package': '17.11-1.pgdg14+2',
  'io.taky.postgres.gosu.builder': 'golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4',
  'io.taky.postgres.gosu.commit': '6456aaa0f3c854d199d0f037f068eb97515b7513',
  'io.taky.postgres.gosu.user-module': 'v0.4.1',
  'io.taky.postgres.gosu.x-sys-module': 'v0.44.0',
  'io.taky.postgres.entrypoint.source': 'postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe',
};
function fail(message) { throw new Error(message); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function required(env, name) {
  const value = env[name];
  if (!value) fail(`Missing ${name}`);
  return value;
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { fail(`Missing or invalid JSON evidence: ${path.basename(file)}`); }
}
async function inspectImage(ref, execute) {
  const { stdout } = await execute('docker', ['image', 'inspect', ref], { maxBuffer: 8 * 1024 * 1024 });
  const rows = JSON.parse(stdout);
  if (!Array.isArray(rows) || rows.length !== 1) fail('Docker inspect did not return exactly one image');
  return rows[0];
}

export async function consumeForkyImageArtifact({ env = process.env, fetchImpl = fetch, execute = execFileAsync, log = console.log } = {}) {
const artifactId = required(env, 'SOURCE_ARTIFACT_ID');
const artifactDigest = required(env, 'SOURCE_ARTIFACT_DIGEST').replace(/^sha256:/i, '').toLowerCase();
if (!/^[1-9][0-9]*$/.test(artifactId) || !/^[a-f0-9]{64}$/.test(artifactDigest)) fail('Invalid artifact identity or digest');
const runId = required(env, 'GITHUB_RUN_ID');
const runAttempt = required(env, 'GITHUB_RUN_ATTEMPT');
const revision = required(env, 'GITHUB_SHA').toLowerCase();
const head = (env.PULL_REQUEST_HEAD_SHA || revision).toLowerCase();
const token = required(env, 'GITHUB_TOKEN');
const artifactName = `forky-pgdg-docker-image-${runId}-${runAttempt}`;
const api = 'https://api.github.com';
const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
async function getJson(url) {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) fail(`GitHub API request failed (${response.status})`);
  return response.json();
}
const [run, artifact] = await Promise.all([
  getJson(`${api}/repos/${REPOSITORY}/actions/runs/${runId}`),
  getJson(`${api}/repos/${REPOSITORY}/actions/artifacts/${artifactId}`),
]);
if (String(run.id) !== runId || String(run.run_attempt) !== runAttempt || run.event !== required(env, 'GITHUB_EVENT_NAME') ||
    String(run.repository?.full_name).toLowerCase() !== REPOSITORY.toLowerCase() || String(run.head_sha).toLowerCase() !== head) {
  fail('GitHub workflow run identity, event, attempt, repository, or head mismatch');
}
if (String(artifact.id) !== artifactId || artifact.expired || artifact.name !== artifactName ||
    String(artifact.workflow_run?.id) !== runId || String(artifact.workflow_run?.head_sha).toLowerCase() !== head ||
    (artifact.digest && artifact.digest.replace(/^sha256:/i, '').toLowerCase() !== artifactDigest)) {
  fail('Forky candidate image artifact does not belong to this exact workflow run');
}

const dir = required(env, 'ARTIFACT_DIR');
const manifest = await readJson(path.join(dir, 'candidate-image-artifact.json'));
const savedInspect = await readJson(path.join(dir, 'candidate-image-inspect.json'));
if (manifest.schemaVersion !== 1 || manifest.repository !== REPOSITORY || manifest.runId !== runId ||
    manifest.runAttempt !== runAttempt || manifest.event !== env.GITHUB_EVENT_NAME || manifest.revision !== revision ||
    manifest.tree !== (await execute('git', ['rev-parse', 'HEAD^{tree}'])).stdout.trim() ||
    !/^[a-f0-9]{64}$/.test(manifest.tarSha256 || '') || !/^[a-f0-9]{64}$/.test(manifest.inspectSha256 || '')) {
  fail('Candidate image manifest does not bind to this checkout and workflow run');
}
const imageRef = `taky-erp-postgres:17.11-forky-pgdg-candidate-${revision.slice(0, 12)}`;
if (manifest.imageRef !== imageRef || savedInspect.Id !== manifest.imageId ||
    sha256(await fs.readFile(path.join(dir, 'candidate-image-inspect.json'))) !== manifest.inspectSha256) {
  fail('Candidate image reference, ID, or inspect evidence digest mismatch');
}
const tarPath = path.join(dir, 'candidate-image.tar.gz');
if (await sha256File(tarPath) !== manifest.tarSha256) fail('Candidate image tar SHA-256 mismatch');
function validateLabels(image) {
  if (image.Id !== manifest.imageId) fail('Candidate Docker image ID differs from the Stage 5-tested source image');
  const labels = image.Config?.Labels || {};
  if (labels['org.opencontainers.image.revision'] !== revision || labels['org.opencontainers.image.tree'] !== manifest.tree ||
      labels['io.taky.candidate.tree'] !== manifest.tree) fail('Candidate image revision/tree labels do not match this checkout');
  for (const [key, value] of Object.entries(EXPECTED)) if (labels[key] !== value) fail(`Candidate image provenance label mismatch: ${key}`);
}
validateLabels(savedInspect);
await execute('docker', ['load', '--input', tarPath], { maxBuffer: 8 * 1024 * 1024 });
const loaded = await inspectImage(imageRef, execute);
validateLabels(loaded);
if (loaded.Id !== manifest.imageId) fail('Loaded candidate image differs from the verified image archive');
log(`Verified and loaded exact Stage 5-tested Forky image ${loaded.Id} from same-run artifact ${artifactId}.`);
return { imageId: loaded.Id, artifactId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  consumeForkyImageArtifact().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Forky candidate image artifact verification failed');
    process.exitCode = 1;
  });
}
