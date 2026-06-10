/**
 * ODF document comparison — tracked-changes redline at inline granularity.
 *
 * `compareOdf` is the public entry: it takes two `content.xml` STRINGS, parses each exactly once
 * internally (no DOM Element crosses the package boundary, no public DOM accessor on
 * `OdfDocument`), diffs the body paragraphs, emits ODF tracked-changes into the revised DOM, and
 * returns the redline `content.xml` plus edit stats. Diff and emit live in separate modules so the
 * diff is testable without round-tripping a `.odt`.
 *
 * Granularity: aligned-but-differing paragraph pairs above `similarityThreshold` are diffed
 * WITHIN the paragraph (token-level) and emitted as inline tracked changes; below-threshold
 * replacements and pure adds/removes keep the Slice-1 whole-paragraph shapes.
 */

import { parseXml, serializeXml } from '@usejunior/docx-core';

import { collectBlocks } from '../shared/odf/blocks.js';
import { buildSegments } from '../shared/odf/text_segments.js';
import { DEFAULT_ODF_SIMILARITY_THRESHOLD, diffParagraphs, pairModifications } from './diff.js';
import { emitTrackedChanges } from './emit.js';

export { OdfEmitError } from './emit.js';

/**
 * Counts of changed-regions in the redline: whole-paragraph inserts/deletes count one per
 * paragraph; a modified paragraph counts one `modifications` plus one insertion/deletion per
 * inline span inside it; a degraded modify pair counts one insertion plus one deletion.
 */
export type OdfCompareStats = {
  insertions: number;
  deletions: number;
  modifications: number;
};

export type OdfCompareResult = {
  /** The redline `content.xml` (revised document + tracked-changes markup). */
  contentXml: string;
  stats: OdfCompareStats;
};

export type OdfCompareOptions = {
  /** Change author for `dc:creator`. Defaults to `SafeDocX`. */
  author?: string;
  /** Change date; defaults to now. */
  date?: Date;
  /**
   * Minimum Jaccard word-overlap for an aligned delete/insert pair to be treated as an
   * in-place modification (intra-paragraph diff) instead of a whole-paragraph replacement.
   * Defaults to `DEFAULT_ODF_SIMILARITY_THRESHOLD` (0.25).
   */
  similarityThreshold?: number;
};

/** ODF `dc:date` value: ISO 8601, no fractional seconds or trailing `Z` (matches comments.ts). */
function odfDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

/**
 * Compare two `content.xml` strings and produce a tracked-changes redline. The redline is built
 * on the REVISED document (so its styles, manifest, and untouched paragraphs are preserved);
 * deleted content — whole paragraphs and inline spans alike — is stored out-of-line in the
 * tracked-changes container.
 */
export function compareOdf(
  originalContentXml: string,
  revisedContentXml: string,
  options: OdfCompareOptions = {},
): OdfCompareResult {
  const author = options.author ?? 'SafeDocX';
  const date = odfDate(options.date ?? new Date());
  const similarityThreshold = options.similarityThreshold ?? DEFAULT_ODF_SIMILARITY_THRESHOLD;

  const originalDoc = parseXml(originalContentXml);
  const revisedDoc = parseXml(revisedContentXml);

  const originalBlocks: Element[] = [];
  collectBlocks(originalDoc.documentElement, originalBlocks);
  const revisedBlocks: Element[] = [];
  collectBlocks(revisedDoc.documentElement, revisedBlocks);

  const originalTexts = originalBlocks.map((b) => buildSegments(b).visible);
  const revisedTexts = revisedBlocks.map((b) => buildSegments(b).visible);
  const ops = pairModifications(
    diffParagraphs(originalTexts, revisedTexts),
    originalTexts,
    revisedTexts,
    similarityThreshold,
  );

  const emitted = emitTrackedChanges({ revisedDoc, revisedBlocks, originalBlocks, ops, author, date });

  // Whole-paragraph ops count one each; inline spans and degradations come from the emitter so
  // the stats always describe the markup actually written.
  let insertions = emitted.inlineInsertions + emitted.degradedModifications;
  let deletions = emitted.inlineDeletions + emitted.degradedModifications;
  for (const op of ops) {
    if (op.kind === 'insert') insertions++;
    else if (op.kind === 'delete') deletions++;
  }

  return {
    contentXml: serializeXml(revisedDoc),
    stats: { insertions, deletions, modifications: emitted.modifications },
  };
}
