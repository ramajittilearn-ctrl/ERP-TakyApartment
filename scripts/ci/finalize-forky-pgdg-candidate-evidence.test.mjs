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
const tree = 'f'.repeat(40);
const imageId = 'sha256:' + 'c'.repeat(64);
const gosuHash = 'e'.repeat(64);

async function fixtures() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'forky-finalize-test-'));
  const evidence = path.join(temp, 'candidate');
  const stage5 = path.join(evidence, 'stage5-runtime');
  const stage5Run = path.join(stage5, 'b'.repeat(24));
  await mkdir(stage5Run, { recursive: true });
  await writeFile(path.join(evidence, 'status.json'), JSON.stringify({
    status: 'PASS', runtimeVerification: true, networkListenAddresses: true,
    gosuBinaryProvenance: true, gosuGovulncheckNoVulnerabilities: true, gosuTrivyNoCriticalHigh: true,
    logicalRestoreFromTrixie: true, logicalRestoreFromBookworm: true,
    collationIndexRebuilt: true, imageId,
  }));
  await writeFile(path.join(evidence, 'listen-addresses.txt'), '*\n');
  await writeFile(path.join(evidence, 'fresh-cluster-ssl-enabled.txt'), 'off\n');
  await writeFile(path.join(evidence, 'fresh-cluster-ssl-cert-file.txt'), 'server.crt\n');
  await writeFile(path.join(evidence, 'fresh-cluster-ssl-key-file.txt'), 'server.key\n');
  await writeFile(path.join(evidence, 'gosu-candidate-provenance.json'), JSON.stringify({
    sourceRevision: sha, sourceTree: tree, imageId,
    builderImage: 'golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4',
    gosuCommit: '6456aaa0f3c854d199d0f037f068eb97515b7513',
    userModule: 'v0.4.1', xSysModule: 'v0.44.0', binarySha256: gosuHash,
  }));
  await writeFile(path.join(evidence, 'gosu-candidate-binary.sha256'), `${gosuHash}\n`);
  await writeFile(path.join(evidence, 'gosu-candidate-govulncheck.txt'), `Database image ID: ${imageId}\nExtracted binary SHA-256: ${gosuHash}\nCommand: govulncheck -mode=binary <extracted-gosu-binary>\nNo vulnerabilities found.\n`);
  await writeFile(path.join(evidence, 'candidate-image-inspect.json'), JSON.stringify({
    Id: imageId,
    Config: { Labels: {
      'io.taky.postgres.gosu.builder': 'golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4',
      'io.taky.postgres.gosu.commit': '6456aaa0f3c854d199d0f037f068eb97515b7513',
      'io.taky.postgres.gosu.user-module': 'v0.4.1',
      'io.taky.postgres.gosu.x-sys-module': 'v0.44.0',
    } },
  }));
  await writeFile(path.join(evidence, 'trivy-candidate-image.json'), JSON.stringify({
    SchemaVersion: 2, Metadata: { ImageID: imageId },
    Results: [{ Target: 'usr/local/bin/gosu', Vulnerabilities: [{ Severity: 'MEDIUM' }] }],
  }));
  await writeFile(path.join(evidence, 'verified-inputs.json'), JSON.stringify({ sourceArtifact: { digest: 'sha256:' + 'd'.repeat(64) } }));
  await writeFile(path.join(stage5Run, 'run-summary.json'), JSON.stringify({
    status: 'passed', source: { checkoutCommit: sha, checkoutTree: tree },
    images: {
      databaseImageReference: 'taky-erp-postgres:17.11-forky-pgdg-candidate-aaaaaaaaaaaa',
      databaseImageId: imageId,
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
    assert.equal(result.freshClusterTlsDefaultsVerified, true);
    assert.equal(result.gosuBinaryProvenance, true);
    assert.equal(result.gosuGovulncheckNoVulnerabilities, true);
    assert.equal(result.gosuTrivyNoCriticalHigh, true);
    assert.equal(result.migrationCount, 1);
    assert.equal(result.scannerClearance, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('refuses candidate acceptance if fresh-cluster PostgreSQL TLS evidence is missing', async () => {
  const f = await fixtures();
  try {
    await rm(path.join(f.evidence, 'fresh-cluster-ssl-key-file.txt'));
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.freshClusterTlsDefaultsVerified, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('refuses candidate acceptance if fresh-cluster PostgreSQL TLS evidence contradicts the default', async () => {
  const f = await fixtures();
  try {
    await writeFile(path.join(f.evidence, 'fresh-cluster-ssl-enabled.txt'), 'on\n');
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.freshClusterTlsDefaultsVerified, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('refuses candidate acceptance if the fresh-cluster TLS certificate path differs from the default', async () => {
  const f = await fixtures();
  try {
    await writeFile(path.join(f.evidence, 'fresh-cluster-ssl-cert-file.txt'), '/etc/ssl/certs/ssl-cert-snakeoil.pem\n');
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.freshClusterTlsDefaultsVerified, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('refuses candidate acceptance if the fresh-cluster TLS key path differs from the default', async () => {
  const f = await fixtures();
  try {
    await writeFile(path.join(f.evidence, 'fresh-cluster-ssl-key-file.txt'), '/etc/ssl/private/ssl-cert-snakeoil.key\n');
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.freshClusterTlsDefaultsVerified, false);
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

test('refuses acceptance when raw Trivy reports Critical or High for gosu', async () => {
  const f = await fixtures();
  try {
    const scanPath = path.join(f.evidence, 'trivy-candidate-image.json');
    const scan = JSON.parse(await readFile(scanPath, 'utf8'));
    scan.Results[0].Vulnerabilities.push({ Severity: 'CRITICAL', VulnerabilityID: 'CVE-test' });
    await writeFile(scanPath, JSON.stringify(scan));
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.gosuTrivyNoCriticalHigh, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('refuses acceptance when the gosu vulnerability report does not match the recorded binary hash', async () => {
  const f = await fixtures();
  try {
    await writeFile(path.join(f.evidence, 'gosu-candidate-govulncheck.txt'), 'No vulnerabilities found.\n');
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.gosuGovulncheckNoVulnerabilities, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test('refuses acceptance when the gosu vulnerability report includes excluded findings', async () => {
  const f = await fixtures();
  try {
    const reportPath = path.join(f.evidence, 'gosu-candidate-govulncheck.txt');
    const report = await readFile(reportPath, 'utf8');
    await writeFile(reportPath, `${report}Excluded finding: GO-2023-1840\n`);
    const run = spawnSync(process.execPath, [finalizer, f.evidence, f.stage5], {
      encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, STAGE5_RUN_RESULT: 'success' },
    });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(await readFile(path.join(f.evidence, 'candidate-acceptance-status.json'), 'utf8'));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.gosuGovulncheckNoVulnerabilities, false);
    assert.equal(result.productionClearance, false);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});
