import fs from 'node:fs/promises';
import { DocxArchive, OOXML, WML_STRICT_NS, createZipBuffer, readZipText } from '@usejunior/docx-core';

function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export async function makeMinimalDocx(paragraphTexts: string[]): Promise<Buffer> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    paragraphTexts.map((t) => `<w:p><w:r><w:t>${xmlEscape(t)}</w:t></w:r></w:p>`).join('') +
    `</w:body></w:document>`;
  return makeDocxWithDocumentXml(xml);
}

const FOOTER_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

/**
 * Minimal DOCX whose single section selects a default footer (`word/footer1.xml`),
 * or — when `footerText` is `null` — the same body with no footer at all.
 *
 * The pair (with footer, without footer) is the smallest removed-story input:
 * since #754 the redline keeps the footer part and marks its content as a
 * tracked deletion, so nothing is reported in `unrepresentedChanges` for it.
 * Use `makeMinimalDocxWithPageWidth` for an input that stays unrepresented.
 */
export async function makeMinimalDocxWithFooter(
  paragraphTexts: string[],
  footerText: string | null,
): Promise<Buffer> {
  const body = paragraphTexts.map((t) => `<w:p><w:r><w:t>${xmlEscape(t)}</w:t></w:r></w:p>`).join('');
  const sectPr = footerText === null
    ? '<w:sectPr/>'
    : '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/></w:sectPr>';
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${body}${sectPr}</w:body></w:document>`;
  if (footerText === null) return makeDocxWithDocumentXml(documentXml);

  const footerXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:p><w:r><w:t>${xmlEscape(footerText)}</w:t></w:r></w:p></w:ftr>`;
  const documentRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdFooter1" Type="${FOOTER_RELATIONSHIP_TYPE}" Target="footer1.xml"/>` +
    `</Relationships>`;
  return makeDocxWithDocumentXml(documentXml, {
    'word/_rels/document.xml.rels': documentRelsXml,
    'word/footer1.xml': footerXml,
  });
}

/**
 * Minimal DOCX whose single section declares a page width in twips.
 *
 * Two of these with different widths are the smallest input on which
 * `compareDocuments` reports a non-empty `unrepresentedChanges` (#1029): the
 * comparison emits no revision for section properties, so the difference is
 * reported as `{ scope: 'section', kind: 'changed' }`.
 */
export async function makeMinimalDocxWithPageWidth(
  paragraphTexts: string[],
  pageWidthTwips: number,
): Promise<Buffer> {
  const body = paragraphTexts.map((t) => `<w:p><w:r><w:t>${xmlEscape(t)}</w:t></w:r></w:p>`).join('');
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="${pageWidthTwips}" w:h="15840"/></w:sectPr></w:body></w:document>`;
  return makeDocxWithDocumentXml(documentXml);
}

const MINIMAL_CONTENT_TYPES_XML = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '  <Default Extension="xml" ContentType="application/xml"/>',
  '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  '</Types>',
].join('\n');

const MINIMAL_RELS_XML = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
  '</Relationships>',
].join('\n');

export async function makeDocxWithDocumentXml(documentXml: string, extraFiles?: Record<string, string | Buffer | Uint8Array>): Promise<Buffer> {
  return createZipBuffer({
    '[Content_Types].xml': MINIMAL_CONTENT_TYPES_XML,
    '_rels/.rels': MINIMAL_RELS_XML,
    'word/document.xml': documentXml,
    ...(extraFiles ?? {}),
  });
}

export async function readDocumentXmlFromPath(filePath: string): Promise<string> {
  const outBuf = await fs.readFile(filePath);
  const text = await readZipText(outBuf, 'word/document.xml');
  if (text === null) {
    throw new Error('Missing file in .docx: word/document.xml');
  }
  return text;
}

export function extractParaIdsFromToon(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('_bk_'))
    .map((l) => l.split('|')[0]!.trim());
}

export function firstParaIdFromToon(content: string): string {
  const ids = extractParaIdsFromToon(content);
  if (ids.length === 0) throw new Error('No paragraph IDs found in TOON content');
  return ids[0]!;
}

/**
 * Rewrite a Transitional package's `word/document.xml` into the ISO/IEC 29500
 * Strict WordprocessingML namespace. This is the #1025 reproduction: the same
 * package, every `w:` element moved to the Strict namespace, which safe-docx
 * refuses at load with UNSUPPORTED_CONFORMANCE_CLASS.
 */
export async function makeStrictDocx(transitional: Buffer): Promise<Buffer> {
  const archive = await DocxArchive.load(transitional);
  const xml = await archive.getDocumentXml();
  if (!xml.includes(OOXML.W_NS)) {
    throw new Error('makeStrictDocx expects a Transitional package');
  }
  archive.setDocumentXml(xml.split(OOXML.W_NS).join(WML_STRICT_NS));
  return archive.save();
}
