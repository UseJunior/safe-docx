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

test('a Lean scope manifest cannot establish a positive claim', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find(
    (candidate) => candidate.capabilityId === 'word.comments.anchors' && candidate.axis === 'edit'
  );
  claim.evidence = [{
    kind: 'lean-checker',
    path: 'verification/registry/lean-xml-checker-coverage.json',
    evidenceClass: 'lean-per-document-checker',
    implementationVersion: claim.implementationVersion,
    lastVerifiedCommit: claim.lastVerifiedCommit,
  }];
  await assert.rejects(() => validateProjection(value, root), /no executable evidence/);
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
  await assert.rejects(() => validateProjection(value, root), /unknown result scenario/);
});

test('claim package-part scope must remain a subset of the neutral capability', async () => {
  const value = await inputs();
  value.projection.claims[0].scope.packageParts = ['word/not-real.xml'];
  await assert.rejects(() => validateProjection(value, root), /package-part scope is not a subset/);
});

test('neutral evidence version and commit must match the pinned adapter result', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.evidence.some((evidence) => evidence.kind === 'neutral-result'));
  claim.evidence[0].lastVerifiedCommit = '0000000000000000000000000000000000000000';
  await assert.rejects(() => validateProjection(value, root), /neutral evidence commit disagrees with resolved result commit/);
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

test('a nonexistent local evidence commit is rejected', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.evidence.some((evidence) => evidence.kind === 'local-test'));
  claim.lastVerifiedCommit = '0000000000000000000000000000000000000000';
  claim.evidence[0].lastVerifiedCommit = claim.lastVerifiedCommit;
  await assert.rejects(() => validateProjection(value, root), /local evidence commit does not exist/);
});

test('a fabricated local implementation version is rejected against package metadata at the commit', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.evidence.some((evidence) => evidence.kind === 'local-test'));
  claim.implementationVersion = '9.9.9';
  claim.evidence[0].implementationVersion = claim.implementationVersion;
  await assert.rejects(() => validateProjection(value, root), /local evidence version disagrees with package version at claimed commit/);
});

test('a fabricated full neutral SHA sharing the adapter prefix is rejected', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.evidence.some((evidence) => evidence.kind === 'neutral-result'));
  claim.evidence[0].lastVerifiedCommit = '459051c072da0000000000000000000000000000';
  await assert.rejects(() => validateProjection(value, root), /neutral evidence commit disagrees with resolved result commit/);
});

test('a generic source substring is not accepted as a test selector', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.evidence.some((evidence) => evidence.kind === 'local-test'));
  claim.evidence[0].selector = 'word/document.xml';
  await assert.rejects(() => validateProjection(value, root), /exact test title not found at claimed commit/);
});

test('an absent local test selector is rejected', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.evidence.some((evidence) => evidence.kind === 'local-test'));
  claim.evidence[0].selector = 'this test title does not exist';
  await assert.rejects(() => validateProjection(value, root), /exact test title not found at claimed commit/);
});

test('a local evidence path cannot escape the repository', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.evidence.some((evidence) => evidence.kind === 'local-test'));
  claim.evidence[0].path = '../outside.test.ts';
  await assert.rejects(() => validateProjection(value, root), /evidence path escapes repository/);
});

test('untagged local tests cannot self-classify as normative evidence', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find((candidate) => candidate.evidence.some(
    (evidence) => evidence.kind === 'local-test' && evidence.evidenceClass === 'behavioral-regression-test'
  ));
  claim.evidence[0].evidenceClass = 'normative-behavioral-scenario';
  await assert.rejects(() => validateProjection(value, root), /normative evidence lacks structured conformance metadata/);
});

test('a sparse second-adapter outcome is rejected', async () => {
  const value = await inputs();
  const row = value.summary.capabilities.find((candidate) => candidate.axis === 'crossPlatform');
  const [, outcome] = Object.entries(row.outcomes).find(([name, candidate]) => name !== 'safe-docx' && candidate.passLike === candidate.denominator);
  outcome.denominator -= 1;
  outcome.passLike -= 1;
  const firstCount = Object.keys(outcome.counts)[0];
  outcome.counts[firstCount] -= 1;
  await assert.rejects(() => validateProjection(value, root), /denominator does not cover every row scenario/);
});

test('a partial SafeDocX outcome cannot establish a neutral claim', async () => {
  const value = await inputs();
  value.summary.capabilities[0].outcomes['safe-docx'].passLike -= 1;
  await assert.rejects(() => validateProjection(value, root), /neutral SafeDocX result is not fully pass-like/);
});

test('adapter outcome counts must sum to their denominator', async () => {
  const value = await inputs();
  value.summary.capabilities[0].outcomes['safe-docx'].counts.pass -= 1;
  await assert.rejects(() => validateProjection(value, root), /counts do not sum to denominator/);
});

test('duplicate summary rows are rejected', async () => {
  const value = await inputs();
  value.summary.capabilities.push(structuredClone(value.summary.capabilities[0]));
  await assert.rejects(() => validateProjection(value, root), /duplicate summary row/);
});

test('duplicate scenario IDs within a summary row are rejected', async () => {
  const value = await inputs();
  value.summary.capabilities[0].scenarioIds.push(value.summary.capabilities[0].scenarioIds[0]);
  await assert.rejects(() => validateProjection(value, root), /duplicate result scenario ID/);
});

test('summary rows must contain the exact mapped measured scenario set', async () => {
  const value = await inputs();
  value.summary.capabilities[0].scenarioIds.pop();
  await assert.rejects(() => validateProjection(value, root), /result scenarios do not exactly match mapped measured scenarios/);
});

test('duplicate projection pairs are rejected', async () => {
  const value = await inputs();
  value.projection.claims.push(structuredClone(value.projection.claims[0]));
  await assert.rejects(() => validateProjection(value, root), /duplicate projection pair/);
});

test('projection pairs outside the selected profile are rejected', async () => {
  const value = await inputs();
  value.profiles.profiles[0].capabilityIds = value.profiles.profiles[0].capabilityIds.slice(1);
  await assert.rejects(() => validateProjection(value, root), /projection capability is outside profile/);
});

test('projection pairs on non-applicable axes are rejected', async () => {
  const value = await inputs();
  const claim = value.projection.claims.find(
    (candidate) => candidate.capabilityId === 'word.comments.removal' && candidate.axis === 'crossPlatform'
  );
  claim.axis = 'generate';
  await assert.rejects(() => validateProjection(value, root), /axis generate is not applicable/);
});

test('the human report retains the exact formal-assurance limitations', async () => {
  const report = await readFile(path.join(root, 'spec-compliance/generated/safe-docx-capability-projection.md'), 'utf8');
  assert.match(report, /scope metadata only and establishes \*\*no capability row\*\*/);
  assert.match(report, /Covered reconstruction mode: inplace\. Excluded mode: rebuild\./);
  assert.match(report, /Covered stories: main, footnotes, endnotes\. Projections: text and field markers only\./);
  assert.match(report, /Exact excluded surfaces: word\/comments\.xml and all comment anchors/);
  assert.match(report, /Exact known unchecked areas: full ECMA-376 schema validation;/);
});
