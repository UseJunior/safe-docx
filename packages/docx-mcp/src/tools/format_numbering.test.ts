import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { readZipText } from '@usejunior/docx-core';
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
import { formatNumbering } from './format_numbering.js';
import { readFile } from './read_file.js';
import { rejectAiEdits } from './reject_ai_edits.js';
import { save } from './save.js';

const TEST_FEATURE = 'add-paragraph-numbering-formatting';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

const DOCUMENT_XML =
  `<w:document xmlns:w="${W_NS}"><w:body>`
  + '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr></w:pPr><w:r><w:t>Alpha item</w:t></w:r></w:p>'
  + '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="20"/></w:numPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>Beta item</w:t></w:r></w:p>'
  + '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t>Plain item</w:t></w:r></w:p>'
  + '</w:body></w:document>';

const NUMBERING_XML =
  `<w:numbering xmlns:w="${W_NS}">`
  + '<w:abstractNum w:abstractNumId="1">'
  + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/></w:lvl>'
  + '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="(%2)"/></w:lvl>'
  + '</w:abstractNum>'
  + '<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>'
  + '<w:num w:numId="20"><w:abstractNumId w:val="1"/></w:num>'
  + '</w:numbering>';

async function openNumberingSession() {
  const mgr = createTestSessionManager({ defaultAiAuthor: 'SafeDocX AI' });
  return openSession([], {
    mgr,
    xml: DOCUMENT_XML,
    extraFiles: {
      'word/numbering.xml': NUMBERING_XML,
      'word/custom-preserved.xml': '<root keep="yes"/>',
    },
  });
}

async function sessionNumbering(
  opened: Awaited<ReturnType<typeof openNumberingSession>>,
  index: number,
) {
  const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session.doc.getDirectParagraphNumbering(opened.paraIds[index]!);
}

registerCleanup();

describe('OpenSpec traceability: paragraph numbering formatting', () => {
  test.openspec('Remove direct paragraph numbering')(
    'removes direct numbering without changing paragraph text',
    async () => {
      const opened = await openNumberingSession();
      const result = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        remove: true,
      });
      assertSuccess(result, 'format_numbering');
      expect(result.changed).toBe(true);
      expect(result.previous_numbering).toEqual({ num_id: '20', ilvl: 0 });
      expect(result.resulting_numbering).toBeNull();
      expect(await sessionNumbering(opened, 1)).toBeNull();
      const reread = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(reread, 'read_file');
      expect(String(reread.content)).toContain('Beta item');
    },
  );

  test.openspec("Match another paragraph's explicit numbering")(
    'copies the source reference and joins its visible sequence',
    async () => {
      const opened = await openNumberingSession();
      const result = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        match_paragraph_id: opened.paraIds[0],
      });
      assertSuccess(result, 'format_numbering');
      expect(result.resulting_numbering).toEqual({ num_id: '10', ilvl: 0 });
      const reread = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'json' });
      assertSuccess(reread, 'read_file');
      const nodes = JSON.parse(String(reread.content)) as Array<{
        text: string;
        list_label: string;
      }>;
      expect(nodes.find((node) => node.text === 'Alpha item')?.list_label).toBe('(a)');
      expect(nodes.find((node) => node.text === 'Beta item')?.list_label).toBe('(b)');
    },
  );

  test.openspec('Set an existing numbering reference directly')(
    'sets an existing instance and level',
    async () => {
      const opened = await openNumberingSession();
      const result = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[2],
        num_id: '10',
        ilvl: 1,
      });
      assertSuccess(result, 'format_numbering');
      expect(await sessionNumbering(opened, 2)).toEqual({ numId: '10', ilvl: 1 });
    },
  );

  test.openspec('Identical direct numbering is a deterministic no-op')(
    'does not increment edit accounting for an identical request',
    async () => {
      const opened = await openNumberingSession();
      const first = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        num_id: '10',
        ilvl: 0,
      });
      assertSuccess(first, 'format_numbering');
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      const editCount = session?.editCount;
      const second = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        num_id: '10',
        ilvl: 0,
      });
      assertSuccess(second, 'format_numbering');
      expect(second.changed).toBe(false);
      expect(session?.editCount).toBe(editCount);
    },
  );

  test.openspec('Mutually exclusive operation forms are enforced')(
    'rejects combined and incomplete operation forms',
    async () => {
      const opened = await openNumberingSession();
      const combined = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        remove: true,
        num_id: '10',
        ilvl: 0,
      });
      assertFailure(combined, 'VALIDATION_ERROR');
      const incomplete = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        num_id: '10',
      });
      assertFailure(incomplete, 'VALIDATION_ERROR');
    },
  );

  test.openspec('Match source must have complete direct numbering')(
    'rejects an unnumbered match source',
    async () => {
      const opened = await openNumberingSession();
      const result = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        match_paragraph_id: opened.paraIds[2],
      });
      assertFailure(result, 'SOURCE_NUMBERING_NOT_DIRECT');
      expect(await sessionNumbering(opened, 1)).toEqual({ numId: '20', ilvl: 0 });
    },
  );

  test.openspec('Dangling numbering references are rejected before mutation')(
    'rejects missing instances and levels transactionally',
    async () => {
      const opened = await openNumberingSession();
      const missingInstance = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        num_id: '99',
        ilvl: 0,
      });
      assertFailure(missingInstance, 'NUMBERING_INSTANCE_NOT_FOUND');
      const missingLevel = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        num_id: '10',
        ilvl: 8,
      });
      assertFailure(missingLevel, 'NUMBERING_LEVEL_NOT_FOUND');
      expect(await sessionNumbering(opened, 1)).toEqual({ numId: '20', ilvl: 0 });
    },
  );

  test('returns a structured error for a missing target anchor', async () => {
    const opened = await openNumberingSession();
    const result = await formatNumbering(opened.mgr, {
      file_path: opened.inputPath,
      target_paragraph_id: '_bk_missing',
      remove: true,
    });
    assertFailure(result, 'PARAGRAPH_NOT_FOUND');
  });

  test.openspec('Removing absent direct numbering is explicit')(
    'returns a warning without changing style-inherited state',
    async () => {
      const opened = await openNumberingSession();
      const result = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[2],
        remove: true,
      });
      assertSuccess(result, 'format_numbering');
      expect(result.changed).toBe(false);
      expect(result.warning).toContain('style-inherited');
    },
  );

  test.openspec('Unsupported providers are rejected')(
    'uses provider chokepoints for ODT and Google Docs',
    async () => {
      const manager = createTestSessionManager();
      const odt = await dispatchToolCall(manager, 'format_numbering', {
        file_path: '/tmp/not-opened-numbering-test.odt',
        target_paragraph_id: '_bk_target',
        remove: true,
      });
      assertFailure(
        odt as { success: boolean; error?: { code?: string } },
        'UNSUPPORTED_FOR_ODF',
      );
      const gdocs = await dispatchToolCall(manager, 'format_numbering', {
        google_doc_id: 'fake-id',
        target_paragraph_id: '_bk_target',
        remove: true,
      });
      assertFailure(
        gdocs as { success: boolean; error?: { code?: string } },
        'UNSUPPORTED_FOR_PROVIDER',
      );
    },
  );

  test.openspec('Effective numbering change emits prior properties')(
    'emits one pPrChange with session metadata and old numPr',
    async () => {
      const opened = await openNumberingSession();
      const result = await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        match_paragraph_id: opened.paraIds[0],
      });
      assertSuccess(result, 'format_numbering');
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
      const packed = await session.doc.toBuffer({ cleanBookmarks: false });
      const xml = await readZipText(packed.buffer, 'word/document.xml');
      expect(xml?.match(/<w:pPrChange\b/g)).toHaveLength(1);
      expect(xml).toContain('w:author="SafeDocX AI"');
      expect(xml).toMatch(/<w:pPrChange[^>]*>[\s\S]*?<w:numId w:val="20"/);
    },
  );

  test.openspec('Clean and tracked saves represent the same numbering edit')(
    'persists current numbering cleanly and keeps tracked review markup',
    async () => {
      const opened = await openNumberingSession();
      assertSuccess(await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        match_paragraph_id: opened.paraIds[0],
      }), 'format_numbering');
      const cleanPath = path.join(opened.tmpDir, 'numbering-clean.docx');
      const trackedPath = path.join(opened.tmpDir, 'numbering-tracked.docx');
      const saved = await save(opened.mgr, {
        file_path: opened.inputPath,
        save_to_local_path: cleanPath,
        tracked_save_to_local_path: trackedPath,
        save_format: 'both',
      });
      assertSuccess(saved, 'save');
      const cleanXml = await readZipText(await fs.readFile(cleanPath), 'word/document.xml');
      const trackedXml = await readZipText(await fs.readFile(trackedPath), 'word/document.xml');
      expect(cleanXml).toContain('<w:numId w:val="10"/>');
      expect(trackedXml).toContain('<w:pPrChange');
    },
  );

  test.openspec('Standard accept and reject semantics cover numbering changes')(
    'keeps current numbering on accept and restores old numbering on reject',
    async () => {
      const accepted = await openNumberingSession();
      assertSuccess(await formatNumbering(accepted.mgr, {
        file_path: accepted.inputPath,
        target_paragraph_id: accepted.paraIds[1],
        match_paragraph_id: accepted.paraIds[0],
      }), 'format_numbering');
      assertSuccess(await acceptAiEdits(accepted.mgr, {
        file_path: accepted.inputPath,
        author: 'SafeDocX AI',
      }), 'accept_ai_edits');
      expect(await sessionNumbering(accepted, 1)).toEqual({ numId: '10', ilvl: 0 });

      const rejected = await openNumberingSession();
      assertSuccess(await formatNumbering(rejected.mgr, {
        file_path: rejected.inputPath,
        target_paragraph_id: rejected.paraIds[1],
        match_paragraph_id: rejected.paraIds[0],
      }), 'format_numbering');
      assertSuccess(await rejectAiEdits(rejected.mgr, {
        file_path: rejected.inputPath,
        author: 'SafeDocX AI',
      }), 'reject_ai_edits');
      expect(await sessionNumbering(rejected, 1)).toEqual({ numId: '20', ilvl: 0 });
    },
  );

  test.openspec('Text and paragraph anchors remain stable')(
    'preserves paragraph count, text, and every anchor',
    async () => {
      const opened = await openNumberingSession();
      const before = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(before, 'read_file');
      assertSuccess(await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        remove: true,
      }), 'format_numbering');
      const after = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(after, 'read_file');
      expect(after.total_paragraphs).toBe(before.total_paragraphs);
      for (const id of opened.paraIds) expect(String(after.content)).toContain(id);
      for (const text of ['Alpha item', 'Beta item', 'Plain item']) {
        expect(String(after.content)).toContain(text);
      }
    },
  );

  test.openspec('Non-target package content remains unchanged')(
    'preserves numbering definitions and an unrelated package part',
    async () => {
      const opened = await openNumberingSession();
      assertSuccess(await formatNumbering(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        match_paragraph_id: opened.paraIds[0],
      }), 'format_numbering');
      const output = path.join(opened.tmpDir, 'preserved.docx');
      assertSuccess(await save(opened.mgr, {
        file_path: opened.inputPath,
        save_to_local_path: output,
        save_format: 'tracked',
      }), 'save');
      const bytes = await fs.readFile(output);
      expect(await readZipText(bytes, 'word/numbering.xml')).toBe(NUMBERING_XML);
      expect(await readZipText(bytes, 'word/custom-preserved.xml')).toBe('<root keep="yes"/>');
    },
  );
});
