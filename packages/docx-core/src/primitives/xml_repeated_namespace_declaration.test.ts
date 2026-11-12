/**
 * A start tag that declares the same namespace twice (#1032), e.g.
 * `<w:document xmlns:w="…main" xmlns:w="…main">`. A repeated attribute breaks
 * XML 1.0 well-formedness constraint "Unique Att Spec" (§3.1), and xmldom
 * rejects it. An exact repeat binds the prefix to the same URI either way, so
 * it is dropped and the part loads; a repeat with a different URI is ambiguous
 * and fails with a typed error that names the part.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1032
 */

import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { afterEach, describe, expect, vi } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml, buildDocxWithAncillaryParts } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';
import {
  findUnparseableXmlPart,
  parseXml,
  removeRepeatedNamespaceDeclarations,
  serializeXml,
  XmlNamespaceRedeclarationError,
  XmlPartParseError,
} from './xml.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'XML part repeated namespace declaration tolerance' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OTHER_NS = 'urn:example:not-wordprocessingml';
const BODY = '<w:p><w:r><w:t>Alpha bravo charlie.</w:t></w:r></w:p>';
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1));

/** The shared builder appends `namespaces` after its own `xmlns:w`, so `w` repeats it. */
const repeatW = (uri: string) => ({ namespaces: { w: uri } });

/** A header part whose root repeats `xmlns:w` with `uri` (null: declared once). */
const headerXml = (uri: string | null) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:hdr xmlns:w="${W_NS}"${uri === null ? '' : ` xmlns:w="${uri}"`}>` +
  `<w:p><w:r><w:t>Header text.</w:t></w:r></w:p></w:hdr>`;

async function buildWithHeader(uri: string | null): Promise<Buffer> {
  return buildDocxWithAncillaryParts({
    bodyXml: BODY,
    sectPrXml: '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/></w:sectPr>',
    relationships: [{ id: 'rIdHeader1', type: `${R_NS}/header`, target: 'header1.xml' }],
    parts: [
      {
        path: 'word/header1.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
        xml: headerXml(uri),
      },
    ],
  });
}

async function partText(buffer: Buffer, part: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(part)!.async('string');
}

/** Parse with xmldom directly: throws on any well-formedness error. */
function strictParse(xml: string): Document {
  return new DOMParser({ onError: () => {} }).parseFromString(xml, 'application/xml') as unknown as Document;
}

async function loadNormalizeSave(buffer: Buffer) {
  const doc = await DocxDocument.load(buffer);
  doc.normalize();
  doc.insertParagraphBookmarks('ns-1032');
  const view = doc.buildDocumentView({ showFormatting: true });
  const { buffer: saved } = await doc.toBuffer({ fileDate: FIXED_DATE });
  return { view, documentXml: await partText(saved, 'word/document.xml') };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('removeRepeatedNamespaceDeclarations', () => {
  test('drops the exact repeat of a prefixed or default declaration and keeps the first', () => {
    expect(removeRepeatedNamespaceDeclarations(`<w:a xmlns:w="${W_NS}" xmlns:w="${W_NS}"/>`)).toBe(
      `<w:a xmlns:w="${W_NS}"/>`,
    );
    expect(removeRepeatedNamespaceDeclarations(`<a xmlns='u' b="1"\n\txmlns = 'u'><c/></a>`)).toBe(
      `<a xmlns='u' b="1"><c/></a>`,
    );
    // Repeats on several tags are all removed in one pass.
    expect(
      removeRepeatedNamespaceDeclarations(`<a xmlns:x="u" xmlns:x="u"><b xmlns:y="v" xmlns:y="v">t</b></a>`),
    ).toBe(`<a xmlns:x="u"><b xmlns:y="v">t</b></a>`);
  });

  test('never edits character data, comments, CDATA, processing instructions or attribute values', () => {
    const lookalike = `xmlns:w="${W_NS}" xmlns:w="${W_NS}"`;
    const xml =
      `<?pi ${lookalike}?><!-- <w:x ${lookalike}/> -->` +
      `<w:document xmlns:w="${W_NS}" w:val='${lookalike}' xmlns:w="${W_NS}">` +
      `<w:t>&lt;w:x ${lookalike}&gt; a &gt; b</w:t><![CDATA[<w:x ${lookalike}/>]]></w:document>`;
    const expected = xml.replace(` xmlns:w="${W_NS}">`, '>');
    expect(removeRepeatedNamespaceDeclarations(xml)).toBe(expected);
    expect(strictParse(expected).documentElement.getAttribute('w:val')).toBe(lookalike);
  });

  test('leaves a redeclaration on a different element alone (that is well-formed)', () => {
    expect(removeRepeatedNamespaceDeclarations(`<a xmlns:x="u"><b xmlns:x="u"/></a>`)).toBeNull();
  });

  test('a repeat with a different URI throws a typed error naming the element and both URIs', () => {
    let failure: unknown;
    try {
      removeRepeatedNamespaceDeclarations(`<w:document xmlns:w="${W_NS}" xmlns:w="${OTHER_NS}"/>`);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(XmlNamespaceRedeclarationError);
    const typed = failure as XmlNamespaceRedeclarationError;
    expect(typed.elementName).toBe('w:document');
    expect(typed.attributeName).toBe('xmlns:w');
    expect(typed.firstValue).toBe(W_NS);
    expect(typed.secondValue).toBe(OTHER_NS);
    expect(typed.message).toContain('declares xmlns:w twice with different namespace URIs');
  });

  test('returns null when there is nothing safe to remove', () => {
    // Repeats of ordinary attributes are not namespace declarations.
    expect(removeRepeatedNamespaceDeclarations('<a b="1" b="1"/>')).toBeNull();
    // A DOCTYPE, an unterminated comment or a malformed attribute: do not guess.
    expect(removeRepeatedNamespaceDeclarations('<!DOCTYPE a><a xmlns:x="u" xmlns:x="u"/>')).toBeNull();
    expect(removeRepeatedNamespaceDeclarations('<a xmlns:x="u" xmlns:x="u"/><!-- open')).toBeNull();
    expect(removeRepeatedNamespaceDeclarations('<a xmlns:x="u" xmlns:x=u/>')).toBeNull();
  });
});

describe('parseXml with a repeated namespace declaration', () => {
  test('parses an exact repeat like the single declaration, without logging a fatal error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repeated = `<w:document xmlns:w="${W_NS}" xmlns:w="${W_NS}"><w:body/></w:document>`;
    const single = `<w:document xmlns:w="${W_NS}"><w:body/></w:document>`;
    const doc = parseXml(repeated);
    expect(doc.documentElement.namespaceURI).toBe(W_NS);
    expect(serializeXml(doc)).toBe(serializeXml(parseXml(single)));
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('a conflicting repeat fails with XmlPartParseError naming the part, caused by the typed error', () => {
    const conflicting = `<w:document xmlns:w="${W_NS}" xmlns:w="${OTHER_NS}"><w:body/></w:document>`;
    let failure: unknown;
    try {
      parseXml(conflicting, { partName: 'word/document.xml' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(XmlPartParseError);
    expect((failure as XmlPartParseError).partName).toBe('word/document.xml');
    expect((failure as Error).message).toContain('Failed to parse XML part word/document.xml: ');
    expect((failure as Error).message).toContain(OTHER_NS);
    expect((failure as Error).cause).toBeInstanceOf(XmlNamespaceRedeclarationError);
    // Without a part name the typed error itself is thrown.
    expect(() => parseXml(conflicting)).toThrow(XmlNamespaceRedeclarationError);
  });

  test('a repeated ordinary attribute still fails with the original parse error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => parseXml(`<a xmlns:x="u" xmlns:x="u" b="1" b="1"/>`)).toThrow(/Attribute b redefined/);
  });
});

describe('DocxDocument.load with a repeated namespace declaration', () => {
  test('word/document.xml repeating xmlns:w loads, normalizes and saves like the clean package', async () => {
    const clean = await buildDocxFromBodyXml(BODY);
    const repeated = await buildDocxFromBodyXml(BODY, [], repeatW(W_NS));
    expect((await partText(repeated, 'word/document.xml')).split(`xmlns:w="${W_NS}"`)).toHaveLength(3);

    const observed = await loadNormalizeSave(repeated);
    expect(observed).toEqual(await loadNormalizeSave(clean));
    // The re-serialized main part declares xmlns:w once and is well-formed.
    expect(observed.documentXml.split(`xmlns:w="${W_NS}"`)).toHaveLength(2);
    expect(strictParse(observed.documentXml).documentElement.localName).toBe('document');
  });

  test('a conflicting xmlns:w on word/document.xml fails with XmlPartParseError naming the part', async () => {
    const conflicting = await buildDocxFromBodyXml(BODY, [], repeatW(OTHER_NS));
    const failure = await DocxDocument.load(conflicting).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(XmlPartParseError);
    expect((failure as XmlPartParseError).partName).toBe('word/document.xml');
    expect((failure as Error).cause).toBeInstanceOf(XmlNamespaceRedeclarationError);
  });

  test('a header part repeating xmlns:w loads; a conflicting one is named', async () => {
    expect(await loadNormalizeSave(await buildWithHeader(W_NS))).toEqual(
      await loadNormalizeSave(await buildWithHeader(null)),
    );

    const failure = await DocxDocument.load(await buildWithHeader(OTHER_NS)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(XmlPartParseError);
    expect((failure as XmlPartParseError).partName).toBe('word/header1.xml');
  });

  test('findUnparseableXmlPart accepts the exact repeat and names the conflicting part', async () => {
    expect(await findUnparseableXmlPart(await buildWithHeader(W_NS), 'revised')).toBeNull();
    const failure = await findUnparseableXmlPart(await buildWithHeader(OTHER_NS), 'revised');
    expect(failure).toBeInstanceOf(XmlPartParseError);
    expect(failure!.partName).toBe('word/header1.xml');
    expect(failure!.source).toBe('revised');
  });
});
