import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { replaceText } from './replace_text.js';
import { readFile } from './read_file.js';
import { clearFormatting } from './clear_formatting.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Editing Features' });

describe('Editing Features', () => {
  registerCleanup();

  const XML_HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
  const XML_FTR = '</w:body></w:document>';

  test('matches text across run boundaries', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let paraId: string;
    let edited: Awaited<ReturnType<typeof replaceText>>;
    let read: Awaited<ReturnType<typeof readFile>>;

    await given('a document with text split across run boundaries', async () => {
      const xml = XML_HDR + '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r></w:p>' + XML_FTR;
      opened = await openSession([], { xml });
      const session = opened.mgr.getSession(opened.sessionId);
      const { nodes } = await session.doc.buildDocumentView();
      paraId = nodes[0]!.id;
    });
    await when('replaceText is called across run boundaries', async () => {
      edited = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: paraId,
        old_string: 'Hello World',
        new_string: 'Hi Universe',
        instruction: 'test cross-run matching',
      });
    });
    await then('the replacement succeeds', () => { assertSuccess(edited, 'replace across run boundaries'); });
    await then('the document contains the new text', async () => {
      read = await readFile(opened.mgr, {
        session_id: opened.sessionId,
        node_ids: [paraId],
        format: 'simple',
      });
      expect(String(read.content)).toContain('Hi Universe');
    });
  });

  test('supports clear_formatting tool', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let paraId: string;
    let cleared: Awaited<ReturnType<typeof clearFormatting>>;
    let read: Awaited<ReturnType<typeof readFile>>;

    await given('a document with bold and highlighted text', async () => {
      const xml = XML_HDR + '<w:p><w:r><w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t>Bold Highlight</w:t></w:r></w:p>' + XML_FTR;
      opened = await openSession([], { xml });
      const session = opened.mgr.getSession(opened.sessionId);
      const { nodes } = await session.doc.buildDocumentView();
      paraId = nodes[0]!.id;
    });
    await when('clearFormatting is called with clear_bold and clear_highlight', async () => {
      cleared = await clearFormatting(opened.mgr, {
        session_id: opened.sessionId,
        paragraph_ids: [paraId],
        clear_bold: true,
        clear_highlight: true,
      });
    });
    await then('the clear_formatting call succeeds', () => { assertSuccess(cleared, 'clear_formatting'); });
    await and('the document node has no bold or highlight formatting', async () => {
      read = await readFile(opened.mgr, {
        session_id: opened.sessionId,
        node_ids: [paraId],
        format: 'json',
      });
      assertSuccess(read, 'read after clear_formatting');
      const responseNodes = JSON.parse(read.content as string);
      const node = responseNodes[0];

      expect(node.body_run_formatting, 'body_run_formatting should be defined').toBeDefined();
      expect(node.body_run_formatting.bold).toBe(false);
      expect(node.body_run_formatting.highlightVal).toBeNull();
    });
  });
});
