import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseRevisionVocabulary,
  validateAdvancedRevisionClassification,
} from './check_advanced_revision_classification.mjs';

const [manifest, registry, leanLedger, vocabularySource] = await Promise.all([
  readFile('spec-compliance/manifests/ecma-376-advanced-revisions.json', 'utf8').then(JSON.parse),
  readFile('spec-compliance/registry/ecma-376.md', 'utf8'),
  readFile('verification/registry/lean-xml-checker-coverage.json', 'utf8').then(JSON.parse),
  readFile('packages/docx-core/src/primitives/revision-vocabulary.ts', 'utf8'),
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
    validateAdvancedRevisionClassification(cloneManifest(), [...vocabulary, 'futureChange'], registry, leanLedger),
    /Unclassified revision vocabulary: futureChange/,
  );
});

test('rejects an operation whose element-specific executable evidence is removed', async () => {
  const candidate = cloneManifest();
  candidate.records[0].evidence = candidate.records[0].evidence.filter(
    (evidence) => !evidence.operations.includes('accept'),
  );
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger),
    /accept lacks element-specific evidence for ins, del/,
  );
});

test('rejects evidence IDs stuffed into a non-executable file', async () => {
  const candidate = cloneManifest();
  candidate.records[0].evidence[0].test.path = 'spec-compliance/manifests/ecma-376-advanced-revisions.json';
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger),
    /identifier is not attached to an executable test callback/,
  );
});

test('rejects omission of one exact normative subsection', async () => {
  const candidate = cloneManifest();
  const moves = candidate.records.find((record) => record.id === 'advanced-revision.moves-ranges');
  moves.normativeSections.moveToRangeStart = [];
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger),
    /Missing normative advanced-revision anchors: ECMA-PART1-17-13-5-28/,
  );
});

test('rejects a blanket Lean semantics claim', async () => {
  const candidate = cloneManifest();
  candidate.records[0].operations.lean.advancedRecordSemantics = 'implemented';
  await assert.rejects(
    validateAdvancedRevisionClassification(candidate, vocabulary, registry, leanLedger),
    /Lean does not verify advanced-record semantics/,
  );
});
