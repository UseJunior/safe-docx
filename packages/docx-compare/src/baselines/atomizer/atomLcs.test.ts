/**
 * Allure-style Regression Tests for atomLcs.ts
 *
 * Same tests as atomLcs.regression.test.ts but using Allure decorators
 * for enhanced reporting with Given/When/Then steps.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { CorrelationStatus } from '@usejunior/docx-core';
import {
  computeAtomLcs,
  markCorrelationStatus,
  createMergedAtomList,
  assignUnifiedParagraphIndices,
} from './atomLcs.js';
import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { el } from '../../testing/dom-test-helpers.js';
import { EMPTY_PARAGRAPH_TAG } from '../../atomizer.js';
import { getLeafText } from '@usejunior/docx-core';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Atom LCS',
});

/**
 * Helper to create a mock atom for testing.
 */
function createMockAtom(
  text: string,
  paragraphIndex: number,
  status: CorrelationStatus = CorrelationStatus.Unknown
): ComparisonUnitAtom {
  const contentElement = el('w:t', {}, undefined, text);

  return {
    contentElement,
    ancestorElements: [],
    ancestorUnids: [],
    part: { uri: 'word/document.xml', contentType: 'text/xml' },
    sha1Hash: `hash_${text}_${paragraphIndex}`,
    correlationStatus: status,
    paragraphIndex,
  };
}

describe('atomLcs Regression Tests (Allure)', () => {
  describe('MovedSource paragraph index lookup', () => {
    const movedSourceTest = test.allure({ story: 'MovedSource Paragraph Index Bug', severity: 'critical' });

    movedSourceTest('assigns MovedSource atoms using original paragraph mapping (allure)', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      let originalAtoms: ComparisonUnitAtom[];
      let revisedAtoms: ComparisonUnitAtom[];
      let lcsResult: ReturnType<typeof computeAtomLcs>;
      let merged: ComparisonUnitAtom[];

      await given('atoms from original paragraph 0: "Hello world"', async () => {
        originalAtoms = [
          createMockAtom('Hello', 0),
          createMockAtom('world', 0),
        ];
        await attachPrettyJson('Original atoms', originalAtoms.map(a => ({
          text: getLeafText(a.contentElement),
          paragraphIndex: a.paragraphIndex,
        })));
      });

      await and('atoms from revised paragraph 0: "Hello universe"', async () => {
        revisedAtoms = [
          createMockAtom('Hello', 0),
          createMockAtom('universe', 0),
        ];
        await attachPrettyJson('Revised atoms', revisedAtoms.map(a => ({
          text: getLeafText(a.contentElement),
          paragraphIndex: a.paragraphIndex,
        })));
      });

      await when('LCS finds "Hello" matches, "world" deleted, "universe" inserted', async () => {
        lcsResult = {
          matches: [{ originalIndex: 0, revisedIndex: 0 }],
          deletedIndices: [1],
          insertedIndices: [1],
        };
        markCorrelationStatus(originalAtoms!, revisedAtoms!, lcsResult);
        await attachPrettyJson('LCS Result', lcsResult);
      });

      await and('move detection marks "world" as MovedSource', () => {
        originalAtoms![1]!.correlationStatus = CorrelationStatus.MovedSource;
        originalAtoms![1]!.moveName = 'move1';
        revisedAtoms![1]!.correlationStatus = CorrelationStatus.MovedDestination;
        revisedAtoms![1]!.moveName = 'move1';
      });

      await and('atoms are merged and paragraph indices assigned', async () => {
        merged = createMergedAtomList(originalAtoms!, revisedAtoms!, lcsResult!);
        assignUnifiedParagraphIndices(originalAtoms!, revisedAtoms!, merged, lcsResult!);
        await attachPrettyJson('Merged atoms', merged.map(a => ({
          text: getLeafText(a.contentElement),
          status: CorrelationStatus[a.correlationStatus],
          paragraphIndex: a.paragraphIndex,
        })));
      });

      await then('MovedSource atom has a valid paragraph index', () => {
        const movedSourceAtom = merged!.find(
          (a) => a.correlationStatus === CorrelationStatus.MovedSource
        );
        expect(movedSourceAtom).toBeDefined();
        expect(movedSourceAtom!.paragraphIndex).toBeDefined();
      });

      await and('MovedSource is in same paragraph as its Equal sibling', () => {
        const movedSourceAtom = merged!.find(
          (a) => a.correlationStatus === CorrelationStatus.MovedSource
        );
        const equalAtom = merged!.find(
          (a) => a.correlationStatus === CorrelationStatus.Equal
        );
        expect(movedSourceAtom!.paragraphIndex).toBe(equalAtom!.paragraphIndex);
      });
    });
  });

  describe('Equal empty-paragraph twin remapping', () => {
    const twinTest = test.allure({ story: 'Unified index for revised empty twins', severity: 'critical' });

    /**
     * For Equal empty-paragraph pairs, createMergedAtomList keeps the ORIGINAL
     * atom, so the revised twin never flows through the merged remapping loop.
     * Its paragraphIndex must still be remapped to the unified index: the
     * inplace modifier keys revised paragraphs by unified index
     * (unifiedParaToElement), and a raw revised index either misses the lookup
     * (stale insertion anchor) or collides with a different paragraph's
     * unified index, mis-anchoring neighboring deleted paragraphs.
     *
     * @see https://github.com/UseJunior/safe-docx/issues/678
     */
    twinTest('remaps the revised twin of an Equal empty paragraph to the unified index', async ({ given, when, then, and }: AllureBddContext) => {
      let originalAtoms: ComparisonUnitAtom[];
      let revisedAtoms: ComparisonUnitAtom[];
      let lcsResult: ReturnType<typeof computeAtomLcs>;
      let merged: ComparisonUnitAtom[];

      const createEmptyParagraphAtom = (paragraphIndex: number): ComparisonUnitAtom => ({
        contentElement: el(EMPTY_PARAGRAPH_TAG),
        ancestorElements: [],
        ancestorUnids: [],
        part: { uri: 'word/document.xml', contentType: 'text/xml' },
        sha1Hash: 'hash_empty_shared',
        correlationStatus: CorrelationStatus.Unknown,
        isEmptyParagraph: true,
        paragraphIndex,
      });

      await given('an original with anchor text, a deleted paragraph, and a trailing empty paragraph', () => {
        originalAtoms = [
          createMockAtom('Anchor', 0),
          createMockAtom('Gone', 1),
          createEmptyParagraphAtom(2),
        ];
      });

      await and('a revised with the same anchor and the same trailing empty paragraph', () => {
        revisedAtoms = [
          createMockAtom('Anchor', 0),
          createEmptyParagraphAtom(1),
        ];
      });

      await when('the LCS matches the anchor and the empty paragraph and deletes the middle paragraph', () => {
        lcsResult = {
          matches: [
            { originalIndex: 0, revisedIndex: 0 },
            { originalIndex: 2, revisedIndex: 1 },
          ],
          deletedIndices: [1],
          insertedIndices: [],
        };
        markCorrelationStatus(originalAtoms!, revisedAtoms!, lcsResult);
        merged = createMergedAtomList(originalAtoms!, revisedAtoms!, lcsResult!);
        assignUnifiedParagraphIndices(originalAtoms!, revisedAtoms!, merged, lcsResult!);
      });

      await then('the merged list carries the ORIGINAL empty atom for the Equal pair', () => {
        const mergedEmpty = merged!.find((a) => a.contentElement.tagName === EMPTY_PARAGRAPH_TAG);
        expect(mergedEmpty).toBe(originalAtoms![2]);
      });

      await and('the revised twin shares the merged atom unified paragraph index', () => {
        expect(revisedAtoms![1]!.paragraphIndex).toBe(originalAtoms![2]!.paragraphIndex);
        // Unified layout: anchor=0, deleted middle=1, matched empty=2.
        expect(revisedAtoms![1]!.paragraphIndex).toBe(2);
      });
    });
  });
});
