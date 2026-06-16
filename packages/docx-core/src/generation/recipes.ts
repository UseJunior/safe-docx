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
  /**
   * Extra left indent on subrow label cells, added on top of `cellPaddingTwips`
   * (so the label sits further right than a normal row). Defaults to 240 twips.
   */
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
          ...cellPaddingProps(
            options,
            subrow
              ? { left: (options.cellPaddingTwips ?? 0) + (options.subrowLabelIndentTwips ?? DEFAULT_SUBROW_LABEL_INDENT_TWIPS) }
              : undefined,
          ),
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
  /** Signature-line column width in twips; defaults to 4320 (3"). Single-column only. */
  lineWidthTwips?: number;

  // ---- two-column mode (all optional; ignored unless layout === 'two-column') ----
  /** Layout selector. Defaults to 'single-column' (the historical behavior). */
  layout?: 'single-column' | 'two-column';
  /** Total grid width in twips, split across the two signer columns. Defaults to 9360 (6.5" body). */
  totalWidthTwips?: number;
  /** Center gutter column width between the two signer cells. Defaults to 360 (0.25"). */
  gutterTwips?: number;
  /** Color for the muted party header and field captions. Defaults to '595959'. */
  headerColorHex?: string;
  /** Captions for the four ruled lines. Defaults to ['Signature', 'Print Name', 'Title', 'Date']. */
  ruledLineLabels?: [string, string, string, string];
};

/**
 * Signature blocks rendered as borderless tables whose content cells carry
 * only bottom borders — the signature lines. No VML, no images.
 *
 * Default `layout: 'single-column'` keeps the historical stacked block: one
 * table per party, a bottom-bordered line then name/title/date rows
 * (scenario SDX-GEN-071). With `layout: 'two-column'` the parties render as a
 * paired signing grid — two signers per row, each a centered uppercase muted
 * header over ruled Signature / Print Name / Title / Date lines (Print Name and
 * Title pre-filled from the party data), with an empty padding cell when the
 * signer count is odd (scenario SDX-GEN-109).
 */
export function signatureBlock(options: SignatureBlockOptions): BlockSpec[] {
  if ((options.layout ?? 'single-column') === 'two-column') {
    return [twoColumnSignatureGrid(options)];
  }
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
  opts?: { bold?: boolean; italic?: boolean; caps?: boolean; colorHex?: string; alignment?: ParagraphSpec['alignment'] },
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
        ...(opts?.caps ? { caps: true } : {}),
        ...(opts?.colorHex !== undefined ? { colorHex: opts.colorHex } : {}),
      },
    ],
  };
}

/**
 * Two-column signing grid: parties chunked into pairs across a 3-column table
 * `[signer, gutter, signer]`, with an empty padding cell for an odd final
 * signer. Each signer cell stacks a centered uppercase muted header over a
 * nested one-column table of four ruled fields (Signature / Print Name / Title
 * / Date), reusing the bottom-bordered-cell rule from the single-column path.
 */
function twoColumnSignatureGrid(options: SignatureBlockOptions): TableSpec {
  const total = options.totalWidthTwips ?? 9360;
  const gutter = options.gutterTwips ?? 360;
  const signer = Math.max(1, Math.floor((total - gutter) / 2));
  const mutedColor = options.headerColorHex ?? DEFAULT_SUBROW_COLOR_HEX;
  const labels = options.ruledLineLabels ?? ['Signature', 'Print Name', 'Title', 'Date'];

  const gutterCell: TableSpec['rows'][number]['cells'][number] = {
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
    blocks: [paragraph('')],
  };
  const paddingCell: TableSpec['rows'][number]['cells'][number] = {
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
    blocks: [paragraph('')],
  };

  const rows: TableSpec['rows'] = [];
  for (let i = 0; i < options.parties.length; i += 2) {
    const left = options.parties[i];
    if (left === undefined) continue;
    const right = options.parties[i + 1];
    rows.push({
      cells: [
        signerCell(left, labels, mutedColor),
        gutterCell,
        right === undefined ? paddingCell : signerCell(right, labels, mutedColor),
      ],
    });
  }

  return {
    kind: 'table',
    layout: 'fixed',
    columnWidthsTwips: [signer, gutter, signer],
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideH: NONE, insideV: NONE },
    rows,
  };
}

function signerCell(
  party: SignatureBlockOptions['parties'][number],
  labels: [string, string, string, string],
  mutedColor: string,
): TableSpec['rows'][number]['cells'][number] {
  // Pre-fill Print Name / Title from the party data; Signature / Date stay blank.
  const fields: Array<[value: string, caption: string]> = [
    ['', labels[0]],
    [party.name, labels[1]],
    [party.title ?? '', labels[2]],
    ['', party.dateLabel ?? labels[3]],
  ];
  return {
    vAlign: 'top',
    blocks: [
      paragraph(party.party, { alignment: 'center', caps: true, colorHex: mutedColor }),
      {
        kind: 'table',
        layout: 'fixed',
        columnWidthsTwips: [4320],
        borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideH: NONE, insideV: NONE },
        rows: fields.flatMap(([value, caption]) => ruledFieldRows(value, caption, mutedColor)),
      },
    ],
  };
}

/** A ruled field = the bottom-bordered value line, then its muted caption beneath. */
function ruledFieldRows(value: string, caption: string, mutedColor: string): TableSpec['rows'] {
  return [
    { cells: [{ borders: { bottom: SINGLE }, blocks: [paragraph(value)] }] },
    { cells: [{ blocks: [paragraph(caption, { colorHex: mutedColor })] }] },
  ];
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
