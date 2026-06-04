import { collectInlineCommentMarkers, countVisibleTextCharacters, injectToonCommentMarkers } from './document_view-comments.js';
import { computeFingerprintToken } from './document_view-styles.js';
import type { DocumentViewComment, DocumentViewNode, ToonCommentMarkerMap } from './document_view-types.js';

function headerStripFromText(params: { header: string; text: string }): string {
  // Mirrors Python TOONRenderer header stripping.
  const { header } = params;
  let { text } = params;
  if (!header) return text;

  const headerNorm = header.trim().toLowerCase();
  const textLower = text.toLowerCase();

  for (const punct of [':', '.', '-', ';', ''] as const) {
    const testPrefix = `${headerNorm}${punct}`;
    if (textLower.startsWith(testPrefix)) {
      text = text.slice(testPrefix.length).trimStart();
      return text;
    }
  }

  if (text.startsWith(header)) {
    text = text.slice(header.length).replace(/^[.:\-;]+/, '').trimStart();
  }
  return text;
}

/**
 * Format a single toon data line for one DocumentViewNode.
 * Handles table-context-aware style (th/td) and header stripping.
 */
export function formatToonDataLine(
  n: DocumentViewNode,
  options?: { compact?: boolean; commentMarkers?: ToonCommentMarkerMap },
): string {
  let text = n.tagged_text;
  let header = n.header;
  let strippedPrefixVisibleLength = 0;

  if (header) {
    const strippedText = headerStripFromText({ header, text });
    strippedPrefixVisibleLength = Math.max(
      0,
      countVisibleTextCharacters(text) - countVisibleTextCharacters(strippedText),
    );
    text = strippedText;
  }
  if (header && !text) {
    text = header;
    header = '';
    strippedPrefixVisibleLength = 0;
  }

  const commentMarkers = options?.commentMarkers?.get(n.id);
  if (commentMarkers && commentMarkers.length > 0) {
    // Comment marker offsets are computed against the FULL paragraph visible text (raw
    // run/char counting in `getComments()`). To translate to `tagged_text` positions we
    // subtract:
    //  1. `visible_offset_correction` — chars stripped at build time when extracting the
    //     manual list label and trimming following whitespace.
    //  2. `strippedPrefixVisibleLength` — chars stripped at format time by the run-in-header
    //     extraction above.
    const totalCorrection = (n.visible_offset_correction ?? 0) + strippedPrefixVisibleLength;
    text = injectToonCommentMarkers(
      text,
      commentMarkers.map(({ offset, marker }) => ({
        offset: Math.max(0, offset - totalCorrection),
        marker,
      })),
    );
  }

  const tc = n.table_context;
  let style: string;
  if (tc) {
    style = tc.is_header_row
      ? `th(${tc.row_index},${tc.col_index})`
      : `td(${tc.row_index},${tc.col_index})`;
  } else {
    style = options?.compact
      ? computeFingerprintToken(n.style_fingerprint, n.style)
      : n.style;
  }
  return `${n.id} | ${n.list_label} | ${header} | ${style} | ${text}`;
}

/**
 * Collect table marker info (dimensions) from nodes for #TABLE markers.
 * Column headers are NOT included in the marker — they appear once in the th() rows.
 */
export function collectTableMarkerInfo(
  nodes: readonly Pick<DocumentViewNode, 'table_context'>[],
): Map<number, { id: string; totalRows: number; totalCols: number }> {
  const info = new Map<number, { id: string; totalRows: number; totalCols: number }>();
  for (const n of nodes) {
    const tc = n.table_context;
    if (!tc) continue;
    if (!info.has(tc.table_index)) {
      info.set(tc.table_index, {
        id: tc.table_id,
        totalRows: tc.total_rows,
        totalCols: tc.total_cols,
      });
    }
  }
  return info;
}

/**
 * Format a #TABLE marker line from collected table info.
 * Headers are omitted — they appear exactly once in the th(0,N) data rows.
 */
export function formatTableMarker(info: { id: string; totalRows: number; totalCols: number }): string {
  return `#TABLE ${info.id} | ${info.totalRows} rows × ${info.totalCols} cols`;
}

function escapeToonCommentField(value: string): string {
  return value
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('|', '\\|');
}

function formatCommentDate(date: string | null): string {
  return date ?? '-';
}

function collectToonCommentLines(
  comment: DocumentViewComment,
  paragraphId: string,
  parentId?: number,
): string[] {
  const author = escapeToonCommentField(comment.author || '-');
  const date = formatCommentDate(comment.date);
  const text = escapeToonCommentField(comment.text);
  const line = parentId == null
    ? `#COMMENT ${paragraphId} c${comment.id} ${author} ${date} | ${text}`
    : `#REPLY c${comment.id} -> c${parentId} ${author} ${date} | ${text}`;

  return [
    line,
    ...comment.replies.flatMap((reply) => collectToonCommentLines(reply, paragraphId, comment.id)),
  ];
}

export function formatToonCommentLines(node: Pick<DocumentViewNode, 'id' | 'comments'>): string[] {
  return node.comments?.flatMap((comment) => collectToonCommentLines(comment, node.id)) ?? [];
}

function collectToonCommentEndnoteLines(
  comment: DocumentViewComment,
  paragraphId: string,
  parentId?: number,
): string[] {
  const author = escapeToonCommentField(comment.author || '-');
  const date = formatCommentDate(comment.date);
  const text = escapeToonCommentField(comment.text);
  const line = parentId == null
    ? `c${comment.id} @ ${paragraphId} ${author} ${date} | ${text}`
    : `c${comment.id} -> c${parentId} ${author} ${date} | ${text}`;

  return [
    line,
    ...comment.replies.flatMap((reply) => collectToonCommentEndnoteLines(reply, paragraphId, comment.id)),
  ];
}

export function formatToonCommentEndnoteLines(node: Pick<DocumentViewNode, 'id' | 'comments'>): string[] {
  return node.comments?.flatMap((comment) => collectToonCommentEndnoteLines(comment, node.id)) ?? [];
}

export function formatToonCommentsEndnotesBlock(
  nodes: readonly Pick<DocumentViewNode, 'id' | 'comments'>[],
): string[] {
  const commentLines = nodes.flatMap((node) => formatToonCommentEndnoteLines(node));
  return commentLines.length > 0
    ? ['#COMMENTS', ...commentLines]
    : [];
}

export function renderToon(nodes: DocumentViewNode[], options: { compact?: boolean } = {}): string {
  const lines: string[] = ['#SCHEMA id | list_label | header | style | text'];
  const commentMarkers = collectInlineCommentMarkers(nodes);
  const lineOptions = { ...options, commentMarkers };

  // Pre-scan: collect table marker info for #TABLE lines
  const tableInfo = collectTableMarkerInfo(nodes);

  let currentTableIndex: number | null = null;

  for (const n of nodes) {
    const tc = n.table_context;
    const nodeTableIndex = tc ? tc.table_index : null;

    // Close previous table if we left it or moved to a different table
    if (currentTableIndex !== null && nodeTableIndex !== currentTableIndex) {
      lines.push('#END_TABLE');
      currentTableIndex = null;
    }

    // Open new table if entering one
    if (nodeTableIndex !== null && currentTableIndex === null) {
      const info = tableInfo.get(nodeTableIndex);
      if (info) lines.push(formatTableMarker(info));
      currentTableIndex = nodeTableIndex;
    }

    lines.push(formatToonDataLine(n, lineOptions));
    lines.push(...formatToonCommentLines(n));
  }

  // Close any open table at end
  if (currentTableIndex !== null) {
    lines.push('#END_TABLE');
  }

  return lines.join('\n');
}

export function renderToonWithCommentEndnotes(
  nodes: DocumentViewNode[],
  options: { compact?: boolean } = {},
): string {
  const lines: string[] = ['#SCHEMA id | list_label | header | style | text'];
  const tableInfo = collectTableMarkerInfo(nodes);

  let currentTableIndex: number | null = null;

  for (const n of nodes) {
    const tc = n.table_context;
    const nodeTableIndex = tc ? tc.table_index : null;

    if (currentTableIndex !== null && nodeTableIndex !== currentTableIndex) {
      lines.push('#END_TABLE');
      currentTableIndex = null;
    }

    if (nodeTableIndex !== null && currentTableIndex === null) {
      const info = tableInfo.get(nodeTableIndex);
      if (info) lines.push(formatTableMarker(info));
      currentTableIndex = nodeTableIndex;
    }

    lines.push(formatToonDataLine(n, options));
  }

  if (currentTableIndex !== null) {
    lines.push('#END_TABLE');
  }

  lines.push(...formatToonCommentsEndnotesBlock(nodes));

  return lines.join('\n');
}
