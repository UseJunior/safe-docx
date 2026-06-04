// DOCX → HTML serializer (semantic tier, mammoth.js-style).
//
// Like `serialize_markdown.ts`, this is a *serializer over the existing structured document
// model* — it does no OOXML parsing. `DocxDocument.buildDocumentView({ showFormatting: true })`
// already yields a `DocumentViewNode[]` carrying headings, list metadata, grid-aware table
// context, injected `[^n]` footnote markers, and an HTML-shaped inline-tag string
// (`tagged_text`). This module turns that model into semantic HTML.
//
// It renders the *same* inline tokens as the Markdown emitter via the shared
// `tokenizeToonInline` core, so the two serializers never re-derive the tag grammar and drift
// from the emitter in `formatting_tags.ts`. Where Markdown is lossy, HTML is richer: highlight
// becomes `<mark>`, font runs become a styled `<span>`, and lists nest as real `<ul>/<ol>`.
//
// This is the *semantic* tier, not pixel-faithful HTML+CSS: exact layout is not reproduced.

import { tokenizeToonInline } from './document_view.js';
import type { DocumentViewNode } from './document_view.js';
import { escapeHtmlAttribute } from './formatting_tags.js';
import type { Footnote } from './footnotes.js';

/** Footnote markers already injected into `tagged_text`, e.g. `[^1]`, `[^12]`. */
const FOOTNOTE_MARKER_RE = /\[\^(\d+)\]/g;

/**
 * Tracks which footnote numbers were actually rendered as markers in the body, and how many
 * times each appeared. Used to (a) give repeated markers unique element ids and (b) emit a
 * back-link from a definition only when its marker was really rendered (no dangling `#fnref-n`).
 */
type FootnoteRefs = Map<number, number>;

/** Escape the characters that are significant in HTML *text* content. */
function escapeHtmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Escape literal text and turn any injected `[^n]` footnote marker into a trusted superscript
 * anchor. Order matters: the literal spans are escaped, but the generated `<sup>` is emitted
 * verbatim (escaping it would render the markup literally).
 *
 * When a `refs` registry is supplied, the first marker for footnote N keeps `id="fnref-N"` (the
 * definition's back-link target); later repeats get a unique `id="fnref-N-k"` so the document
 * never carries duplicate ids.
 */
function renderTextWithFootnotes(raw: string, refs?: FootnoteRefs): string {
  let out = '';
  let last = 0;
  for (const match of raw.matchAll(FOOTNOTE_MARKER_RE)) {
    const idx = match.index ?? 0;
    out += escapeHtmlText(raw.slice(last, idx));
    const n = match[1]!;
    let id = `fnref-${n}`;
    if (refs) {
      const k = (refs.get(Number(n)) ?? 0) + 1;
      refs.set(Number(n), k);
      if (k > 1) id = `fnref-${n}-${k}`;
    }
    out += `<sup id="${id}"><a href="#fn-${n}">${n}</a></sup>`;
    last = idx + match[0].length;
  }
  out += escapeHtmlText(raw.slice(last));
  return out;
}

/**
 * Allow only schemes that are safe to follow from a rendered document. The href arrives already
 * attribute-escaped from `formatting_tags.ts`; a `javascript:`/`data:`/`vbscript:` URL would
 * otherwise pass through and execute on click. Relative URLs and fragments (no scheme) are kept.
 */
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
function isSafeHref(href: string): boolean {
  // Strip whitespace/control chars browsers ignore (e.g. `java\tscript:`) before scheme-matching.
  const v = href.replace(/[\u0000-\u0020]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(v);
  return scheme ? SAFE_URL_SCHEMES.has(scheme[1]!) : true;
}

// ── Font (`<font ...>`) → sanitized inline style ─────────────────────────────
// The values come from `formatting_tags.ts`: color is a raw hex string (no `#`), size is in
// *points* (display units), face is a font name. Every value is sanitized so a hostile font
// name cannot break out of the `style` attribute.

function sanitizeColor(raw: string | undefined): string | null {
  if (!raw) return null;
  const hex = raw.replace(/^#/, '');
  return /^[0-9A-Fa-f]{3,8}$/.test(hex) ? `#${hex}` : null;
}

function sanitizeFontSize(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? `${n}pt` : null;
}

function sanitizeFontFamily(raw: string | undefined): string | null {
  if (!raw) return null;
  // Strip anything that could terminate the value or the attribute; keep ordinary name chars.
  const clean = raw.replace(/[<>"';{}()]/g, '').trim();
  return clean ? `'${clean}'` : null;
}

function fontTagToSpan(tag: string): string {
  const color = sanitizeColor(/color="([^"]*)"/.exec(tag)?.[1]);
  const size = sanitizeFontSize(/size="([^"]*)"/.exec(tag)?.[1]);
  const face = sanitizeFontFamily(/face="([^"]*)"/.exec(tag)?.[1]);
  const decls: string[] = [];
  if (color) decls.push(`color:${color}`);
  if (size) decls.push(`font-size:${size}`);
  if (face) decls.push(`font-family:${face}`);
  // A `<font>` with no usable attribute degrades to a bare span (still balances `</font>`).
  if (decls.length === 0) return '<span>';
  return `<span style="${escapeHtmlAttribute(decls.join(';'))}">`;
}

/**
 * Convert one TOON inline-tag string (a `DocumentViewNode.tagged_text` value) to inline HTML.
 * This is the HTML parallel of `inlineTagsToMarkdown` and the reusable core of the serializer.
 *
 * Tag mapping:
 * - `<b>`/`<i>`/`<u>`/`<a href="...">` → passed through verbatim (already valid, attribute-escaped HTML)
 * - `<highlight>`                       → `<mark>`
 * - `<font color=… size=… face=…>`      → `<span style="…">` (values sanitized)
 *
 * Literal text spans are HTML-escaped; injected `[^n]` footnote markers become `<sup>` anchors.
 */
export function inlineTagsToHtml(text: string, refs?: FootnoteRefs): string {
  let out = '';
  for (const token of tokenizeToonInline(text)) {
    if (token.kind === 'text') {
      out += renderTextWithFootnotes(token.value, refs);
      continue;
    }
    const tag = token.value;
    if (tag === '<highlight>') out += '<mark>';
    else if (tag === '</highlight>') out += '</mark>';
    else if (tag.startsWith('<font ')) out += fontTagToSpan(tag);
    else if (tag === '</font>') out += '</span>';
    else if (tag.startsWith('<a ')) {
      // Drop the href for unsafe schemes (e.g. `javascript:`); keep the anchor so `</a>` still
      // balances and the link text survives as plain text.
      const href = /href="([^"]*)"/.exec(tag)?.[1] ?? '';
      out += isSafeHref(href) ? tag : '<a>';
    }
    // <b>/<i>/<u> and `</a>` and the closers are already valid HTML — pass through.
    else out += tag;
  }
  return out;
}

/** A heading is structural (gets `<hN>`) only when Word's style told us so and gave a level. */
function isStructuralHeading(node: DocumentViewNode): boolean {
  return node.heading?.source === 'word_style' && typeof node.heading.level === 'number';
}

/**
 * Render a run of nodes that share a `table_context.table_id` as an HTML `<table>`.
 *
 * Lossy by design (the view model discards `gridSpan`/`vMerge` span width):
 * - Horizontally merged cells (`gridSpan`) advance `col_index`, leaving grid gaps that we fill
 *   with empty cells so every row has the full column count.
 * - Vertically merged cells and nested tables flatten into the body-level grid; multi-paragraph
 *   cells join with `<br/>`.
 */
function renderTable(group: DocumentViewNode[], refs: FootnoteRefs): string {
  let totalCols = 0;
  for (const n of group) {
    const tc = n.table_context;
    if (!tc) continue;
    totalCols = Math.max(totalCols, tc.total_cols, tc.col_index + 1);
  }
  if (totalCols <= 0) return '';

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
    const cellHtml = inlineTagsToHtml(n.tagged_text, refs).replace(/\s*\n+\s*/g, '<br/>').trim();
    const parts = cellMap.get(tc.col_index) ?? [];
    if (cellHtml) parts.push(cellHtml);
    cellMap.set(tc.col_index, parts);
    if (tc.is_header_row) headerRows.add(tc.row_index);
  }

  rowOrder.sort((a, b) => a - b);
  if (rowOrder.length === 0) return '';

  const cellsFor = (rowIndex: number): string[] => {
    const cellMap = rows.get(rowIndex) ?? new Map<number, string[]>();
    const cells: string[] = [];
    for (let c = 0; c < totalCols; c++) cells.push((cellMap.get(c) ?? []).join('<br/>'));
    return cells;
  };

  // Prefer the first row Word flagged as a header; otherwise treat the first row as the header.
  const headerRowIndex = rowOrder.find((ri) => headerRows.has(ri)) ?? rowOrder[0]!;

  const lines: string[] = ['<table>'];
  lines.push('<thead>');
  lines.push(`<tr>${cellsFor(headerRowIndex).map((c) => `<th>${c}</th>`).join('')}</tr>`);
  lines.push('</thead>');
  lines.push('<tbody>');
  for (const ri of rowOrder) {
    if (ri === headerRowIndex) continue;
    lines.push(`<tr>${cellsFor(ri).map((c) => `<td>${c}</td>`).join('')}</tr>`);
  }
  lines.push('</tbody>');
  lines.push('</table>');
  return lines.join('\n');
}

/**
 * Stateful nested-list builder. Auto list levels come straight from OOXML `ilvl` with no
 * monotonicity guarantee, so the open/close logic must be robust to level jumps, interruptions,
 * and same-level kind changes — a naive open-on-increase/close-on-decrease stack would emit
 * malformed HTML.
 */
class ListBuilder {
  // Each open list records its tag AND the item `level` that opened it. Storing the level (not
  // just depth) is what keeps consecutive same-level items siblings even after a level jump that
  // skipped intermediate depths — depth alone would drift deeper on every repeated jumped level.
  private stack: Array<{ tag: 'ul' | 'ol'; level: number }> = [];
  private out: string[] = [];

  /** Append one list item at the given 0-based level with the given list tag. */
  item(level: number, tag: 'ul' | 'ol', content: string): void {
    const lvl = Math.max(0, level);
    // Close any lists deeper than this item's level.
    while (this.stack.length > 0 && this.stack[this.stack.length - 1]!.level > lvl) {
      this.out.push('</li>');
      this.out.push(`</${this.stack.pop()!.tag}>`);
    }
    const top = this.stack[this.stack.length - 1];
    if (top && top.level === lvl) {
      // Sibling at the same list level: close the previous item; swap list kind if it changed.
      this.out.push('</li>');
      if (top.tag !== tag) {
        this.out.push(`</${this.stack.pop()!.tag}>`);
        this.out.push(`<${tag}>`);
        this.stack.push({ tag, level: lvl });
      }
    } else {
      // Deeper than the current top (or the first item): open one nested list inside the open
      // <li>. We record the item's actual level, so a jump of >1 opens a single step and a later
      // same-level item lands here as a sibling rather than nesting further.
      this.out.push(`<${tag}>`);
      this.stack.push({ tag, level: lvl });
    }
    this.out.push(`<li>${content}`);
  }

  /** True when at least one list is currently open. */
  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  /** Close every open list and return the accumulated HTML. */
  flush(): string {
    while (this.stack.length > 0) {
      this.out.push('</li>');
      this.out.push(`</${this.stack.pop()!.tag}>`);
    }
    const html = this.out.join('\n');
    this.out = [];
    return html;
  }
}

function renderListContent(node: DocumentViewNode, refs: FootnoteRefs): { tag: 'ul' | 'ol'; content: string } {
  const lm = node.list_metadata;
  const html = inlineTagsToHtml(node.tagged_text, refs).trim();
  // Auto-numbered lists become <ol> (the renderer numbers them). Manual/legal labels keep their
  // literal text (`Section 2.1`, `(a)`) prefixed inside a <ul> item — a bare number would
  // silently destroy meaningful legal labels. `is_auto_numbered` is the reliable signal:
  // an auto `1.` can classify as NUMBERED_HEADING, so label_type alone is not enough.
  if (lm.is_auto_numbered) return { tag: 'ol', content: html };
  const label = lm.label_string?.trim() ?? '';
  return { tag: 'ul', content: label ? `${escapeHtmlText(label)} ${html}` : html };
}

function renderFootnotes(footnotes: Footnote[], refs: FootnoteRefs): string {
  const defs = footnotes.filter((fn) => fn.displayNumber > 0);
  if (defs.length === 0) return '';
  const items = defs.map((fn) => {
    const body = escapeHtmlText(fn.text.replace(/\s+/g, ' ').trim());
    // Only link back when the marker was actually rendered in the body — otherwise the `#fnref-n`
    // target does not exist (an unreferenced/orphan footnote definition), so omit the back-link.
    const backlink = refs.has(fn.displayNumber) ? ` <a href="#fnref-${fn.displayNumber}">↩</a>` : '';
    return `<li id="fn-${fn.displayNumber}">${body}${backlink}</li>`;
  });
  return ['<section class="footnotes">', '<hr/>', '<ol>', ...items, '</ol>', '</section>'].join('\n');
}

const DOCUMENT_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 50rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; }
  table { border-collapse: collapse; margin: 1rem 0; }
  th, td { border: 1px solid #ccc; padding: 0.3rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  mark { background: #fef08a; }
  .footnotes { margin-top: 2rem; font-size: 0.9em; color: #444; }
  .footnotes hr { border: none; border-top: 1px solid #ccc; }
  sup a { text-decoration: none; }
`.trim();

/** Strip inline tags from a heading's tagged text to make a plain-text `<title>`. */
function deriveTitle(nodes: DocumentViewNode[]): string {
  const first = nodes.find(isStructuralHeading);
  if (!first) return 'Document';
  const plain = tokenizeToonInline(first.tagged_text)
    .filter((t) => t.kind === 'text')
    .map((t) => t.value)
    .join('')
    .replace(/\[\^\d+\]/g, '')
    .trim();
  return plain || 'Document';
}

export interface SerializeHtmlOptions {
  /** Emit only the body-level elements (no `<!DOCTYPE>`/`<head>`/`<body>` wrapper). */
  readonly fragment?: boolean;
  /** Override the `<title>` (full-document mode only). Defaults to the first heading's text. */
  readonly title?: string;
}

/**
 * Serialize a structured document view to semantic HTML.
 *
 * @param nodes     Block nodes from `buildDocumentView({ showFormatting: true }).nodes`.
 * @param footnotes Footnotes from `DocxDocument.getFootnotes()` (already sorted by
 *                  `displayNumber`); rendered as a footnotes `<section>` with back-links.
 */
export function serializeToHtml(
  nodes: DocumentViewNode[],
  footnotes: Footnote[] = [],
  opts: SerializeHtmlOptions = {},
): string {
  const blocks: string[] = [];
  // Footnote markers rendered in the body, used to dedupe ids and gate definition back-links.
  const refs: FootnoteRefs = new Map();
  let lists: ListBuilder | null = null;

  const closeLists = (): void => {
    if (lists && lists.isOpen) blocks.push(lists.flush());
    lists = null;
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    // ── Tables: consume the whole run of same-table_id nodes at once ──
    if (node.table_context) {
      closeLists();
      const tableId = node.table_context.table_id;
      const group: DocumentViewNode[] = [];
      while (i < nodes.length && nodes[i]!.table_context?.table_id === tableId) {
        group.push(nodes[i]!);
        i++;
      }
      i--; // for-loop will re-increment
      const table = renderTable(group, refs);
      if (table) blocks.push(table);
      continue;
    }

    // ── Structural (Word-styled) headings ──
    if (isStructuralHeading(node)) {
      closeLists();
      const level = Math.min(6, Math.max(1, node.heading!.level as number));
      blocks.push(`<h${level}>${inlineTagsToHtml(node.tagged_text, refs).trim()}</h${level}>`);
      continue;
    }

    // ── List items: accumulated in a stateful nested-list builder ──
    if (node.list_metadata.list_level >= 0) {
      if (!lists) lists = new ListBuilder();
      const { tag, content } = renderListContent(node, refs);
      lists.item(Math.max(0, node.list_metadata.list_level), tag, content);
      continue;
    }

    // ── Normal paragraphs (heuristic headings land here: their run-in bold is already in the
    //     inline tags, so they stay <p> rather than being promoted to a heading). ──
    closeLists();
    const html = inlineTagsToHtml(node.tagged_text, refs).trim();
    if (html) blocks.push(`<p>${html}</p>`);
  }

  closeLists();

  const footnotesHtml = renderFootnotes(footnotes, refs);
  if (footnotesHtml) blocks.push(footnotesHtml);

  const body = blocks.join('\n');
  if (opts.fragment) return `${body}\n`;

  const title = escapeHtmlText(opts.title ?? deriveTitle(nodes));
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${title}</title>`,
    `<style>\n${DOCUMENT_STYLE}\n</style>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
