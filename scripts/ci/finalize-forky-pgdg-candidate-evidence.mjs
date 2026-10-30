#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const [evidenceDirArg, stage5DirArg] = process.argv.slice(2);
assert.ok(evidenceDirArg && stage5DirArg, 'candidate evidence and Stage 5 evidence directories are required');
const evidenceDir = path.resolve(evidenceDirArg);
const stage5Dir = path.resolve(stage5DirArg);
const statusPath = path.join(evidenceDir, 'status.json');
const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));
const result = {
  schemaVersion: 1,
  status: 'INCOMPLETE',
  candidateOnly: true,
  runtimeVerification: false,
  freshClusterTlsDefaultsVerified: false,
  gosuBinaryProvenance: false,
  gosuGovulncheckNoVulnerabilities: false,
  gosuTrivyNoCriticalHigh: false,
  logicalRestoreFromTrixie: false,
  logicalRestoreFromBookworm: false,
  collationIndexRebuilt: false,
  erpStage5Verification: false,
  scannerClearance: false,
  cveDisposition: false,
  imageSelection: false,
  productionClearance: false,
  revision: process.env.GITHUB_SHA || null,
};

try {
function assertTrue(value, message) { assert.equal(value, true, message); }
assertTrue(status.status === 'PASS', 'Forky PostgreSQL base runtime verification did not pass');
assertTrue(status.runtimeVerification, 'Forky PostgreSQL runtime checks are absent');
assertTrue(status.networkListenAddresses, 'PostgreSQL network listener evidence is absent');
assert.equal((await fs.readFile(path.join(evidenceDir, 'listen-addresses.txt'), 'utf8')).trim(), '*', 'PostgreSQL listen-address evidence does not prove wildcard binding');
assert.equal((await fs.readFile(path.join(evidenceDir, 'fresh-cluster-ssl-enabled.txt'), 'utf8')).trim(), 'off', 'fresh-cluster runtime evidence does not prove PostgreSQL TLS is off by default');
assert.equal((await fs.readFile(path.join(evidenceDir, 'fresh-cluster-ssl-cert-file.txt'), 'utf8')).trim(), 'server.crt', 'fresh-cluster runtime evidence has a non-default TLS certificate path');
assert.equal((await fs.readFile(path.join(evidenceDir, 'fresh-cluster-ssl-key-file.txt'), 'utf8')).trim(), 'server.key', 'fresh-cluster runtime evidence has a non-default TLS key path');
assertTrue(status.gosuBinaryProvenance, 'Candidate gosu provenance evidence is absent');
assertTrue(status.gosuGovulncheckNoVulnerabilities, 'Candidate gosu binary vulnerability analysis is absent');
assertTrue(status.gosuTrivyNoCriticalHigh, 'Candidate gosu Trivy severity gate did not pass');
const gosuProvenance = JSON.parse(await fs.readFile(path.join(evidenceDir, 'gosu-candidate-provenance.json'), 'utf8'));
assert.equal(gosuProvenance.sourceRevision, process.env.GITHUB_SHA, 'gosu source revision differs from this candidate revision');
assert.equal(gosuProvenance.imageId, status.imageId, 'gosu provenance image ID differs from candidate runtime image');
assert.match(gosuProvenance.sourceTree || '', /^[a-f0-9]{40}$/);
assert.equal(gosuProvenance.builderImage, 'golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4');
assert.equal(gosuProvenance.gosuCommit, '6456aaa0f3c854d199d0f037f068eb97515b7513');
assert.equal(gosuProvenance.userModule, 'v0.4.1');
assert.equal(gosuProvenance.xSysModule, 'v0.44.0');
assert.match(gosuProvenance.binarySha256 || '', /^[a-f0-9]{64}$/);
const candidateImageInspect = JSON.parse(await fs.readFile(path.join(evidenceDir, 'candidate-image-inspect.json'), 'utf8'));
assert.equal(candidateImageInspect.Id, status.imageId, 'candidate inspect evidence is not bound to the runtime image ID');
assert.equal(candidateImageInspect.Config?.Labels?.['io.taky.postgres.gosu.builder'], gosuProvenance.builderImage);
assert.equal(candidateImageInspect.Config?.Labels?.['io.taky.postgres.gosu.commit'], gosuProvenance.gosuCommit);
assert.equal(candidateImageInspect.Config?.Labels?.['io.taky.postgres.gosu.user-module'], gosuProvenance.userModule);
assert.equal(candidateImageInspect.Config?.Labels?.['io.taky.postgres.gosu.x-sys-module'], gosuProvenance.xSysModule);
assert.equal((await fs.readFile(path.join(evidenceDir, 'gosu-candidate-binary.sha256'), 'utf8')).trim(), gosuProvenance.binarySha256, 'gosu binary hash evidence does not match its provenance record');
const gosuGovulncheck = await fs.readFile(path.join(evidenceDir, 'gosu-candidate-govulncheck.txt'), 'utf8');
assert.ok(gosuGovulncheck.includes(status.imageId), 'gosu vulnerability report is not bound to the candidate image ID');
assert.ok(gosuGovulncheck.includes(gosuProvenance.binarySha256), 'gosu vulnerability report is not bound to the extracted binary hash');
assert.ok(gosuGovulncheck.includes('Command: govulncheck -mode=binary'), 'gosu vulnerability report was not produced by direct binary mode');
assert.doesNotMatch(gosuGovulncheck, /excluded|exclusion/i, 'gosu vulnerability report contains excluded findings');
assert.match(gosuGovulncheck, /No vulnerabilities found\./, 'gosu binary vulnerability analysis did not report a clean result');
const candidateTrivy = JSON.parse(await fs.readFile(path.join(evidenceDir, 'trivy-candidate-image.json'), 'utf8'));
assert.equal(candidateTrivy.SchemaVersion, 2);
assert.equal(candidateTrivy.Metadata?.ImageID, status.imageId, 'candidate Trivy scan is not bound to the runtime image ID');
const gosuTrivyResults = (candidateTrivy.Results || []).filter((entry) => entry.Target === 'usr/local/bin/gosu');
assert.equal(gosuTrivyResults.length, 1, 'candidate Trivy report must contain exactly one gosu binary target');
assert.equal(gosuTrivyResults.flatMap((entry) => entry.Vulnerabilities || []).filter((finding) => ['CRITICAL', 'HIGH'].includes(finding.Severity)).length, 0, 'candidate gosu retains raw Trivy Critical/High findings');
assertTrue(status.logicalRestoreFromTrixie, 'Trixie logical restore evidence is absent');
assertTrue(status.logicalRestoreFromBookworm, 'Bookworm logical restore evidence is absent');
assertTrue(status.collationIndexRebuilt, 'Candidate collation/index rebuild evidence is absent');
assert.equal(process.env.STAGE5_RUN_RESULT, 'success', 'ERP Stage 5 workflow step did not succeed');

async function collect(directory) {
  const found = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, item.name);
    if (item.isDirectory()) found.push(...await collect(child));
    else if (item.isFile() && item.name === 'run-summary.json') found.push(child);
  }
  return found;
}

const summaries = await collect(stage5Dir);
assert.equal(summaries.length, 1, 'exactly one isolated Stage 5 run summary is required');
const summaryBytes = await fs.readFile(summaries[0]);
const summary = JSON.parse(summaryBytes.toString('utf8'));
assert.equal(summary.status, 'passed', 'ERP Stage 5 run summary is not passed');
assert.equal(summary.source?.checkoutCommit, process.env.GITHUB_SHA, 'Stage 5 checkout differs from this candidate revision');
assert.equal(gosuProvenance.sourceTree, summary.source?.checkoutTree, 'gosu build tree differs from the Stage 5 source tree');
assert.ok(summary.checks?.some((check) => check.label === 'fresh database identity checked before migration' && check.result === 'passed'), 'Stage 5 database service connectivity was not verified before migration');
assert.match(summary.images?.databaseImageReference || '', /^taky-erp-postgres:17\.11-forky-pgdg-candidate-[a-f0-9]{12}$/);
assert.equal(summary.images?.databaseImageId, status.imageId, 'Stage 5 database container image ID differs from the candidate runtime image');
assert.ok(Array.isArray(summary.migrations) && summary.migrations.length > 0, 'Stage 5 migration evidence is missing');
assert.ok(summary.checks?.some((check) => check.label === 'prisma migrate deploy' && check.result === 'passed'), 'Prisma migration deployment was not verified');
result.status = 'PASS';
result.runtimeVerification = true;
result.freshClusterTlsDefaultsVerified = true;
result.gosuBinaryProvenance = true;
result.gosuGovulncheckNoVulnerabilities = true;
result.gosuTrivyNoCriticalHigh = true;
result.logicalRestoreFromTrixie = true;
result.logicalRestoreFromBookworm = true;
result.collationIndexRebuilt = true;
result.erpStage5Verification = true;
result.revision = process.env.GITHUB_SHA;
result.imageId = status.imageId;
result.sourceProvenanceArtifactDigest = JSON.parse(await fs.readFile(path.join(evidenceDir, 'verified-inputs.json'), 'utf8')).sourceArtifact.digest;
result.stage5RunSummary = path.relative(evidenceDir, summaries[0]);
result.stage5RunSummarySha256 = crypto.createHash('sha256').update(summaryBytes).digest('hex');
result.migrationCount = summary.migrations.length;
await fs.writeFile(path.join(evidenceDir, 'candidate-acceptance-status.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  result.reason = error instanceof Error ? error.message : 'candidate evidence validation failed';
  await fs.writeFile(path.join(evidenceDir, 'candidate-acceptance-status.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  process.stderr.write(result.reason + '\n');
  process.exitCode = 1;
}
