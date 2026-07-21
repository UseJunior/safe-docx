import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseRevisionVocabulary,
  hasExecutableEvidenceTest,
  validateAdvancedRevisionClassification,
} from './check_advanced_revision_classification.mjs';

const [manifest, registry, leanLedger, vocabularySource, evidenceResults] = await Promise.all([
  readFile('spec-compliance/manifests/ecma-376-advanced-revisions.json', 'utf8').then(JSON.parse),
  readFile('spec-compliance/registry/ecma-376.md', 'utf8'),
  readFile('verification/registry/lean-xml-checker-coverage.json', 'utf8').then(JSON.parse),
  readFile('packages/docx-core/src/primitives/revision-vocabulary.ts', 'utf8'),
  readFile('spec-compliance/evidence/ecma-376-advanced-revisions.json', 'utf8').then(JSON.parse),
]);
const vocabulary = parseRevisionVocabulary(vocabularySource);

function cloneManifest() {
  return structuredClone(manifest);
}

test('parses both canonical runtime revision vocabulary arrays', () => {
  const source = `
    export const TRACKED_CHANGE_ELEMENT_NAMES = ['ins', 'del'] as const;
    export const REVISION_RANGE_ELEMENT_NAMES = ['moveFromRangeStart'] as const;
  `;
  assert.deepEqual(parseRevisionVocabulary(source), ['ins', 'del', 'moveFromRangeStart']);
});

test('rejects a newly introduced unclassified revision element', async () => {
  await assert.rejects(
    validateAdvancedRevisionClassification(cloneManifest(), [...vocabulary, 'futureChange'], registry, leanLedger, evidenceResults),
    /Unclassified revision vocabulary: futureChange/,
  );
});

test('rejects an operation whose element-specific executable evidence is removed', async () => {
  const candidate = cloneManifest();
  candidate.records[0].evidence[0].claims = candidate.records[0].evidence[0].claims.filter(
    (claim) => claim.operation !== 'accept',
  );
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /ADV-CONTENT-RESOLUTION-01: undeclared executed mutation-sensitive claim (ins|del) accept main/,
  );
});

test('rejects evidence IDs stuffed into a non-executable file', async () => {
  const candidate = cloneManifest();
  candidate.records[0].evidence[0].test.path = 'spec-compliance/manifests/ecma-376-advanced-revisions.json';
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /identifier is not attached to an executable test callback/,
  );
});

test('recognizes an evidence ID only on an executable test callback', () => {
  const stuffed = `
    test('[ADV-CONTENT-RESOLUTION-01] ins del accept reject main', () => {
      expect('ins accept main').toContain('accept');
    });
  `;
  assert.equal(hasExecutableEvidenceTest(stuffed, 'stuffed.test.ts', 'ADV-CONTENT-RESOLUTION-01'), true);
  assert.equal(hasExecutableEvidenceTest('const token = "ADV-CONTENT-RESOLUTION-01";', 'stuffed.ts', 'ADV-CONTENT-RESOLUTION-01'), false);
});

test('does not allow emission evidence to masquerade as accept evidence', async () => {
  const candidate = cloneManifest();
  const emission = candidate.records[0].evidence.find((evidence) => evidence.id === 'ADV-CONTENT-EMISSION-01');
  emission.claims[0].operation = 'accept';
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /ADV-CONTENT-EMISSION-01: (missing|undeclared) executed mutation-sensitive claim/,
  );
});

test('binds comparison and reconstruction evidence to the exact mode', async () => {
  const candidate = cloneManifest();
  const moves = candidate.records.find((record) => record.id === 'advanced-revision.moves-content');
  const comparison = moves.evidence.find((evidence) => evidence.id === 'ADV-COMPARE-MOVE-EMISSION-01');
  const inplace = comparison.claims.find((claim) => claim.operation === 'comparison.inplace');
  inplace.operation = 'reconstruction.inplace';
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /ADV-COMPARE-MOVE-EMISSION-01: (missing|undeclared) executed mutation-sensitive claim/,
  );
});

test('binds evidence to the classified story', async () => {
  const candidate = cloneManifest();
  const stories = candidate.records.find((record) => record.id === 'advanced-revision.header-footer-stories');
  stories.evidence[0].claims[0].story = 'main';
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /ADV-STORY-BOUNDARY-01: (missing|undeclared) executed mutation-sensitive claim/,
  );
});

test('rejects omission of one exact normative subsection', async () => {
  const candidate = cloneManifest();
  const moves = candidate.records.find((record) => record.id === 'advanced-revision.moves-ranges');
  moves.normativeSections.moveToRangeStart = [];
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /moveToRangeStart: normative anchors must be ECMA-PART1-17-13-5-28/,
  );
});

test('rejects reassignment of every manifest anchor to another element', async () => {
  for (const sourceRecord of manifest.records) {
    for (const [element, anchors] of Object.entries(sourceRecord.normativeSections ?? {})) {
      for (const anchor of anchors) {
        const candidate = cloneManifest();
        const source = candidate.records.find((record) => record.id === sourceRecord.id);
        source.normativeSections[element] = source.normativeSections[element].filter((value) => value !== anchor);
        const target = candidate.records.find((record) =>
          Object.keys(record.normativeSections ?? {}).some((name) => name !== element),
        );
        const targetElement = Object.keys(target.normativeSections).find((name) => name !== element);
        target.normativeSections[targetElement].push(anchor);
        await assert.rejects(
          validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
          /normative anchors must be/,
          `${anchor} must remain bound to ${element}`,
        );
      }
    }
  }
});

test('rejects a blanket Lean semantics claim', async () => {
  const candidate = cloneManifest();
  candidate.records[0].operations.lean.advancedRecordSemantics = 'implemented';
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /Lean does not verify advanced-record semantics/,
  );
});

test('rejects assigning an ECMA anchor to a w14 extension element', async () => {
  const candidate = cloneManifest();
  const conflicts = candidate.records.find((record) => record.elements.includes('w14:conflictIns'));
  conflicts.normativeSections['w14:conflictIns'] = ['ECMA-PART1-17-13-5-28'];
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /w14:conflictIns: normative anchors must be \(none\)/,
  );
});

test('rejects omission of an explicit empty normative anchor owner', async () => {
  const candidate = cloneManifest();
  const conflicts = candidate.records.find((record) => record.elements.includes('w14:conflictIns'));
  delete conflicts.normativeSections['w14:conflictIns'];
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger, evidenceResults),
    /normativeSections must own an array for w14:conflictIns/,
  );
});

test('rejects an executed evidence artifact with a missing mutation sentinel', async () => {
  const candidateResults = structuredClone(evidenceResults);
  candidateResults.cases[0].assertions.targetRemovalDetected = false;
  await assert.rejects(
    validateAdvancedRevisionClassification(cloneManifest(), vocabulary, registry, leanLedger, candidateResults),
    /incomplete mutation-sensitive result/,
  );
});
