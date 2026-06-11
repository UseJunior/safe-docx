/**
 * Declarative document specification for from-scratch DOCX generation.
 *
 * The entire surface is plain data: discriminated unions on `kind`, no Map /
 * Date / class instances, explicit unit suffixes (`...Twips`, `...Pt`) instead
 * of bare numbers. `JSON.parse(JSON.stringify(spec))` is identity over any
 * valid spec, which is what lets a stored recipe (or, later, an MCP payload)
 * compile without translation.
 *
 * The type surface intentionally covers the full feature set of the
 * add-docx-generation change even though emitters land in phases; the
 * compiler rejects any spec feature whose emitter has not shipped yet
 * (see validate-spec.ts) rather than silently ignoring it.
 */

export type DocumentSpec = {
  meta?: DocumentMetaSpec;
  /** Emitted to word/styles.xml. Document defaults + Normal are always emitted. */
  styles?: StyleSpec[];
  /** Emitted to word/numbering.xml when non-empty. */
  numbering?: NumberingSpec[];
  /** At least one section. The final section's properties bind at body level. */
  sections: SectionSpec[];
  options?: {
    /** Default true. When false, drafting notes compile to nothing. */
    includeDraftingNotes?: boolean;
  };
};

export type DocumentMetaSpec = {
  title?: string;
  author?: string;
  /** ISO-8601 timestamp used for docProps dates. Generation never reads the clock. */
  createdIso?: string;
};

export type SectionSpec = {
  page?: {
    /** Defaults to US Letter (12240 × 15840). */
    sizeTwips?: { w: number; h: number };
    orientation?: 'portrait' | 'landscape';
    marginsTwips?: {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
      header?: number;
      footer?: number;
      gutter?: number;
    };
  };
  /** Section-break type for non-final sections (w:type). */
  breakType?: 'nextPage' | 'continuous' | 'oddPage' | 'evenPage';
  pageNumbering?: {
    start?: number;
    format?: 'decimal' | 'lowerRoman' | 'upperRoman' | 'lowerLetter' | 'upperLetter';
  };
  /** Auto-implied when headers.first or footers.first is present. */
  titlePg?: boolean;
  headers?: HeaderFooterSet;
  footers?: HeaderFooterSet;
  blocks: BlockSpec[];
};

export type HeaderFooterSet = {
  default?: HeaderFooterSpec;
  first?: HeaderFooterSpec;
  even?: HeaderFooterSpec;
};

export type HeaderFooterSpec = { blocks: BlockSpec[] };

export type BlockSpec = ParagraphSpec | TableSpec;

export type ParagraphSpec = {
  kind: 'paragraph';
  /** Must resolve to a declared style (or the implicit Normal). */
  styleId?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spacing?: {
    beforeTwips?: number;
    afterTwips?: number;
    lineTwips?: number;
    lineRule?: 'auto' | 'exact' | 'atLeast';
  };
  indent?: {
    leftTwips?: number;
    rightTwips?: number;
    firstLineTwips?: number;
    hangingTwips?: number;
  };
  /** Must resolve to a declared numbering definition. */
  list?: { numId: string; ilvl: number };
  pageBreakBefore?: boolean;
  keepNext?: boolean;
  tabs?: Array<{
    posTwips: number;
    align: 'left' | 'center' | 'right';
    leader?: 'none' | 'dot' | 'underscore';
  }>;
  runs: InlineSpec[];
  /** Drafting-note annotation anchored to this paragraph (separable layer). */
  note?: DraftingNoteSpec;
};

export type InlineSpec = RunSpec | FieldSpec | TabSpec | BreakSpec;

/** Run-level formatting shared by text runs, fields, and style definitions. */
export type RunProps = {
  bold?: boolean;
  italic?: boolean;
  underline?: 'single' | 'double' | 'none';
  /** Six-digit hex without '#', e.g. 'FF0000'. */
  colorHex?: string;
  /** Applied to ascii + hAnsi + cs so all script ranges agree. */
  font?: string;
  sizePt?: number;
  caps?: boolean;
  smallCaps?: boolean;
};

export type RunSpec = { kind: 'text'; text: string } & RunProps;

export type FieldSpec = {
  kind: 'field';
  field: 'PAGE' | 'NUMPAGES';
  /**
   * Cached field result text, required so readers display a value without
   * recomputation prompts. The no-recovery-dialog guarantee is
   * unrepresentable-by-omission.
   */
  cachedResult: string;
} & RunProps;

export type TabSpec = { kind: 'tab' };

export type BreakSpec = { kind: 'break'; breakType?: 'line' | 'page' };

export type TableSpec = {
  kind: 'table';
  /** Defaults to 'fixed'. */
  layout?: 'fixed' | 'autofit';
  /** Defines w:tblGrid; the sum drives w:tblW. */
  columnWidthsTwips: number[];
  borders?: TableBorders;
  rows: TableRowSpec[];
};

export type BorderSpec = {
  style: 'single' | 'double' | 'none';
  sizeEighthPt?: number;
  colorHex?: string;
};

export type TableBorders = {
  top?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
  right?: BorderSpec;
  insideH?: BorderSpec;
  insideV?: BorderSpec;
};

export type TableRowSpec = {
  heightTwips?: number;
  heightRule?: 'atLeast' | 'exact';
  /** Marks the row as a repeating header row (w:tblHeader). */
  header?: boolean;
  cells: TableCellSpec[];
};

export type TableCellSpec = {
  widthTwips?: number;
  gridSpan?: number;
  vMerge?: 'restart' | 'continue';
  borders?: TableBorders;
  shadingHex?: string;
  vAlign?: 'top' | 'center' | 'bottom';
  marginsTwips?: { top?: number; right?: number; bottom?: number; left?: number };
  blocks: BlockSpec[];
};

export type StyleSpec = {
  styleId: string;
  name: string;
  type: 'paragraph' | 'character';
  basedOn?: string;
  next?: string;
  paragraph?: Omit<ParagraphSpec, 'kind' | 'runs' | 'list' | 'note' | 'styleId'>;
  run?: RunProps;
};

export type NumberingSpec = {
  /** Spec-level handle; the compiler assigns numeric w:numId / abstractNumId. */
  numId: string;
  levels: Array<{
    ilvl: number;
    start?: number;
    numFmt: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' | 'bullet' | 'none';
    /** Level text pattern, e.g. '%1.' or '%1.%2' or a bullet glyph. */
    lvlText: string;
    suff?: 'tab' | 'space' | 'nothing';
    indentTwips?: { left?: number; hanging?: number };
    runProps?: RunProps;
  }>;
};

export type DraftingNoteSpec = {
  text: string;
  author?: string;
  /** ISO-8601; comment metadata is deterministic, never wall-clock. */
  dateIso?: string;
};
