/**
 * The single definition of how run content contributes to a paragraph's
 * raw-offset coordinate space.
 *
 * `getParagraphText` is the definition of that space: paragraph editing
 * (`replaceParagraphTextRange`), run splitting, comment range metadata,
 * footnote reference insertion, the document view's footnote markers,
 * `read_file`'s comment-marker run lengths and table cell text are all
 * expressed in it. Each of those walkers used to decide for itself which run
 * content elements count and how much, so a change to one (for example letting
 * a `w:sym` glyph count as a character) would have left the others addressing
 * different characters. Every raw-offset walker named in issue #1045 now asks
 * this module, and keeps only its own context rules (field-code suppression,
 * tracked-deletion handling, story boundaries). Projections that are not
 * paragraph raw offsets (comment and footnote body text, the run-in heading
 * detector's header text) keep their own `w:t` walks.
 *
 * A `w:sym` symbol character contributes nothing here yet: it is zero-width
 * run content in the coordinate space, like a field marker or a proofing mark.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.30
 * @see https://github.com/UseJunior/safe-docx/issues/1045
 * @see https://github.com/UseJunior/safe-docx/issues/797
 */

import { OOXML, W } from './namespaces.js';

/**
 * The text a run content element contributes to the paragraph's raw-offset
 * coordinate space: the element's text for `w:t`, `\t` for `w:tab`, `\n` for
 * `w:br`. Returns `null` for an element that contributes no characters (run
 * properties, field markers, note and comment references, drawings, symbol
 * characters, and anything outside the WordprocessingML namespace).
 *
 * An empty `w:t` returns `''`, not `null`: it is a text-carrying element with
 * no characters, which walkers that track field-result provenance still treat
 * as text.
 */
export function runContentVisibleText(element: Element): string | null {
  if (element.namespaceURI !== OOXML.W_NS) return null;
  switch (element.localName) {
    case W.t:
      return element.textContent ?? '';
    case W.tab:
      return '\t';
    case W.br:
      return '\n';
    default:
      return null;
  }
}

/**
 * The number of raw-offset characters a run content element occupies: the
 * length of {@link runContentVisibleText}, or 0 for zero-width content.
 */
export function runContentVisibleLength(element: Element): number {
  return runContentVisibleText(element)?.length ?? 0;
}
