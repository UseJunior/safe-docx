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
  /** Optional partial override for the emitted package theme. */
  theme?: DocumentThemeSpec;
  /**
   * Document-wide run and paragraph defaults (`w:docDefaults`). Every
   * paragraph and run inherits them unless a style or direct formatting
   * overrides them, so a house font, size, and spacing are declared once.
   */
  defaults?: DocumentDefaultsSpec;
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

export type DocumentDefaultsSpec = {
  /** Merged over the built-in Calibri 11pt baseline in `w:rPrDefault`. */
  run?: RunProps;
  /** Emitted as `w:pPrDefault`; empty when omitted. */
  paragraph?: StyleSpec['paragraph'];
};

export type DocumentMetaSpec = {
  title?: string;
  author?: string;
  /** ISO-8601 timestamp used for docProps dates. Generation never reads the clock. */
  createdIso?: string;
};

export const THEME_COLOR_SLOTS = [
  'text1',
  'background1',
  'text2',
  'background2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hyperlink',
  'followedHyperlink',
] as const;

export type ThemeColorSlot = (typeof THEME_COLOR_SLOTS)[number];

export type DocumentThemeSpec = {
  /** Partial slot overrides; values are six-digit hex without '#'. */
  colors?: Partial<Record<ThemeColorSlot, string>>;
  /** Optional major (headings) and minor (body) latin typefaces. */
  fonts?: { major?: string; minor?: string };
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
  /**
   * Where a non-final section's w:sectPr binds. 'ownParagraph' (default) adds
   * a dedicated empty break paragraph, as Word's Insert → Section Break does.
   * 'lastParagraph' puts the w:sectPr on the section's final paragraph, so the
   * break adds no dedicated empty paragraph. Pagination still follows the
   * break type and paragraph settings (an oddPage break may still need a
   * blank page). The section must then end with a paragraph. Ignored on the final section,
   * whose properties always bind at body level.
   */
  breakPlacement?: 'ownParagraph' | 'lastParagraph';
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
  /** Paragraph-level border edges emitted as w:pBdr. */
  borders?: ParagraphBorders;
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
  /** Keep every line of this paragraph on one page (w:keepLines). */
  keepLines?: boolean;
  tabs?: TabStopSpec[];
  /**
   * Bookmark name for this paragraph: a `w:bookmarkStart`/`w:bookmarkEnd`
   * pair around its content, which a {@link CrossReferenceSpec} names. Word's
   * Bookmark dialog rules apply: at most 40 characters, a letter first, then
   * only letters, digits and underscores (`bookmarkNameForSlug` maps a
   * kebab-case id to one). Names are unique in the document, compared without
   * regard to case. Body story only, table cells included.
   */
  bookmark?: string;
  runs: InlineSpec[];
  /** Drafting-note annotation anchored to this paragraph (separable layer). */
  note?: DraftingNoteSpec;
};

export type InlineSpec = RunSpec | FieldSpec | TabSpec | BreakSpec | FootnoteSpec | CrossReferenceSpec;

/**
 * The fixed set of text-highlight values (CT_HighlightColor). Single source of
 * truth: the {@link HighlightColor} union is derived from this array, and
 * validation reuses it as a runtime whitelist so JSON/JS callers cannot author
 * an out-of-enum `w:highlight`.
 */
export const HIGHLIGHT_COLORS = [
  'yellow',
  'green',
  'cyan',
  'magenta',
  'blue',
  'red',
  'darkBlue',
  'darkCyan',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'darkGray',
  'lightGray',
  'black',
  'white',
  'none',
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** Run-level formatting shared by text runs, fields, and style definitions. */
export type RunProps = {
  bold?: boolean;
  italic?: boolean;
  underline?: 'single' | 'double' | 'none';
  /** Six-digit hex without '#', e.g. 'FF0000'. */
  colorHex?: string;
  /** Theme color slot emitted as w:color/@w:themeColor. */
  themeColor?: ThemeColorSlot;
  /** Two-digit hex tint emitted as w:color/@w:themeTint. */
  themeTint?: string;
  /** Two-digit hex shade emitted as w:color/@w:themeShade. */
  themeShade?: string;
  /** Fixed text highlight color; arbitrary run fill belongs to run shading. */
  highlight?: HighlightColor;
  /** Applied to ascii + hAnsi + eastAsia + cs so all script ranges agree. */
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

/**
 * A cross-reference to a numbered paragraph: a `REF <bookmark> \w \h`
 * field (or `\n` for `number: 'paragraph'`) that Word renumbers when fields
 * are updated and that Ctrl-click follows to the target.
 *
 * The compiler sets the cached result to the number Word shows after
 * updating fields, so the document reads correctly before any update:
 * `fullContext` gives the number with its context ("Section 2.06(b)",
 * "2(b)"), `paragraph` the target's own level text ("(b)"), each less a
 * trailing period. The target must be a numbered paragraph whose number
 * depends only on levels the list has used; otherwise generation fails.
 *
 * Allowed in the body story (table cells included) and in footnotes; not in
 * headers or footers.
 */
export type CrossReferenceSpec = {
  kind: 'crossReference';
  /** The `bookmark` of a body paragraph. */
  bookmark: string;
  /** Defaults to 'fullContext' (`\w`); 'paragraph' is `\n`. */
  number?: CrossReferenceNumber;
} & RunProps;

/** The number a cross-reference shows; see {@link CrossReferenceSpec}. */
export const CROSS_REFERENCE_NUMBERS = ['fullContext', 'paragraph'] as const;

export type CrossReferenceNumber = (typeof CROSS_REFERENCE_NUMBERS)[number];

export type TabSpec = { kind: 'tab' };

export type BreakSpec = { kind: 'break'; breakType?: 'line' | 'page' };

/**
 * A footnote: a reference mark at this point of the paragraph and a note body
 * at the foot of the page. Word numbers notes 1, 2, 3, … in document order;
 * the compiler assigns the note ids. The reference mark is a run in the
 * FootnoteReference character style, and each body paragraph without a
 * `styleId` takes the FootnoteText paragraph style. Both styles are emitted
 * when the document has a footnote and does not declare them itself.
 *
 * Footnotes are allowed only in the body story (table cells included): not in
 * headers or footers, and not inside another footnote. Body paragraphs may not
 * carry a drafting note, `pageBreakBefore`, or a page break.
 */
export type FootnoteSpec = {
  kind: 'footnote';
  /** The note's paragraphs, at least one. */
  blocks: ParagraphSpec[];
};

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

export type ParagraphBorders = {
  top?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
  right?: BorderSpec;
  between?: BorderSpec;
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
  themeFill?: ThemeColorSlot;
  themeFillTint?: string;
  themeFillShade?: string;
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
  paragraph?: Omit<ParagraphSpec, 'kind' | 'runs' | 'list' | 'note' | 'styleId' | 'bookmark'>;
  run?: RunProps;
};

/**
 * The level-justification values we author for `w:lvlJc` — the transitional
 * ST_Jc subset (`left`/`center`/`right`) the numbering generator emits, not the
 * full CT_Jc value space. Single source of truth: the
 * {@link NumberingLevelJustification} union is derived from this array, and
 * validation reuses it as a runtime whitelist so JSON/JS callers cannot author
 * an out-of-enum `w:lvlJc`.
 */
export const NUMBERING_LEVEL_JUSTIFICATIONS = ['left', 'center', 'right'] as const;

export type NumberingLevelJustification = (typeof NUMBERING_LEVEL_JUSTIFICATIONS)[number];

/**
 * The level number formats we author for `w:numFmt` — the ST_NumberFormat
 * subset the numbering generator emits. Single source of truth: the
 * {@link NumberingLevelFormat} union is derived from this array, and
 * validation reuses it as a runtime whitelist. `decimalZero` pads one through
 * nine with a leading zero (`01`, `02`, … `10`), the format of the "Section
 * 1.01" level in US legal outlines.
 */
export const NUMBERING_LEVEL_FORMATS = [
  'decimal',
  'decimalZero',
  'lowerLetter',
  'upperLetter',
  'lowerRoman',
  'upperRoman',
  'bullet',
  'none',
] as const;

export type NumberingLevelFormat = (typeof NUMBERING_LEVEL_FORMATS)[number];

/** A tab stop, as authored on a paragraph, a style, or a numbering level. */
export type TabStopSpec = {
  posTwips: number;
  align: 'left' | 'center' | 'right';
  leader?: 'none' | 'dot' | 'underscore';
};

/** One level (`w:lvl`) of an abstract numbering definition. */
export type NumberingLevelSpec = {
  ilvl: number;
  start?: number;
  numFmt: NumberingLevelFormat;
  /**
   * One-based restart threshold (`w:lvlRestart`): this level restarts only
   * when level `lvlRestart` (one-based, so `1` is `ilvl` 0) or an earlier
   * level is used; `0` never restarts it. Omitted, the level restarts after
   * any earlier level, which is already what "(a) restarts in each Section"
   * needs. Must be `0` or below `ilvl`: the value `ilvl` names the previous
   * level (the default), and Word drops the level's numbering when it is
   * written explicitly. LibreOffice (26.2) ignores `w:lvlRestart` and always
   * applies the default, so a non-default threshold renders differently there.
   */
  lvlRestart?: number;
  /**
   * Paragraph style linked to this level (`w:pStyle`), e.g. `Heading2` for
   * the "Section 1.01" level. Must name a declared paragraph style, and each
   * style links to at most one level. The compiler also emits the reverse
   * link — a `w:numPr` naming this definition's default instance and this
   * level — in the style's `w:pPr`, so a paragraph that only sets
   * `styleId` is numbered at this level.
   */
  pStyle?: string;
  /**
   * Legal numbering (`w:isLgl`): every level placeholder in `lvlText` shows
   * as an Arabic numeral, so `'Section %1.%2'` under an `upperRoman` article
   * level prints "Section 2.01", not "Section II.01".
   */
  isLgl?: boolean;
  /** Level text pattern, e.g. '%1.' or '%1.%2' or a bullet glyph. */
  lvlText: string;
  suff?: 'tab' | 'space' | 'nothing';
  /**
   * Level number justification against the text indent (`w:lvlJc`); defaults
   * to `left`. `right` aligns labels of differing widths on their right edge.
   */
  lvlJc?: NumberingLevelJustification;
  /**
   * Level indentation (`w:pPr/w:ind`). `firstLine` and `hanging` are
   * mutually exclusive: `{ left: 0, firstLine: 720 }` puts the label at
   * 0.5" and wraps lines back to the margin.
   */
  indentTwips?: { left?: number; hanging?: number; firstLine?: number };
  /**
   * Level tab stops (`w:pPr/w:tabs`). With `suff: 'tab'` (the default) the
   * text after the label starts at the first stop past the label, e.g. a
   * left stop at 1440 puts the text at 1".
   */
  tabs?: TabStopSpec[];
  runProps?: RunProps;
};

/**
 * Per-level override inside a numbering instance (`w:lvlOverride`). Only
 * `startOverride` is supported: the level restarts at that value when a
 * paragraph first uses the instance.
 */
export type NumberingLevelOverrideSpec = {
  ilvl: number;
  startOverride: number;
};

/**
 * An additional numbering instance (`w:num`) of a definition's abstract
 * numbering. Paragraphs reference it through `list.numId` exactly like the
 * definition's own handle.
 *
 * Every instance of one definition shares a single running sequence in Word
 * and LibreOffice: an instance's `startOverride` restarts that sequence at
 * the given value the first time a paragraph uses the instance, and later
 * paragraphs on any instance of the definition continue from there. So an
 * instance is the way to restart a list ("1, 2" then "1, 2" again), not to
 * interleave two lists that count separately. Each additional instance needs
 * at least one level override; without one it would simply continue the
 * shared sequence, exactly like the definition's own handle.
 */
export type NumberingInstanceSpec = {
  /** Spec-level handle, unique across every definition and instance handle. */
  numId: string;
  levelOverrides: NumberingLevelOverrideSpec[];
};

export type NumberingSpec = {
  /**
   * Spec-level handle of the definition's default instance; the compiler
   * assigns numeric w:numId / abstractNumId. Default instances take numeric
   * ids 1..N in declaration order; additional `instances` follow from N+1.
   * Numeric ids are compile-local: reference lists by these string handles.
   */
  numId: string;
  levels: NumberingLevelSpec[];
  /**
   * Additional instances of the same abstract definition, each restarting
   * the definition's shared sequence (e.g. a second list that starts again
   * at 1). Emitted after every default instance, in declaration order.
   */
  instances?: NumberingInstanceSpec[];
};

export type DraftingNoteSpec = {
  text: string;
  author?: string;
  /** ISO-8601; comment metadata is deterministic, never wall-clock. */
  dateIso?: string;
};
