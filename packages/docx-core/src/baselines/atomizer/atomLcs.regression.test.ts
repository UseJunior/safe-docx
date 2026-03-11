/**
 * Regression Tests for atomLcs.ts
 *
 * These tests document and prevent regression of specific bugs that were fixed.
 * Each test includes:
 * - Description of the original bug
 * - Root cause explanation
 * - Test case that would fail if the bug regresses
 *
 * @see https://github.com/anthropics/claude-code - For bug tracking
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { CorrelationStatus } from '../../core-types.js';
import {
  markCorrelationStatus,
  createMergedAtomList,
  assignUnifiedParagraphIndices,
} from './atomLcs.js';
import type { ComparisonUnitAtom } from '../../core-types.js';
import { el } from '../../testing/dom-test-helpers.js';
import { getLeafText } from '../../primitives/index.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Atom LCS Regression' });

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

describe('atomLcs Regression Tests', () => {
  /**
   * BUG: MovedSource atoms get incorrect paragraph indices
   *
   * SYMPTOM:
   * When rejecting all changes on a document with move tracking, content would
   * end up in the wrong paragraph. For example:
   * - Original: "Distributable Proceeds" means, as of any date...
   * - After reject: "Distributable ProceedsDrawdown" means... (concatenation error)
   *
   * ROOT CAUSE:
   * In assignUnifiedParagraphIndices(), atoms with CorrelationStatus.MovedSource
   * were falling through to the `else` branch which looks up in `revisedToOutputPara`.
   * But MovedSource atoms come from the ORIGINAL document and have ORIGINAL
   * paragraph indices, so they need to be looked up in `originalToOutputPara`.
   *
   * FIX:
   * Changed the condition from:
   *   if (atom.correlationStatus === CorrelationStatus.Deleted)
   * To:
   *   if (atom.correlationStatus === CorrelationStatus.Deleted ||
   *       atom.correlationStatus === CorrelationStatus.MovedSource)
   *
   * FILE: src/baselines/atomizer/atomLcs.ts:359-360
   * DATE: 2026-01-15
   */
  describe('MovedSource paragraph index lookup', () => {
    test('assigns MovedSource atoms using original paragraph mapping', async ({ given, when, then, and }: AllureBddContext) => {
      // Setup: Create atoms simulating the bug scenario
      // Original paragraph 0: "Hello world"
      // Revised paragraph 0: "Hello" (Equal) + "universe" (Inserted/MovedDestination)
      // The "world" becomes MovedSource

      let originalAtoms: ComparisonUnitAtom[];
      let revisedAtoms: ComparisonUnitAtom[];
      let lcsResult: {
        matches: { originalIndex: number; revisedIndex: number }[];
        deletedIndices: number[];
        insertedIndices: number[];
      };
      let merged: ComparisonUnitAtom[];

      await given('original atoms: "Hello"(para 0) and "world"(para 0)', () => {
        originalAtoms = [
          createMockAtom('Hello', 0),
          createMockAtom('world', 0),
        ];
      });

      await and('revised atoms: "Hello"(para 0) and "universe"(para 0)', () => {
        revisedAtoms = [
          createMockAtom('Hello', 0),
          createMockAtom('universe', 0),
        ];
      });

      await when('LCS matches "Hello", deletes "world", inserts "universe", then move detection promotes "world" to MovedSource', () => {
        // Simulate LCS result where "Hello" matches, "world" is deleted, "universe" is inserted
        lcsResult = {
          matches: [{ originalIndex: 0, revisedIndex: 0 }],
          deletedIndices: [1],
          insertedIndices: [1],
        };

        // Mark correlation status
        markCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

        // Now simulate move detection: "world" becomes MovedSource
        originalAtoms[1]!.correlationStatus = CorrelationStatus.MovedSource;
        originalAtoms[1]!.moveName = 'move1';

        // And "universe" becomes MovedDestination
        revisedAtoms[1]!.correlationStatus = CorrelationStatus.MovedDestination;
        revisedAtoms[1]!.moveName = 'move1';

        // Create merged list
        merged = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);

        // Assign unified paragraph indices
        assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, merged, lcsResult);
      });

      await then('MovedSource atom has a valid paragraph index', () => {
        // Find the MovedSource atom in merged list
        const movedSourceAtom = merged.find(
          (a) => a.correlationStatus === CorrelationStatus.MovedSource
        );

        // CRITICAL ASSERTION:
        // MovedSource atom should have a valid paragraph index (not undefined)
        // If the bug regresses, this would be undefined or wrong because it was
        // looked up in the wrong map
        expect(movedSourceAtom).toBeDefined();
        expect(movedSourceAtom!.paragraphIndex).toBeDefined();
      });

      await and('MovedSource is in the same output paragraph as the Equal atom from original paragraph 0', () => {
        const movedSourceAtom = merged.find(
          (a) => a.correlationStatus === CorrelationStatus.MovedSource
        );
        // The MovedSource should be in the same output paragraph as other
        // content from the same original paragraph
        const equalAtom = merged.find(
          (a) => a.correlationStatus === CorrelationStatus.Equal
        );
        expect(equalAtom).toBeDefined();

        // Both atoms from original paragraph 0 should map to the same output paragraph
        // (This is the key regression check - before the fix, they would be different)
        expect(movedSourceAtom!.paragraphIndex).toBe(equalAtom!.paragraphIndex);
      });
    });

    test('keeps MovedSource atoms with their original paragraph siblings after reject', async ({ given, when, then, and }: AllureBddContext) => {
      // This test verifies the higher-level behavior:
      // Content marked as MovedSource should remain in the correct paragraph
      // when changes are rejected

      let originalAtoms: ComparisonUnitAtom[];
      let revisedAtoms: ComparisonUnitAtom[];
      let lcsResult: {
        matches: { originalIndex: number; revisedIndex: number }[];
        deletedIndices: number[];
        insertedIndices: number[];
      };
      let merged: ComparisonUnitAtom[];
      let atomsByParagraph: Map<number, ComparisonUnitAtom[]>;

      await given('two original paragraphs where " means something." is a candidate for move', () => {
        // Setup: Two original paragraphs, content moves from para 0 to para 1
        originalAtoms = [
          createMockAtom('Definition A', 0),
          createMockAtom(' means something.', 0),
          createMockAtom('Definition B', 1),
        ];

        revisedAtoms = [
          createMockAtom('Definition A', 0),
          createMockAtom(' means something different.', 0), // Modified
          createMockAtom('Definition B', 1),
        ];
      });

      await when('correlation status is set and move detection promotes " means something." to MovedSource', () => {
        // "means something" doesn't match exactly
        lcsResult = {
          matches: [
            { originalIndex: 0, revisedIndex: 0 },
            { originalIndex: 2, revisedIndex: 2 },
          ],
          deletedIndices: [1],
          insertedIndices: [1],
        };

        markCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

        // Simulate move detection
        originalAtoms[1]!.correlationStatus = CorrelationStatus.MovedSource;
        originalAtoms[1]!.moveName = 'move1';
        revisedAtoms[1]!.correlationStatus = CorrelationStatus.MovedDestination;
        revisedAtoms[1]!.moveName = 'move1';

        merged = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
        assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, merged, lcsResult);

        // Group atoms by their final paragraph index
        atomsByParagraph = new Map<number, ComparisonUnitAtom[]>();
        for (const atom of merged) {
          const idx = atom.paragraphIndex ?? -1;
          if (!atomsByParagraph.has(idx)) {
            atomsByParagraph.set(idx, []);
          }
          atomsByParagraph.get(idx)!.push(atom);
        }
      });

      await then('a paragraph containing "Definition A" is found', () => {
        let defAParagraphIdx: number | undefined;
        for (const [idx, atoms] of atomsByParagraph) {
          if (atoms.some((a) => getLeafText(a.contentElement) === 'Definition A')) {
            defAParagraphIdx = idx;
            break;
          }
        }
        expect(defAParagraphIdx).toBeDefined();
      });

      await and('the MovedSource " means something." is in the same paragraph as "Definition A"', () => {
        let defAParagraphIdx: number | undefined;
        for (const [idx, atoms] of atomsByParagraph) {
          if (atoms.some((a) => getLeafText(a.contentElement) === 'Definition A')) {
            defAParagraphIdx = idx;
            break;
          }
        }

        // The MovedSource " means something." should be in the SAME paragraph as "Definition A"
        // This is the critical check - before the fix, it would end up in a different paragraph
        const defAParagraph = atomsByParagraph.get(defAParagraphIdx!)!;
        const hasMovedSource = defAParagraph.some(
          (a) => a.correlationStatus === CorrelationStatus.MovedSource
        );

        expect(hasMovedSource).toBe(true);
      });
    });

    test('Deleted atoms should still work correctly after MovedSource fix', async ({ given, when, then, and }: AllureBddContext) => {
      // Ensure the fix didn't break normal Deleted atom handling

      let originalAtoms: ComparisonUnitAtom[];
      let revisedAtoms: ComparisonUnitAtom[];
      let lcsResult: {
        matches: { originalIndex: number; revisedIndex: number }[];
        deletedIndices: number[];
        insertedIndices: number[];
      };
      let merged: ComparisonUnitAtom[];

      await given('original atoms "Keep this" and "Delete this" with only "Keep this" in revised', () => {
        originalAtoms = [
          createMockAtom('Keep this', 0),
          createMockAtom('Delete this', 0),
        ];

        revisedAtoms = [createMockAtom('Keep this', 0)];
      });

      await when('correlation status is assigned via LCS', () => {
        lcsResult = {
          matches: [{ originalIndex: 0, revisedIndex: 0 }],
          deletedIndices: [1],
          insertedIndices: [],
        };

        markCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);
      });

      await then('"Delete this" is marked Deleted', () => {
        // Verify Deleted status is set correctly
        expect(originalAtoms[1]!.correlationStatus).toBe(CorrelationStatus.Deleted);
      });

      await when('merged list and unified paragraph indices are computed', () => {
        merged = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
        assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, merged, lcsResult);
      });

      await then('Deleted atom has a valid paragraph index', () => {
        // Deleted atom should have valid paragraph index
        const deletedAtom = merged.find(
          (a) => a.correlationStatus === CorrelationStatus.Deleted
        );
        expect(deletedAtom).toBeDefined();
        expect(deletedAtom!.paragraphIndex).toBeDefined();
      });

      await and('Deleted atom is in the same paragraph as the Equal atom', () => {
        // Should be in same paragraph as the Equal atom
        const deletedAtom = merged.find(
          (a) => a.correlationStatus === CorrelationStatus.Deleted
        );
        const equalAtom = merged.find(
          (a) => a.correlationStatus === CorrelationStatus.Equal
        );
        expect(deletedAtom!.paragraphIndex).toBe(equalAtom!.paragraphIndex);
      });
    });
  });
});
