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
assert.ok(summary.checks?.some((check) => check.label === 'fresh database identity checked before migration' && check.result === 'passed'), 'Stage 5 database service connectivity was not verified before migration');
assert.match(summary.images?.databaseImageReference || '', /^taky-erp-postgres:17\.11-forky-pgdg-candidate-[a-f0-9]{12}$/);
assert.equal(summary.images?.databaseImageId, status.imageId, 'Stage 5 database container image ID differs from the candidate runtime image');
assert.ok(Array.isArray(summary.migrations) && summary.migrations.length > 0, 'Stage 5 migration evidence is missing');
assert.ok(summary.checks?.some((check) => check.label === 'prisma migrate deploy' && check.result === 'passed'), 'Prisma migration deployment was not verified');
result.status = 'PASS';
result.runtimeVerification = true;
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
