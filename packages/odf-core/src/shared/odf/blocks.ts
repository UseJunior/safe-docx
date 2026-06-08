/**
 * Shared block-level paragraph enumeration for ODF `content.xml`.
 *
 * Extracted from `document.ts` so both the document view and the comparison engine
 * (`compare/index.ts`) enumerate body paragraphs identically without an import cycle.
 *
 * A "block" is a `text:p` / `text:h` carrying visible content, in document order — including
 * those nested in `table:table-cell`. Two subtrees are skipped because their `text:p`s are not
 * body content: `office:annotation` / `office:annotation-end` (comment bodies) and
 * `text:tracked-changes` (deleted content stored out-of-line). All matching is by
 * `namespaceURI` + `localName` (ODF prefixes are not guaranteed).
 */

import {
  ELEMENT_NODE,
  isAnnotationSubtree,
  isTextBlock,
  isTrackedChangesSubtree,
} from './text_segments.js';

/** Depth-first, document-order collection of `text:p` / `text:h` blocks into `out`. */
export function collectBlocks(node: Node | null, out: Element[]): void {
  if (!node) return;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    const el = child as Element;
    // An annotation carries its own `text:p` comment body; never enumerate it as a block.
    if (isAnnotationSubtree(el)) continue;
    // `text:tracked-changes` stores deleted paragraphs out-of-line; they are not body blocks.
    if (isTrackedChangesSubtree(el)) continue;
    if (isTextBlock(el)) {
      out.push(el);
      // Block-level text elements are not nested inside one another in ODF, but
      // continue traversal in case of unusual structures (cost is negligible).
    }
    collectBlocks(el, out);
  }
}
