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
import { acceptAiEdits } from './accept_ai_edits.js';
import { formatSection } from './format_section.js';
import { getSections } from './get_sections.js';
import { rejectAiEdits } from './reject_ai_edits.js';
import { save } from './save.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TEST_FEATURE = 'add-section-page-numbering-formatting';
const test = testAllure.epic('Document Editing').withLabels({
  feature: TEST_FEATURE,
});
const pageSetupTest = testAllure.epic('Document Editing').withLabels({
  feature: 'Add Section Page Setup Formatting',
});
const pageSetupConformanceTest = pageSetupTest.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.13' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.11' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
);

const DOCUMENT_XML =
  `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`
  + '<w:p><w:r><w:t>First section</w:t></w:r></w:p>'
  + '<w:p><w:pPr><w:sectPr>'
  + '<w:headerReference w:type="default" r:id="rId4"/>'
  + '<w:pgSz w:w="12240" w:h="15840"/>'
  + '<w:pgMar w:top="1440" w:right="720" w:bottom="1440" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>'
  + '<w:pgNumType w:start="2" w:fmt="lowerRoman"/>'
  + '<w:cols w:num="2"/><w:titlePg/>'
  + '</w:sectPr></w:pPr><w:r><w:t>Section boundary</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>Final section</w:t></w:r></w:p>'
  + '<w:sectPr><w:footerReference w:type="default" r:id="rId5"/>'
  + '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
  + '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>'
  + '</w:sectPr>'
  + '</w:body></w:document>';

async function openSectionSession() {
  const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX AI' });
  return openSession([], {
    mgr,
    xml: DOCUMENT_XML,
    extraFiles: {
      'word/custom-preserved.xml': '<root keep="yes"/>',
    },
  });
}

async function getSessionSections(
  opened: Awaited<ReturnType<typeof openSectionSession>>,
) {
  const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session.doc.getSections();
}

registerCleanup();

describe('OpenSpec traceability: section tools', () => {
  test.openspec('Section discovery returns selectable boundaries')(
    'returns ordered boundary and page-setup metadata',
    async () => {
      const opened = await openSectionSession();
      const result = await getSections(opened.mgr, {
        file_path: opened.inputPath,
      });
      assertSuccess(result, 'get_sections');
      expect(result.section_count).toBe(2);
      expect(result.sections).toEqual([
        expect.objectContaining({
          section_index: 0,
          location: 'paragraph',
          anchor_paragraph_id: opened.paraIds[1],
          page_numbering: { start: 2, format: 'lowerRoman' },
          page_size: expect.objectContaining({ width_twips: 12240 }),
          headers: [{ type: 'default', relationship_id: 'rId4' }],
        }),
        expect.objectContaining({
          section_index: 1,
          location: 'body',
          anchor_paragraph_id: null,
          page_numbering: { start: null, format: null },
          page_size: expect.objectContaining({ orientation: 'landscape' }),
          footers: [{ type: 'default', relationship_id: 'rId5' }],
        }),
      ]);
    },
  );

  test.openspec('File-first and session reuse are supported')(
    'reuses the session without recording edits',
    async () => {
      const opened = await openSectionSession();
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      const editsBefore = session?.editCount;
      const first = await getSections(opened.mgr, { file_path: opened.inputPath });
      const second = await getSections(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(first, 'first get_sections');
      assertSuccess(second, 'second get_sections');
      expect(second.session_resolution).toBe('reused');
      expect(session?.editCount).toBe(editsBefore);
    },
  );

  test.openspec('Page numbering restarts at the requested value')(
    'sets the final section restart with tracked metadata',
    async () => {
      const opened = await openSectionSession();
      const result = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 1,
        page_number_start: 1,
      });
      assertSuccess(result, 'format_section');
      expect(result).toMatchObject({
        section_index: 1,
        changed: true,
        previous_page_number_start: null,
        resulting_page_number_start: 1,
        section_count_before: 2,
        section_count_after: 2,
      });
      expect((await getSessionSections(opened))[1]?.pageNumberStart).toBe(1);
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
      const packed = await session.doc.toBuffer({ cleanBookmarks: false });
      const xml = await readZipText(packed.buffer, 'word/document.xml');
      expect(xml).toContain('<w:sectPrChange');
      expect(xml).toContain('w:author="SafeDocX AI"');
    },
  );

  test.openspec('Identical restart does not create an edit')(
    'leaves edit accounting unchanged on an identical request',
    async () => {
      const opened = await openSectionSession();
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      const editsBefore = session?.editCount;
      const result = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_number_start: 2,
      });
      assertSuccess(result, 'format_section');
      expect(result.changed).toBe(false);
      expect(session?.editCount).toBe(editsBefore);
    },
  );

  test.openspec('Invalid input is transactional')(
    'rejects invalid and missing indexes without changing section state',
    async () => {
      const opened = await openSectionSession();
      const before = await getSessionSections(opened);
      assertFailure(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: -1,
        page_number_start: 1,
      }), 'VALIDATION_ERROR');
      assertFailure(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 9,
        page_number_start: 1,
      }), 'SECTION_NOT_FOUND');
      assertFailure(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_number_start: -1,
      }), 'VALIDATION_ERROR');
      expect(await getSessionSections(opened)).toEqual(before);
    },
  );

  test.openspec('Unsupported providers are rejected')(
    'routes ODT and Google Docs through provider chokepoints',
    async () => {
      const manager = createTestSessionManager();
      for (const toolName of ['get_sections', 'format_section']) {
        const extra = toolName === 'format_section'
          ? { section_index: 0, page_number_start: 1 }
          : {};
        assertFailure(
          await dispatchToolCall(manager, toolName, {
            file_path: '/tmp/not-opened-sections-test.odt',
            ...extra,
          }) as { success: boolean; error?: { code?: string } },
          'UNSUPPORTED_FOR_ODF',
        );
        assertFailure(
          await dispatchToolCall(manager, toolName, {
            google_doc_id: 'fake-id',
            ...extra,
          }) as { success: boolean; error?: { code?: string } },
          'UNSUPPORTED_FOR_PROVIDER',
        );
      }
    },
  );

  test.openspec('Page setup and references survive formatting')(
    'preserves every projected untargeted property and package side part',
    async () => {
      const opened = await openSectionSession();
      const before = (await getSessionSections(opened))[0]!;
      assertSuccess(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_number_start: 6,
      }), 'format_section');
      const after = (await getSessionSections(opened))[0]!;
      expect({
        ...after,
        pageNumberStart: before.pageNumberStart,
      }).toEqual(before);

      const output = path.join(opened.tmpDir, 'section-preserved.docx');
      assertSuccess(await save(opened.mgr, {
        file_path: opened.inputPath,
        save_to_local_path: output,
        save_format: 'tracked',
      }), 'save');
      expect(await readZipText(
        await fs.readFile(output),
        'word/custom-preserved.xml',
      )).toBe('<root keep="yes"/>');
    },
  );

  test.openspec('Clean and tracked saves agree on current state')(
    'keeps the restart in both variants and review markup only in tracked',
    async () => {
      const opened = await openSectionSession();
      assertSuccess(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 1,
        page_number_start: 1,
      }), 'format_section');
      const cleanPath = path.join(opened.tmpDir, 'section-clean.docx');
      const trackedPath = path.join(opened.tmpDir, 'section-tracked.docx');
      assertSuccess(await save(opened.mgr, {
        file_path: opened.inputPath,
        save_to_local_path: cleanPath,
        tracked_save_to_local_path: trackedPath,
        save_format: 'both',
      }), 'save');
      const cleanXml = await readZipText(
        await fs.readFile(cleanPath),
        'word/document.xml',
      );
      const trackedXml = await readZipText(
        await fs.readFile(trackedPath),
        'word/document.xml',
      );
      expect(cleanXml).toContain('<w:pgNumType w:start="1"/>');
      expect(cleanXml).not.toContain('<w:sectPrChange');
      expect(trackedXml).toContain('<w:pgNumType w:start="1"/>');
      expect(trackedXml).toContain('<w:sectPrChange');
    },
  );

  test.openspec('Accept and reject preserve section semantics')(
    'keeps current restart on accept and restores the prior restart on reject',
    async () => {
      const accepted = await openSectionSession();
      assertSuccess(await formatSection(accepted.mgr, {
        file_path: accepted.inputPath,
        section_index: 0,
        page_number_start: 7,
      }), 'format_section');
      assertSuccess(await acceptAiEdits(accepted.mgr, {
        file_path: accepted.inputPath,
        author: 'SafeDocX AI',
      }), 'accept_ai_edits');
      expect((await getSessionSections(accepted))[0]?.pageNumberStart).toBe(7);

      const rejected = await openSectionSession();
      assertSuccess(await formatSection(rejected.mgr, {
        file_path: rejected.inputPath,
        section_index: 0,
        page_number_start: 7,
      }), 'format_section');
      assertSuccess(await rejectAiEdits(rejected.mgr, {
        file_path: rejected.inputPath,
        author: 'SafeDocX AI',
      }), 'reject_ai_edits');
      expect((await getSessionSections(rejected))[0]?.pageNumberStart).toBe(2);
      expect((await getSessionSections(rejected))[0]?.pageNumberFormat)
        .toBe('lowerRoman');
    },
  );
});

describe('OpenSpec traceability: section page setup tool', () => {
  pageSetupConformanceTest.openspec('Mixed page setup request is revisionable')(
    'updates numbering, paper geometry, and margins with one revision',
    async () => {
      const opened = await openSectionSession();
      const result = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_number_start: 5,
        page_size: {
          width_twips: 15840,
          height_twips: 12240,
          orientation: 'landscape',
        },
        margins: {
          top_twips: 720,
          gutter_twips: 180,
        },
      });
      assertSuccess(result, 'mixed format_section');
      expect(result).toMatchObject({
        changed: true,
        previous_page_number_start: 2,
        resulting_page_number_start: 5,
        previous_page_size: {
          width_twips: 12240,
          height_twips: 15840,
          orientation: null,
        },
        resulting_page_size: {
          width_twips: 15840,
          height_twips: 12240,
          orientation: 'landscape',
        },
        previous_margins: { top_twips: 1440, gutter_twips: 0 },
        resulting_margins: { top_twips: 720, gutter_twips: 180 },
      });
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
      const xml = await readZipText(
        (await session.doc.toBuffer({ cleanBookmarks: false })).buffer,
        'word/document.xml',
      );
      if (xml === null) throw new Error('Expected word/document.xml');
      expect(xml.match(/<w:sectPrChange\b/g)).toHaveLength(1);
    },
  );

  pageSetupConformanceTest.openspec('Page setup objects support partial updates')(
    'changes selected leaves and preserves every unspecified projection',
    async () => {
      const opened = await openSectionSession();
      const before = (await getSessionSections(opened))[0]!;
      assertSuccess(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_size: { orientation: 'portrait' },
        margins: { right_twips: 960 },
      }), 'partial format_section');
      const after = (await getSessionSections(opened))[0]!;
      expect(after.pageSize).toEqual({
        ...before.pageSize,
        orientation: 'portrait',
      });
      expect(after.margins).toEqual({
        ...before.margins,
        rightTwips: 960,
      });
      expect(after.pageNumberStart).toBe(before.pageNumberStart);
      expect(after.pageNumberFormat).toBe(before.pageNumberFormat);
    },
  );

  pageSetupTest.openspec('Empty or invalid requests are transactional')(
    'rejects malformed values and incomplete missing-element creation',
    async () => {
      const opened = await openSectionSession();
      const before = await getSessionSections(opened);
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      const editsBefore = session?.editCount;
      const invalid = [
        {},
        { page_size: {} },
        { page_size: { width_twips: 0 } },
        { page_size: { orientation: 'sideways' } },
        { margins: { left_twips: -1 } },
        { margins: { unknown_twips: 1 } },
      ];
      for (const extra of invalid) {
        assertFailure(await formatSection(opened.mgr, {
          file_path: opened.inputPath,
          section_index: 0,
          ...extra,
        }), 'VALIDATION_ERROR');
      }

      const missingMgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX AI' });
      const missing = await openSession([], {
        mgr: missingMgr,
        xml: `<w:document xmlns:w="${W_NS}"><w:body>`
          + '<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/>'
          + '</w:body></w:document>',
      });
      assertFailure(await formatSection(missing.mgr, {
        file_path: missing.inputPath,
        section_index: 0,
        page_size: { orientation: 'landscape' },
      }), 'INCOMPLETE_PAGE_SIZE');
      assertFailure(await formatSection(missing.mgr, {
        file_path: missing.inputPath,
        section_index: 0,
        margins: { top_twips: 720 },
      }), 'INCOMPLETE_PAGE_MARGINS');

      expect(await getSessionSections(opened)).toEqual(before);
      expect(session?.editCount).toBe(editsBefore);
    },
  );

  pageSetupTest.openspec('Identical mixed request does not create an edit')(
    'keeps XML and edit accounting unchanged',
    async () => {
      const opened = await openSectionSession();
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
      const editsBefore = session.editCount;
      const before = await session.doc.toBuffer({ cleanBookmarks: false });
      const result = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 1,
        page_size: {
          width_twips: 15840,
          height_twips: 12240,
          orientation: 'landscape',
        },
        margins: { top_twips: 720, gutter_twips: 0 },
      });
      assertSuccess(result, 'no-op format_section');
      expect(result.changed).toBe(false);
      expect(session.editCount).toBe(editsBefore);
      const after = await session.doc.toBuffer({ cleanBookmarks: false });
      expect(await readZipText(after.buffer, 'word/document.xml'))
        .toBe(await readZipText(before.buffer, 'word/document.xml'));
    },
  );

  pageSetupTest.openspec('Existing page-number-only calls remain compatible')(
    'retains the original restart response fields',
    async () => {
      const opened = await openSectionSession();
      const result = await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 1,
        page_number_start: 1,
      });
      assertSuccess(result, 'compatible format_section');
      expect(result).toMatchObject({
        changed: true,
        previous_page_number_start: null,
        resulting_page_number_start: 1,
      });
      expect((await getSessionSections(opened))[1]?.pageNumberStart).toBe(1);
    },
  );

  pageSetupTest.openspec('Unsupported providers remain rejected')(
    'rejects page setup calls at both provider chokepoints',
    async () => {
      const manager = createTestSessionManager();
      const pageSetup = {
        section_index: 0,
        page_size: { width_twips: 12240, height_twips: 15840 },
      };
      assertFailure(
        await dispatchToolCall(manager, 'format_section', {
          file_path: '/tmp/not-opened-page-setup.odt',
          ...pageSetup,
        }) as { success: boolean; error?: { code?: string } },
        'UNSUPPORTED_FOR_ODF',
      );
      assertFailure(
        await dispatchToolCall(manager, 'format_section', {
          google_doc_id: 'fake-id',
          ...pageSetup,
        }) as { success: boolean; error?: { code?: string } },
        'UNSUPPORTED_FOR_PROVIDER',
      );
    },
  );

  pageSetupConformanceTest.openspec('Page setup and relationships remain narrowly scoped')(
    'preserves untargeted settings, side parts, and topology',
    async () => {
      const opened = await openSectionSession();
      const before = (await getSessionSections(opened))[0]!;
      const sessionBefore = await opened.mgr.getSessionByFilePath(opened.inputPath);
      if (!sessionBefore || sessionBefore.provider !== 'docx') {
        throw new Error('Expected DOCX session');
      }
      const paragraphsBefore = sessionBefore.doc.getParagraphs().length;
      assertSuccess(await formatSection(opened.mgr, {
        file_path: opened.inputPath,
        section_index: 0,
        page_size: { width_twips: 15840 },
        margins: { left_twips: 960 },
      }), 'preserving format_section');
      const after = (await getSessionSections(opened))[0]!;
      expect(after.breakType).toBe(before.breakType);
      expect(after.pageNumberStart).toBe(before.pageNumberStart);
      expect(after.pageNumberFormat).toBe(before.pageNumberFormat);
      expect(after.headers).toEqual(before.headers);
      expect(after.footers).toEqual(before.footers);
      expect((await getSessionSections(opened))).toHaveLength(2);
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
      expect(session.doc.getParagraphs()).toHaveLength(paragraphsBefore);
      const output = path.join(opened.tmpDir, 'page-setup-preserved.docx');
      assertSuccess(await save(opened.mgr, {
        file_path: opened.inputPath,
        save_to_local_path: output,
        save_format: 'tracked',
      }), 'save');
      expect(await readZipText(
        await fs.readFile(output),
        'word/custom-preserved.xml',
      )).toBe('<root keep="yes"/>');
    },
  );

  pageSetupConformanceTest.openspec('Clean and tracked saves agree on current page setup')(
    'keeps current geometry in both outputs and the prior snapshot only in tracked',
    async () => {
      const opened = await openSectionSession();
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
      const cleanPath = path.join(opened.tmpDir, 'page-setup-clean.docx');
      const trackedPath = path.join(opened.tmpDir, 'page-setup-tracked.docx');
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
        expect(xml).toContain('w:left="720"');
      }
      expect(cleanXml).not.toContain('<w:sectPrChange');
      expect(trackedXml).toContain('<w:sectPrChange');
    },
  );
});
