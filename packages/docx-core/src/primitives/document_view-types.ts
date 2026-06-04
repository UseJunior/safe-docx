import type { LabelType } from './list_labels.js';
import type { ParagraphAlignment, RunFormatting } from './styles.js';

export type HeaderFormatting = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

export type HeadingSource =
  | 'word_style'
  | 'run_in_header'
  | 'title_with_period'
  | 'title_with_colon'
  | 'title_caps_centered'
  | 'title_bare';

export type HeuristicHeadingSource = Exclude<HeadingSource, 'word_style'>;

export type HeadingValue = {
  /**
   * Heading label text. Semantics depend on `source`:
   * - `word_style`: the full paragraph text (the entire paragraph IS the heading).
   * - All heuristic sources (`run_in_header`, `title_with_period`, `title_with_colon`,
   *   `title_caps_centered`, `title_bare`): only the extracted heading prefix.
   *   For example, on `"Indemnification. The Company shall …"` the value is
   *   `"Indemnification"`, not the whole paragraph.
   */
  text: string;
  source: HeadingSource;
  level: number | null;
};

export type FormattingFingerprint = {
  list_level: number;
  left_indent_pt: number;
  first_line_indent_pt: number;
  style_name: string;
  alignment: ParagraphAlignment;
};

export type DocumentStyleInfo = {
  style_id: string;
  display_name: string;
  fingerprint: FormattingFingerprint;
  example_node_id: string;
  example_text: string;
  count: number;
  dominant_alignment: ParagraphAlignment;
};

export type DocumentStyles = {
  styles: Map<string, DocumentStyleInfo>;
  fingerprint_to_style: Map<string, string>; // fingerprintKey -> style_id
};

export type DocumentViewCommentRange = {
  startParagraphId: string;
  endParagraphId: string;
  startRunIndex?: number;
  startCharOffset?: number;
  endRunIndex?: number;
  endCharOffset?: number;
};

export type DocumentViewComment = {
  id: number;
  author: string;
  date: string | null;
  initials: string;
  text: string;
  replies: DocumentViewComment[];
  range?: DocumentViewCommentRange;
};

export type ToonCommentMarker = {
  offset: number;
  marker: string;
};

export type ToonCommentMarkerMap = Map<string, ToonCommentMarker[]>;

/** A single token produced by {@link tokenizeToonInline}. */
export type ToonInlineToken =
  | { kind: 'tag'; value: string }
  | { kind: 'text'; value: string };

export type ListMetadata = {
  list_level: number; // -1 for non-list
  label_type: LabelType | null;
  label_string: string;
  header_text: string | null;
  header_style: HeuristicHeadingSource | null;
  header_formatting: HeaderFormatting | null;
  is_auto_numbered: boolean;
};

export type TableContext = {
  table_id: string;         // "_tbl_0", "_tbl_1" — body-level table index
  table_index: number;      // 0-based among body-level w:tbl elements
  row_index: number;        // 0-based row within table (by w:tr position)
  col_index: number;        // Grid-aware column (accounts for gridSpan)
  col_header: string;       // Header text for this grid column (from row 0)
  total_rows: number;
  total_cols: number;       // Max grid columns (accounts for gridSpan)
  is_header_row: boolean;
  para_in_cell: number;     // 0-based paragraph index within cell
  cell_para_count: number;  // Total paragraphs in this cell
};

export type DocumentViewNode = {
  id: string; // _bk_*
  list_label: string;
  header: string;
  style: string;
  text: string;

  // Metadata for JSON mode / parity tooling.
  clean_text: string;
  tagged_text: string;
  list_metadata: ListMetadata;
  style_fingerprint: FormattingFingerprint;
  paragraph_style_id: string | null;
  paragraph_style_name: string;
  paragraph_alignment: ParagraphAlignment;
  paragraph_indents_pt: { left: number; first_line: number };
  numbering: { num_id: string | null; ilvl: number | null; is_auto_numbered: boolean };
  heading?: HeadingValue;
  header_formatting: HeaderFormatting | null;
  body_run_formatting: RunFormatting | null;
  table_context?: TableContext;
  comments?: DocumentViewComment[];
  /**
   * Number of visible characters stripped from the head of the raw paragraph text when
   * extracting a manual list label (and trimming the trailing whitespace). Used by the
   * inline-comment-marker injector to translate run/offset positions (which are computed
   * against the FULL paragraph visible text by `getComments()`) into positions within
   * `tagged_text` (which has the label stripped).
   *
   * Auto-numbered list paragraphs do NOT have their text stripped — their label lives in
   * the `list_label` field separately — so this stays 0 for them. Run-in header stripping
   * is handled separately at format time and is not included here.
   */
  visible_offset_correction?: number;
};

export type BuildDocumentViewOptions = {
  include_semantic_tags?: boolean;
};
