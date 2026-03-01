import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { replaceText } from './replace_text.js';
import { readFile } from './read_file.js';
import { clearFormatting } from './clear_formatting.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

describe('Editing Features', () => {
  registerCleanup();

  const XML_HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
  const XML_FTR = '</w:body></w:document>';

  it('matches text across run boundaries', async () => {
    const xml = XML_HDR + '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r></w:p>' + XML_FTR;
    const opened = await openSession([], { xml });
    const session = opened.mgr.getSession(opened.sessionId);
    const { nodes } = await session.doc.buildDocumentView();
    const paraId = nodes[0]!.id;

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'Hello World',
      new_string: 'Hi Universe',
      instruction: 'test cross-run matching',
    });
    assertSuccess(edited, 'replace across run boundaries');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [paraId],
      format: 'simple',
    });
    expect(String(read.content)).toContain('Hi Universe');
  });

  it('supports clear_formatting tool', async () => {
    const xml = XML_HDR + '<w:p><w:r><w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t>Bold Highlight</w:t></w:r></w:p>' + XML_FTR;
    const opened = await openSession([], { xml });
    const session = opened.mgr.getSession(opened.sessionId);
    const { nodes } = await session.doc.buildDocumentView();
    const paraId = nodes[0]!.id;

    const cleared = await clearFormatting(opened.mgr, {
      session_id: opened.sessionId,
      paragraph_ids: [paraId],
      clear_bold: true,
      clear_highlight: true,
    });
    assertSuccess(cleared, 'clear_formatting');

    const read = await readFile(opened.mgr, {
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
