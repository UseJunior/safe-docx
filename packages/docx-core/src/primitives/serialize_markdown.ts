// DOCX → Markdown serializer.
//
// This is a *serializer over the existing structured document model* — it does no OOXML
// parsing. `DocxDocument.buildDocumentView({ showFormatting: true })` already yields a
// `DocumentViewNode[]` carrying headings, list metadata, grid-aware table context, injected
// `[^n]` footnote markers, and an HTML-shaped inline-tag string (`tagged_text`). This module
// turns that model into GitHub-Flavored Markdown.
//
// Markdown is intentionally *lossy*: there is no round-trip guarantee. Constructs without a
// Markdown equivalent (highlighting, font runs, merged/nested table cells, layout) are
// downgraded as documented below rather than preserved.
//
// The inline tokenizer (`inlineTagsToMarkdown`) is the reusable core; the planned HTML
// emitter (#304) renders the same tokens, so neither serializer reasons about the tag
// grammar independently and drifts from the emitter in `formatting_tags.ts`.

import { tokenizeToonInline } from './document_view.js';
import type { DocumentViewNode } from './document_view.js';
import { LabelType } from './list_labels.js';
import type { Footnote } from './footnotes.js';

/** Footnote markers already injected into `tagged_text`, e.g. `[^1]`, `[^12]`. */
const FOOTNOTE_MARKER_RE = /\[\^\d+\]/g;

/**
 * Backslash-escape the inline Markdown-significant characters that would otherwise be
 * interpreted mid-line. GFM honours backslash escapes for ASCII punctuation, so `\*`
 * renders a literal `*`. We escape only the characters that trigger *inline* constructs
 * (emphasis, code, links, raw HTML, table pipes); block-level triggers (`#`, `-`, `>`, …)
 * are handled per-line by {@link escapeLeadingBlockSyntax} so we don't litter prose with
 * `\.` and `\-` on every sentence.
 *
 * Already-present `[^n]` footnote markers are protected: escaping their `[`/`]`/`^` would
 * sever them from the appended `[^n]: …` definitions.
 */
function escapeInlineText(text: string): string {
  const escapeSpan = (s: string): string => s.replace(/[\\`*_[\]<|]/g, (c) => `\\${c}`);

  let out = '';
  let lastIndex = 0;
  for (const match of text.matchAll(FOOTNOTE_MARKER_RE)) {
    const idx = match.index ?? 0;
    out += escapeSpan(text.slice(lastIndex, idx));
    out += match[0]; // leave the footnote marker untouched
    lastIndex = idx + match[0].length;
  }
  out += escapeSpan(text.slice(lastIndex));
  return out;
}

/**
 * Escape a leading block-level trigger so a normal paragraph whose visible text begins with
 * `#`, `>`, `-`, `+`, `* `, or `N.`/`N)` is not mis-read as a heading, quote, or list.
 * Block triggers always require a trailing space, whereas the emphasis we emit (`**`, `*`)
 * never does — so matching the space-terminated forms cannot corrupt generated Markdown.
 */
function escapeLeadingBlockSyntax(line: string): string {
  return line.replace(/^(\s*)(#{1,6}(?= )|>(?= )|[-+*](?= )|\d+[.)](?= ))/, (_m, ws: string, trig: string) => {
    if (/^\d/.test(trig)) {
      // ordered-list trigger: escape the delimiter (the `.` or `)`), keep the digits
      return `${ws}${trig.slice(0, -1)}\\${trig.slice(-1)}`;
    }
    return `${ws}\\${trig[0]}${trig.slice(1)}`;
  });
}

/**
 * Convert one TOON inline-tag string (a `DocumentViewNode.tagged_text` value) to inline
 * Markdown. This is the reusable core of the serializer.
 *
 * Tag mapping:
 * - `<b>`/`</b>`            → `**`
 * - `<i>`/`</i>`            → `*`
 * - `<u>`/`</u>`            → passed through verbatim (Markdown has no underline; raw `<u>`
 *                             is valid GFM HTML)
 * - `<a href="u">…</a>`     → `[…](u)`
 * - `<highlight>`/`<font …>` → tags stripped, inner text kept (no Markdown equivalent — lossy)
 *
 * Literal text spans are Markdown-escaped; injected `[^n]` footnote markers are preserved.
 */
type InlineOp =
  | { t: 'md'; v: string } // already-final Markdown/raw text (escaped text, links, raw <u>)
  | { t: 'emph'; kind: 'b' | 'i'; dir: 1 | -1 }; // emphasis open (+1) / close (-1)

export function inlineTagsToMarkdown(text: string): string {
  const ops: InlineOp[] = [];
  const linkUrls: string[] = []; // stack of open <a> hrefs (links don't nest meaningfully)

  for (const token of tokenizeToonInline(text)) {
    if (token.kind === 'text') {
      ops.push({ t: 'md', v: escapeInlineText(token.value) });
      continue;
    }
    const tag = token.value;
    if (tag === '<b>') ops.push({ t: 'emph', kind: 'b', dir: 1 });
    else if (tag === '</b>') ops.push({ t: 'emph', kind: 'b', dir: -1 });
    else if (tag === '<i>') ops.push({ t: 'emph', kind: 'i', dir: 1 });
    else if (tag === '</i>') ops.push({ t: 'emph', kind: 'i', dir: -1 });
    else if (tag === '<u>' || tag === '</u>') ops.push({ t: 'md', v: tag }); // raw HTML passthrough
    else if (tag.startsWith('<a ')) {
      linkUrls.push(/href="([^"]*)"/.exec(tag)?.[1] ?? '');
      ops.push({ t: 'md', v: '[' });
    } else if (tag === '</a>') {
      ops.push({ t: 'md', v: `](${linkUrls.pop() ?? ''})` });
    }
    // <highlight>, </highlight>, <font …>, </font> → strip (emit nothing, keep inner text)
  }

  // Defensive: an unbalanced <a> (no closing tag) would leave a dangling "["; close it.
  while (linkUrls.length > 0) {
    ops.push({ t: 'md', v: `](${linkUrls.pop()})` });
  }

  // Collapse redundant *adjacent* emphasis toggles (nothing between them). Word splits a
  // single formatted phrase into multiple runs, so `tagged_text` often holds
  // `</b></i><b><i>` or empty `<b></b>` pairs. Mapped naively these become `******` or
  // `****`, which render as literal asterisks. Removing the adjacent close→open (and empty
  // open→close) pairs re-fuses the phrase into one clean emphasis span.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < ops.length - 1; i++) {
      const a = ops[i]!;
      const b = ops[i + 1]!;
      if (a.t === 'emph' && b.t === 'emph' && a.kind === b.kind && a.dir === -b.dir) {
        ops.splice(i, 2);
        changed = true;
        break;
      }
    }
  }

  let out = '';
  for (const op of ops) {
    out += op.t === 'md' ? op.v : op.kind === 'b' ? '**' : '*';
  }
  return out;
}

/** A heading is structural (gets `#`) only when Word's style told us so and gave a level. */
function isStructuralHeading(node: DocumentViewNode): boolean {
  return node.heading?.source === 'word_style' && typeof node.heading.level === 'number';
}

function renderListItem(node: DocumentViewNode): string {
  const lm = node.list_metadata;
  const level = Math.max(0, lm.list_level);
  const indent = '  '.repeat(level);
  const text = inlineTagsToMarkdown(node.tagged_text).trim();
  const label = lm.label_string?.trim() ?? '';

  // True auto-numbered numeric lists render as a Markdown ordered list (let the renderer
  // number them). Everything else preserves the *literal* label — legal documents carry
  // meaningful labels like `Section 2.1`, `Article IV`, `(a)`, `(i)` that a bare `1.` would
  // silently destroy.
  if (lm.label_type === LabelType.NUMBER && lm.is_auto_numbered) {
    return `${indent}1. ${text}`.trimEnd();
  }
  if (label) {
    return `${indent}- ${label} ${text}`.trimEnd();
  }
  return `${indent}- ${text}`.trimEnd();
}

/**
 * Render a run of nodes that share a `table_context.table_id` as a GFM table.
 *
 * Lossy by design (GFM has no merged/nested-cell support):
 * - Horizontally merged cells (`gridSpan`) advance `col_index`, leaving grid gaps that we
 *   fill with empty cells so the column count stays consistent and viewers don't break.
 * - Vertically merged cells (`vMerge`) and nested tables are flattened into the body-level
 *   grid; multi-paragraph cells are joined with `<br>`.
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
  const headerRows = new Set<number>();

  for (const n of group) {
    const tc = n.table_context;
    if (!tc) continue;
    if (!rows.has(tc.row_index)) {
      rows.set(tc.row_index, new Map());
      rowOrder.push(tc.row_index);
    }
    const cellMap = rows.get(tc.row_index)!;
    // A raw newline inside a cell (from a line break) would split the GFM table row and
    // break the whole table, so collapse intra-cell newlines to `<br>`.
    const cellText = inlineTagsToMarkdown(n.tagged_text).replace(/\s*\n+\s*/g, '<br>').trim();
    const parts = cellMap.get(tc.col_index) ?? [];
    if (cellText) parts.push(cellText);
    cellMap.set(tc.col_index, parts);
    if (tc.is_header_row) headerRows.add(tc.row_index);
  }

  rowOrder.sort((a, b) => a - b);
  if (rowOrder.length === 0) return [];

  const cellsFor = (rowIndex: number): string[] => {
    const cellMap = rows.get(rowIndex) ?? new Map<number, string[]>();
    const cells: string[] = [];
    for (let c = 0; c < totalCols; c++) {
      cells.push((cellMap.get(c) ?? []).join('<br>'));
    }
    return cells;
  };

  // GFM requires exactly one header row. Prefer the first row Word flagged as a header;
  // otherwise treat the first row as the header (the common case).
  const headerRowIndex = rowOrder.find((ri) => headerRows.has(ri)) ?? rowOrder[0]!;

  const lines: string[] = [];
  lines.push(`| ${cellsFor(headerRowIndex).join(' | ')} |`);
  lines.push(`| ${Array.from({ length: totalCols }, () => '---').join(' | ')} |`);
  for (const ri of rowOrder) {
    if (ri === headerRowIndex) continue;
    lines.push(`| ${cellsFor(ri).join(' | ')} |`);
  }
  return lines;
}

export interface SerializeMarkdownOptions {
  /** Reserved for future knobs (heading promotion, table policy). Currently unused. */
  readonly _reserved?: never;
}

/**
 * Serialize a structured document view to GitHub-Flavored Markdown.
 *
 * @param nodes     Block nodes from `buildDocumentView({ showFormatting: true }).nodes`.
 * @param footnotes Footnotes from `DocxDocument.getFootnotes()` (already sorted by
 *                  `displayNumber`); appended as `[^n]: …` definitions.
 */
export function serializeToMarkdown(
  nodes: DocumentViewNode[],
  footnotes: Footnote[] = [],
  _opts: SerializeMarkdownOptions = {},
): string {
  const blocks: string[] = [];
  let inList = false;

  const closeList = (): void => {
    if (inList) {
      blocks.push('');
      inList = false;
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    // ── Tables: consume the whole run of same-table_id nodes at once ──
    if (node.table_context) {
      closeList();
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

    // ── Structural (Word-styled) headings ──
    if (isStructuralHeading(node)) {
      closeList();
      const level = Math.min(6, Math.max(1, node.heading!.level as number));
      const text = inlineTagsToMarkdown(node.tagged_text).trim();
      blocks.push(`${'#'.repeat(level)} ${text}`.trimEnd());
      blocks.push('');
      continue;
    }

    // ── List items ──
    if (node.list_metadata.list_level >= 0) {
      inList = true;
      blocks.push(renderListItem(node));
      continue;
    }

    // ── Normal paragraphs (heuristic headings land here: their run-in bold already lives
    //     in the inline tags, so we keep them as paragraphs rather than inventing a `#`). ──
    closeList();
    const text = escapeLeadingBlockSyntax(inlineTagsToMarkdown(node.tagged_text));
    if (text.trim() === '') {
      blocks.push('');
    } else {
      blocks.push(text);
      blocks.push('');
    }
  }

  closeList();

  // ── Footnote definitions ──
  const defs = footnotes.filter((fn) => fn.displayNumber > 0);
  if (defs.length > 0) {
    blocks.push('');
    for (const fn of defs) {
      const body = escapeInlineText(fn.text.replace(/\s+/g, ' ').trim());
      blocks.push(`[^${fn.displayNumber}]: ${body}`);
    }
  }

  return `${blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
