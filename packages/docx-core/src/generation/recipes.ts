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
const NONE: BorderSpec = { style: 'none' };
const DEFAULT_SUBROW_COLOR_HEX = '595959';
const DEFAULT_SUBROW_LABEL_INDENT_TWIPS = 240;

export type CoverTermRow = { label: string; value: string };
export type CoverTermGroupRow = { group: string };
export type CoverTermSubrow = { label: string; value: string; subrow: true };
export type CoverTermEntry = CoverTermRow | CoverTermGroupRow | CoverTermSubrow;

export type CoverTermsOptions = {
  /** Plain rows, group headers, and subrows rendered in declaration order. */
  terms: CoverTermEntry[];
  /** Two-column widths in twips; defaults to a 2880/6480 split of a 6.5" body. */
  columnWidthsTwips?: [number, number];
  /** Heading text for a shaded full-width header row; omitted when absent. */
  title?: string;
  /** Table border style; defaults to the historical full grid. */
  borderMode?: 'grid' | 'horizontal-rules';
  /** Optional minimum row height applied to term/group/sub rows, not the title row. */
  rowHeightTwips?: number;
  /** Optional uniform cell padding applied to every cover-terms cell. */
  cellPaddingTwips?: number;
  /** Text color for subrow labels and values; defaults to mid-gray. */
  subrowColorHex?: string;
  /** Additional left padding on subrow label cells; defaults to 240 twips. */
  subrowLabelIndentTwips?: number;
};

/**
 * A fixed-layout two-column label/value table for cover-terms blocks
 * (scenario SDX-GEN-070), with optional house-style grouped/sub rows.
 */
export function coverTermsTable(options: CoverTermsOptions): TableSpec {
  const [labelWidth, valueWidth] = options.columnWidthsTwips ?? [2880, 6480];
  const borders =
    options.borderMode === 'horizontal-rules'
      ? { top: SINGLE, bottom: SINGLE, left: NONE, right: NONE, insideH: SINGLE, insideV: NONE }
      : { top: SINGLE, bottom: SINGLE, left: SINGLE, right: SINGLE, insideH: SINGLE, insideV: SINGLE };
  const rowRhythm = rowRhythmProps(options);
  const rows: TableSpec['rows'] = [];
  if (options.title !== undefined) {
    rows.push({
      header: true,
      cells: [
        {
          gridSpan: 2,
          shadingHex: 'D9D9D9',
          vAlign: 'center',
          ...cellPaddingProps(options),
          blocks: [paragraph(options.title, { bold: true, alignment: 'center' })],
        },
      ],
    });
  }
  for (const term of options.terms) {
    if ('group' in term) {
      rows.push({
        ...rowRhythm,
        cells: [
          {
            gridSpan: 2,
            vAlign: 'center',
            ...cellPaddingProps(options),
            blocks: [paragraph(term.group, { bold: true })],
          },
        ],
      });
      continue;
    }

    const subrow = 'subrow' in term && term.subrow === true;
    rows.push({
      ...rowRhythm,
      cells: [
        {
          ...cellPaddingProps(options, subrow ? { left: options.subrowLabelIndentTwips ?? DEFAULT_SUBROW_LABEL_INDENT_TWIPS } : undefined),
          blocks: [
            paragraph(term.label, {
              bold: !subrow,
              italic: subrow,
              colorHex: subrow ? (options.subrowColorHex ?? DEFAULT_SUBROW_COLOR_HEX) : undefined,
            }),
          ],
        },
        {
          ...cellPaddingProps(options),
          blocks: [
            paragraph(term.value, {
              italic: subrow,
              colorHex: subrow ? (options.subrowColorHex ?? DEFAULT_SUBROW_COLOR_HEX) : undefined,
            }),
          ],
        },
      ],
    });
  }
  return {
    kind: 'table',
    layout: 'fixed',
    columnWidthsTwips: [labelWidth, valueWidth],
    borders,
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
  opts?: { bold?: boolean; italic?: boolean; colorHex?: string; alignment?: ParagraphSpec['alignment'] },
): ParagraphSpec {
  return {
    kind: 'paragraph',
    ...(opts?.alignment !== undefined ? { alignment: opts.alignment } : {}),
    runs: [
      {
        kind: 'text',
        text,
        ...(opts?.bold ? { bold: true } : {}),
        ...(opts?.italic ? { italic: true } : {}),
        ...(opts?.colorHex !== undefined ? { colorHex: opts.colorHex } : {}),
      },
    ],
  };
}

function rowRhythmProps(options: CoverTermsOptions): Pick<TableSpec['rows'][number], 'heightTwips' | 'heightRule'> {
  return options.rowHeightTwips === undefined ? {} : { heightTwips: options.rowHeightTwips, heightRule: 'atLeast' };
}

function cellPaddingProps(
  options: CoverTermsOptions,
  overrides?: NonNullable<TableSpec['rows'][number]['cells'][number]['marginsTwips']>,
): Pick<TableSpec['rows'][number]['cells'][number], 'marginsTwips'> {
  if (options.cellPaddingTwips === undefined && overrides === undefined) return {};
  const uniform = options.cellPaddingTwips;
  return {
    marginsTwips: {
      ...(uniform === undefined ? {} : { top: uniform, right: uniform, bottom: uniform, left: uniform }),
      ...overrides,
    },
  };
}
