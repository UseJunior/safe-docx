/**
 * Minimal ODF (.odt) document view over `content.xml`.
 *
 * Phase 1 scope: enumerate block-level text elements (`text:p` / `text:h`) in
 * document order — including those nested in `table:table-cell` — with deterministic
 * structural paragraph IDs, read a paragraph's visible text, and replace text within
 * a paragraph when the match lies in a single `#text` node. See the `add-odf-core`
 * OpenSpec change for the full rationale.
 *
 * Namespaces: ODF is heavily namespaced and prefixes are not guaranteed, so all
 * element matching is by `namespaceURI` + `localName`, never by prefixed tag name.
 */

import { parseXml, serializeXml } from '@usejunior/docx-core';

import { ODF_NS } from './shared/odf/namespaces.js';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export type OdfParagraph = {
  /** Deterministic structural ID (document-order ordinal), stable for identical bytes. */
  id: string;
  /** Visible text with `text:s` expanded to spaces and `text:tab` to a tab. */
  text: string;
};

export type ReplaceResult =
  | { ok: true }
  | { ok: false; code: 'ANCHOR_NOT_FOUND' | 'TEXT_NOT_FOUND' | 'MATCH_SPANS_MULTIPLE_NODES'; message: string };

export type InsertResult =
  | { ok: true; newIds: string[] }
  | { ok: false; code: 'ANCHOR_NOT_FOUND'; message: string };

/** A contiguous slice of a paragraph's visible text and where it came from. */
type Segment =
  | { kind: 'text'; node: { data: string }; visStart: number; length: number }
  | { kind: 'virtual'; visStart: number; length: number };

function isTextBlock(el: { namespaceURI?: string | null; localName?: string | null }): boolean {
  return el.namespaceURI === ODF_NS.TEXT && (el.localName === 'p' || el.localName === 'h');
}

export class OdfDocument {
  private doc: Document;
  /** Block-level text elements in document order; index is the structural ID ordinal. */
  private blocks: Element[];

  private constructor(doc: Document, blocks: Element[]) {
    this.doc = doc;
    this.blocks = blocks;
  }

  /** Parse a `content.xml` string into a document view. */
  static fromContentXml(contentXml: string): OdfDocument {
    const doc = parseXml(contentXml);
    const blocks: Element[] = [];
    OdfDocument.collectBlocks(doc.documentElement, blocks);
    return new OdfDocument(doc, blocks);
  }

  /** Depth-first, document-order collection of `text:p` / `text:h` blocks. */
  private static collectBlocks(node: Node | null, out: Element[]): void {
    if (!node) return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as Element;
      if (isTextBlock(el)) {
        out.push(el);
        // Block-level text elements are not nested inside one another in ODF, but
        // continue traversal in case of unusual structures (cost is negligible).
      }
      OdfDocument.collectBlocks(el, out);
    }
  }

  private idForIndex(index: number): string {
    return `p${index}`;
  }

  private blockForId(id: string): Element | null {
    const m = /^p(\d+)$/.exec(id);
    if (!m) return null;
    const idx = Number.parseInt(m[1]!, 10);
    return this.blocks[idx] ?? null;
  }

  /** All paragraphs in document order. */
  getParagraphs(): OdfParagraph[] {
    return this.blocks.map((el, i) => ({
      id: this.idForIndex(i),
      text: this.buildSegments(el).visible,
    }));
  }

  /** Visible text of a paragraph by ID, or null if the ID does not resolve. */
  getParagraphTextById(id: string): string | null {
    const el = this.blockForId(id);
    if (!el) return null;
    return this.buildSegments(el).visible;
  }

  /**
   * Build the ordered segment list and concatenated visible string for a block.
   * `text:s` (count via `text:c`) expands to spaces, `text:tab` to a tab, and
   * `text:line-break` to a newline — each a "virtual" segment with no single host
   * `#text` node (so a match landing on one cannot be edited in place in Phase 1).
   */
  private buildSegments(block: Element): { segments: Segment[]; visible: string } {
    const segments: Segment[] = [];
    let visible = '';

    const walk = (node: Node): void => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === TEXT_NODE) {
          const data = (child as unknown as { data: string }).data ?? '';
          if (data.length === 0) continue;
          segments.push({ kind: 'text', node: child as unknown as { data: string }, visStart: visible.length, length: data.length });
          visible += data;
          continue;
        }
        if (child.nodeType !== ELEMENT_NODE) continue;
        const el = child as Element;
        if (el.namespaceURI === ODF_NS.TEXT && el.localName === 's') {
          const countRaw = el.getAttributeNS(ODF_NS.TEXT, 'c') ?? el.getAttribute('text:c');
          const count = Math.max(1, Number.parseInt(countRaw ?? '1', 10) || 1);
          const spaces = ' '.repeat(count);
          segments.push({ kind: 'virtual', visStart: visible.length, length: spaces.length });
          visible += spaces;
          continue;
        }
        if (el.namespaceURI === ODF_NS.TEXT && el.localName === 'tab') {
          segments.push({ kind: 'virtual', visStart: visible.length, length: 1 });
          visible += '\t';
          continue;
        }
        if (el.namespaceURI === ODF_NS.TEXT && el.localName === 'line-break') {
          segments.push({ kind: 'virtual', visStart: visible.length, length: 1 });
          visible += '\n';
          continue;
        }
        // Other elements (text:span, hyperlink, etc.): recurse so their inner
        // #text nodes are recorded as separate segments.
        walk(el);
      }
    };

    walk(block);
    return { segments, visible };
  }

  /**
   * Replace `findText` with `replaceWith` in the paragraph identified by `id`.
   * Phase 1 only edits when the match lies entirely within a single `#text` node.
   */
  replaceTextById(id: string, findText: string, replaceWith: string): ReplaceResult {
    const el = this.blockForId(id);
    if (!el) {
      return { ok: false, code: 'ANCHOR_NOT_FOUND', message: `Paragraph not found: ${id}` };
    }
    const { segments, visible } = this.buildSegments(el);
    const matchStart = visible.indexOf(findText);
    if (matchStart < 0) {
      return { ok: false, code: 'TEXT_NOT_FOUND', message: `Text not found in paragraph ${id}: ${JSON.stringify(findText)}` };
    }
    const matchEnd = matchStart + findText.length;

    const host = segments.find(
      (seg) => seg.kind === 'text' && matchStart >= seg.visStart && matchEnd <= seg.visStart + seg.length,
    );
    if (!host || host.kind !== 'text') {
      return {
        ok: false,
        code: 'MATCH_SPANS_MULTIPLE_NODES',
        message:
          `Match for ${JSON.stringify(findText)} in paragraph ${id} crosses node boundaries ` +
          `(spans, spaces, or tabs). Phase 1 only replaces matches contained in a single text run.`,
      };
    }

    const localStart = matchStart - host.visStart;
    const localEnd = matchEnd - host.visStart;
    host.node.data = host.node.data.slice(0, localStart) + replaceWith + host.node.data.slice(localEnd);
    return { ok: true };
  }

  /**
   * Insert one or more paragraphs relative to the anchor paragraph identified by `id`.
   *
   * `text` is split on blank lines (`\n{2,}`) into separate `text:p` blocks (parity with
   * the DOCX `insert_paragraph` tool); a single `\n` within a block becomes a
   * `text:line-break`. Inserted blocks inherit the anchor's `text:style-name` ONLY when
   * the anchor is itself a `text:p` — inserting after a heading (`text:h`) produces
   * default body paragraphs, never more headings.
   *
   * Paragraph IDs are positional ordinals, so every ID at or after the insertion point
   * shifts by the number of inserted blocks. Returns the inserted blocks' freshly
   * recomputed IDs in document order; callers must re-read before issuing further edits
   * that target IDs near or after the insertion point.
   */
  insertParagraph(id: string, text: string, position: 'BEFORE' | 'AFTER'): InsertResult {
    const anchor = this.blockForId(id);
    if (!anchor) {
      return { ok: false, code: 'ANCHOR_NOT_FOUND', message: `Paragraph not found: ${id}` };
    }
    const parent = anchor.parentNode;
    if (!parent) {
      return { ok: false, code: 'ANCHOR_NOT_FOUND', message: `Paragraph ${id} has no parent element` };
    }

    // Inherit the anchor's paragraph style only when the anchor is a body paragraph.
    // Inserting relative to a heading must not produce another heading.
    const inheritStyle =
      anchor.localName === 'p'
        ? anchor.getAttributeNS(ODF_NS.TEXT, 'style-name') ?? anchor.getAttribute('text:style-name')
        : null;

    const blockTexts = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
    const newEls: Element[] = blockTexts.map((blockText) => {
      const p = this.doc.createElementNS(ODF_NS.TEXT, 'text:p');
      if (inheritStyle) p.setAttributeNS(ODF_NS.TEXT, 'text:style-name', inheritStyle);
      const lines = blockText.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) p.appendChild(this.doc.createElementNS(ODF_NS.TEXT, 'text:line-break'));
        if (line.length > 0) p.appendChild(this.doc.createTextNode(line));
      });
      return p;
    });

    // `insertBefore(el, null)` appends, so AFTER on the last child appends correctly.
    const refNode = position === 'AFTER' ? anchor.nextSibling : anchor;
    for (const el of newEls) {
      parent.insertBefore(el, refNode);
    }

    // Rebuild the structural block index; positional IDs shift accordingly.
    const blocks: Element[] = [];
    OdfDocument.collectBlocks(this.doc.documentElement, blocks);
    this.blocks = blocks;

    const newIds = newEls.map((el) => this.idForIndex(blocks.indexOf(el)));
    return { ok: true, newIds };
  }

  /** Serialize the (possibly edited) document back to a `content.xml` string. */
  toXml(): string {
    return serializeXml(this.doc);
  }
}
