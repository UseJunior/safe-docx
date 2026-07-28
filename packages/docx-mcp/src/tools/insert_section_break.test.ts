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
import { getSections } from './get_sections.js';
import { insertSectionBreakTool } from './insert_section_break.js';

const TEST_FEATURE = 'add-section-break-insertion';
const test = testAllure.epic('Document Editing').withLabels({
  feature: TEST_FEATURE,
});
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.18' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.22' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
);

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DOCUMENT_XML =
  `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`
  + '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>Beta</w:t></w:r></w:p>'
  + '<w:sectPr><w:headerReference w:type="default" r:id="rId4"/>'
  + '<w:footerReference w:type="first" r:id="rId5"/>'
  + '<w:pgSz w:w="12240" w:h="15840"/>'
  + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"'
  + ' w:header="720" w:footer="720" w:gutter="0"/>'
  + '<w:pgNumType w:start="2"/><w:cols w:num="2"/></w:sectPr>'
  + '</w:body></w:document>';

async function openBreakSession() {
  return openSession([], {
    mgr: createTestSessionManager({ defaultAiAuthor: 'SafeDocX AI' }),
    xml: DOCUMENT_XML,
  });
}

async function docxSession(opened: Awaited<ReturnType<typeof openBreakSession>>) {
  const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session;
}

registerCleanup();

describe('OpenSpec: insert_section_break', () => {
  conformanceTest.openspec('Insert and project a section break')(
    'returns stable topology projections and immediately updates get_sections',
    async () => {
      const opened = await openBreakSession();
      const result = await insertSectionBreakTool(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_id: opened.firstParaId,
        break_type: 'nextPage',
        new_section: { page_number_start: 1 },
      });
      assertSuccess(result, 'insert_section_break');
      expect(result).toMatchObject({
        changed: true,
        preceding_section_index: 0,
        following_section_index: 1,
        section_count_before: 1,
        section_count_after: 2,
        paragraph_count_before: 2,
        paragraph_count_after: 3,
        preceding_section: {
          break_type: 'nextPage',
          page_numbering: { start: 2 },
          headers: [{ type: 'default', relationship_id: 'rId4' }],
        },
        following_section: {
          page_numbering: { start: 1 },
          headers: [{ type: 'default', relationship_id: 'rId4' }],
        },
      });
      expect(result.inserted_boundary_paragraph_id).toMatch(/^_bk_/);

      const sections = await getSections(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(sections, 'get_sections');
      expect(sections.section_count).toBe(2);
      expect(sections.sections).toEqual([
        result.preceding_section,
        result.following_section,
      ]);
    },
  );

  test.openspec('Invalid input does not mutate the session')(
    'returns actionable errors for malformed and structurally unsupported requests',
    async () => {
      const opened = await openBreakSession();
      const session = await docxSession(opened);
      const before = session.doc.getSections();
      const editCount = session.editCount;

      assertFailure(await insertSectionBreakTool(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_id: '',
        break_type: 'nextPage',
      }), 'VALIDATION_ERROR');
      assertFailure(await insertSectionBreakTool(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_id: opened.firstParaId,
        break_type: 'page' as never,
      }), 'VALIDATION_ERROR');
      assertFailure(await insertSectionBreakTool(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_id: opened.firstParaId,
        break_type: 'continuous',
        inherit_properties: false,
        new_section: { page_size: { orientation: 'landscape' } },
      }), 'INCOMPLETE_PAGE_SIZE');
      assertFailure(await insertSectionBreakTool(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_id: '_bk_missing',
        break_type: 'nextPage',
      }), 'SECTION_ANCHOR_NOT_FOUND');

      expect(session.doc.getSections()).toEqual(before);
      expect(session.doc.getParagraphs()).toHaveLength(2);
      expect(session.editCount).toBe(editCount);
    },
  );

  conformanceTest.openspec('AI mutation policy is enforced')(
    'emits supported AI-authored topology and property revisions through dispatch',
    async () => {
      const opened = await openBreakSession();
      const result = await dispatchToolCall(opened.mgr, 'insert_section_break', {
        file_path: opened.inputPath,
        paragraph_id: opened.firstParaId,
        break_type: 'oddPage',
        inherit_properties: false,
        new_section: {
          page_number_start: 1,
          page_size: {
            width_twips: 15840,
            height_twips: 12240,
            orientation: 'landscape',
          },
          margins: {
            top_twips: 720,
            right_twips: 720,
            bottom_twips: 720,
            left_twips: 720,
            header_twips: 360,
            footer_twips: 360,
            gutter_twips: 0,
          },
        },
      });
      assertSuccess(
        result as { success: boolean },
        'dispatched insert_section_break',
      );

      const session = await docxSession(opened);
      const validation = await session.doc.validateAiRevisions('SafeDocX AI');
      expect(validation.errors).toEqual([]);
      const xml = await readZipText(
        (await session.doc.toBuffer({ cleanBookmarks: false })).buffer,
        'word/document.xml',
      );
      if (!xml) throw new Error('Expected word/document.xml');
      expect(xml.match(/<w:pPr><w:rPr><w:ins\b/g)).toHaveLength(1);
      expect(xml.match(/<w:sectPrChange\b/g)).toHaveLength(1);
      expect(xml).toContain('r:id="rId4"');
      expect(xml).toContain('r:id="rId5"');
    },
  );
});
