import { describe, expect } from 'vitest';
import { testAllure as test, type AllureBddContext } from '../testing/allure-test.js';

import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

type JsonNode = {
  id: string;
  clean_text: string;
};

async function readCleanTextById(
  mgr: Parameters<typeof readFile>[0],
  sessionId: string,
  paragraphId: string,
): Promise<string> {
  const read = await readFile(mgr, {
    session_id: sessionId,
    node_ids: [paragraphId],
    format: 'json',
  });
  assertSuccess(read, 'read_file json');
  const nodes = JSON.parse(String(read.content)) as JsonNode[];
  expect(nodes.length).toBe(1);
  return nodes[0]!.clean_text;
}

describe('replace_text: unicode grapheme safety', () => {
  registerCleanup();

  test('replace_text preserves untouched ZWJ emoji, combining marks, and RTL text', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let paraId: string;
    let after: string;

    await given('a paragraph containing a ZWJ emoji, decomposed combining mark, and RTL text is open', async () => {
      const initial = `Lead 👩‍💻 coder Cafe\u0301 says مرحبا بالعالم`;
      opened = await openSession([initial], { prefix: 'safe-docx-unicode-preserve-' });
      paraId = firstParaIdFromToon(opened.content);
    });

    await when('"coder" is replaced with "engineer"', async () => {
      const edited = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: paraId,
        old_string: 'coder',
        new_string: 'engineer',
        instruction: 'replace ascii token without touching unicode graphemes',
      });
      assertSuccess(edited, 'replace_text');
      after = await readCleanTextById(opened.mgr, opened.sessionId, paraId);
    });

    await then('the ZWJ emoji, combining mark, and RTL text are untouched and only "coder" changed', () => {
      expect(after).toBe(`Lead 👩‍💻 engineer Cafe\u0301 says مرحبا بالعالم`);
    });
  });

  test('replace_text replaces a ZWJ emoji grapheme sequence without corruption', async ({ given, when, then }: AllureBddContext) => {
    const zwj = '👩\u200d💻';
    const toneZwJ = '🧑🏽\u200d💻';
    let opened: Awaited<ReturnType<typeof openSession>>;
    let paraId: string;
    let after: string;

    await given('a paragraph with a split-run ZWJ emoji sequence is open', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p>` +
        `<w:r><w:t>Role: 👩</w:t></w:r>` +
        `<w:r><w:t>\u200d💻, status: active</w:t></w:r>` +
        `</w:p>` +
        `</w:body>` +
        `</w:document>`;
      opened = await openSession([], { xml, prefix: 'safe-docx-unicode-zwj-' });
      paraId = firstParaIdFromToon(opened.content);
    });

    await when('the woman-technologist ZWJ sequence is replaced with a skin-tone variant', async () => {
      const edited = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: paraId,
        old_string: zwj,
        new_string: toneZwJ,
        instruction: 'replace full zwj grapheme cluster',
      });
      assertSuccess(edited, 'replace_text');
      after = await readCleanTextById(opened.mgr, opened.sessionId, paraId);
    });

    await then('the output contains the skin-tone variant and the original sequence is gone', () => {
      expect(after).toBe('Role: 🧑🏽‍💻, status: active');
      expect(after.includes(zwj)).toBe(false);
    });
  });

  test('replace_text replaces decomposed combining sequence deterministically', async ({ given, when, then }: AllureBddContext) => {
    const decomposed = `Cafe\u0301`;
    let opened: Awaited<ReturnType<typeof openSession>>;
    let paraId: string;
    let after: string;

    await given('a paragraph with a decomposed combining-accent sequence (Cafe + combining acute) is open', async () => {
      opened = await openSession(
        [`Offer for ${decomposed} starts Monday`],
        { prefix: 'safe-docx-unicode-combining-' },
      );
      paraId = firstParaIdFromToon(opened.content);
    });

    await when('the decomposed sequence is replaced with the precomposed form Café', async () => {
      const edited = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: paraId,
        old_string: decomposed,
        new_string: 'Café',
        instruction: 'replace decomposed sequence with precomposed form',
      });
      assertSuccess(edited, 'replace_text');
      after = await readCleanTextById(opened.mgr, opened.sessionId, paraId);
    });

    await then('the output contains the precomposed form and the surrounding text is intact', () => {
      expect(after).toBe('Offer for Café starts Monday');
    });
  });
});
