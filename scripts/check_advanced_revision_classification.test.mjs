import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseRevisionVocabulary,
  validateAdvancedRevisionClassification,
} from './check_advanced_revision_classification.mjs';

const registry = [
  'ECMA-PART1-17-13-5',
  'ECMA-PART1-17-13-5-2',
  'ECMA-PART1-17-13-5-21',
  'ECMA-PART1-17-13-5-30',
  'ECMA-PART1-17-13-5-34',
  'ECMA-PART1-17-13-5-36',
].map((id) => `## [${id}]`).join('\n');

function manifestFor(elements) {
  return {
    schemaVersion: 1,
    storyScope: { leanReads: ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'] },
    records: [{
      id: 'test.record',
      elements,
      registryIds: [
        'ECMA-PART1-17-13-5-21',
        'ECMA-PART1-17-13-5-30',
        'ECMA-PART1-17-13-5-34',
        'ECMA-PART1-17-13-5-36',
      ],
      classification: 'implemented',
      operations: { accept: 'implemented', lean: 'non-goal' },
      evidence: [
        'scripts/check_advanced_revision_classification.mjs',
        'scripts/check_advanced_revision_classification.test.mjs',
      ],
    }],
  };
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
    validateAdvancedRevisionClassification(manifestFor(['ins']), ['ins', 'futureChange'], registry),
    /Unclassified revision vocabulary: futureChange/,
  );
});

test('rejects an implemented claim without evidence', async () => {
  const manifest = manifestFor(['ins']);
  manifest.records[0].evidence = [];
  await assert.rejects(
    validateAdvancedRevisionClassification(manifest, ['ins'], registry),
    /implemented operations require executable test evidence/,
  );
});
