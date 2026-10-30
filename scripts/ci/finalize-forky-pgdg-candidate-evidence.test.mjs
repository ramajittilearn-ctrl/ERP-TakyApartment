import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const finalizer = path.join(root, 'scripts/ci/finalize-forky-pgdg-candidate-evidence.mjs');
const sha = 'a'.repeat(40);

async function fixtures() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'forky-finalize-test-'));
  const evidence = path.join(temp, 'candidate');
  const stage5 = path.join(evidence, 'stage5-runtime');
  const stage5Run = path.join(stage5, 'b'.repeat(24));
  await mkdir(stage5Run, { recursive: true });
  await writeFile(path.join(evidence, 'status.json'), JSON.stringify({
    status: 'PASS', runtimeVerification: true, networkListenAddresses: true, logicalRestoreFromTrixie: true,
    logicalRestoreFromBookworm: true, collationIndexRebuilt: true, imageId: 'sha256:' + 'c'.repeat(64),
  }));
  await writeFile(path.join(evidence, 'listen-addresses.txt'), '*\n');
  await writeFile(path.join(evidence, 'verified-inputs.json'), JSON.stringify({ sourceArtifact: { digest: 'sha256:' + 'd'.repeat(64) } }));
  await writeFile(path.join(stage5Run, 'run-summary.json'), JSON.stringify({
    status: 'passed', source: { checkoutCommit: sha },
    images: {
      databaseImageReference: 'taky-erp-postgres:17.11-forky-pgdg-candidate-aaaaaaaaaaaa',
      databaseImageId: 'sha256:' + 'c'.repeat(64),
    },
    migrations: [{ name: '001_init' }], checks: [
      { label: 'fresh database identity checked before migration', result: 'passed' },
      { label: 'prisma migrate deploy', result: 'passed' },
    ],
  }));
  return { temp, evidence, stage5 };
}

test('finalizes only source-matched Forky candidate plus successful ERP Stage 5 evidence', async () => {
  const f = await fixtures();
  try {
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'PASS');
    assert.equal(result.erpStage5Verification, true);
    assert.equal(result.migrationCount, 1);
    assert.equal(result.scannerClearance, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('retains an incomplete no-clearance record if Stage 5 failed', async () => {
  const f = await fixtures();
  try {
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'failure' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.erpStage5Verification, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('refuses acceptance when PostgreSQL listener output contradicts wildcard binding', async () => {
  const f = await fixtures();
  try {
    await writeFile(path.join(f.evidence, 'listen-addresses.txt'), '127.0.0.1\n');
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.erpStage5Verification, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('refuses acceptance when the Stage 5 database service identity check is absent', async () => {
  const f = await fixtures();
  try {
    const summaryPath = path.join(f.stage5, 'b'.repeat(24), 'run-summary.json');
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    summary.checks = [];
    await writeFile(summaryPath, JSON.stringify(summary));
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.erpStage5Verification, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});
