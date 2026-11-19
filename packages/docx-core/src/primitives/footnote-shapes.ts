/**
 * Canonical footnote OOXML shapes shared by the brownfield editing path
 * (`footnotes.ts`, behind `add_footnote`) and from-scratch generation
 * (`generation/emit/footnotes-part.ts`), so a generated footnote and an added
 * one are built from the same elements.
 *
 * Internal module: not re-exported from the package index.
 */

import { OOXML } from './namespaces.js';

export const FOOTNOTES_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
export const FOOTNOTES_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';

/** Note id of the separator note in {@link FOOTNOTES_XML_TEMPLATE}. */
export const SEPARATOR_FOOTNOTE_ID = -1;
/** Note id of the continuation-separator note in {@link FOOTNOTES_XML_TEMPLATE}. */
export const CONTINUATION_SEPARATOR_FOOTNOTE_ID = 0;

/** Character style of a footnote reference and of the mark that opens the note. */
export const FOOTNOTE_REFERENCE_STYLE_ID = 'FootnoteReference';
/** Paragraph style of footnote text. */
export const FOOTNOTE_TEXT_STYLE_ID = 'FootnoteText';

/**
 * A footnotes part holding only the separator (id -1) and continuation
 * separator (id 0) notes, the ids Word gives them.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.1
 */
export const FOOTNOTES_XML_TEMPLATE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
  ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
  `<w:footnote w:type="separator" w:id="${SEPARATOR_FOOTNOTE_ID}">` +
  `<w:p><w:r><w:separator/></w:r></w:p>` +
  `</w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="${CONTINUATION_SEPARATOR_FOOTNOTE_ID}">` +
  `<w:p><w:r><w:continuationSeparator/></w:r></w:p>` +
  `</w:footnote>` +
  `</w:footnotes>`;

/**
 * `w:rPr` of a footnote mark: the FootnoteReference character style, with
 * superscript stated directly so the mark stays raised when a document omits
 * or redefines that style.
 */
function buildMarkRunProperties(doc: Document): Element {
  const rPr = doc.createElementNS(OOXML.W_NS, 'w:rPr');
  const rStyle = doc.createElementNS(OOXML.W_NS, 'w:rStyle');
  rStyle.setAttributeNS(OOXML.W_NS, 'w:val', FOOTNOTE_REFERENCE_STYLE_ID);
  rPr.appendChild(rStyle);
  const vertAlign = doc.createElementNS(OOXML.W_NS, 'w:vertAlign');
  vertAlign.setAttributeNS(OOXML.W_NS, 'w:val', 'superscript');
  rPr.appendChild(vertAlign);
  return rPr;
}

/**
 * The run that references note `noteId` from the main story.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 */
export function buildFootnoteReferenceRun(doc: Document, noteId: number): Element {
  const run = doc.createElementNS(OOXML.W_NS, 'w:r');
  run.appendChild(buildMarkRunProperties(doc));
  const reference = doc.createElementNS(OOXML.W_NS, 'w:footnoteReference');
  reference.setAttributeNS(OOXML.W_NS, 'w:id', String(noteId));
  run.appendChild(reference);
  return run;
}

/**
 * The run that opens a note's first paragraph and shows its number.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.13
 */
export function buildFootnoteRefMarkRun(doc: Document): Element {
  const run = doc.createElementNS(OOXML.W_NS, 'w:r');
  run.appendChild(buildMarkRunProperties(doc));
  run.appendChild(doc.createElementNS(OOXML.W_NS, 'w:footnoteRef'));
  return run;
}

/** The single-space run Word puts between a note's number and its text. */
export function buildFootnoteMarkSpaceRun(doc: Document): Element {
  const run = doc.createElementNS(OOXML.W_NS, 'w:r');
  const t = doc.createElementNS(OOXML.W_NS, 'w:t');
  t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(' '));
  run.appendChild(t);
  return run;
}
