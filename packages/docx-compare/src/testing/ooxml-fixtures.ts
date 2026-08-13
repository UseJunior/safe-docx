/**
 * Shared OOXML test fixtures.
 *
 * Single source of truth for the field-XML primitives, complete-field
 * sequences, tracked-change variants, and minimal DOCX-package builder used
 * across the docx-core test suite. Consolidates patterns previously
 * re-derived inline in `pipeline.field-validation.test.ts` and
 * `collapsed-field-inplace.test.ts`.
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

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const XML_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9._-]*$/u;

function assertXmlPrefix(prefix: string): void {
  if (!XML_PREFIX_RE.test(prefix) || /^xml/i.test(prefix)) {
    throw new Error(`Invalid XML namespace prefix: ${JSON.stringify(prefix)}`);
  }
}

export function paragraphWithText(text: string): string {
  return `<w:p>${resultText(escapeXmlText(text))}</w:p>`;
}

export function paragraphWithField(prefixText: string, field: string, suffixText: string): string {
  return `<w:p>${resultText(escapeXmlText(prefixText))}${field}${resultText(escapeXmlText(suffixText))}</w:p>`;
}

// Field instruction-code strings, keyed by field type. Single source of truth so
// the complete-field constants and the fragmented-field builder agree on the
// exact instruction text per type.
export const FIELD_INSTRUCTIONS = {
  NUMPAGES: ' NUMPAGES ',
  PAGE: ' PAGE ',
  PAGEREF: ' PAGEREF _Toc123 \\h ',
  REF: ' REF Clause_1 \\h ',
} as const;

// A complete, self-contained simple field: begin → instrText → separate →
// result → end. Generalizes the COMPLETE_* constants over instruction and
// result text.
export function completeField(instruction: string, result: string): string {
  return (
    fldChar('begin') +
    instrText(instruction, { preserve: true }) +
    fldChar('separate') +
    resultText(result) +
    fldChar('end')
  );
}

export const COMPLETE_NUMPAGES_FIELD = completeField(FIELD_INSTRUCTIONS.NUMPAGES, '3');

export const COMPLETE_PAGE_FIELD = completeField(FIELD_INSTRUCTIONS.PAGE, '1');

export const COMPLETE_PAGEREF_FIELD = completeField(FIELD_INSTRUCTIONS.PAGEREF, '42');

export const COMPLETE_REF_FIELD = completeField(FIELD_INSTRUCTIONS.REF, 'Section 1');

/**
 * Build a topology-sensitive complex field used by forced-rebuild tests.
 *
 * Every field component has distinct run properties, the instruction is
 * fragmented across two runs, and the cached result retains a pre-existing
 * wrapper. The extension payload is intentionally opaque to the comparison
 * engine.
 */
export function decoratedComplexField(
  instruction: string,
  result: string,
  anchor = '_FieldResult',
): string {
  const split = Math.max(1, Math.floor(instruction.length / 2));
  const firstInstruction = escapeXmlText(instruction.slice(0, split));
  const secondInstruction = escapeXmlText(instruction.slice(split));
  return (
    `<w:r w:rsidR="A0000001"><w:rPr><w:b/></w:rPr>` +
    `<w:fldChar w:fldCharType="begin" w:dirty="false"/></w:r>` +
    `<w:r><w:rPr><w:i/></w:rPr><w:instrText xml:space="preserve">${firstInstruction}</w:instrText></w:r>` +
    `<w:r><w:rPr><w:color w:val="336699"/></w:rPr>` +
    `<w:instrText xml:space="preserve">${secondInstruction}</w:instrText></w:r>` +
    `<w:r><w:rPr><w:u w:val="single"/></w:rPr>` +
    `<w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:hyperlink w:anchor="${escapeXmlAttr(anchor)}" w:history="1">` +
    `<w:r><w:rPr><w:smallCaps/></w:rPr><w:t>${escapeXmlText(result)}</w:t></w:r>` +
    `</w:hyperlink>` +
    `<w:r><w:rPr><w:vanish/><w14:textEffect w14:val="none"/></w:rPr>` +
    `<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

// ECMA-376 conformant field-modification pattern: a field whose instruction
// text is changing under track changes. The fldChars remain UNWRAPPED at the
// sibling-run level (they cannot enter <w:del>), while the changed instrText
// fragments into <w:ins>/<w:del> wrappers. See c-rex ECMA-376 Part 4 fldChar
// topic + DeletedFieldCode placement constraint.
export function fragmentedFieldModification(
  newInstruction: string,
  oldInstruction: string,
  result: string,
): string {
  return (
    fldChar('begin') +
    `<w:ins>${instrText(newInstruction, { preserve: true })}</w:ins>` +
    `<w:del>${delInstrText(oldInstruction, { preserve: true })}</w:del>` +
    fldChar('separate') +
    resultText(result) +
    fldChar('end')
  );
}

export const FRAGMENTED_NUMPAGES_MODIFICATION = fragmentedFieldModification(
  FIELD_INSTRUCTIONS.NUMPAGES,
  FIELD_INSTRUCTIONS.PAGE,
  '3',
);

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
 *
 * Pass `hyperlinkRels` to populate `word/_rels/document.xml.rels` with hyperlink
 * relationships so `r:id` references in the body actually resolve (needed to
 * exercise link retargeting / relationship merging — issue #376).
 */
export interface HyperlinkRelFixture {
  id: string;
  target: string;
  /** Defaults to true (external URL); pass false for an internal target. */
  external?: boolean;
}

export interface MinimalDocumentNamespaceOptions {
  /** Additional root prefix bindings, keyed without `xmlns:`. */
  namespaces?: Readonly<Record<string, string>>;
  /** Additional prefixes appended to the root `mc:Ignorable` token list. */
  ignorablePrefixes?: readonly string[];
}

export async function buildDocxFromBodyXml(
  bodyXml: string,
  hyperlinkRels: HyperlinkRelFixture[] = [],
  namespaceOptions: MinimalDocumentNamespaceOptions = {},
): Promise<Buffer> {
  const namespaceEntries = Object.entries(namespaceOptions.namespaces ?? {});
  for (const [prefix] of namespaceEntries) assertXmlPrefix(prefix);
  const additionalIgnorablePrefixes = namespaceOptions.ignorablePrefixes ?? [];
  for (const prefix of additionalIgnorablePrefixes) assertXmlPrefix(prefix);

  const extraNamespaces = namespaceEntries
    .map(([prefix, uri]) => ` xmlns:${prefix}="${escapeXmlAttr(uri)}"`)
    .join('');
  const ignorable = ['w14', ...additionalIgnorablePrefixes].join(' ');
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
    ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"` +
    extraNamespaces +
    ` mc:Ignorable="${escapeXmlAttr(ignorable)}">` +
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

  const hyperlinkRelsXml = hyperlinkRels
    .map((rel) => {
      const external = rel.external ?? true;
      const mode = external ? ` TargetMode="External"` : '';
      return (
        `<Relationship Id="${escapeXmlAttr(rel.id)}"` +
        ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"` +
        ` Target="${escapeXmlAttr(rel.target)}"${mode}/>`
      );
    })
    .join('');

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `${hyperlinkRelsXml}` +
    `</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml, { createFolders: false });
  zip.file('_rels/.rels', rootRelsXml, { createFolders: false });
  zip.file('word/document.xml', documentXml, { createFolders: false });
  zip.file('word/_rels/document.xml.rels', docRelsXml, { createFolders: false });

  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}
