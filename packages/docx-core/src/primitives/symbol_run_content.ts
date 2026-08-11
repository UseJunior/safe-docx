/**
 * Character resolution for `<w:sym>` run content.
 *
 * A symbol glyph has two legal spellings in WordprocessingML and Word renders
 * them identically:
 *
 * 1. `<w:sym w:font="Wingdings" w:char="F0A8"/>`, and
 * 2. the same codepoint written literally inside a `<w:t>`, with the symbol
 *    font carried on the run's `<w:rFonts>`.
 *
 * Any text projection that walks `w:t`/`w:delText` alone therefore sees a
 * document that *lost* a symbol and a document that *kept* it as the same
 * string, and sees the two spellings of one glyph as different strings. This
 * module is the single place the projection resolves spelling (1) into the
 * characters spelling (2) would have contributed.
 *
 * The font is deliberately **not** part of the resolved value. The projections
 * that consume this are text projections: they already exclude `w:rFonts`, so
 * folding `w:sym/@w:font` in would make the same font signal visible for one
 * spelling of a glyph and invisible for the other, and would make the two
 * spellings compare unequal by construction — the exact false difference this
 * resolution exists to remove. A font-only change is a formatting change and
 * belongs to the formatting-fidelity surface, not the round-trip text gate.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.30
 * @see https://github.com/UseJunior/safe-docx/issues/793
 */

import { OOXML } from './namespaces.js';

/** Local name of the symbol-character run-content element. */
export const SYM_LOCAL_NAME = 'sym';

/**
 * `w:sym/@w:char` is `ST_UcharHexNumber`: exactly two hex bytes, so every
 * legal value is a BMP codepoint and `String.fromCharCode` is total over it.
 */
const UCHAR_HEX = /^[0-9A-Fa-f]{1,4}$/u;

/**
 * Stand-in for a `w:sym` whose `w:char` is absent or not a hex number. Such an
 * element is not schema-valid, but it is still *content*: projecting nothing
 * would reopen the blindness this module closes, so it projects a character
 * that is stable, out of band, and equal to itself across a round trip.
 */
const UNRESOLVABLE_SYMBOL = '\uFFFD';

function isSymElement(element: Element): boolean {
  if (element.localName !== SYM_LOCAL_NAME) return false;
  // Namespace-aware parses carry the WordprocessingML URI. Parsers that were
  // handed a fragment without declarations report a null namespace; fall back
  // to the qualified name so a `w:sym` is not silently skipped.
  return element.namespaceURI === OOXML.W_NS || element.tagName === 'w:sym';
}

/**
 * Resolve a `<w:sym>` element to the character it stands for, or `undefined`
 * when `element` is not a `w:sym`.
 *
 * Callers are text projections, so the return value is what the glyph would
 * have contributed had it been spelled as literal `w:t` content.
 */
export function symbolRunCharacter(element: Element): string | undefined {
  if (!isSymElement(element)) return undefined;
  const raw =
    element.getAttributeNS(OOXML.W_NS, 'char') ?? element.getAttribute('w:char');
  if (raw === null || !UCHAR_HEX.test(raw)) return UNRESOLVABLE_SYMBOL;
  return String.fromCharCode(Number.parseInt(raw, 16));
}
