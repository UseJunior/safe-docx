/**
 * ODF document comparison — paragraph-granularity tracked-changes redline (Slice 1).
 *
 * `compareOdf` is the public entry: it takes two `content.xml` STRINGS, parses each exactly once
 * internally (no DOM Element crosses the package boundary, no public DOM accessor on
 * `OdfDocument`), diffs the body paragraphs, emits ODF tracked-changes into the revised DOM, and
 * returns the redline `content.xml` plus edit stats. Diff and emit live in separate modules so the
 * diff is testable without round-tripping a `.odt`.
 *
 * Granularity: whole-paragraph. A "modified" paragraph surfaces as a deletion of the old plus an
 * insertion of the new, so `modifications` is always 0 at this granularity; intra-paragraph
 * (run-level) diffs are a later slice.
 */

import { parseXml, serializeXml } from '@usejunior/docx-core';

import { collectBlocks } from '../shared/odf/blocks.js';
import { buildSegments } from '../shared/odf/text_segments.js';
import { diffParagraphs } from './diff.js';
import { emitTrackedChanges } from './emit.js';

export { OdfEmitError } from './emit.js';

/** Counts of whole-paragraph edits. `modifications` is always 0 at paragraph granularity. */
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
};

/** ODF `dc:date` value: ISO 8601, no fractional seconds or trailing `Z` (matches comments.ts). */
function odfDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

/**
 * Compare two `content.xml` strings and produce a paragraph-granularity tracked-changes redline.
 * The redline is built on the REVISED document (so its styles, manifest, and untouched paragraphs
 * are preserved); deleted paragraphs are stored out-of-line in the tracked-changes container.
 */
export function compareOdf(
  originalContentXml: string,
  revisedContentXml: string,
  options: OdfCompareOptions = {},
): OdfCompareResult {
  const author = options.author ?? 'SafeDocX';
  const date = odfDate(options.date ?? new Date());

  const originalDoc = parseXml(originalContentXml);
  const revisedDoc = parseXml(revisedContentXml);

  const originalBlocks: Element[] = [];
  collectBlocks(originalDoc.documentElement, originalBlocks);
  const revisedBlocks: Element[] = [];
  collectBlocks(revisedDoc.documentElement, revisedBlocks);

  const ops = diffParagraphs(
    originalBlocks.map((b) => buildSegments(b).visible),
    revisedBlocks.map((b) => buildSegments(b).visible),
  );

  emitTrackedChanges({ revisedDoc, revisedBlocks, originalBlocks, ops, author, date });

  let insertions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.kind === 'insert') insertions++;
    else if (op.kind === 'delete') deletions++;
  }

  return {
    contentXml: serializeXml(revisedDoc),
    stats: { insertions, deletions, modifications: 0 },
  };
}
