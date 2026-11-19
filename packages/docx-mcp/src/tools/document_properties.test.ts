import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { checkGeneratedPackage, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { dispatchToolCall } from '../server.js';
import { testAllure } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { getDocumentProperties } from './get_document_properties.js';
import { readFile } from './read_file.js';
import { save } from './save.js';
import { setDocumentProperties } from './set_document_properties.js';

const TEST_FEATURE = 'add-document-properties-control';
const test = testAllure
  .epic('Document Editing')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 2, section: '8.2' },
    { spec: 'ECMA-376', edition: 5, part: 2, section: '8.3.4.3' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '22.2' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DCTERMS = 'http://purl.org/dc/terms/';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const CORE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const APP_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
const CORE_CT = 'application/vnd.openxmlformats-package.core-properties+xml';
const APP_CT = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';

const DOCUMENT_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>`
  + '<w:p><w:r><w:t>This Agreement is made between the parties.</w:t></w:r></w:p>'
  + '<w:sectPr/></w:body></w:document>';

/** Word-shaped parts with content outside the closed set, the app root prefixed as in the NVCA corpus. */
const PROPERTY_PARTS: Record<string, string> = {
  '[Content_Types].xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + `<Override PartName="/docProps/core.xml" ContentType="${CORE_CT}"/><Override PartName="/docProps/app.xml" ContentType="${APP_CT}"/>`
    + '</Types>',
  '_rels/.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId3" Type="${APP_REL}" Target="docProps/app.xml"/>`
    + `<Relationship Id="rId2" Type="${CORE_REL}" Target="docProps/core.xml"/>`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>',
  'docProps/core.xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="${DCTERMS}"`
    + ` xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="${XSI}" xmlns:ext="urn:example:ext">`
    + '<dc:title>Draft NDA</dc:title><dc:creator>Alice</dc:creator><cp:lastPrinted>2025-10-01T20:53:42Z</cp:lastPrinted>'
    + '<dcterms:created xsi:type="dcterms:W3CDTF">2025-10-01T20:53:42Z</dcterms:created>'
    + '<dcterms:modified xsi:type="dcterms:W3CDTF">2025-10-01T20:53:42Z</dcterms:modified>'
    + '<ext:note ext:id="7">keep</ext:note></cp:coreProperties>',
  'docProps/app.xml':
    '<?xml version="1.0" encoding="utf-8" standalone="yes"?>'
    + '<ap:Properties xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"'
    + ' xmlns:ap="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
    + '<ap:Template>Normal.dotm</ap:Template><ap:Application>Microsoft Office Word</ap:Application><ap:Pages>3</ap:Pages></ap:Properties>',
  'docProps/custom.xml': '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>',
};

async function openWithParts() {
  return openSession([], { mgr: createTestSessionManager({ defaultAiAuthor: 'SafeDocX AI' }), xml: DOCUMENT_XML, extraFiles: PROPERTY_PARTS });
}

async function openWithoutParts() {
  return openSession([], { mgr: createTestSessionManager({ defaultAiAuthor: 'SafeDocX AI' }), xml: DOCUMENT_XML });
}

async function zipTexts(buffer: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const texts = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    if (!zip.files[name]!.dir) texts.set(name, await zip.files[name]!.async('string'));
  }
  return texts;
}

async function saveClean(mgr: ReturnType<typeof createTestSessionManager>, inputPath: string, name = 'out.docx'): Promise<{ result: Record<string, unknown>; buffer: Buffer }> {
  const dir = await createTrackedTempDir('docprops-save-');
  const output = path.join(dir, name);
  const result = await save(mgr, { file_path: inputPath, save_to_local_path: output, save_format: 'clean' });
  assertSuccess(result, 'save');
  return { result, buffer: await fs.readFile(output) };
}

describe('Document properties tools', () => {
  registerCleanup();

  test.openspec('Document properties are read from the related parts')(
    'reads every core and extended property, names the parts, and changes nothing',
    async () => {
      const opened = await openWithParts();
      const result = await getDocumentProperties(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(result, 'get_document_properties');
      expect(result.core_part).toBe('docProps/core.xml');
      expect(result.app_part).toBe('docProps/app.xml');
      expect(result.core).toEqual({
        title: 'Draft NDA',
        subject: null,
        creator: 'Alice',
        keywords: null,
        description: null,
        category: null,
        content_status: null,
        language: null,
        identifier: null,
        version: null,
        last_modified_by: null,
        revision: null,
        created: '2025-10-01T20:53:42Z',
        modified: '2025-10-01T20:53:42Z',
        last_printed: '2025-10-01T20:53:42Z',
      });
      expect(result.app).toEqual({ application: 'Microsoft Office Word', app_version: null, company: null, manager: null, template: 'Normal.dotm' });
      const status = await dispatchToolCall(opened.mgr, 'get_file_status', { file_path: opened.inputPath });
      expect(status.edit_count).toBe(0);

      const bare = await openWithoutParts();
      const none = await getDocumentProperties(bare.mgr, { file_path: bare.inputPath });
      assertSuccess(none, 'get_document_properties');
      expect(none.core_part).toBeNull();
      expect(none.app_part).toBeNull();
      expect(Object.values(none.core as Record<string, unknown>).every((value) => value === null)).toBe(true);
    },
  );

  test.openspec('Properties are set and removed in place')(
    'sets core and extended values, removes Application, and reports both states',
    async () => {
      const opened = await openWithParts();
      const result = await dispatchToolCall(opened.mgr, 'set_document_properties', {
        file_path: opened.inputPath,
        core: { title: 'Mutual NDA & <Schedule A>', creator: 'Jane Roe', last_modified_by: 'Counsel', revision: 4, modified: '2026-01-02T03:04:05Z', created: '2026-01-01' },
        app: { application: null, company: 'Acme LLP' },
      });
      assertSuccess(result as { success: boolean }, 'set_document_properties');
      expect(result.changed).toBe(true);
      expect((result.previous as { core: Record<string, unknown> }).core.title).toBe('Draft NDA');
      expect(result.resulting).toMatchObject({
        core: { title: 'Mutual NDA & <Schedule A>', creator: 'Jane Roe', last_modified_by: 'Counsel', revision: '4', created: '2026-01-01', modified: '2026-01-02T03:04:05Z' },
        app: { application: null, company: 'Acme LLP', template: 'Normal.dotm' },
      });
      expect(result.parts_changed).toEqual(['docProps/core.xml', 'docProps/app.xml']);

      const read = await getDocumentProperties(opened.mgr, { file_path: opened.inputPath });
      expect(read.core).toEqual((result.resulting as { core: unknown }).core);

      const { buffer } = await saveClean(opened.mgr, opened.inputPath);
      const texts = await zipTexts(buffer);
      const core = parseXml(texts.get('docProps/core.xml')!);
      expect(core.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]!.textContent).toBe('Mutual NDA & <Schedule A>');
      expect(texts.get('docProps/core.xml')).toContain('Mutual NDA &amp; &lt;Schedule A&gt;');
      for (const name of ['created', 'modified']) {
        const element = core.getElementsByTagNameNS(DCTERMS, name)[0]!;
        expect(element.prefix).toBe('dcterms');
        expect(element.getAttributeNS(XSI, 'type')).toBe('dcterms:W3CDTF');
      }
      expect(texts.get('docProps/app.xml')).not.toContain('Application');
    },
  );

  test.openspec('Unknown content in the parts is preserved')(
    'keeps unknown elements, declarations, prefixes and every other part',
    async () => {
      const opened = await openWithParts();
      const { buffer: before } = await saveClean(opened.mgr, opened.inputPath, 'before.docx');
      const result = await setDocumentProperties(opened.mgr, { file_path: opened.inputPath, core: { subject: 'Confidentiality' }, app: { manager: 'GC' } });
      assertSuccess(result, 'set_document_properties');
      const { buffer: after } = await saveClean(opened.mgr, opened.inputPath, 'after.docx');
      const beforeTexts = await zipTexts(before);
      const afterTexts = await zipTexts(after);
      expect([...afterTexts.keys()]).toEqual([...beforeTexts.keys()]);
      for (const [name, text] of beforeTexts) {
        if (name === 'docProps/core.xml' || name === 'docProps/app.xml') continue;
        expect(afterTexts.get(name), name).toBe(text);
      }
      const core = afterTexts.get('docProps/core.xml')!;
      expect(core).toContain('<ext:note ext:id="7">keep</ext:note>');
      expect(core).toContain('xmlns:ext="urn:example:ext"');
      expect(core).toContain('<cp:lastPrinted>2025-10-01T20:53:42Z</cp:lastPrinted>');
      expect(core).toContain('<dc:subject>Confidentiality</dc:subject>');
      const app = afterTexts.get('docProps/app.xml')!;
      expect(app).toContain('<ap:Manager>GC</ap:Manager>');
      expect(app).toContain('<ap:Pages>3</ap:Pages>');
      expect(app).toContain('<ap:Application>Microsoft Office Word</ap:Application>');
      expect(app).not.toMatch(/xmlns="/u);
    },
  );

  test.openspec('Missing property parts are created with relationship and content type')(
    'creates both parts, their relationships and overrides, and the package reopens with the values',
    async () => {
      const opened = await openWithoutParts();
      const result = await setDocumentProperties(opened.mgr, { file_path: opened.inputPath, core: { title: 'Fresh Agreement' }, app: { company: 'Acme' } });
      assertSuccess(result, 'set_document_properties');
      expect(result.parts_created).toEqual(['docProps/core.xml', 'docProps/app.xml']);
      const { buffer } = await saveClean(opened.mgr, opened.inputPath);
      const texts = await zipTexts(buffer);
      const rels = parseXml(texts.get('_rels/.rels')!);
      const relationships = Array.from(rels.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship'));
      expect(relationships.filter((rel) => rel.getAttribute('Type') === CORE_REL).map((rel) => rel.getAttribute('Target'))).toEqual(['docProps/core.xml']);
      expect(relationships.filter((rel) => rel.getAttribute('Type') === APP_REL).map((rel) => rel.getAttribute('Target'))).toEqual(['docProps/app.xml']);
      expect(new Set(relationships.map((rel) => rel.getAttribute('Id'))).size).toBe(relationships.length);
      const types = parseXml(texts.get('[Content_Types].xml')!);
      const overrides = Array.from(types.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Override'));
      expect(overrides.filter((o) => o.getAttribute('PartName') === '/docProps/core.xml').map((o) => o.getAttribute('ContentType'))).toEqual([CORE_CT]);
      expect(overrides.filter((o) => o.getAttribute('PartName') === '/docProps/app.xml').map((o) => o.getAttribute('ContentType'))).toEqual([APP_CT]);

      const check = await checkGeneratedPackage(buffer);
      expect(check.ok, JSON.stringify(check.issues)).toBe(true);

      const dir = await createTrackedTempDir('docprops-reopen-');
      const reopenedPath = path.join(dir, 'reopened.docx');
      await fs.writeFile(reopenedPath, buffer);
      const mgr = createTestSessionManager();
      assertSuccess(await readFile(mgr, { file_path: reopenedPath }), 'read_file');
      const read = await getDocumentProperties(mgr, { file_path: reopenedPath });
      expect(read).toMatchObject({ core: { title: 'Fresh Agreement' }, app: { company: 'Acme' }, core_part: 'docProps/core.xml', app_part: 'docProps/app.xml' });
    },
  );

  test.openspec('Matching values are a no-op')(
    'reports changed=false and records no edit',
    async () => {
      const opened = await openWithParts();
      const same = await setDocumentProperties(opened.mgr, { file_path: opened.inputPath, core: { title: 'Draft NDA', subject: null }, app: { company: null } });
      assertSuccess(same, 'set_document_properties');
      expect(same.changed).toBe(false);
      expect(same.parts_changed).toEqual([]);
      const status = await dispatchToolCall(opened.mgr, 'get_file_status', { file_path: opened.inputPath });
      expect(status.edit_count).toBe(0);

      const bare = await openWithoutParts();
      const removal = await setDocumentProperties(bare.mgr, { file_path: bare.inputPath, core: { title: null }, app: { application: null } });
      expect(removal.changed).toBe(false);
      const { buffer } = await saveClean(bare.mgr, bare.inputPath);
      expect(Object.keys((await JSZip.loadAsync(buffer)).files).some((name) => name.startsWith('docProps/'))).toBe(false);
    },
  );

  test.openspec('Invalid property values are refused before writing')(
    'returns structured validation errors and leaves the package unchanged',
    async () => {
      const opened = await openWithParts();
      const { buffer: before } = await saveClean(opened.mgr, opened.inputPath, 'before.docx');
      const cases: Array<Record<string, unknown>> = [
        { core: { created: '2026-02-30' } },
        { core: { modified: 'tomorrow' } },
        { core: { revision: -1 } },
        { core: { revision: 1.5 } },
        { core: { revision: 'four' } },
        { app: { app_version: '16' } },
        { core: { title: '' } },
        { core: { title: 'bell\u0007' } },
        { core: { last_printed: '2026-01-01' } },
        { core: { identifier: 'x' } },
        { core: { colour: 'red' } },
        { app: { pages: '3' } },
        { core: 'title' },
        {},
        { core: {} },
      ];
      for (const extra of cases) {
        const result = await dispatchToolCall(opened.mgr, 'set_document_properties', { file_path: opened.inputPath, ...extra });
        assertFailure(result as { success: boolean; error?: { code?: string } }, 'VALIDATION_ERROR', JSON.stringify(extra));
      }
      const { buffer: after } = await saveClean(opened.mgr, opened.inputPath, 'after.docx');
      expect(await zipTexts(after)).toEqual(await zipTexts(before));
      const status = await dispatchToolCall(opened.mgr, 'get_file_status', { file_path: opened.inputPath });
      expect(status.edit_count).toBe(0);
    },
  );

  test.openspec('Effective property writes appear in the save report')(
    'lists the change in the non-revision manifest and carries it into clean and tracked outputs',
    async () => {
      const opened = await openWithParts();
      assertSuccess(await setDocumentProperties(opened.mgr, { file_path: opened.inputPath, core: { title: 'Final NDA' } }), 'set_document_properties');
      const status = await dispatchToolCall(opened.mgr, 'get_file_status', { file_path: opened.inputPath });
      expect(status.edit_count).toBe(1);
      const dir = await createTrackedTempDir('docprops-both-');
      const cleanPath = path.join(dir, 'clean.docx');
      const trackedPath = path.join(dir, 'tracked.docx');
      const saved = await save(opened.mgr, { file_path: opened.inputPath, save_to_local_path: cleanPath, tracked_save_to_local_path: trackedPath, save_format: 'both' });
      assertSuccess(saved, 'save');
      const manifest = saved.non_revision_changes as Array<{ tool: string; parts: string[] }>;
      expect(manifest).toEqual([expect.objectContaining({ tool: 'set_document_properties', parts: ['docProps/core.xml'] })]);
      for (const file of [cleanPath, trackedPath]) {
        const texts = await zipTexts(await fs.readFile(file));
        expect(texts.get('docProps/core.xml'), file).toContain('<dc:title>Final NDA</dc:title>');
      }
    },
  );

  test.openspec('Unsupported providers are rejected for document properties')(
    'routes ODT and Google Docs through provider chokepoints',
    async () => {
      const manager = createTestSessionManager();
      for (const toolName of ['get_document_properties', 'set_document_properties']) {
        const extra = toolName === 'set_document_properties' ? { core: { title: 'x' } } : {};
        assertFailure(
          await dispatchToolCall(manager, toolName, { file_path: '/tmp/not-opened-docprops-test.odt', ...extra }) as { success: boolean; error?: { code?: string } },
          'UNSUPPORTED_FOR_ODF',
        );
        assertFailure(
          await dispatchToolCall(manager, toolName, { google_doc_id: 'fake-id', ...extra }) as { success: boolean; error?: { code?: string } },
          'UNSUPPORTED_FOR_PROVIDER',
        );
      }
    },
  );
});
