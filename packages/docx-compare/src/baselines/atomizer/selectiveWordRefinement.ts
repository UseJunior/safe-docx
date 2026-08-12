import type {
  ComparisonUnitAtom,
  MoveDetectionSettings,
} from '@usejunior/docx-core';
import {
  assignIdentityIds,
  type IdentityInterner,
  splitAtomsIntoWords,
} from '../../atomizer.js';
import {
  countWords,
  getAtomText,
  jaccardWordSimilarity,
  wordContainmentSimilarity,
} from '../../move-detection.js';
import { hierarchicalCompare } from './hierarchicalLcs.js';
import type { LcsResult } from './atomLcs.js';

export interface SelectiveWordRefinementResult {
  originalAtoms: ComparisonUnitAtom[];
  revisedAtoms: ComparisonUnitAtom[];
  lcsResult: LcsResult;
  refinedPairCount: number;
}

/**
 * Aligned paragraphs already have exact atom evidence establishing their
 * correspondence, so refining their changed runs does not need the stricter
 * threshold used to infer a move between otherwise unrelated locations.
 */
export const ALIGNED_RUN_REFINEMENT_SIMILARITY_THRESHOLD = 0.5;
export const ALIGNED_RUN_REFINEMENT_CONTAINMENT_THRESHOLD = 0.8;

/**
 * Refine fuzzy changed runs only inside paragraph pairs already established by
 * exact atom matches. This is the run-level precision escape hatch: it avoids
 * applying word atomization to unrelated paragraphs while preserving unchanged
 * inline tokens inside a broadly modified run.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/717
 * @see https://github.com/UseJunior/safe-docx/issues/734
 */
export function refineFuzzyRunsWithinAlignedParagraphs(
  originalAtoms: ComparisonUnitAtom[],
  revisedAtoms: ComparisonUnitAtom[],
  lcsResult: LcsResult,
  moveSettings: MoveDetectionSettings,
  identityInterner: IdentityInterner,
  maxChangeRanges?: number,
): SelectiveWordRefinementResult {
  const alignedParagraphPairs = new Set<string>();
  for (const match of lcsResult.matches) {
    const originalParagraph = originalAtoms[match.originalIndex]?.paragraphIndex;
    const revisedParagraph = revisedAtoms[match.revisedIndex]?.paragraphIndex;
    if (originalParagraph !== undefined && revisedParagraph !== undefined) {
      alignedParagraphPairs.add(`${originalParagraph}:${revisedParagraph}`);
    }
  }

  const candidates: Array<{
    originalIndex: number;
    revisedIndex: number;
    similarity: number;
  }> = [];
  for (const originalIndex of lcsResult.deletedIndices) {
    const originalAtom = originalAtoms[originalIndex]!;
    const originalText = getAtomText(originalAtom);
    if (
      originalAtom.contentElement.tagName !== 'w:t' ||
      originalAtom.collapsedFieldAtoms ||
      countWords(originalText) < moveSettings.moveMinimumWordCount
    ) {
      continue;
    }
    for (const revisedIndex of lcsResult.insertedIndices) {
      const revisedAtom = revisedAtoms[revisedIndex]!;
      const revisedText = getAtomText(revisedAtom);
      if (
        revisedAtom.contentElement.tagName !== 'w:t' ||
        revisedAtom.collapsedFieldAtoms ||
        originalAtom.paragraphIndex === undefined ||
        revisedAtom.paragraphIndex === undefined ||
        !alignedParagraphPairs.has(
          `${originalAtom.paragraphIndex}:${revisedAtom.paragraphIndex}`,
        ) ||
        countWords(revisedText) < moveSettings.moveMinimumWordCount ||
        originalText === revisedText
      ) {
        continue;
      }
      const jaccardSimilarity = jaccardWordSimilarity(
        originalText,
        revisedText,
        moveSettings.caseInsensitiveMove,
      );
      const containmentSimilarity = wordContainmentSimilarity(
        originalText,
        revisedText,
        moveSettings.caseInsensitiveMove,
      );
      if (
        jaccardSimilarity >= ALIGNED_RUN_REFINEMENT_SIMILARITY_THRESHOLD ||
        containmentSimilarity >= ALIGNED_RUN_REFINEMENT_CONTAINMENT_THRESHOLD
      ) {
        candidates.push({
          originalIndex,
          revisedIndex,
          similarity: Math.max(jaccardSimilarity, containmentSimilarity),
        });
      }
    }
  }

  candidates.sort(
    (left, right) =>
      right.similarity - left.similarity ||
      left.originalIndex - right.originalIndex ||
      left.revisedIndex - right.revisedIndex,
  );
  const splitOriginal = new Set<number>();
  const splitRevised = new Set<number>();
  for (const candidate of candidates) {
    if (
      splitOriginal.has(candidate.originalIndex) ||
      splitRevised.has(candidate.revisedIndex)
    ) {
      continue;
    }
    splitOriginal.add(candidate.originalIndex);
    splitRevised.add(candidate.revisedIndex);
  }

  if (splitOriginal.size === 0) {
    return {
      originalAtoms,
      revisedAtoms,
      lcsResult,
      refinedPairCount: 0,
    };
  }

  const refinedOriginal = originalAtoms.flatMap((atom, index) =>
    splitOriginal.has(index) ? splitAtomsIntoWords([atom]) : [atom],
  );
  const refinedRevised = revisedAtoms.flatMap((atom, index) =>
    splitRevised.has(index) ? splitAtomsIntoWords([atom]) : [atom],
  );
  assignIdentityIds(refinedOriginal, identityInterner);
  assignIdentityIds(refinedRevised, identityInterner);
  const refinedLcs = hierarchicalCompare(refinedOriginal, refinedRevised);
  if (maxChangeRanges !== undefined) {
    if (!Number.isInteger(maxChangeRanges) || maxChangeRanges < 1) {
      throw new RangeError('maxChangeRanges must be a positive integer');
    }
    const countRanges = (indices: number[]): number =>
      indices.reduce(
        (ranges, index, position) =>
          ranges + (position === 0 || index !== indices[position - 1]! + 1 ? 1 : 0),
        0,
      );
    const ranges =
      countRanges(refinedLcs.deletedIndices) +
      countRanges(refinedLcs.insertedIndices);
    if (ranges > maxChangeRanges) {
      return { originalAtoms, revisedAtoms, lcsResult, refinedPairCount: 0 };
    }
  }
  return {
    originalAtoms: refinedOriginal,
    revisedAtoms: refinedRevised,
    lcsResult: refinedLcs,
    refinedPairCount: splitOriginal.size,
  };
}
