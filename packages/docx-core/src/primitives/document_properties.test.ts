/**
 * Document properties primitive: reading the Core Properties and Extended
 * File Properties parts through the package relationships, and writing them
 * element by element without disturbing anything else in the package.
 */

import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import {
  CORE_PROPERTIES_CONTENT_TYPE,
  CORE_PROPERTIES_REL_TYPES,
  DocumentPropertiesError,
  EXTENDED_PROPERTIES_CONTENT_TYPE,
  EXTENDED_PROPERTIES_REL_TYPES,
  isW3cdtfDate,
  readDocumentProperties,
  setDocumentProperties,
  validateDocumentPropertyValue,
} from './document_properties.js';
import { OOXML } from './namespaces.js';
import { parseXml } from './xml.js';
import { DocxZip } from './zip.js';

const TEST_FEATURE = 'add-document-properties-control';
// docx-core primitives share the package's epics; sections and layout primitives file under Document Comparison too.
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 2, section: '8.2' },
    { spec: 'ECMA-376', edition: 5, part: 2, section: '8.3.4.3' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '22.2' },
  );

const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DCTERMS = 'http://purl.org/dc/terms/';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

const WORD_CORE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
  + `<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="${DCTERMS}"`
  + ` xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="${XSI}" xmlns:ext="urn:example:ext">`
  + '<dc:title>Old title</dc:title><dc:creator>Alice</dc:creator><cp:lastModifiedBy>Alice</cp:lastModifiedBy>'
  + '<cp:revision>3</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:created>'
  + '<dcterms:modified xsi:type="dcterms:W3CDTF">2024-02-01T00:00:00Z</dcterms:modified>'
  + '<ext:custom ext:flag="1">keep me</ext:custom></cp:coreProperties>';

const PREFIXED_APP =
  '<?xml version="1.0" encoding="utf-8" standalone="yes"?>'
  + '<ap:Properties xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"'
  + ' xmlns:ap="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
  + '<ap:Template>Normal.dotm</ap:Template><ap:TotalTime>7</ap:TotalTime><ap:Application>Microsoft Office Word</ap:Application>'
  + '<ap:HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Title</vt:lpstr></vt:variant>'
  + '<vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></ap:HeadingPairs></ap:Properties>';

/** A package with Word-shaped core and app parts (the app root prefixed, as in the NVCA corpus). */
async function packageWithParts(core = WORD_CORE, app = PREFIXED_APP): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await buildDocxFromBodyXml('<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));
  zip.file('docProps/core.xml', core);
  zip.file('docProps/app.xml', app);
  const rels = await zip.file('_rels/.rels')!.async('string');
  zip.file('_rels/.rels', rels.replace('</Relationships>',
    `<Relationship Id="rId2" Type="${CORE_PROPERTIES_REL_TYPES[0]}" Target="docProps/core.xml"/>`
    + `<Relationship Id="rId3" Type="${EXTENDED_PROPERTIES_REL_TYPES[0]}" Target="/docProps/app.xml"/></Relationships>`));
  const types = await zip.file('[Content_Types].xml')!.async('string');
  zip.file('[Content_Types].xml', types.replace('</Types>',
    `<Override PartName="/docProps/core.xml" ContentType="${CORE_PROPERTIES_CONTENT_TYPE}"/>`
    + `<Override PartName="/docProps/app.xml" ContentType="${EXTENDED_PROPERTIES_CONTENT_TYPE}"/></Types>`));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function entryTexts(zip: DocxZip): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const name of zip.listFiles().sort()) texts.set(name, (await zip.readTextOrNull(name)) ?? '');
  return texts;
}

describe('document properties primitive', () => {
  test('reads core and extended properties through the package relationships', async () => {
    const zip = await DocxZip.load(await packageWithParts());
    const before = await entryTexts(zip);
    const properties = await readDocumentProperties(zip);
    expect(properties.corePart).toBe('docProps/core.xml');
    expect(properties.appPart).toBe('docProps/app.xml');
    expect(properties.core).toMatchObject({
      title: 'Old title',
      creator: 'Alice',
      lastModifiedBy: 'Alice',
      revision: '3',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-02-01T00:00:00Z',
      subject: null,
      lastPrinted: null,
    });
    expect(properties.app).toEqual({
      application: 'Microsoft Office Word',
      appVersion: null,
      company: null,
      manager: null,
      template: 'Normal.dotm',
    });
    expect(await entryTexts(zip)).toEqual(before);
  });

  test('sets and removes properties in place, keeping every other element, attribute and declaration', async () => {
    const zip = await DocxZip.load(await packageWithParts());
    const before = await entryTexts(zip);
    const result = await setDocumentProperties(zip, {
      core: { title: 'Terms & <Conditions> "v2"', modified: '2026-01-02T03:04:05Z', subject: 'NDA', creator: null },
      app: { application: null, company: 'Acme' },
    });
    expect(result.changed).toBe(true);
    expect(result.partsCreated).toEqual([]);
    expect(result.partsChanged).toEqual(['docProps/core.xml', 'docProps/app.xml']);
    expect(result.previous.core.title).toBe('Old title');
    expect(result.current.core).toMatchObject({ title: 'Terms & <Conditions> "v2"', subject: 'NDA', creator: null, modified: '2026-01-02T03:04:05Z' });
    expect(result.current.app).toMatchObject({ application: null, company: 'Acme', template: 'Normal.dotm' });
    expect(await readDocumentProperties(zip)).toEqual(result.current);

    const after = await entryTexts(zip);
    for (const [name, text] of before) {
      if (name !== 'docProps/core.xml' && name !== 'docProps/app.xml') expect(after.get(name), name).toBe(text);
    }
    const core = after.get('docProps/core.xml')!;
    expect(core).toContain('<dc:title>Terms &amp; &lt;Conditions&gt; "v2"</dc:title>');
    expect(core).toContain('<ext:custom ext:flag="1">keep me</ext:custom>');
    expect(core).toContain('xmlns:ext="urn:example:ext"');
    expect(core).toContain('<dc:subject>NDA</dc:subject>');
    expect(core).not.toContain('dc:creator');
    expect(core).toContain('<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-02T03:04:05Z</dcterms:modified>');
    const app = after.get('docProps/app.xml')!;
    expect(app).toContain('<ap:Company>Acme</ap:Company>');
    expect(app).not.toContain('Application');
    expect(app).toContain('<ap:TotalTime>7</ap:TotalTime>');
    expect(app).toContain('<vt:lpstr>Title</vt:lpstr>');
    expect(app).not.toMatch(/xmlns="/u);
  });

  test('a write whose values already hold changes nothing', async () => {
    const zip = await DocxZip.load(await packageWithParts());
    const before = await entryTexts(zip);
    const result = await setDocumentProperties(zip, {
      core: { title: 'Old title', subject: null },
      app: { manager: null, application: 'Microsoft Office Word' },
    });
    expect(result.changed).toBe(false);
    expect(result.partsChanged).toEqual([]);
    expect(await entryTexts(zip)).toEqual(before);
  });

  test('creates missing parts with one relationship and one content-type override each', async () => {
    const zip = await DocxZip.load(await buildDocxFromBodyXml('<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));
    expect(await readDocumentProperties(zip)).toMatchObject({ corePart: null, appPart: null });
    const removal = await setDocumentProperties(zip, { core: { title: null }, app: { application: null } });
    expect(removal.changed).toBe(false);
    expect(zip.hasFile('docProps/core.xml')).toBe(false);

    const result = await setDocumentProperties(zip, {
      core: { title: 'Fresh', created: '2026-03-04' },
      app: { company: 'Acme', appVersion: '16.0000' },
    });
    expect(result.partsCreated).toEqual(['docProps/core.xml', 'docProps/app.xml']);
    expect(result.partsChanged).toEqual(['docProps/core.xml', 'docProps/app.xml', '[Content_Types].xml', '_rels/.rels']);

    const rels = parseXml(await zip.readText('_rels/.rels'));
    const relationships = Array.from(rels.getElementsByTagNameNS(OOXML.REL_NS, 'Relationship'));
    const coreRels = relationships.filter((rel) => rel.getAttribute('Type') === CORE_PROPERTIES_REL_TYPES[0]);
    const appRels = relationships.filter((rel) => rel.getAttribute('Type') === EXTENDED_PROPERTIES_REL_TYPES[0]);
    expect(coreRels.map((rel) => rel.getAttribute('Target'))).toEqual(['docProps/core.xml']);
    expect(appRels.map((rel) => rel.getAttribute('Target'))).toEqual(['docProps/app.xml']);
    expect(new Set(relationships.map((rel) => rel.getAttribute('Id'))).size).toBe(relationships.length);

    const types = parseXml(await zip.readText('[Content_Types].xml'));
    const overrides = Array.from(types.getElementsByTagNameNS(OOXML.CT_NS, 'Override'));
    expect(overrides.filter((o) => o.getAttribute('PartName') === '/docProps/core.xml').map((o) => o.getAttribute('ContentType'))).toEqual([CORE_PROPERTIES_CONTENT_TYPE]);
    expect(overrides.filter((o) => o.getAttribute('PartName') === '/docProps/app.xml').map((o) => o.getAttribute('ContentType'))).toEqual([EXTENDED_PROPERTIES_CONTENT_TYPE]);

    const core = parseXml(await zip.readText('docProps/core.xml'));
    const created = core.getElementsByTagNameNS(DCTERMS, 'created')[0]!;
    expect(created.prefix).toBe('dcterms');
    expect(created.getAttributeNS(XSI, 'type')).toBe('dcterms:W3CDTF');
    expect(created.textContent).toBe('2026-03-04');
    expect(await readDocumentProperties(zip)).toMatchObject({
      corePart: 'docProps/core.xml',
      appPart: 'docProps/app.xml',
      core: { title: 'Fresh', created: '2026-03-04' },
      app: { company: 'Acme', appVersion: '16.0000' },
    });
  });

  test('a default-namespace core root and a strict extended part keep their own namespace forms', async () => {
    const core = `<coreProperties xmlns="${CP}"><category>Specification</category></coreProperties>`;
    const strictApp = '<Properties xmlns="http://purl.oclc.org/ooxml/officeDocument/extendedProperties"><Company>Old</Company></Properties>';
    const zip = await DocxZip.load(await packageWithParts(core, strictApp));
    const result = await setDocumentProperties(zip, {
      core: { contentStatus: 'Final', modified: '2026-05-06T07:08:09+02:00' },
      app: { company: 'New' },
    });
    expect(result.changed).toBe(true);
    const coreText = await zip.readText('docProps/core.xml');
    expect(coreText).toContain('<contentStatus>Final</contentStatus>');
    expect(coreText).toContain(`xmlns:dcterms="${DCTERMS}"`);
    expect(coreText).toContain(`xmlns:xsi="${XSI}"`);
    expect(coreText).toContain('<dcterms:modified xsi:type="dcterms:W3CDTF">2026-05-06T07:08:09+02:00</dcterms:modified>');
    expect(await zip.readText('docProps/app.xml')).toContain('<Company>New</Company>');
    expect((await readDocumentProperties(zip)).core.category).toBe('Specification');
  });

  test('a dcterms prefix bound to another namespace is refused rather than rewritten', async () => {
    const core = `<cp:coreProperties xmlns:cp="${CP}" xmlns:dcterms="urn:not-dcterms"/>`;
    const zip = await DocxZip.load(await packageWithParts(core));
    const before = await entryTexts(zip);
    await expect(setDocumentProperties(zip, { core: { created: '2026-01-01' } })).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_PROPERTIES_PART' });
    expect(await entryTexts(zip)).toEqual(before);
  });

  test('a part whose root is not the one its relationship calls for is refused', async () => {
    const zip = await DocxZip.load(await packageWithParts('<notCore/>'));
    await expect(readDocumentProperties(zip)).rejects.toBeInstanceOf(DocumentPropertiesError);
  });

  test('values are validated before anything is written', async () => {
    const zip = await DocxZip.load(await packageWithParts());
    const before = await entryTexts(zip);
    const cases: Array<[Parameters<typeof setDocumentProperties>[1], string]> = [
      [{ core: { title: 'ok', created: '2026-13-01' } }, 'core.created'],
      [{ core: { modified: '2026-02-30T00:00:00Z' } }, 'core.modified'],
      [{ core: { modified: '2026-01-01T10:00:00' } }, 'core.modified'],
      [{ core: { revision: '-1' } }, 'core.revision'],
      [{ core: { language: 'en_US' } }, 'core.language'],
      [{ app: { appVersion: '16.0' } }, 'app.appVersion'],
      [{ core: { title: '' } }, 'core.title'],
      [{ core: { title: 'bad\u0001char' } }, 'core.title'],
      [{ core: { lastPrinted: '2026-01-01' } as never }, 'core.lastPrinted'],
    ];
    for (const [mutation, property] of cases) {
      await expect(setDocumentProperties(zip, mutation), property).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_PROPERTY', property });
    }
    await expect(setDocumentProperties(zip, {})).rejects.toMatchObject({ code: 'EMPTY_DOCUMENT_PROPERTIES_MUTATION' });
    expect(await entryTexts(zip)).toEqual(before);
  });

  test('W3CDTF accepts each profile granularity and rejects out-of-range fields', () => {
    for (const value of ['2026', '2026-02', '2026-02-28', '2024-02-29', '2026-02-28T10:20Z', '2026-02-28T10:20:30Z', '2026-02-28T10:20:30.45-05:00']) {
      expect(isW3cdtfDate(value), value).toBe(true);
    }
    for (const value of ['2026-2-28', '2025-02-29', '2026-00-10', '2026-02-28T24:00Z', '2026-02-28T10:20', '2026-02-28 10:20Z', '2026-02-28T10:20:30+05:60']) {
      expect(isW3cdtfDate(value), value).toBe(false);
    }
    expect(() => validateDocumentPropertyValue('app', 'application', null)).not.toThrow();
    expect(() => validateDocumentPropertyValue('core', 'title', 42)).toThrow(DocumentPropertiesError);
  });
});
