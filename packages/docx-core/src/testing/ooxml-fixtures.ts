/**
 * Shared OOXML test fixtures.
 *
 * Single source of truth for the field-XML primitives, complete-field
 * sequences, tracked-change variants, and minimal DOCX-package builder used
 * across the docx-core test suite. Consolidates patterns previously
 * re-derived inline in `lean-spec-bridge.test.ts`,
 * `pipeline.field-validation.test.ts`, and `collapsed-field-inplace.test.ts`.
 *
 * The Lean Tier 2 model in `verification/lean/...` does NOT import this
 * module — it operates on inductive `Doc`/`Block`/`Atom` constructors, not
 * XML strings. The three independent walk semantics
 * (`pipeline.ts:fieldContextNeutral`, `Tier2/FieldStructure.fieldContextNeutral`,
 * `lean-spec-bridge.test.ts:isFieldContextNeutral`) are deliberately
 * re-derived — that triple is the falsifiability layer of the field-structure
 * proof and must not be collapsed.
 *
 * Ref: issue #221.
 */

import JSZip from 'jszip';

export type FldCharKind = 'begin' | 'separate' | 'end';

export function fldChar(kind: FldCharKind): string {
  return `<w:r><w:fldChar w:fldCharType="${kind}"/></w:r>`;
}

export interface InstrTextOptions {
  preserve?: boolean;
}

export function instrText(text: string, opts: InstrTextOptions = {}): string {
  const space = opts.preserve ? ' xml:space="preserve"' : '';
  return `<w:r><w:instrText${space}>${text}</w:instrText></w:r>`;
}

export function delInstrText(text: string, opts: InstrTextOptions = {}): string {
  const space = opts.preserve ? ' xml:space="preserve"' : '';
  return `<w:r><w:delInstrText${space}>${text}</w:delInstrText></w:r>`;
}

export function resultText(text: string): string {
  return `<w:r><w:t>${text}</w:t></w:r>`;
}

export const COMPLETE_NUMPAGES_FIELD =
  fldChar('begin') +
  instrText(' NUMPAGES ', { preserve: true }) +
  fldChar('separate') +
  resultText('3') +
  fldChar('end');

export const COMPLETE_PAGE_FIELD =
  fldChar('begin') +
  instrText(' PAGE ', { preserve: true }) +
  fldChar('separate') +
  resultText('1') +
  fldChar('end');

export const COMPLETE_PAGEREF_FIELD =
  fldChar('begin') +
  instrText(' PAGEREF _Toc123 \\h ', { preserve: true }) +
  fldChar('separate') +
  resultText('42') +
  fldChar('end');

// ECMA-376 conformant field-modification pattern: a field whose instruction
// text is changing under track changes. The fldChars remain UNWRAPPED at the
// sibling-run level (they cannot enter <w:del>), while the changed instrText
// fragments into <w:ins>/<w:del> wrappers. See c-rex ECMA-376 Part 4 fldChar
// topic + DeletedFieldCode placement constraint.
export const FRAGMENTED_NUMPAGES_MODIFICATION =
  fldChar('begin') +
  `<w:ins>${instrText(' NUMPAGES ', { preserve: true })}</w:ins>` +
  `<w:del>${delInstrText(' PAGE ', { preserve: true })}</w:del>` +
  fldChar('separate') +
  resultText('3') +
  fldChar('end');

const W_NS_ATTR = ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export interface WrapOptions {
  /**
   * When true, emits `xmlns:w="…"` on the wrapper element so the result
   * can be parsed as a standalone document root by `@xmldom/xmldom`'s
   * `DOMParser.parseFromString(xml, 'application/xml')` without throwing
   * `NamespaceError: prefix is non-null and namespace is null`.
   *
   * Default false (the wrapper is assumed to live inside a `<w:document>`
   * that already declares the namespace).
   */
  standalone?: boolean;
}

export function WHOLE_FIELD_IN_INS(
  field: string = COMPLETE_NUMPAGES_FIELD,
  opts: WrapOptions = {},
): string {
  const ns = opts.standalone ? W_NS_ATTR : '';
  return `<w:ins${ns}>${field}</w:ins>`;
}

export function WHOLE_FIELD_IN_DEL(
  field: string = COMPLETE_NUMPAGES_FIELD,
  opts: WrapOptions = {},
): string {
  const ns = opts.standalone ? W_NS_ATTR : '';
  return `<w:del${ns}>${field}</w:del>`;
}

/**
 * Build a minimal DOCX package buffer from raw `<w:body>` inner XML.
 *
 * Emits `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, and an
 * empty `word/_rels/document.xml.rels`. The `<w:document>` root declares
 * both `xmlns:w` and `xmlns:w14`. Suitable for any test that needs a
 * loadable DOCX with a custom body but no styles/footnotes/comments/etc.
 *
 * Use `buildSyntheticDocx` (in `../integration/synthetic-docx-fixture.ts`)
 * instead when you need paragraph-array input with optional
 * footnote/comment/bookmark scaffolding.
 */
export async function buildDocxFromBodyXml(bodyXml: string): Promise<Buffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    `<w:body>${bodyXml}<w:sectPr/></w:body></w:document>`;

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);

  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}
