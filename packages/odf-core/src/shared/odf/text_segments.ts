/**
 * Shared visible-text ↔ DOM-node mapping for ODF block-level text elements.
 *
 * Extracted from `document.ts` so both the document view and the comments module use one
 * segmentation of a `text:p`/`text:h`'s visible text without an import cycle.
 *
 * All element matching is by `namespaceURI` + `localName` (ODF prefixes are not guaranteed).
 */

import { ODF_NS } from './namespaces.js';

export const TEXT_NODE = 3;
export const ELEMENT_NODE = 1;

/** True for the block-level text elements that carry a paragraph's visible content. */
export function isTextBlock(el: { namespaceURI?: string | null; localName?: string | null }): boolean {
  return el.namespaceURI === ODF_NS.TEXT && (el.localName === 'p' || el.localName === 'h');
}

/**
 * True for an `office:annotation` / `office:annotation-end` element. Annotation subtrees carry
 * their own `text:p` comment body, which must NOT be walked as part of the host paragraph's
 * visible text nor enumerated as a paragraph block — callers skip these subtrees.
 */
export function isAnnotationSubtree(el: { namespaceURI?: string | null; localName?: string | null }): boolean {
  return el.namespaceURI === ODF_NS.OFFICE && (el.localName === 'annotation' || el.localName === 'annotation-end');
}

/**
 * True for a `text:tracked-changes` container. It holds change DEFINITIONS — including deleted
 * paragraphs stored out-of-line inside `text:deletion` — which are NOT body content: they must
 * not be walked as a host paragraph's visible text nor enumerated as paragraph blocks. Callers
 * skip this subtree (the deletion-storage analogue of `isAnnotationSubtree`).
 */
export function isTrackedChangesSubtree(el: { namespaceURI?: string | null; localName?: string | null }): boolean {
  return el.namespaceURI === ODF_NS.TEXT && el.localName === 'tracked-changes';
}

/** A contiguous slice of a paragraph's visible text and where it came from. */
export type Segment =
  | { kind: 'text'; node: { data: string }; visStart: number; length: number }
  | { kind: 'virtual'; node: Element; virtual: 'space' | 'tab' | 'line-break'; visStart: number; length: number };

/**
 * Build the ordered segment list and concatenated visible string for a block.
 * `text:s` (count via `text:c`) expands to spaces, `text:tab` to a tab, and
 * `text:line-break` to a newline — each a "virtual" segment whose visible text has no host
 * `#text` node (so a match landing on one cannot be edited in place via `replaceTextById`);
 * the generating element itself is carried as `node` so offset-mapping consumers (the compare
 * emitter) can split or copy it. `office:annotation` / `office:annotation-end` subtrees are
 * skipped entirely.
 */
export function buildSegments(block: Element): { segments: Segment[]; visible: string } {
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
      // Skip annotation subtrees: their body text is a comment, not the host paragraph's content.
      if (isAnnotationSubtree(el)) continue;
      // Skip tracked-changes storage: deleted paragraphs live out-of-line here, not in the body.
      if (isTrackedChangesSubtree(el)) continue;
      if (el.namespaceURI === ODF_NS.TEXT && el.localName === 's') {
        const countRaw = el.getAttributeNS(ODF_NS.TEXT, 'c') ?? el.getAttribute('text:c');
        const count = Math.max(1, Number.parseInt(countRaw ?? '1', 10) || 1);
        const spaces = ' '.repeat(count);
        segments.push({ kind: 'virtual', node: el, virtual: 'space', visStart: visible.length, length: spaces.length });
        visible += spaces;
        continue;
      }
      if (el.namespaceURI === ODF_NS.TEXT && el.localName === 'tab') {
        segments.push({ kind: 'virtual', node: el, virtual: 'tab', visStart: visible.length, length: 1 });
        visible += '\t';
        continue;
      }
      if (el.namespaceURI === ODF_NS.TEXT && el.localName === 'line-break') {
        segments.push({ kind: 'virtual', node: el, virtual: 'line-break', visStart: visible.length, length: 1 });
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
