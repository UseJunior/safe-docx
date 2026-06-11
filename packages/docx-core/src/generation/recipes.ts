/**
 * Legal-document recipes.
 *
 * Pure functions producing spec nodes from options — no own OOXML
 * representation, no compiler hooks. Everything a recipe returns is built
 * from the paragraph/table grammar, so its output is inlineable anywhere a
 * BlockSpec is accepted and serializes through exactly the emitters the
 * rest of the document uses. Signature lines are bottom-bordered cells, not
 * VML shapes: Pages and Google Docs mangle VML, borders survive everywhere.
 */

import type { BlockSpec, BorderSpec, ParagraphSpec, TableSpec } from './types.js';

const SINGLE: BorderSpec = { style: 'single' };

export type CoverTermsOptions = {
  /** Label/value pairs, rendered one row each in declaration order. */
  terms: Array<{ label: string; value: string }>;
  /** Two-column widths in twips; defaults to a 2880/6480 split of a 6.5" body. */
  columnWidthsTwips?: [number, number];
  /** Heading text for a shaded full-width header row; omitted when absent. */
  title?: string;
};

/**
 * A fixed-layout two-column label/value table for cover-terms blocks
 * (scenario SDX-GEN-070).
 */
export function coverTermsTable(options: CoverTermsOptions): TableSpec {
  const [labelWidth, valueWidth] = options.columnWidthsTwips ?? [2880, 6480];
  const rows: TableSpec['rows'] = [];
  if (options.title !== undefined) {
    rows.push({
      header: true,
      cells: [
        {
          gridSpan: 2,
          shadingHex: 'D9D9D9',
          vAlign: 'center',
          blocks: [paragraph(options.title, { bold: true, alignment: 'center' })],
        },
      ],
    });
  }
  for (const term of options.terms) {
    rows.push({
      cells: [
        { blocks: [paragraph(term.label, { bold: true })] },
        { blocks: [paragraph(term.value)] },
      ],
    });
  }
  return {
    kind: 'table',
    layout: 'fixed',
    columnWidthsTwips: [labelWidth, valueWidth],
    borders: { top: SINGLE, bottom: SINGLE, left: SINGLE, right: SINGLE, insideH: SINGLE, insideV: SINGLE },
    rows,
  };
}

export type SignatureBlockOptions = {
  parties: Array<{
    /** Party heading above the signature line, e.g. the company name. */
    party: string;
    /** Signatory name printed under the line. */
    name: string;
    title?: string;
    /** Label for the date row; defaults to 'Date:'. */
    dateLabel?: string;
  }>;
  /** Signature-line column width in twips; defaults to 4320 (3"). */
  lineWidthTwips?: number;
};

/**
 * Signature blocks rendered as borderless single-column tables whose first
 * content cell carries only a bottom border — the signature line — followed
 * by name, title, and date rows (scenario SDX-GEN-071). No VML, no images.
 */
export function signatureBlock(options: SignatureBlockOptions): BlockSpec[] {
  const width = options.lineWidthTwips ?? 4320;
  const blocks: BlockSpec[] = [];
  options.parties.forEach((party, index) => {
    if (index > 0) blocks.push(paragraph(''));
    blocks.push(paragraph(party.party, { bold: true }));
    const rows: TableSpec['rows'] = [
      { cells: [{ borders: { bottom: SINGLE }, blocks: [paragraph('')] }] },
      { cells: [{ blocks: [paragraph(`Name: ${party.name}`)] }] },
    ];
    if (party.title !== undefined) {
      rows.push({ cells: [{ blocks: [paragraph(`Title: ${party.title}`)] }] });
    }
    rows.push({ cells: [{ blocks: [paragraph(party.dateLabel ?? 'Date:')] }] });
    blocks.push({
      kind: 'table',
      layout: 'fixed',
      columnWidthsTwips: [width],
      rows,
    });
  });
  return blocks;
}

function paragraph(
  text: string,
  opts?: { bold?: boolean; alignment?: ParagraphSpec['alignment'] },
): ParagraphSpec {
  return {
    kind: 'paragraph',
    ...(opts?.alignment !== undefined ? { alignment: opts.alignment } : {}),
    runs: [{ kind: 'text', text, ...(opts?.bold ? { bold: true } : {}) }],
  };
}
