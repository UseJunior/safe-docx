import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateProjection, verifyPinnedContent } from './generate_capability_projection.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function inputs() {
  return {
    pin: await json('spec-compliance/capabilities/upstream-pin.json'),
    capabilities: await json('spec-compliance/capabilities/upstream/capabilities.json'),
    profiles: await json('spec-compliance/capabilities/upstream/profiles.json'),
    mappings: await json('spec-compliance/capabilities/upstream/scenario-capabilities.json'),
    summary: await json('spec-compliance/capabilities/upstream/capability-summary.json'),
    projection: await json('spec-compliance/capabilities/safe-docx-projection.json'),
    leanCoverage: await json('verification/registry/lean-xml-checker-coverage.json'),
  };
}

test('the committed projection matches the exact upstream denominator', async () => {
  const result = await validateProjection(await inputs(), root);
  assert.equal(result.denominator, 59);
});

test('a positive claim without executable evidence is rejected', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.status === 'supported');
  claim.evidence = [];
  await assert.rejects(() => validateProjection(value, root), /positive status requires executable evidence/);
});

test('an unknown capability ID is rejected', async () => {
  const value = await inputs();
  value.projection.claims[0].capabilityId = 'word.unknown.capability';
  await assert.rejects(() => validateProjection(value, root), /unknown capability/);
});

test('a missing profile pair is rejected as denominator drift', async () => {
  const value = await inputs();
  value.projection.claims.pop();
  await assert.rejects(() => validateProjection(value, root), /missing denominator pairs/);
});

test('vendored byte drift is rejected by its content hash', async () => {
  const value = await inputs();
  const contents = new Map();
  for (const file of value.pin.files) {
    contents.set(file.path, await readFile(path.join(root, file.path)));
  }
  const first = value.pin.files[0].path;
  contents.set(first, Buffer.from('mutated'));
  assert.throws(() => verifyPinnedContent(value.pin, contents), /pin drift/);
});

test('a Lean claim outside the fixed-story checker scope is rejected', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find(
    (candidate) => candidate.capabilityId === 'word.comments.anchors' && candidate.axis === 'edit'
  );
  claim.evidence = [{
    kind: 'lean-checker',
    path: 'verification/registry/lean-xml-checker-coverage.json',
    stories: ['main'],
    reconstructionModes: ['inplace'],
  }];
  await assert.rejects(() => validateProjection(value, root), /Lean checker does not cover this capability axis/);
});

test('an unmeasured neutral result cannot establish a positive claim', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find(
    (candidate) => candidate.capabilityId === 'word.comments.anchors' && candidate.axis === 'crossPlatform'
  );
  claim.status = 'supported';
  claim.evidence = [{
    kind: 'neutral-result',
    evidenceClass: 'cross-implementation-differential',
    path: 'spec-compliance/capabilities/upstream/capability-summary.json',
    implementationVersion: '0.15.0',
    lastVerifiedCommit: '459051c072daca16cf02d8406c439d81281d382f',
  }];
  claim.rationale = 'Mutation probe.';
  await assert.rejects(() => validateProjection(value, root), /no pinned neutral result row/);
});

test('a result row not grounded in the pinned scenario mapping is rejected', async () => {
  const value = await inputs();
  value.summary.capabilities[0].scenarioIds.push('fabricatedScenario');
  await assert.rejects(() => validateProjection(value, root), /result scenario is absent from pinned mappings/);
});

test('claim package-part and story scope cannot drift from the neutral capability', async () => {
  const value = await inputs();
  value.projection.claims[0].scope.packageParts = ['word/not-real.xml'];
  await assert.rejects(() => validateProjection(value, root), /package-part scope disagrees/);
});

test('neutral evidence version and commit must match the pinned adapter result', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.status === 'supported');
  claim.evidence[0].lastVerifiedCommit = '0000000000000000000000000000000000000000';
  await assert.rejects(() => validateProjection(value, root), /neutral evidence commit disagrees/);
});

test('a positive claim cannot advance beyond all of its evidence provenance', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) =>
    candidate.status === 'supported' && candidate.evidence.every((evidence) => evidence.kind === 'neutral-result')
  );
  claim.implementationVersion = '0.16.0';
  claim.lastVerifiedCommit = '4ea2a263dc199cb81132a6580a5d22785fcda7e3';
  await assert.rejects(() => validateProjection(value, root), /positive claim lacks evidence matching its version/);
});
