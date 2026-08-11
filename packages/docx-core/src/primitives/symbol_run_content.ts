/**
 * Text projection of `<w:sym>` run content.
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
 * The font is deliberately **not** part of the projected value. The projections
 * that consume this are text projections: they already exclude `w:rFonts`, so
 * folding `w:sym/@w:font` in would make the same font signal visible for one
 * spelling of a glyph and invisible for the other, and would make the two
 * spellings compare unequal by construction — the exact false difference this
 * resolution exists to remove. A font-only change is a formatting change and
 * belongs to the formatting-fidelity surface, not the round-trip text gate;
 * that residual is tracked separately.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.3.30
 * @see https://github.com/UseJunior/safe-docx/issues/793
 * @see https://github.com/UseJunior/safe-docx/issues/799
 */

import { OOXML } from './namespaces.js';

/** Local name of the symbol-character run-content element. */
export const SYM_LOCAL_NAME = 'sym';

/**
 * `w:sym/@w:char` is `ST_ShortHexNumber` — `xsd:hexBinary` restricted to
 * `length="2"`, i.e. exactly two bytes, four hexadecimal digits. Every legal
 * value is therefore a BMP codepoint and `String.fromCharCode` is total over
 * the domain. Four digits exactly: `A` and `ABC` are outside the lexical space
 * and must not be read as characters.
 */
const SHORT_HEX_NUMBER = /^[0-9A-Fa-f]{4}$/u;

/**
 * Projection identity for a `w:sym` whose `@w:char` is absent or outside
 * `ST_ShortHexNumber`. Both `CT_Sym` attributes are optional in the vendored
 * schema, so such an element is not schema-invalid — it is semantically
 * unresolvable, and it is still *content*. Projecting nothing would reopen the
 * blindness this module closes.
 *
 * It is a framed token rather than a character (U+FFFD was the obvious choice
 * and is wrong: a document may author U+FFFD literally, and an unresolvable
 * symbol would then compare equal to that text). The framing follows the
 * `__safe_docx_pageref__|` convention already used for stable comparison
 * identities in `docx-compare`.
 */
const UNRESOLVED_SYMBOL_IDENTITY = '__safe_docx_sym__|unresolved';

function isSymElement(element: Element): boolean {
  if (element.localName !== SYM_LOCAL_NAME) return false;
  // Namespace-aware parses carry the WordprocessingML URI. Parsers that were
  // handed a fragment without declarations report a null namespace; fall back
  // to the qualified name so a `w:sym` is not silently skipped.
  return element.namespaceURI === OOXML.W_NS || element.tagName === 'w:sym';
}

/**
 * Project a `<w:sym>` element to the text it contributes, or `undefined` when
 * `element` is not a `w:sym`.
 *
 * For a resolvable `@w:char` the result is exactly the character the glyph
 * stands for — what it would have contributed had it been spelled as literal
 * `w:t` content. Otherwise it is a framed, projection-only identity that keeps
 * the element's presence visible without colliding with authored text.
 */
export function projectSymbolRun(element: Element): string | undefined {
  if (!isSymElement(element)) return undefined;
  const raw =
    element.getAttributeNS(OOXML.W_NS, 'char') ?? element.getAttribute('w:char');
  if (raw === null || !SHORT_HEX_NUMBER.test(raw)) return UNRESOLVED_SYMBOL_IDENTITY;
  return String.fromCharCode(Number.parseInt(raw, 16));
}
