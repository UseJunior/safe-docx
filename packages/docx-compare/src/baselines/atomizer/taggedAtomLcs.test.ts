import { describe, expect } from 'vitest';
import { CorrelationStatus, type ComparisonUnitAtom } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';
import { computeTaggedAtomLcs } from './atomLcs.js';

const TEST_FEATURE = 'Tagged Atom LCS';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

function atom(text: string, runProperties: Element | null = null): ComparisonUnitAtom {
  const content = el('w:t', {}, undefined, text);
  const run = el('w:r', {}, runProperties ? [runProperties, content] : [content]);
  el('w:p', {}, [run]);
  return {
    contentElement: content,
    ancestorElements: [run],
    ancestorUnids: [],
    part: { uri: 'word/document.xml', contentType: 'application/xml' },
    sha1Hash: text,
    correlationStatus: CorrelationStatus.Unknown,
    rPr: runProperties,
  };
}

describe('tagged atom LCS', () => {
  test.allure({ story: 'formatting-only matches remain both-tagged' })(
    'a formatting-only difference remains one both alignment with a direct property delta',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = atom('settled text');
      const revised = atom('settled text', el('w:rPr', {}, [el('w:b')]));
      let result!: ReturnType<typeof computeTaggedAtomLcs>;

      await given('equal text with different direct run properties', () => {
        expect(original.contentElement.textContent).toBe(revised.contentElement.textContent);
      });

      await when('the existing LCS is tagged without rerunning matching', () => {
        result = computeTaggedAtomLcs([original], [revised], 'word');
      });

      await then('the unchanged LCS result has one match and no delete or insert', () => {
        expect(result.lcs).toEqual({
          matches: [{ originalIndex: 0, revisedIndex: 0 }],
          deletedIndices: [],
          insertedIndices: [],
        });
      });

      await and('the tag preserves both representatives and a direct run delta', () => {
        expect(result.granularity).toBe('word');
        expect(result.alignments).toHaveLength(1);
        expect(result.alignments[0]).toMatchObject({ tag: 'both', original, revised });
        expect(result.alignments[0]?.propertyDelta?.scope).toBe('run');
      });
    },
  );

  test.allure({ story: 'pre-existing insertion provenance survives alignment boundaries' })(
    'each original-side fragment retains its prior author and date',
    async ({ given, when, then, and }: AllureBddContext) => {
      const originalMatched = atom('kept');
      const originalDeleted = atom('removed');
      const originalInsertion = el(
        'w:ins',
        { 'w:id': '17', 'w:author': 'Prior Author', 'w:date': '2024-03-04T05:06:07Z' },
        [originalMatched.ancestorElements[0]!, originalDeleted.ancestorElements[0]!],
      );
      el('w:p', {}, [originalInsertion]);
      const revisedMatched = atom('kept');
      let result!: ReturnType<typeof computeTaggedAtomLcs>;

      await given('a comparison boundary inside one original pre-existing insertion', () => {
        expect(originalInsertion.textContent).toBe('keptremoved');
      });

      await when('one atom matches and its sibling is deleted by the comparison', () => {
        result = computeTaggedAtomLcs([originalMatched, originalDeleted], [revisedMatched]);
      });

      await then('the matched and deleted fragments both retain the original insertion metadata', () => {
        for (const alignment of result.alignments) {
          expect(alignment.originalProvenance).toEqual([
            {
              kind: 'w:ins',
              id: '17',
              author: 'Prior Author',
              date: '2024-03-04T05:06:07Z',
            },
          ]);
        }
      });

      await and('only the unmatched fragment is original-sided', () => {
        expect(result.alignments.map((alignment) => alignment.tag).sort()).toEqual(['both', 'original']);
      });
    },
  );
});
