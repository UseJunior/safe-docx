/**
 * Move Detection Module
 *
 * Detects relocated content after LCS comparison by matching deleted blocks
 * with inserted blocks using Jaccard word similarity.
 *
 * Pipeline position:
 * LCS() → MarkRowsAsDeletedOrInserted() → FlattenToAtomList() → detectMovesInAtomList() → CoalesceRecurse()
 *
 * @see WmlComparer.cs DetectMovesInAtomList() line 3811
 */

import {
  AtomBlock,
  ComparisonUnitAtom,
  CorrelationStatus,
  DEFAULT_MOVE_DETECTION_SETTINGS,
  MoveDetectionSettings,
} from '@usejunior/docx-core';
import { getLeafText } from '@usejunior/docx-core';
import {
  countWords,
  jaccardWordSimilarity,
} from './textSimilarity.js';
export {
  countWords,
  jaccardWordSimilarity,
  wordContainmentSimilarity,
} from './textSimilarity.js';

// =============================================================================
// Text Extraction
// =============================================================================

/**
 * Extract text content from an atom.
 *
 * @param atom - The atom to extract text from
 * @returns The text content, or empty string for non-text atoms
 */
export function getAtomText(atom: ComparisonUnitAtom): string {
  const element = atom.contentElement;

  // Handle text elements
  if (element.tagName === 'w:t' || element.tagName === 'w:delText') {
    return getLeafText(element) ?? '';
  }

  // Handle break elements
  if (element.tagName === 'w:br' || element.tagName === 'w:cr') {
    return '\n';
  }

  // Handle tab
  if (element.tagName === 'w:tab') {
    return '\t';
  }

  return '';
}

/**
 * Extract text from a sequence of atoms.
 *
 * @param atoms - The atoms to extract text from
 * @returns Combined text content
 */
export function getAtomsText(atoms: ComparisonUnitAtom[]): string {
  return atoms.map(getAtomText).join('');
}

// =============================================================================
// Block Grouping
// =============================================================================

/**
 * Group consecutive atoms by correlation status.
 *
 * Creates blocks of atoms with the same status (Deleted or Inserted).
 *
 * @param atoms - The atoms to group
 * @returns Array of atom blocks
 */
export function groupIntoBlocks(atoms: ComparisonUnitAtom[]): AtomBlock[] {
  const blocks: AtomBlock[] = [];
  let currentBlock: AtomBlock | null = null;

  for (const atom of atoms) {
    const status = atom.correlationStatus;

    // Only group Deleted and Inserted atoms for move detection
    if (status !== CorrelationStatus.Deleted && status !== CorrelationStatus.Inserted) {
      // End current block
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Start new block or continue existing
    if (!currentBlock || currentBlock.status !== status) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = {
        status,
        atoms: [atom],
        text: getAtomText(atom),
        wordCount: 0, // Calculated at end
      };
    } else {
      currentBlock.atoms.push(atom);
      currentBlock.text += getAtomText(atom);
    }
  }

  // Don't forget the last block
  if (currentBlock) {
    blocks.push(currentBlock);
  }

  // Calculate word counts
  for (const block of blocks) {
    block.wordCount = countWords(block.text);
  }

  return blocks;
}

// =============================================================================
// Move Matching
// =============================================================================

/**
 * Result of finding the best match for a deleted block.
 */
interface MatchResult {
  /** The matching inserted block */
  block: AtomBlock;
  /** Similarity score between 0 and 1 */
  similarity: number;
  /** Index in the insertedBlocks array */
  index: number;
}

/**
 * Optional candidate-level guard supplied by the comparison pipeline.
 *
 * Move detection remains usable as a standalone post-processing step, while
 * callers that know paragraph correspondence can prevent a fuzzy edit from
 * being relabeled as a relocation.
 */
export type MoveCandidateGuard = (
  deleted: AtomBlock,
  inserted: AtomBlock,
  similarity: number,
) => boolean;

/**
 * Find the best matching inserted block for a deleted block.
 *
 * @param deleted - The deleted block to match
 * @param insertedBlocks - Available inserted blocks
 * @param settings - Move detection settings
 * @returns The best match, or undefined if no match meets threshold
 */
export function findBestMatch(
  deleted: AtomBlock,
  insertedBlocks: AtomBlock[],
  settings: MoveDetectionSettings,
  candidateGuard?: MoveCandidateGuard,
): MatchResult | undefined {
  let bestMatch: MatchResult | undefined;

  for (let i = 0; i < insertedBlocks.length; i++) {
    const inserted = insertedBlocks[i];
    if (!inserted) continue;

    // Skip already matched blocks (marked as MovedDestination)
    if (inserted.atoms.length > 0 &&
        inserted.atoms[0]?.correlationStatus === CorrelationStatus.MovedDestination) {
      continue;
    }

    const similarity = jaccardWordSimilarity(
      deleted.text,
      inserted.text,
      settings.caseInsensitiveMove
    );

    if (candidateGuard && !candidateGuard(deleted, inserted, similarity)) {
      continue;
    }

    if (similarity >= settings.moveSimilarityThreshold) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { block: inserted, similarity, index: i };
      }
    }
  }

  return bestMatch;
}

// =============================================================================
// Move Marking
// =============================================================================

/**
 * Mark atoms as part of a move operation.
 *
 * @param atoms - Atoms to mark
 * @param status - New correlation status (MovedSource or MovedDestination)
 * @param moveGroupId - ID linking source and destination
 * @param moveName - Name for move tracking (e.g., "move1")
 */
export function markAsMove(
  atoms: ComparisonUnitAtom[],
  status: CorrelationStatus.MovedSource | CorrelationStatus.MovedDestination,
  moveGroupId: number,
  moveName: string
): void {
  for (const atom of atoms) {
    atom.correlationStatus = status;
    atom.moveGroupId = moveGroupId;
    atom.moveName = moveName;
  }
}

// =============================================================================
// Main Algorithm
// =============================================================================

/**
 * Detect moves in a flat list of atoms.
 *
 * Runs after LCS comparison to identify deleted blocks that were actually
 * moved to a new location. Updates atoms in place with move status.
 *
 * @param atoms - The atom list to process (modified in place)
 * @param settings - Move detection settings (optional, uses defaults)
 *
 * @see WmlComparer.cs DetectMovesInAtomList() line 3811
 *
 * @example
 * const atoms = atomizeTree(document, [], part);
 * runLCSComparison(atoms);
 * detectMovesInAtomList(atoms); // Updates atoms in place
 */
export function detectMovesInAtomList(
  atoms: ComparisonUnitAtom[],
  settings: MoveDetectionSettings = DEFAULT_MOVE_DETECTION_SETTINGS,
  reservedMoveNames: ReadonlySet<string> = new Set(),
  candidateGuard?: MoveCandidateGuard,
): void {
  if (!settings.detectMoves) {
    return;
  }

  // 1. Group consecutive atoms by status
  const blocks = groupIntoBlocks(atoms);

  // 2. Filter by minimum word count
  const deletedBlocks = blocks.filter(
    (b) =>
      b.status === CorrelationStatus.Deleted &&
      b.wordCount >= settings.moveMinimumWordCount
  );

  const insertedBlocks = blocks.filter(
    (b) =>
      b.status === CorrelationStatus.Inserted &&
      b.wordCount >= settings.moveMinimumWordCount
  );

  // 3. Find best matches using Jaccard similarity
  let moveGroupId = 1;

  for (const deleted of deletedBlocks) {
    const bestMatch = findBestMatch(deleted, insertedBlocks, settings, candidateGuard);

    if (bestMatch) {
      // 4. Convert to moves
      while (reservedMoveNames.has(`move${moveGroupId}`)) moveGroupId++;
      const moveName = `move${moveGroupId}`;
      markAsMove(
        deleted.atoms,
        CorrelationStatus.MovedSource,
        moveGroupId,
        moveName
      );
      markAsMove(
        bestMatch.block.atoms,
        CorrelationStatus.MovedDestination,
        moveGroupId,
        moveName
      );
      moveGroupId++;
    }
  }
}

/**
 * Collect identities from move-start markup that can be preserved in output.
 * Required-but-empty names are reserved too; the certificate checker applies
 * its separate stronger non-empty identity rule.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.27
 * @see https://github.com/UseJunior/safe-docx/issues/446
 */
export function collectPreservedMoveNames(roots: readonly Element[]): Set<string> {
  const names = new Set<string>();
  const visit = (element: Element): void => {
    if (element.tagName === 'w:moveFromRangeStart' || element.tagName === 'w:moveToRangeStart') {
      const name = element.getAttribute('w:name');
      if (name !== null) names.add(name);
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  for (const root of roots) visit(root);
  return names;
}
