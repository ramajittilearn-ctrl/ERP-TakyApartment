import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { consumeForkyImageArtifact } from './consume-forky-image-artifact.mjs';

const repository = 'ramajittilearn-ctrl/ERP-TakyApartment';
const runId = '12345';
const runAttempt = '2';
const revision = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const imageId = `sha256:${'c'.repeat(64)}`;
const artifactDigest = 'd'.repeat(64);
const labels = {
  'org.opencontainers.image.base.name': 'debian:forky-slim@sha256:98af9d99779532814d4b51c34d50df8d8886286a2a1ab9625a62db59b9cf1b2d',
  'org.opencontainers.image.revision': revision,
  'org.opencontainers.image.tree': tree,
  'io.taky.candidate.tree': tree,
  'io.taky.candidate.only': 'true',
  'io.taky.postgresql.package': '17.11-1.pgdg14+2',
  'io.taky.postgres.gosu.builder': 'golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4',
  'io.taky.postgres.gosu.commit': '6456aaa0f3c854d199d0f037f068eb97515b7513',
  'io.taky.postgres.gosu.user-module': 'v0.4.1',
  'io.taky.postgres.gosu.x-sys-module': 'v0.44.0',
  'io.taky.postgres.entrypoint.source': 'postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe',
};
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function fixture(overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forky-image-artifact-test-'));
  const tarBytes = Buffer.from('synthetic docker archive');
  const inspect = { Id: imageId, Config: { Labels: labels } };
  await fs.writeFile(path.join(dir, 'candidate-image.tar.gz'), tarBytes);
  await fs.writeFile(path.join(dir, 'candidate-image-inspect.json'), JSON.stringify(inspect));
  const manifest = {
    schemaVersion: 1,
    repository,
    runId,
    runAttempt,
    event: 'pull_request',
    revision,
    tree,
    imageRef: `taky-erp-postgres:17.11-forky-pgdg-candidate-${revision.slice(0, 12)}`,
    imageId,
    tarSha256: hash(tarBytes),
    inspectSha256: hash(await fs.readFile(path.join(dir, 'candidate-image-inspect.json'))),
  };
  if (overrides.manifest) Object.assign(manifest, overrides.manifest);
  await fs.writeFile(path.join(dir, 'candidate-image-artifact.json'), JSON.stringify(manifest));
  const env = {
    SOURCE_ARTIFACT_ID: '67890',
    SOURCE_ARTIFACT_DIGEST: `sha256:${artifactDigest}`,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: runAttempt,
    GITHUB_SHA: revision,
    PULL_REQUEST_HEAD_SHA: 'e'.repeat(40),
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_TOKEN: 'test-token',
    ARTIFACT_DIR: dir,
  };
  const run = {
    id: Number(runId), run_attempt: Number(runAttempt), event: 'pull_request',
    repository: { full_name: repository }, head_sha: env.PULL_REQUEST_HEAD_SHA,
  };
  const artifact = {
    id: 67890,
    expired: false,
    name: `forky-pgdg-docker-image-${runId}-${runAttempt}`,
    digest: `sha256:${artifactDigest}`,
    workflow_run: { id: Number(runId), head_sha: env.PULL_REQUEST_HEAD_SHA },
  };
  Object.assign(run, overrides.run || {});
  Object.assign(artifact, overrides.artifact || {});
  const calls = [];
  const execute = async (command, args) => {
    calls.push([command, args]);
    if (command === 'git') return { stdout: `${tree}\n` };
    if (command === 'docker' && args[0] === 'image') return { stdout: JSON.stringify([inspect]) };
    return { stdout: '' };
  };
  const fetchImpl = async (url) => {
    const body = url.endsWith(`/runs/${runId}`) ? run : artifact;
    return { ok: true, json: async () => body };
  };
  return { dir, env, calls, execute, fetchImpl };
}

for (const [name, overrides] of [
  ['wrong workflow run', { artifact: { workflow_run: { id: 12346, head_sha: 'e'.repeat(40) } } }],
  ['wrong workflow head', { run: { head_sha: 'f'.repeat(40) } }],
  ['wrong artifact digest', { artifact: { digest: `sha256:${'f'.repeat(64)}` } }],
]) {
  test(`rejects ${name} before docker load`, async () => {
    const data = await fixture(overrides);
    try {
      await assert.rejects(consumeForkyImageArtifact({ ...data, log() {} }));
      assert.equal(data.calls.some(([command, args]) => command === 'docker' && args[0] === 'load'), false);
    } finally { await fs.rm(data.dir, { recursive: true, force: true }); }
  });
}

test('rejects a candidate tar SHA-256 mismatch before docker load', async () => {
  const data = await fixture();
  try {
    await fs.writeFile(path.join(data.dir, 'candidate-image.tar.gz'), 'tampered archive');
    await assert.rejects(consumeForkyImageArtifact({ ...data, log() {} }), /tar SHA-256 mismatch/);
    assert.equal(data.calls.some(([command, args]) => command === 'docker' && args[0] === 'load'), false);
  } finally { await fs.rm(data.dir, { recursive: true, force: true }); }
});
