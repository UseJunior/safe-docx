// DOCX → plain text serializer.
//
// The thinnest member of the export family. Like `serialize_markdown.ts`, this is a
// *serializer over the existing structured document model* — it does no OOXML parsing.
// `DocxDocument.buildDocumentView({ showFormatting: true })` already yields a
// `DocumentViewNode[]` carrying headings, list metadata, grid-aware table context, injected
// `[^n]` footnote markers, and an HTML-shaped inline-tag string (`tagged_text`). This module
// turns that model into plain text with no markup.
//
// Where the Markdown emitter *maps* inline tags to Markdown syntax, the plain-text emitter
// *strips* them (via `stripAllInlineTags`) and keeps only sensible block separators:
//   - a blank line between block-level paragraphs (including headings),
//   - simple `- ` list bullets (preserving literal legal labels like `Section 2.1`),
//   - tab-separated table cells, one row per line,
//   - injected `[^n]` footnote markers kept inline, definitions appended at the end.
//
// Plain text is intentionally *lossy*: all formatting (bold/italic/underline, highlight,
// fonts, links, merged/nested table cells, layout) is discarded — that is the whole point of
// a "just give me the text" rendering.

import type { DocumentViewNode } from './document_view.js';
import { stripAllInlineTags } from './semantic_tags.js';
import type { Footnote } from './footnotes.js';

/** Convert one `tagged_text` value to plain text: strip all inline/semantic tags, keep text. */
function toPlainInline(text: string): string {
  return stripAllInlineTags(text);
}

/**
 * Render a list item as a simple bullet. Auto-numbered numeric items and unlabeled items get
 * a bare `- ` bullet; items carrying a literal label (legal documents use meaningful labels
 * like `Section 2.1`, `Article IV`, `(a)`, `(i)`) keep that label so it isn't silently lost.
 * Indentation tracks the list level.
 */
function renderListItem(node: DocumentViewNode): string {
  const lm = node.list_metadata;
  const level = Math.max(0, lm.list_level);
  const indent = '  '.repeat(level);
  const text = toPlainInline(node.tagged_text).trim();
  const label = lm.label_string?.trim() ?? '';
  if (label) {
    return `${indent}- ${label} ${text}`.trimEnd();
  }
  return `${indent}- ${text}`.trimEnd();
}

/**
 * Render a run of nodes sharing a `table_context.table_id` as tab-separated rows.
 *
 * Lossy by design (plain text has no table model):
 * - Horizontally merged cells (`gridSpan`) leave grid gaps; we fill them with empty fields so
 *   every row keeps the same tab-delimited column count (a row `X<gap>Z` → `X\t\tZ`).
 * - Vertically merged cells (`vMerge`) and nested tables are flattened into the body grid.
 * - Multi-paragraph / multi-node cells and intra-cell line breaks are joined with a space
 *   (a raw newline would split the tab-delimited row).
 */
function renderTable(group: DocumentViewNode[]): string[] {
  let totalCols = 0;
  for (const n of group) {
    const tc = n.table_context;
    if (!tc) continue;
    totalCols = Math.max(totalCols, tc.total_cols, tc.col_index + 1);
  }
  if (totalCols <= 0) return [];

  const rows = new Map<number, Map<number, string[]>>();
  const rowOrder: number[] = [];

  for (const n of group) {
    const tc = n.table_context;
    if (!tc) continue;
    if (!rows.has(tc.row_index)) {
      rows.set(tc.row_index, new Map());
      rowOrder.push(tc.row_index);
    }
    const cellMap = rows.get(tc.row_index)!;
    const cellText = toPlainInline(n.tagged_text).replace(/\s*\n+\s*/g, ' ').trim();
    const parts = cellMap.get(tc.col_index) ?? [];
    if (cellText) parts.push(cellText);
    cellMap.set(tc.col_index, parts);
  }

  rowOrder.sort((a, b) => a - b);

  const lines: string[] = [];
  for (const ri of rowOrder) {
    const cellMap = rows.get(ri) ?? new Map<number, string[]>();
    const cells: string[] = [];
    for (let c = 0; c < totalCols; c++) {
      cells.push((cellMap.get(c) ?? []).join(' '));
    }
    lines.push(cells.join('\t'));
  }
  return lines;
}

export interface SerializePlainTextOptions {
  /** Reserved for future knobs (footnote policy, table layout). Currently unused. */
  readonly _reserved?: never;
}

/**
 * Serialize a structured document view to plain text.
 *
 * @param nodes     Block nodes from `buildDocumentView({ showFormatting: true }).nodes`.
 * @param footnotes Footnotes from `DocxDocument.getFootnotes()` (already sorted by
 *                  `displayNumber`); appended as `[^n] …` definitions.
 */
export function serializeToPlainText(
  nodes: DocumentViewNode[],
  footnotes: Footnote[] = [],
  _opts: SerializePlainTextOptions = {},
): string {
  const blocks: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    // ── Tables: consume the whole run of same-table_id nodes at once ──
    if (node.table_context) {
      const tableId = node.table_context.table_id;
      const group: DocumentViewNode[] = [];
      while (i < nodes.length && nodes[i]!.table_context?.table_id === tableId) {
        group.push(nodes[i]!);
        i++;
      }
      i--; // for-loop will re-increment
      const tableLines = renderTable(group);
      if (tableLines.length > 0) {
        blocks.push(tableLines.join('\n'));
        blocks.push('');
      }
      continue;
    }

    // ── List items: a bullet per item, no surrounding blank lines ──
    if (node.list_metadata.list_level >= 0) {
      blocks.push(renderListItem(node));
      continue;
    }

    // ── Headings and normal paragraphs alike: plain text, blank line between blocks ──
    // Plain text has no heading syntax, so a Word-styled heading is just its text.
    const text = toPlainInline(node.tagged_text).trim();
    if (text === '') {
      blocks.push('');
    } else {
      blocks.push(text);
      blocks.push('');
    }
  }

  // ── Footnote definitions ──
  const defs = footnotes.filter((fn) => fn.displayNumber > 0);
  if (defs.length > 0) {
    blocks.push('');
    for (const fn of defs) {
      const body = fn.text.replace(/\s+/g, ' ').trim();
      blocks.push(`[^${fn.displayNumber}] ${body}`.trimEnd());
    }
  }

  // Trim only blank *lines* at the document boundary — not all whitespace. A plain `.trim()`
  // would eat a leading/trailing tab that is a meaningful empty TSV field when the document
  // starts or ends with a table whose boundary cell is empty (e.g. a row `\tZ`), breaking the
  // "every row keeps the same column count" contract.
  const rendered = blocks
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  return `${rendered}\n`;
}
