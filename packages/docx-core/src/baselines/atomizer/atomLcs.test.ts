/**
 * Allure-style Regression Tests for atomLcs.ts
 *
 * Same tests as atomLcs.regression.test.ts but using Allure decorators
 * for enhanced reporting with Given/When/Then steps.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
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
});
