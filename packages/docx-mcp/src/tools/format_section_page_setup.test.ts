import fs from 'node:fs/promises';
import path from 'node:path';
import { readZipText } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { dispatchToolCall } from '../server.js';
import { testAllure } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { formatSection } from './format_section.js';
import { save } from './save.js';

const TEST_FEATURE = 'add-section-page-setup-formatting';
const test = testAllure.epic('Document Editing').withLabels({
  feature: TEST_FEATURE,
});
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.13' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.11' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
);

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DOCUMENT_XML =
  `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`
  + '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'
  + '<w:sectPr><w:headerReference w:type="default" r:id="rId4"/>'
  + '<w:footerReference w:type="first" r:id="rId5"/>'
  + '<w:type w:val="continuous"/>'
  + '<w:pgSz w:w="12240" w:h="15840" w:code="1"/>'
  + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
  + '<w:pgBorders/><w:pgNumType w:start="2" w:fmt="lowerRoman"/>'
  + '<w:cols w:num="2"/></w:sectPr>'
  + '</w:body></w:document>';

async function openPageSetupSession(xml = DOCUMENT_XML) {
  const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX AI' });
  return openSession([], {
    mgr,
    xml,
    extraFiles: { 'word/custom-preserved.xml': '<root keep="yes"/>' },
  });
}

async function docxSession(opened: Awaited<ReturnType<typeof openPageSetupSession>>) {
  const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session;
}

registerCleanup();

describe('OpenSpec: format_section page setup', () => {
  conformanceTest.openspec('Mixed page setup request is revisionable')(
    'returns prior/current projections and emits one native snapshot',
    async () => {
      const opened = await openPageSetupSession();
      const result = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_number_start: 5,
        page_size: {
          width_twips: 15840,
          height_twips: 12240,
          orientation: 'landscape',
        },
        margins: { top_twips: 720, gutter_twips: 180 },
      });
      assertSuccess(result, 'mixed format_section');
      expect(result).toMatchObject({
        changed: true,
        previous_page_number_start: 2,
        resulting_page_number_start: 5,
        previous_page_size: { width_twips: 12240, height_twips: 15840 },
        resulting_page_size: {
          width_twips: 15840,
          height_twips: 12240,
          orientation: 'landscape',
        },
        previous_margins: { top_twips: 1440, gutter_twips: 0 },
        resulting_margins: { top_twips: 720, gutter_twips: 180 },
      });
      const xml = await readZipText(
        (await (await docxSession(opened)).doc.toBuffer({ cleanBookmarks: false })).buffer,
        'word/document.xml',
      );
      if (xml === null) throw new Error('Expected word/document.xml');
      expect(xml.match(/<w:sectPrChange\b/g)).toHaveLength(1);
    },
  );

  conformanceTest.openspec('Page setup objects support partial updates')(
    'updates selected leaves and keeps the rest',
    async () => {
      const opened = await openPageSetupSession();
      const before = (await docxSession(opened)).doc.getSections()[0]!;
      assertSuccess(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_size: { orientation: 'portrait' },
        margins: { right_twips: 960 },
      }), 'partial format_section');
      const after = (await docxSession(opened)).doc.getSections()[0]!;
      expect(after.pageSize).toEqual({ ...before.pageSize, orientation: 'portrait' });
      expect(after.margins).toEqual({ ...before.margins, rightTwips: 960 });
      expect(after.pageNumberFormat).toBe('lowerRoman');
    },
  );

  test.openspec('Empty or invalid requests are transactional')(
    'rejects empty, malformed, and incomplete requests without accounting an edit',
    async () => {
      const opened = await openPageSetupSession();
      const session = await docxSession(opened);
      const before = session.doc.getSections();
      const editCount = session.editCount;
      for (const extra of [
        {},
        { page_size: {} },
        { page_size: { width_twips: 0 } },
        { page_size: { orientation: 'sideways' } },
        { margins: { left_twips: -1 } },
      ]) {
        assertFailure(await formatSection(opened.mgr, {
          file_path: opened.inputPath,
          section_index: 0,
          ...extra,
        }), 'VALIDATION_ERROR');
      }
      const missing = await openPageSetupSession(
        `<w:document xmlns:w="${W_NS}"><w:body>`
          + '<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/>'
          + '</w:body></w:document>',
      );
      assertFailure(await formatSection(missing.mgr, {
        file_path: missing.inputPath,
        section_index: 0,
        margins: { top_twips: 720 },
      }), 'INCOMPLETE_PAGE_MARGINS');
      expect(session.doc.getSections()).toEqual(before);
      expect(session.editCount).toBe(editCount);
    },
  );

  test.openspec('Identical mixed request does not create an edit')(
    'reports a deterministic no-op',
    async () => {
      const opened = await openPageSetupSession();
      const session = await docxSession(opened);
      const editCount = session.editCount;
      const result = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_size: { width_twips: 12240, height_twips: 15840 },
        margins: { top_twips: 1440, gutter_twips: 0 },
        page_number_start: 2,
      });
      assertSuccess(result, 'no-op format_section');
      expect(result.changed).toBe(false);
      expect(session.editCount).toBe(editCount);
    },
  );

  test.openspec('Existing page-number-only calls remain compatible')(
    'retains the page-number response and mutation behavior',
    async () => {
      const opened = await openPageSetupSession();
      const result = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_number_start: 7,
      });
      assertSuccess(result, 'page-number format_section');
      expect(result).toMatchObject({
        previous_page_number_start: 2,
        resulting_page_number_start: 7,
      });
    },
  );

  test.openspec('Unsupported providers remain rejected')(
    'routes page setup through both provider guards',
    async () => {
      const manager = createTestSessionManager();
      const mutation = {
        section_index: 0,
        page_size: { width_twips: 12240, height_twips: 15840 },
      };
      assertFailure(
        await dispatchToolCall(manager, 'format_section', {
          file_path: '/tmp/page-setup.odt',
          ...mutation,
        }) as { success: boolean; error?: { code?: string } },
        'UNSUPPORTED_FOR_ODF',
      );
      assertFailure(
        await dispatchToolCall(manager, 'format_section', {
          google_doc_id: 'fake-id',
          ...mutation,
        }) as { success: boolean; error?: { code?: string } },
        'UNSUPPORTED_FOR_PROVIDER',
      );
    },
  );

  conformanceTest.openspec('Page setup and relationships remain narrowly scoped')(
    'preserves topology, references, and package side parts',
    async () => {
      const opened = await openPageSetupSession();
      const session = await docxSession(opened);
      const before = session.doc.getSections()[0]!;
      const paragraphs = session.doc.getParagraphs().length;
      assertSuccess(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_size: { width_twips: 15840 },
        margins: { left_twips: 720 },
      }), 'preserving format_section');
      const after = session.doc.getSections()[0]!;
      expect(after).toMatchObject({
        breakType: before.breakType,
        pageNumberStart: before.pageNumberStart,
        pageNumberFormat: before.pageNumberFormat,
        headers: before.headers,
        footers: before.footers,
      });
      expect(session.doc.getSections()).toHaveLength(1);
      expect(session.doc.getParagraphs()).toHaveLength(paragraphs);
      const output = path.join(opened.tmpDir, 'preserved.docx');
      assertSuccess(await save(opened.mgr, {
        file_path: opened.inputPath,
        save_to_local_path: output,
        save_format: 'tracked',
      }), 'save');
      expect(await readZipText(await fs.readFile(output), 'word/custom-preserved.xml'))
        .toBe('<root keep="yes"/>');
    },
  );

  conformanceTest.openspec('Clean and tracked saves agree on current page setup')(
    'keeps current geometry in both outputs and the snapshot only in tracked',
    async () => {
      const opened = await openPageSetupSession();
      assertSuccess(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_size: {
          width_twips: 15840,
          height_twips: 12240,
          orientation: 'landscape',
        },
        margins: { top_twips: 720, left_twips: 720 },
      }), 'format_section');
      const cleanPath = path.join(opened.tmpDir, 'clean.docx');
      const trackedPath = path.join(opened.tmpDir, 'tracked.docx');
      assertSuccess(await save(opened.mgr, {
        file_path: opened.inputPath,
        save_to_local_path: cleanPath,
        tracked_save_to_local_path: trackedPath,
        save_format: 'both',
      }), 'save');
      const cleanXml = await readZipText(await fs.readFile(cleanPath), 'word/document.xml');
      const trackedXml = await readZipText(await fs.readFile(trackedPath), 'word/document.xml');
      for (const xml of [cleanXml, trackedXml]) {
        expect(xml).toContain('w:w="15840"');
        expect(xml).toContain('w:h="12240"');
        expect(xml).toContain('w:orient="landscape"');
        expect(xml).toContain('w:top="720"');
      }
      expect(cleanXml).not.toContain('<w:sectPrChange');
      expect(trackedXml).toContain('<w:sectPrChange');
    },
  );
});
