import { describe, expect } from 'vitest';
import { CorrelationStatus, type ComparisonUnitAtom } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { el } from '../../testing/dom-test-helpers.js';
import { computeTaggedAtomLcs } from './atomLcs.js';
import { hierarchicalCompare, hierarchicalCompareTagged } from './hierarchicalLcs.js';
import { nextRevisionId } from './taggedTree.js';

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
        expect(result.alignments[0]?.tag).toBe('both');
        expect(result.alignments[0]?.original).toBe(original);
        expect(result.alignments[0]?.revised).toBe(revised);
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

  test.allure({ story: 'tagged alignment preserves comparison order' })(
    'deleted and inserted atoms remain between their matched neighbors',
    async ({ when, then }: AllureBddContext) => {
      const original = [atom('A'), atom('X'), atom('B')];
      const revised = [atom('A'), atom('Y'), atom('B')];
      let tags: string[] = [];

      await when('both atom and hierarchical alignment emit tags for an inline replacement', () => {
        tags = computeTaggedAtomLcs(original, revised).alignments.map((alignment) => alignment.tag);
      });

      await then('the tags retain source order around the replacement boundary', () => {
        expect(tags).toEqual(['both', 'original', 'revised', 'both']);
      });
    },
  );

  test.allure({ story: 'hierarchical tags retain the legacy group alignment' })(
    'the tagged wrapper exposes exactly the hierarchical matcher result',
    async ({ when, then }: AllureBddContext) => {
      const original = [atom('A'), atom('X'), atom('B')];
      const revised = [atom('A'), atom('Y'), atom('B')];
      original.forEach((value) => { value.paragraphIndex = 0; });
      revised.forEach((value) => { value.paragraphIndex = 0; });
      let tagged!: ReturnType<typeof hierarchicalCompareTagged>;
      let legacy!: ReturnType<typeof hierarchicalCompare>;

      await when('the hierarchical matcher and tagged wrapper receive the same grouped atoms', () => {
        legacy = hierarchicalCompare(original, revised);
        tagged = hierarchicalCompareTagged(original, revised);
      });

      await then('the tagged wrapper exposes the unmodified legacy LCS result', () => {
        expect(tagged.lcs).toEqual(legacy);
      });
    },
  );

  test.allure({ story: 'equivalent direct properties do not create a delta' })(
    'attribute order alone does not create formatting evidence',
    async ({ when, then }: AllureBddContext) => {
      const original = atom('same', el('w:rPr', { 'w:rsidRPr': '1', 'w:lang': 'en-US' }));
      const revised = atom('same', el('w:rPr', { 'w:lang': 'en-US', 'w:rsidRPr': '1' }));
      let delta: unknown;

      await when('the property order differs only lexically', () => {
        delta = computeTaggedAtomLcs([original], [revised]).alignments[0]?.propertyDelta;
      });

      await then('no direct formatting delta is emitted', () => {
        expect(delta).toBeUndefined();
      });
    },
  );

  test.allure({ story: 'revision IDs reserve all surviving markup IDs' })(
    'the first allocation skips root, marker, and property-change aliases',
    async ({ when, then }: AllureBddContext) => {
      const original = el('w:ins', { 'w:id': '1' }, [el('w:rPrChange', { 'w:id': '+2' })]);
      const revised = el('w:body', {}, [el('w:moveFromRangeStart', { 'w:id': '03' })]);
      let next = 0;

      await when('both roots contribute surviving revision-related markup', () => {
        next = nextRevisionId(original, revised);
      });

      await then('the allocator skips every canonical numeric ID', () => {
        expect(next).toBe(4);
      });
    },
  );
});
