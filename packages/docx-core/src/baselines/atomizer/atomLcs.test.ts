/**
 * Allure-style Regression Tests for atomLcs.ts
 *
 * Same tests as atomLcs.regression.test.ts but using Allure decorators
 * for enhanced reporting with Given/When/Then steps.
 */

import { describe, expect } from 'vitest';
import { itAllure, allureStep, allureJsonAttachment } from '../../testing/allure-test.js';
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

const it = itAllure.epic('Document Comparison').withLabels({
  feature: 'Atom LCS Algorithm',
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
    const movedSourceIt = it.allure({ story: 'MovedSource Paragraph Index Bug', severity: 'critical' });

    movedSourceIt('assigns MovedSource atoms using original paragraph mapping (allure)', async () => {
      let originalAtoms: ComparisonUnitAtom[];
      let revisedAtoms: ComparisonUnitAtom[];
      let lcsResult: ReturnType<typeof computeAtomLcs>;
      let merged: ComparisonUnitAtom[];

      await allureStep('Given atoms from original paragraph 0: "Hello world"', async () => {
        originalAtoms = [
          createMockAtom('Hello', 0),
          createMockAtom('world', 0),
        ];
        await allureJsonAttachment('Original atoms', originalAtoms.map(a => ({
          text: getLeafText(a.contentElement),
          paragraphIndex: a.paragraphIndex,
        })));
      });

      await allureStep('And atoms from revised paragraph 0: "Hello universe"', async () => {
        revisedAtoms = [
          createMockAtom('Hello', 0),
          createMockAtom('universe', 0),
        ];
        await allureJsonAttachment('Revised atoms', revisedAtoms.map(a => ({
          text: getLeafText(a.contentElement),
          paragraphIndex: a.paragraphIndex,
        })));
      });

      await allureStep('When LCS finds "Hello" matches, "world" deleted, "universe" inserted', async () => {
        lcsResult = {
          matches: [{ originalIndex: 0, revisedIndex: 0 }],
          deletedIndices: [1],
          insertedIndices: [1],
        };
        markCorrelationStatus(originalAtoms!, revisedAtoms!, lcsResult);
        await allureJsonAttachment('LCS Result', lcsResult);
      });

      await allureStep('And move detection marks "world" as MovedSource', async () => {
        originalAtoms![1]!.correlationStatus = CorrelationStatus.MovedSource;
        originalAtoms![1]!.moveName = 'move1';
        revisedAtoms![1]!.correlationStatus = CorrelationStatus.MovedDestination;
        revisedAtoms![1]!.moveName = 'move1';
      });

      await allureStep('And atoms are merged and paragraph indices assigned', async () => {
        merged = createMergedAtomList(originalAtoms!, revisedAtoms!, lcsResult!);
        assignUnifiedParagraphIndices(originalAtoms!, revisedAtoms!, merged, lcsResult!);
        await allureJsonAttachment('Merged atoms', merged.map(a => ({
          text: getLeafText(a.contentElement),
          status: CorrelationStatus[a.correlationStatus],
          paragraphIndex: a.paragraphIndex,
        })));
      });

      await allureStep('Then MovedSource atom has a valid paragraph index', async () => {
        const movedSourceAtom = merged!.find(
          (a) => a.correlationStatus === CorrelationStatus.MovedSource
        );
        expect(movedSourceAtom).toBeDefined();
        expect(movedSourceAtom!.paragraphIndex).toBeDefined();
      });

      await allureStep('And MovedSource is in same paragraph as its Equal sibling', async () => {
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
