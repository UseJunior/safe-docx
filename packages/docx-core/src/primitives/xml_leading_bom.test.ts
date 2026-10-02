/**
 * A UTF-8 byte-order mark, or whitespace, before an XML part's `<?xml`
 * declaration must not break parsing (#1024). A leading BOM is legal XML and
 * Microsoft's ISO-Strict Word exports emit it; the NVCA Voting Agreement cache
 * copy carries one on `word/_rels/document.xml.rels`.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1024
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromParts, buildSyntheticDocx } from '../integration/synthetic-docx-fixture.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { DocxDocument } from './document.js';
import { DocxZip } from './zip.js';
import {
  attributeXmlParseError,
  findUnparseableXmlPart,
  isXmlPartPath,
  parseXml,
  serializeXml,
  stripXmlLeadingNoise,
  XmlPartParseError,
} from './xml.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'XML part leading BOM tolerance' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const BOM = '﻿';
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1));

const STYLES_XML =
  `${DECL}<w:styles xmlns:w="${W_NS}">` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
  `<w:rPr><w:b/></w:rPr></w:style></w:styles>`;
const NUMBERING_XML =
  `${DECL}<w:numbering xmlns:w="${W_NS}">` +
  `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
  `<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const STYLED_BODY =
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
  `<w:r><w:t>Alpha bravo charlie.</w:t></w:r></w:p>`;

/** Re-zip `buffer` with `prefix` written in front of `part`'s text. */
async function prefixPart(buffer: Buffer, part: string, prefix: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const text = await zip.file(part)!.async('string');
  zip.file(part, prefix + text);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

async function replacePart(buffer: Buffer, part: string, text: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  zip.file(part, text);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

async function partBytes(buffer: Buffer, part: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  return (await zip.file(part)!.async('nodebuffer')) as Buffer;
}

/** Load, normalize and save; return what a caller observes. */
async function loadNormalizeSave(buffer: Buffer) {
  const doc = await DocxDocument.load(buffer);
  doc.normalize();
  doc.insertParagraphBookmarks('bom-1024');
  const view = doc.buildDocumentView({ showFormatting: true });
  const { buffer: saved } = await doc.toBuffer({ fileDate: FIXED_DATE });
  const zip = await JSZip.loadAsync(saved);
  return {
    view,
    documentXml: await zip.file('word/document.xml')!.async('string'),
  };
}

const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['a BOM', BOM],
  ['a leading newline', '\n'],
  ['leading CRLF and indentation', '\r\n  \t'],
  ['a BOM followed by whitespace', `${BOM}\n `],
];

describe('stripXmlLeadingNoise', () => {
  test('strips one BOM and the whitespace before the first <, and nothing else', () => {
    expect(stripXmlLeadingNoise(`${BOM}${DECL}<a/>`)).toBe(`${DECL}<a/>`);
    expect(stripXmlLeadingNoise(`\r\n \t${DECL}<a/>`)).toBe(`${DECL}<a/>`);
    expect(stripXmlLeadingNoise(`${BOM}\n${DECL}<a/>`)).toBe(`${DECL}<a/>`);
    // Already clean text is returned as the same string.
    const clean = `${DECL}<a> x </a>`;
    expect(stripXmlLeadingNoise(clean)).toBe(clean);
    // Only one BOM is a byte-order mark; a second is content and stays.
    expect(stripXmlLeadingNoise(`${BOM}${BOM}<a/>`)).toBe(`${BOM}<a/>`);
    // Whitespace not followed by markup is not an XML prolog; leave it.
    expect(stripXmlLeadingNoise('  plain text')).toBe('  plain text');
    expect(stripXmlLeadingNoise('')).toBe('');
  });

  test('recognises XML and relationship part paths', () => {
    expect(isXmlPartPath('word/document.xml')).toBe(true);
    expect(isXmlPartPath('word/_rels/document.xml.rels')).toBe(true);
    expect(isXmlPartPath('[Content_Types].xml')).toBe(true);
    expect(isXmlPartPath('_rels/.rels')).toBe(true);
    expect(isXmlPartPath('word/media/image1.png')).toBe(false);
    expect(isXmlPartPath('word/afchunk.htm')).toBe(false);
  });
});

describe('parseXml leading BOM and whitespace', () => {
  for (const [label, prefix] of PREFIXES) {
    test(`parses a part with ${label} before the declaration like the clean part`, () => {
      const xml = `${DECL}<w:document xmlns:w="${W_NS}"><w:body/></w:document>`;
      expect(serializeXml(parseXml(prefix + xml))).toBe(serializeXml(parseXml(xml)));
    });
  }

  test('names the part when a parse failure is attributed', () => {
    let caught: unknown;
    try {
      parseXml(`${DECL}<w:styles xmlns:w="${W_NS}"><w:style>`, { partName: 'word/styles.xml' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(XmlPartParseError);
    expect((caught as XmlPartParseError).partName).toBe('word/styles.xml');
    expect((caught as Error).message).toMatch(/^Failed to parse XML part word\/styles\.xml: /);
    expect(((caught as Error).cause as Error).name).toBe('ParseError');
  });

  test('rethrows the original error when no part name is given', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(expect.objectContaining({ name: 'ParseError' }));
  });
});

describe('archive read sites strip a leading BOM from XML parts', () => {
  test('DocxArchive.getDocumentXml and getFile return markup-first XML; non-XML entries are untouched', async () => {
    let buffer = await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'], footnoteOnParagraph: 0 });
    buffer = await prefixPart(buffer, 'word/document.xml', BOM);
    buffer = await prefixPart(buffer, 'word/footnotes.xml', `${BOM}\n`);
    buffer = await prefixPart(buffer, 'word/_rels/document.xml.rels', BOM);
    const zip = await JSZip.loadAsync(buffer);
    zip.file('word/notes.txt', `${BOM}  <not xml>`);
    const archive = await DocxArchive.load((await zip.generateAsync({ type: 'nodebuffer' })) as Buffer);

    expect((await archive.getDocumentXml()).startsWith('<?xml')).toBe(true);
    expect((await archive.getFile('word/footnotes.xml'))!.startsWith('<?xml')).toBe(true);
    expect((await archive.getFile('word/_rels/document.xml.rels'))!.startsWith('<?xml')).toBe(true);
    expect(await archive.getFile('word/notes.txt')).toBe(`${BOM}  <not xml>`);
  });

  test('DocxZip.readText and readTextOrNull return markup-first XML', async () => {
    let buffer = await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'] });
    buffer = await prefixPart(buffer, 'word/document.xml', `${BOM}\r\n`);
    buffer = await prefixPart(buffer, '[Content_Types].xml', BOM);
    const zip = await DocxZip.load(buffer);
    expect((await zip.readText('word/document.xml')).startsWith('<?xml')).toBe(true);
    expect((await zip.readTextOrNull('[Content_Types].xml'))!.startsWith('<?xml')).toBe(true);
  });

  test('the saved main part is written without the BOM', async () => {
    const buffer = await prefixPart(
      await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'] }),
      'word/document.xml',
      BOM,
    );
    expect((await partBytes(buffer, 'word/document.xml')).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const doc = await DocxDocument.load(buffer);
    const { buffer: saved } = await doc.toBuffer({ fileDate: FIXED_DATE });
    expect((await partBytes(saved, 'word/document.xml')).subarray(0, 5).toString('utf8')).toBe('<?xml');
  });
});

describe('DocxDocument.load().normalize() with a BOM-prefixed part', () => {
  for (const [label, prefix] of PREFIXES) {
    test(`word/document.xml with ${label} loads and normalizes like the clean fixture`, async () => {
      const clean = await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'] });
      const prefixed = await prefixPart(clean, 'word/document.xml', prefix);
      expect(await loadNormalizeSave(prefixed)).toEqual(await loadNormalizeSave(clean));
    });
  }

  for (const part of ['word/styles.xml', 'word/numbering.xml'] as const) {
    test(`${part} with a BOM loads and normalizes like the clean fixture`, async () => {
      const clean = await buildDocxFromParts({
        bodyXml: STYLED_BODY,
        stylesXml: STYLES_XML,
        numberingXml: NUMBERING_XML,
      });
      const prefixed = await prefixPart(clean, part, `${BOM}\n`);
      const expected = await loadNormalizeSave(clean);
      expect(await loadNormalizeSave(prefixed)).toEqual(expected);
      // The fixture really exercises both parts: the list label comes from
      // numbering.xml and the style name and bold from styles.xml.
      const [node] = expected.view.nodes;
      expect(node?.list_label).toBe('1.');
      expect(node?.paragraph_style_name).toBe('heading 1');
      expect(node?.text).toBe('<b>Alpha bravo charlie.</b>');
    });
  }

  test('word/footnotes.xml with a BOM loads and normalizes like the clean fixture', async () => {
    const clean = await buildSyntheticDocx({
      paragraphs: ['Alpha bravo charlie.'],
      footnoteOnParagraph: 0,
      footnoteText: 'A note.',
    });
    const prefixed = await prefixPart(clean, 'word/footnotes.xml', BOM);
    expect(await loadNormalizeSave(prefixed)).toEqual(await loadNormalizeSave(clean));
  });
});

describe('remaining parse failures name the offending part', () => {
  test('DocxDocument.load names a malformed non-main part', async () => {
    const buffer = await buildDocxFromParts({
      bodyXml: STYLED_BODY,
      stylesXml: `${DECL}<w:styles xmlns:w="${W_NS}"><w:style>`,
    });
    await expect(DocxDocument.load(buffer)).rejects.toThrow(XmlPartParseError);
    await expect(DocxDocument.load(buffer)).rejects.toThrow(/word\/styles\.xml/);
  });

  test('findUnparseableXmlPart finds the first malformed part and attributeXmlParseError names it', async () => {
    const clean = await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'] });
    expect(await findUnparseableXmlPart(clean)).toBeNull();
    expect(await findUnparseableXmlPart(Buffer.from('not a zip'))).toBeNull();

    const broken = await replacePart(clean, 'word/header9.xml', `${DECL}<w:hdr xmlns:w="${W_NS}"><w:p>`);
    const found = await findUnparseableXmlPart(broken, 'revised');
    expect(found).toBeInstanceOf(XmlPartParseError);
    expect(found!.partName).toBe('word/header9.xml');
    expect(found!.source).toBe('revised');
    expect(found!.message).toMatch(/^Failed to parse XML part word\/header9\.xml in the revised document: /);

    let raw: unknown;
    try {
      parseXml('<a><b></a>');
    } catch (error) {
      raw = error;
    }
    const attributed = await attributeXmlParseError(raw, broken);
    expect(attributed).toBeInstanceOf(XmlPartParseError);
    expect((attributed as XmlPartParseError).partName).toBe('word/header9.xml');

    // Non-parse errors, and parse errors with no locatable part, pass through.
    const other = new Error('something else');
    expect(await attributeXmlParseError(other, broken)).toBe(other);
    expect(await attributeXmlParseError(raw, clean)).toBe(raw);
  });
});
