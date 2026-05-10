import type { CachedParagraph } from './types.js';

type HeadingSource =
  | 'word_style'
  | 'run_in_header'
  | 'title_with_period'
  | 'title_with_colon'
  | 'title_caps_centered'
  | 'title_bare';

type HeadingValue = {
  text: string;
  source: HeadingSource;
  level: number | null;
};

function normalizeParagraphStyleId(rawStyleId: string | null | undefined): string | null {
  if (!rawStyleId) return null;
  const gdocsMatch = /^HEADING_([1-6])$/.exec(rawStyleId);
  if (gdocsMatch) return `Heading${gdocsMatch[1]}`;
  return /^Heading([1-6])$/.test(rawStyleId) ? rawStyleId : null;
}

function deriveHeading(paragraphStyleId: string | null, text: string): HeadingValue | undefined {
  const styleMatch = paragraphStyleId ? /^Heading([1-6])$/.exec(paragraphStyleId) : null;
  if (!styleMatch) return undefined;
  return {
    text,
    source: 'word_style',
    level: Number.parseInt(styleMatch[1]!, 10),
  };
}

/**
 * DocumentViewNode for Google Docs output.
 * Same shape as the DOCX DocumentViewNode to ensure schema compatibility.
 */
export type DocumentViewNodeGdocs = {
  id: string;
  list_label: string;
  header: string;
  style: string;
  text: string;
  clean_text: string;
  tagged_text: string;
  list_metadata: {
    list_level: number;
    label_type: string | null;
    label_string: string;
    header_text: string | null;
    header_style: string | null;
    header_formatting: { bold: boolean; italic: boolean; underline: boolean } | null;
    is_auto_numbered: boolean;
  };
  style_fingerprint: {
    list_level: number;
    left_indent_pt: number;
    first_line_indent_pt: number;
    style_name: string;
    alignment: string;
  };
  paragraph_style_id: string | null;
  paragraph_style_name: string;
  paragraph_alignment: string;
  paragraph_indents_pt: { left: number; first_line: number };
  numbering: { num_id: string | null; ilvl: number | null; is_auto_numbered: boolean };
  heading?: HeadingValue;
  header_formatting: { bold: boolean; italic: boolean; underline: boolean } | null;
  body_run_formatting: Record<string, unknown> | null;
  table_context?: {
    table_id: string;
    table_index: number;
    row_index: number;
    col_index: number;
    col_header: string;
    total_rows: number;
    total_cols: number;
    is_header_row: boolean;
    para_in_cell: number;
    cell_para_count: number;
  };
};

/** Build DocumentViewNode array from cached paragraphs */
export function buildDocumentViewNodes(paragraphs: CachedParagraph[]): DocumentViewNodeGdocs[] {
  return paragraphs.map((para) => {
    const rowIndex = para.tableMetadata?.rowIndex ?? 0;
    const colIndex = para.tableMetadata?.colIndex ?? 0;
    const isHeaderRow = para.tableMetadata?.isHeaderRow ?? false;

    const style = para.inTable
      ? (isHeaderRow
        ? `th(${rowIndex},${colIndex})`
        : `td(${rowIndex},${colIndex})`)
      : 'body';
    const paragraphStyleId = normalizeParagraphStyleId(para.paragraphId);
    const paragraphStyleName = paragraphStyleId ?? 'body';
    const heading = deriveHeading(paragraphStyleId, para.text);

    const node: DocumentViewNodeGdocs = {
      id: para.anchorId || para.anchorName || `para_${para.startIndex}`,
      list_label: '',
      header: '',
      style,
      text: para.text,
      clean_text: para.text,
      tagged_text: para.text,
      list_metadata: {
        list_level: -1,
        label_type: null,
        label_string: '',
        header_text: null,
        header_style: null,
        header_formatting: null,
        is_auto_numbered: false,
      },
      style_fingerprint: {
        list_level: -1,
        left_indent_pt: 0,
        first_line_indent_pt: 0,
        style_name: paragraphStyleName,
        alignment: 'LEFT',
      },
      paragraph_style_id: paragraphStyleId,
      paragraph_style_name: paragraphStyleName,
      paragraph_alignment: 'LEFT',
      paragraph_indents_pt: { left: 0, first_line: 0 },
      numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
      header_formatting: null,
      body_run_formatting: null,
    };
    if (heading) node.heading = heading;

    if (para.tableMetadata) {
      node.table_context = {
        table_id: para.tableMetadata.tableId,
        table_index: para.tableMetadata.tableIndex,
        row_index: para.tableMetadata.rowIndex,
        col_index: para.tableMetadata.colIndex,
        col_header: para.tableMetadata.colHeader,
        total_rows: para.tableMetadata.totalRows,
        total_cols: para.tableMetadata.totalCols,
        is_header_row: para.tableMetadata.isHeaderRow,
        para_in_cell: para.tableMetadata.paraInCell,
        cell_para_count: para.tableMetadata.cellParaCount,
      };
    }

    return node;
  });
}
