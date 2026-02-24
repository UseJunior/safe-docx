/**
 * Allure-style Regression Tests for atomLcs.ts
 *
 * Same tests as atomLcs.regression.test.ts but using Allure decorators
 * for enhanced reporting with Given/When/Then steps.
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
// allure is a global set up by allure-vitest/setup (configured in vitest.config.ts)
import { CorrelationStatus } from '../../core-types.js';
import {
  computeAtomLcs,
  markCorrelationStatus,
  createMergedAtomList,
  assignUnifiedParagraphIndices,
} from './atomLcs.js';
import type { ComparisonUnitAtom } from '../../core-types.js';
import { el } from '../../testing/dom-test-helpers.js';
import { getLeafText } from '../../primitives/index.js';

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
    it('assigns MovedSource atoms using original paragraph mapping (allure)', async () => {
      // Allure metadata
      await allure.epic('Document Comparison');
      await allure.feature('Atom LCS Algorithm');
      await allure.story('MovedSource Paragraph Index Bug');
      await allure.severity('critical');
      await allure.description(`
        BUG: MovedSource atoms were being looked up in revisedToOutputPara instead of
        originalToOutputPara. Since MovedSource atoms come from the ORIGINAL document,
        they have ORIGINAL paragraph indices and need the original-to-output mapping.

        FIX: Changed condition in assignUnifiedParagraphIndices() to include MovedSource
        alongside Deleted atoms when choosing which map to use.

        FILE: src/baselines/atomizer/atomLcs.ts:359-360
      `);

      let originalAtoms: ComparisonUnitAtom[];
      let revisedAtoms: ComparisonUnitAtom[];
      let lcsResult: ReturnType<typeof computeAtomLcs>;
      let merged: ComparisonUnitAtom[];

      await allure.step('Given atoms from original paragraph 0: "Hello world"', async () => {
        originalAtoms = [
          createMockAtom('Hello', 0),
          createMockAtom('world', 0),
        ];
        await allure.attachment('Original atoms', JSON.stringify(originalAtoms.map(a => ({
          text: getLeafText(a.contentElement),
          paragraphIndex: a.paragraphIndex,
        })), null, 2), 'application/json');
      });

      await allure.step('And atoms from revised paragraph 0: "Hello universe"', async () => {
        revisedAtoms = [
          createMockAtom('Hello', 0),
          createMockAtom('universe', 0),
        ];
        await allure.attachment('Revised atoms', JSON.stringify(revisedAtoms.map(a => ({
          text: getLeafText(a.contentElement),
          paragraphIndex: a.paragraphIndex,
        })), null, 2), 'application/json');
      });

      await allure.step('When LCS finds "Hello" matches, "world" deleted, "universe" inserted', async () => {
        lcsResult = {
          matches: [{ originalIndex: 0, revisedIndex: 0 }],
          deletedIndices: [1],
          insertedIndices: [1],
        };
        markCorrelationStatus(originalAtoms!, revisedAtoms!, lcsResult);
        await allure.attachment('LCS Result', JSON.stringify(lcsResult, null, 2), 'application/json');
      });

      await allure.step('And move detection marks "world" as MovedSource', async () => {
        originalAtoms![1]!.correlationStatus = CorrelationStatus.MovedSource;
        originalAtoms![1]!.moveName = 'move1';
        revisedAtoms![1]!.correlationStatus = CorrelationStatus.MovedDestination;
        revisedAtoms![1]!.moveName = 'move1';
      });

      await allure.step('And atoms are merged and paragraph indices assigned', async () => {
        merged = createMergedAtomList(originalAtoms!, revisedAtoms!, lcsResult!);
        assignUnifiedParagraphIndices(originalAtoms!, revisedAtoms!, merged, lcsResult!);
        await allure.attachment('Merged atoms', JSON.stringify(merged.map(a => ({
          text: getLeafText(a.contentElement),
          status: CorrelationStatus[a.correlationStatus],
          paragraphIndex: a.paragraphIndex,
        })), null, 2), 'application/json');
      });

      await allure.step('Then MovedSource atom has a valid paragraph index', async () => {
        const movedSourceAtom = merged!.find(
          (a) => a.correlationStatus === CorrelationStatus.MovedSource
        );
        expect(movedSourceAtom).toBeDefined();
        expect(movedSourceAtom!.paragraphIndex).toBeDefined();
      });

      await allure.step('And MovedSource is in same paragraph as its Equal sibling', async () => {
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
});
