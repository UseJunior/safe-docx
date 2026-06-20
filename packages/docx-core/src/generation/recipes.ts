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

import type { BlockSpec, BorderSpec, HighlightColor, ParagraphSpec, TableSpec } from './types.js';

const SINGLE: BorderSpec = { style: 'single' };
const NONE: BorderSpec = { style: 'none' };
const DEFAULT_SUBROW_COLOR_HEX = '595959';
const DEFAULT_SUBROW_LABEL_INDENT_TWIPS = 240;
const DEFAULT_FILLABLE_HIGHLIGHT: HighlightColor = 'yellow';

type CellMargins = NonNullable<TableSpec['rows'][number]['cells'][number]['marginsTwips']>;

/** A value cell that can be flagged as an unfilled fillable placeholder. */
type FillableValue = { fillable?: boolean };

export type CoverTermRow = { label: string; value: string } & FillableValue;
export type CoverTermGroupRow = { group: string };
export type CoverTermSubrow = { label: string; value: string; subrow: true } & FillableValue;
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
  /**
   * Optional non-uniform cell margins. When set it supersedes `cellPaddingTwips`
   * for every cover-terms cell (the subrow label indent is still added on top of
   * the resulting `left`).
   */
  cellMarginsTwips?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Body font applied to every label/value/group run; default inherits Normal. */
  fontFamily?: string;
  /** Point size for plain-row and group runs; default inherits Normal. */
  sizePt?: number;
  /** Point size for subrow runs; defaults to `sizePt`. */
  subrowSizePt?: number;
  /** Text color for plain-row labels/values (six-hex, no '#'); default unset. */
  textColorHex?: string;
  /** Text color for group-row labels; defaults to `textColorHex`. */
  groupColorHex?: string;
  /** Text color for subrow labels and values; defaults to mid-gray. */
  subrowColorHex?: string;
  /** Highlight applied to a value flagged `fillable`; defaults to `yellow`. */
  fillableHighlight?: HighlightColor;
  /**
   * Extra left indent on subrow label cells, added on top of `cellPaddingTwips`
   * (so the label sits further right than a normal row). Defaults to 240 twips.
   */
  subrowLabelIndentTwips?: number;
  /** Color (six-hex, no '#') for the table's single-style borders. Default 'auto'. */
  ruleColorHex?: string;
  /** Weight in eighths of a point for the single-style borders. Default 4 (0.5pt). */
  ruleSizeEighthPt?: number;
};

/**
 * A fixed-layout two-column label/value table for cover-terms blocks
 * (scenario SDX-GEN-070), with optional house-style grouped/sub rows
 * (SDX-GEN-106) and run styling + fillable placeholders (SDX-GEN-110).
 */
export function coverTermsTable(options: CoverTermsOptions): TableSpec {
  const [labelWidth, valueWidth] = options.columnWidthsTwips ?? [2880, 6480];
  // The single-style borders honor an optional house-style color/weight; omitting
  // both yields the bare `{ style: 'single' }` (w:sz="4" w:color="auto") as before.
  const rule: BorderSpec = {
    style: 'single',
    ...(options.ruleSizeEighthPt !== undefined ? { sizeEighthPt: options.ruleSizeEighthPt } : {}),
    ...(options.ruleColorHex !== undefined ? { colorHex: options.ruleColorHex } : {}),
  };
  const borders =
    options.borderMode === 'horizontal-rules'
      ? { top: rule, bottom: rule, left: NONE, right: NONE, insideH: rule, insideV: NONE }
      : { top: rule, bottom: rule, left: rule, right: rule, insideH: rule, insideV: rule };
  const rowRhythm = rowRhythmProps(options);
  const font = options.fontFamily;
  const plainSize = options.sizePt;
  const subSize = options.subrowSizePt ?? options.sizePt;
  const fillHighlight = options.fillableHighlight ?? DEFAULT_FILLABLE_HIGHLIGHT;

  const rows: TableSpec['rows'] = [];
  if (options.title !== undefined) {
    rows.push({
      header: true,
      cells: [
        {
          gridSpan: 2,
          shadingHex: 'D9D9D9',
          vAlign: 'center',
          ...cellMarginProps(options),
          blocks: [paragraph(options.title, { bold: true, alignment: 'center', font, sizePt: plainSize })],
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
            ...cellMarginProps(options),
            blocks: [
              paragraph(term.group, {
                bold: true,
                font,
                sizePt: plainSize,
                colorHex: options.groupColorHex ?? options.textColorHex,
              }),
            ],
          },
        ],
      });
      continue;
    }

    const subrow = 'subrow' in term && term.subrow === true;
    const size = subrow ? subSize : plainSize;
    const labelColor = subrow ? (options.subrowColorHex ?? DEFAULT_SUBROW_COLOR_HEX) : options.textColorHex;
    const valueColor = subrow ? (options.subrowColorHex ?? DEFAULT_SUBROW_COLOR_HEX) : options.textColorHex;
    const subrowIndent = (uniformLeft(options)) + (options.subrowLabelIndentTwips ?? DEFAULT_SUBROW_LABEL_INDENT_TWIPS);

    rows.push({
      ...rowRhythm,
      cells: [
        {
          ...cellMarginProps(options, subrow ? { left: subrowIndent } : undefined),
          blocks: [paragraph(term.label, { bold: !subrow, italic: subrow, colorHex: labelColor, font, sizePt: size })],
        },
        {
          ...cellMarginProps(options),
          blocks: [
            paragraph(term.value, {
              italic: subrow,
              colorHex: valueColor,
              font,
              sizePt: size,
              ...(term.fillable ? { bold: true, highlight: fillHighlight } : {}),
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
    /** Override block `fillable` for this party's Print Name (oa-stacked-ruled). Default: `fillable`. */
    nameFillable?: boolean;
    /** Override block `fillable` for this party's Title (oa-stacked-ruled). Default: `fillable`. */
    titleFillable?: boolean;
  }>;
  /** Signature-line column width in twips; defaults to 4320 (3"). Single-column only. */
  lineWidthTwips?: number;

  // ---- two-column / oa-stacked-ruled mode (ignored unless that layout is set) ----
  /** Layout selector. Defaults to 'single-column' (the historical behavior). */
  layout?: 'single-column' | 'two-column' | 'oa-stacked-ruled';
  /** Total grid width in twips, split across the two signer columns. Defaults to 9360 (6.5" body). */
  totalWidthTwips?: number;
  /** Center gutter column width between the two signer cells. Defaults to 360 (0.25"). */
  gutterTwips?: number;
  /** Color for the muted party header and field captions. Defaults to '595959'. */
  headerColorHex?: string;
  /** Captions for the four ruled lines. Defaults to ['Signature', 'Print Name', 'Title', 'Date']. */
  ruledLineLabels?: [string, string, string, string];

  // ---- oa-stacked-ruled mode only ----
  /** Width of the left label column in twips. Defaults to 1800 (1.25"). */
  labelColumnTwips?: number;
  /** Minimum signing-row height in twips (room to sign). Defaults to 620. */
  ruledRowHeightTwips?: number;
  /** Which fields render, in order. Defaults to all four. */
  fields?: Array<'signature' | 'printName' | 'title' | 'date'>;
  /** Body font for the OA signature header + labels + values. */
  fontFamily?: string;
  /** Mark pre-filled values (printName/title) as fillable -> highlight + bold. */
  fillable?: boolean;
  /** Highlight for fillable values; defaults to `yellow`. */
  fillableHighlight?: HighlightColor;
  /** Bold the centered party header (oa-stacked-ruled). Default false. */
  headerBold?: boolean;
  /** Party-header point size (oa-stacked-ruled). Default: inherit Normal. */
  headerSizePt?: number;
  /** Color (six-hex) for the ruled signing line (oa-stacked-ruled). Default 'auto'. */
  lineColorHex?: string;
  /** Ruled signing-line weight in eighths of a point (oa-stacked-ruled). Default 4. */
  lineSizeEighthPt?: number;
};

/**
 * Signature blocks rendered as borderless tables whose content cells carry
 * only bottom borders — the signature lines. No VML, no images.
 *
 * - `single-column` (default): the historical stacked block — one table per
 *   party, a bottom-bordered line then name/title/date rows (SDX-GEN-071).
 * - `two-column`: a paired signing grid, two signers per row, each a centered
 *   muted header over ruled Signature/Print Name/Title/Date lines with captions
 *   beneath (SDX-GEN-109).
 * - `oa-stacked-ruled`: per party, a centered muted-caps header over a
 *   label-column / ruled-line table with tall signing rows (SDX-GEN-111).
 */
export function signatureBlock(options: SignatureBlockOptions): BlockSpec[] {
  const layout = options.layout ?? 'single-column';
  if (layout === 'two-column') return [twoColumnSignatureGrid(options)];
  if (layout === 'oa-stacked-ruled') return oaStackedRuledSignatures(options);
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
  opts?: {
    bold?: boolean;
    italic?: boolean;
    caps?: boolean;
    colorHex?: string;
    alignment?: ParagraphSpec['alignment'];
    font?: string;
    sizePt?: number;
    highlight?: HighlightColor;
  },
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
        ...(opts?.font !== undefined ? { font: opts.font } : {}),
        ...(opts?.sizePt !== undefined ? { sizePt: opts.sizePt } : {}),
        ...(opts?.highlight !== undefined ? { highlight: opts.highlight } : {}),
      },
    ],
  };
}

/**
 * OA stacked-ruled signatures: per party a centered uppercase muted header over
 * a borderless `[label | ruled line]` two-column table with tall signing rows.
 * Print Name / Title are pre-filled from the party data and optionally rendered
 * as fillable (highlight + bold) placeholders.
 */
function oaStackedRuledSignatures(options: SignatureBlockOptions): BlockSpec[] {
  const total = options.totalWidthTwips ?? 9360;
  const labelWidth = options.labelColumnTwips ?? 1800;
  const lineWidth = Math.max(1, total - labelWidth);
  const rowHeight = options.ruledRowHeightTwips ?? 620;
  const muted = options.headerColorHex ?? DEFAULT_SUBROW_COLOR_HEX;
  const font = options.fontFamily;
  const fields = options.fields ?? ['signature', 'printName', 'title', 'date'];
  // Caption overrides honor the same `ruledLineLabels` tuple as the two-column
  // path ([Signature, Print Name, Title, Date]); the Date caption additionally
  // honors a per-party `dateLabel`, matching single-column / two-column behavior.
  const labels = options.ruledLineLabels ?? ['Signature', 'Print Name', 'Title', 'Date'];
  const captionFor = (
    field: NonNullable<SignatureBlockOptions['fields']>[number],
    party: SignatureBlockOptions['parties'][number],
  ): string => {
    switch (field) {
      case 'signature':
        return labels[0];
      case 'printName':
        return labels[1];
      case 'title':
        return labels[2];
      case 'date':
        return party.dateLabel ?? labels[3];
    }
  };
  const fillHighlight = options.fillableHighlight ?? DEFAULT_FILLABLE_HIGHLIGHT;
  const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideH: NONE, insideV: NONE };
  // The ruled signing line honors an optional house-style color/weight; omitting
  // both yields the bare `{ style: 'single' }` bottom border as before.
  const lineBorder: BorderSpec = {
    style: 'single',
    ...(options.lineSizeEighthPt !== undefined ? { sizeEighthPt: options.lineSizeEighthPt } : {}),
    ...(options.lineColorHex !== undefined ? { colorHex: options.lineColorHex } : {}),
  };

  const blocks: BlockSpec[] = [];
  for (const party of options.parties) {
    blocks.push(
      paragraph(party.party, {
        alignment: 'center',
        caps: true,
        colorHex: muted,
        font,
        ...(options.headerBold ? { bold: true } : {}),
        ...(options.headerSizePt !== undefined ? { sizePt: options.headerSizePt } : {}),
      }),
    );
    const rows: TableSpec['rows'] = fields.map((field) => {
      const value = field === 'printName' ? party.name : field === 'title' ? (party.title ?? '') : '';
      // Print Name / Title resolve their fillable flag per party, falling back to
      // the block-level `fillable`; Signature / Date are never fillable. This lets
      // a filled assignment stay un-highlighted while an unfilled placeholder is.
      const fieldFillable =
        field === 'printName'
          ? (party.nameFillable ?? options.fillable)
          : field === 'title'
            ? (party.titleFillable ?? options.fillable)
            : false;
      const fillableValue = fieldFillable === true && value !== '';
      return {
        heightTwips: rowHeight,
        heightRule: 'atLeast' as const,
        cells: [
          {
            vAlign: 'bottom' as const,
            borders: noBorders,
            blocks: [paragraph(captionFor(field, party), { bold: true, font })],
          },
          {
            vAlign: 'bottom' as const,
            borders: { bottom: lineBorder },
            blocks: [
              paragraph(value, {
                font,
                ...(fillableValue ? { bold: true, highlight: fillHighlight } : {}),
              }),
            ],
          },
        ],
      };
    });
    blocks.push({
      kind: 'table',
      layout: 'fixed',
      columnWidthsTwips: [labelWidth, lineWidth],
      borders: noBorders,
      rows,
    });
  }
  return blocks;
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

/** The effective uniform left margin (non-uniform margins win over uniform padding). */
function uniformLeft(options: CoverTermsOptions): number {
  if (options.cellMarginsTwips !== undefined) return options.cellMarginsTwips.left ?? 0;
  return options.cellPaddingTwips ?? 0;
}

function cellMarginProps(
  options: CoverTermsOptions,
  overrides?: Partial<CellMargins>,
): Pick<TableSpec['rows'][number]['cells'][number], 'marginsTwips'> {
  const base: CellMargins | undefined = options.cellMarginsTwips
    ? { ...options.cellMarginsTwips }
    : options.cellPaddingTwips !== undefined
      ? {
          top: options.cellPaddingTwips,
          right: options.cellPaddingTwips,
          bottom: options.cellPaddingTwips,
          left: options.cellPaddingTwips,
        }
      : undefined;
  if (base === undefined && overrides === undefined) return {};
  return { marginsTwips: { ...(base ?? {}), ...(overrides ?? {}) } };
}
