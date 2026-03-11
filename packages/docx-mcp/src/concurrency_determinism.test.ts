import { describe, expect } from 'vitest';
import { testAllure as test, type AllureBddContext } from './testing/allure-test.js';
import fs from 'node:fs/promises';
import { DocxZip, OOXML, W, parseXml, serializeXml } from '@usejunior/docx-core';

import { formatLayout } from './tools/format_layout.js';
import { save } from './tools/save.js';
import { getSessionStatus } from './tools/get_session_status.js';
import { extractParaIdsFromToon } from './testing/docx_test_utils.js';
import { assertSuccess, openSession, registerCleanup } from './testing/session-test-utils.js';

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

function canonicalizeXml(xml: string): string {
  return serializeXml(parseXml(xml));
}

function paragraphAfterSpacingTwips(paragraph: Element): string | null {
  const pPr = paragraph.getElementsByTagNameNS(OOXML.W_NS, W.pPr).item(0) as Element | null;
  if (!pPr) return null;
  const spacing = pPr.getElementsByTagNameNS(OOXML.W_NS, W.spacing).item(0) as Element | null;
  if (!spacing) return null;
  return getWAttr(spacing, W.after);
}

async function runConcurrentFormattingOnce(): Promise<string> {
  const opened = await openSession(
    ['Alpha clause', 'Beta clause', 'Gamma clause'],
    { prefix: 'safe-docx-concurrency-determinism-' },
  );
  const paraIds = extractParaIdsFromToon(opened.content);
  const firstId = paraIds[0]!;
  const thirdId = paraIds[2]!;

  const [resA, resB] = await Promise.all([
    formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      paragraph_spacing: {
        paragraph_ids: [firstId],
        after_twips: 120,
      },
    }),
    formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      paragraph_spacing: {
        paragraph_ids: [thirdId],
        after_twips: 360,
      },
    }),
  ]);
  assertSuccess(resA, 'format_layout A');
  assertSuccess(resB, 'format_layout B');

  const status = await getSessionStatus(opened.mgr, { session_id: opened.sessionId });
  assertSuccess(status, 'get_session_status');
  expect(status.edit_count).toBe(2);
  expect(status.edit_revision).toBe(2);

  const session = opened.mgr.getSession(opened.sessionId);
  const firstParagraph = session.doc.getParagraphElementById(firstId);
  const thirdParagraph = session.doc.getParagraphElementById(thirdId);
  expect(firstParagraph).toBeTruthy();
  expect(thirdParagraph).toBeTruthy();
  expect(paragraphAfterSpacingTwips(firstParagraph!)).toBe('120');
  expect(paragraphAfterSpacingTwips(thirdParagraph!)).toBe('360');

  const outputPath = `${opened.tmpDir}/concurrent-out.docx`;
  const saved = await save(opened.mgr, {
    session_id: opened.sessionId,
    save_to_local_path: outputPath,
    save_format: 'clean',
    clean_bookmarks: false,
  });
  assertSuccess(saved, 'save');

  const zip = await DocxZip.load(await fs.readFile(outputPath) as Buffer);
  const xml = await zip.readText('word/document.xml');
  return canonicalizeXml(xml);
}

describe('concurrency determinism: disjoint formatting operations', () => {
  registerCleanup();

  test('concurrent disjoint layout operations converge to same canonical XML', async ({ given, when, then }: AllureBddContext) => {
    const outputs: string[] = [];

    await given('three independent concurrent formatting sessions on disjoint paragraphs', async () => {
      // Sessions are created inside runConcurrentFormattingOnce
    });

    await when('each session runs concurrent disjoint formatLayout calls and saves', async () => {
      for (let i = 0; i < 3; i++) {
        outputs.push(await runConcurrentFormattingOnce());
      }
    });

    await then('all three runs produce identical canonical XML output', () => {
      expect(outputs[1]).toBe(outputs[0]);
      expect(outputs[2]).toBe(outputs[0]);
    });
  });
});
