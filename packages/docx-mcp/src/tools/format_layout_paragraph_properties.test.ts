import { describe, expect } from 'vitest';
import { parseXml, readZipText } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { acceptAiEdits } from './accept_ai_edits.js';
import { formatLayout } from './format_layout.js';
import { gdocsFormatLayout } from './gdocs/format_layout.js';
import { insertSectionBreakTool } from './insert_section_break.js';
import { rejectAiEdits } from './reject_ai_edits.js';

const TEST_FEATURE = 'add-paragraph-alignment-pagination-layout';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI_AUTHOR = 'SafeDocX AI';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.13' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.23' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' },
);

const TWO_PARAGRAPH_XML =
  `<w:document xmlns:w="${W_NS}"><w:body>`
  + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Title paragraph</w:t></w:r></w:p>'
  + '<w:p><w:pPr><w:pageBreakBefore/><w:jc w:val="left"/></w:pPr><w:r><w:t>Body paragraph</w:t></w:r></w:p>'
  + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
  + '</w:body></w:document>';

async function openAiSession(xml = TWO_PARAGRAPH_XML) {
  const mgr = createTestSessionManager({ defaultAiAuthor: AI_AUTHOR });
  return openSession([], { mgr, xml });
}

type Opened = Awaited<ReturnType<typeof openAiSession>>;

async function paragraphPPr(opened: Opened, text: string): Promise<Element> {
  const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  const packed = await session.doc.toBuffer({ cleanBookmarks: true });
  const xml = await readZipText(packed.buffer, 'word/document.xml');
  const dom = parseXml(xml ?? '');
  const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
  const paragraph = paragraphs.find((p) => (p.textContent ?? '').includes(text));
  if (!paragraph) throw new Error(`Paragraph not found: ${text}`);
  const pPr = Array.from(paragraph.children).find((c) => c.localName === 'pPr');
  if (!pPr) throw new Error(`pPr not found: ${text}`);
  return pPr;
}

function childNames(el: Element | undefined): string[] {
  return el ? Array.from(el.children).map((c) => c.localName) : [];
}

function child(el: Element, name: string): Element | undefined {
  return Array.from(el.children).find((c) => c.localName === name);
}

function jcVal(el: Element | undefined): string | null {
  const jc = el ? child(el, 'jc') : undefined;
  return jc ? jc.getAttributeNS(W_NS, 'val') : null;
}

registerCleanup();

describe('OpenSpec traceability: paragraph alignment and pagination layout controls', () => {
  conformanceTest.openspec('Center an existing paragraph as a tracked property change')(
    'centers paragraph 2 with w:jc center and a pPrChange holding the prior pPr',
    async () => {
      const opened = await openAiSession();
      const result = await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_properties: { paragraph_ids: [opened.paraIds[1]!], alignment: 'center' },
      });
      assertSuccess(result, 'format_layout');
      expect(result.mutation_summary).toEqual({ affected_paragraphs: 1, affected_rows: 0, affected_cells: 0 });

      const pPr = await paragraphPPr(opened, 'Body paragraph');
      expect(jcVal(pPr)).toBe('center');
      const change = child(pPr, 'pPrChange');
      expect(change?.getAttributeNS(W_NS, 'author')).toBe(AI_AUTHOR);
      const previous = change ? child(change, 'pPr') : undefined;
      expect(jcVal(previous)).toBe('left');
      expect(childNames(previous)).toEqual(['pageBreakBefore', 'jc']);
      expect(childNames(pPr).at(-1)).toBe('pPrChange');
    },
  );

  conformanceTest.openspec('Remove a redundant page break before a new section')(
    'clears pageBreakBefore after a nextPage section break precedes the paragraph',
    async () => {
      const opened = await openAiSession();
      assertSuccess(await insertSectionBreakTool(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_id: opened.paraIds[0]!,
        break_type: 'nextPage',
      }), 'insert_section_break');

      const result = await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_properties: { paragraph_ids: [opened.paraIds[1]!], page_break_before: false },
      });
      assertSuccess(result, 'format_layout');

      const pPr = await paragraphPPr(opened, 'Body paragraph');
      expect(child(pPr, 'pageBreakBefore')).toBeUndefined();
      const previous = child(child(pPr, 'pPrChange')!, 'pPr');
      expect(previous && child(previous, 'pageBreakBefore')).toBeTruthy();
    },
  );

  test.openspec('Accept keeps and reject restores paragraph properties')(
    'accept keeps the new alignment and flags; reject restores the prior ones',
    async () => {
      const request = (opened: Opened) => formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_properties: {
          paragraph_ids: [opened.paraIds[1]!],
          alignment: 'both',
          page_break_before: false,
          keep_next: true,
        },
      });

      const accepted = await openAiSession();
      assertSuccess(await request(accepted), 'format_layout');
      assertSuccess(await acceptAiEdits(accepted.mgr, { file_path: accepted.inputPath, author: AI_AUTHOR }), 'accept_ai_edits');
      const acceptedPPr = await paragraphPPr(accepted, 'Body paragraph');
      expect(childNames(acceptedPPr)).toEqual(['keepNext', 'jc']);
      expect(jcVal(acceptedPPr)).toBe('both');

      const rejected = await openAiSession();
      assertSuccess(await request(rejected), 'format_layout');
      assertSuccess(await rejectAiEdits(rejected.mgr, { file_path: rejected.inputPath, author: AI_AUTHOR }), 'reject_ai_edits');
      const rejectedPPr = await paragraphPPr(rejected, 'Body paragraph');
      expect(childNames(rejectedPPr)).toEqual(['pageBreakBefore', 'jc']);
      expect(jcVal(rejectedPPr)).toBe('left');
    },
  );

  test.openspec('Existing paragraph-property revisions keep a sound baseline')(
    'keeps the first snapshot across later AI edits and refuses foreign-authored revisions',
    async () => {
      const opened = await openAiSession();
      const id = opened.paraIds[1]!;
      assertSuccess(await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_properties: { paragraph_ids: [id], alignment: 'center' },
      }), 'format_layout alignment');
      const combined = await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_spacing: { paragraph_ids: [id], after_twips: 240 },
        paragraph_properties: { paragraph_ids: [id], keep_lines: true },
      });
      assertSuccess(combined, 'format_layout spacing + flags');
      expect(combined.mutation_summary).toEqual({ affected_paragraphs: 1, affected_rows: 0, affected_cells: 0 });
      assertSuccess(await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_spacing: { paragraph_ids: [id], before_twips: 120 },
      }), 'format_layout spacing');

      const pPr = await paragraphPPr(opened, 'Body paragraph');
      const changes = Array.from(pPr.children).filter((c) => c.localName === 'pPrChange');
      expect(changes).toHaveLength(1);
      expect(childNames(child(changes[0]!, 'pPr'))).toEqual(['pageBreakBefore', 'jc']);
      assertSuccess(await rejectAiEdits(opened.mgr, { file_path: opened.inputPath, author: AI_AUTHOR }), 'reject_ai_edits');
      const restored = await paragraphPPr(opened, 'Body paragraph');
      expect(childNames(restored)).toEqual(['pageBreakBefore', 'jc']);
      expect(jcVal(restored)).toBe('left');

      const foreignXml =
        `<w:document xmlns:w="${W_NS}"><w:body>`
        + '<w:p><w:pPr><w:jc w:val="right"/><w:pPrChange w:id="7" w:author="Human Reviewer" w:date="2026-01-01T00:00:00Z">'
        + '<w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t>Reviewed paragraph</w:t></w:r></w:p>'
        + '</w:body></w:document>';
      const foreign = await openAiSession(foreignXml);
      const refused = await formatLayout(foreign.mgr, {
        file_path: foreign.inputPath,
        paragraph_properties: { paragraph_ids: [foreign.paraIds[0]!], alignment: 'center' },
      });
      assertFailure(refused, 'FOREIGN_PARAGRAPH_REVISION');
      const refusedCombined = await formatLayout(foreign.mgr, {
        file_path: foreign.inputPath,
        paragraph_spacing: { paragraph_ids: [foreign.paraIds[0]!], after_twips: 240 },
        paragraph_properties: { paragraph_ids: [foreign.paraIds[0]!], alignment: 'center' },
      });
      assertFailure(refusedCombined, 'FOREIGN_PARAGRAPH_REVISION');
      const untouched = await paragraphPPr(foreign, 'Reviewed paragraph');
      expect(child(untouched, 'spacing')).toBeUndefined();
      expect(jcVal(untouched)).toBe('right');
      expect(child(untouched, 'pPrChange')?.getAttributeNS(W_NS, 'author')).toBe('Human Reviewer');
    },
  );

  test.openspec('Pagination flags are set in schema order')(
    'inserts keepNext, keepLines and pageBreakBefore at their CT_PPrBase positions',
    async () => {
      const xml =
        `<w:document xmlns:w="${W_NS}"><w:body>`
        + '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:spacing w:after="120"/><w:jc w:val="right"/>'
        + '<w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Styled paragraph</w:t></w:r></w:p>'
        + '</w:body></w:document>';
      const opened = await openAiSession(xml);
      assertSuccess(await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_properties: {
          paragraph_ids: [opened.paraIds[0]!],
          page_break_before: true,
          keep_lines: true,
          keep_next: true,
          alignment: 'left',
        },
      }), 'format_layout');
      const pPr = await paragraphPPr(opened, 'Styled paragraph');
      expect(childNames(pPr)).toEqual([
        'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'spacing', 'jc', 'rPr', 'pPrChange',
      ]);
      expect(jcVal(pPr)).toBe('left');
    },
  );

  test.openspec('Unchanged paragraph properties are a no-op')(
    'reports zero affected paragraphs and emits no pPrChange when values already match',
    async () => {
      const opened = await openAiSession();
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      const editCount = session?.editCount;
      const result = await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_properties: {
          paragraph_ids: [opened.paraIds[1]!],
          alignment: 'left',
          page_break_before: true,
          keep_lines: false,
        },
      });
      assertSuccess(result, 'format_layout');
      expect(result.mutation_summary).toEqual({ affected_paragraphs: 0, affected_rows: 0, affected_cells: 0 });
      expect(session?.editCount).toBe(editCount);
      const pPr = await paragraphPPr(opened, 'Body paragraph');
      expect(child(pPr, 'pPrChange')).toBeUndefined();

      const explicitOn = await openAiSession(
        `<w:document xmlns:w="${W_NS}"><w:body>`
        + '<w:p><w:pPr><w:keepNext w:val="1"/><w:keepLines w:val="0"/></w:pPr><w:r><w:t>Flagged paragraph</w:t></w:r></w:p>'
        + '</w:body></w:document>',
      );
      const flagged = await formatLayout(explicitOn.mgr, {
        file_path: explicitOn.inputPath,
        paragraph_properties: { paragraph_ids: [explicitOn.paraIds[0]!], keep_next: true, keep_lines: false },
      });
      assertSuccess(flagged, 'format_layout explicit on/off');
      expect(flagged.mutation_summary).toEqual({ affected_paragraphs: 0, affected_rows: 0, affected_cells: 0 });
      expect(child(await paragraphPPr(explicitOn, 'Flagged paragraph'), 'pPrChange')).toBeUndefined();
    },
  );

  test.openspec('Invalid paragraph property input is rejected')(
    'returns structured errors for bad input and Google Docs sessions',
    async () => {
      const opened = await openAiSession();
      const id = opened.paraIds[1]!;
      const cases: Array<Record<string, unknown>> = [
        { paragraph_ids: [id], alignment: 'justify' },
        { paragraph_ids: [id], keep_next: 'yes' },
        { paragraph_ids: [id] },
        { paragraph_ids: [], alignment: 'center' },
      ];
      for (const paragraph_properties of cases) {
        assertFailure(await formatLayout(opened.mgr, {
          file_path: opened.inputPath,
          paragraph_properties: paragraph_properties as never,
        }), 'VALIDATION_ERROR');
      }
      assertFailure(await formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_properties: { paragraph_ids: [id, '_bk_missing'], alignment: 'center' },
      }), 'INVALID_SELECTOR');
      const pPr = await paragraphPPr(opened, 'Body paragraph');
      expect(jcVal(pPr)).toBe('left');
      expect(child(pPr, 'pPrChange')).toBeUndefined();

      const gdocs = await gdocsFormatLayout(
        createTestSessionManager(),
        {} as never,
        { paragraph_properties: { paragraph_ids: ['_bk_x'], alignment: 'center' } },
        {},
      );
      assertFailure(gdocs, 'UNSUPPORTED_FOR_PROVIDER');
    },
  );
});
