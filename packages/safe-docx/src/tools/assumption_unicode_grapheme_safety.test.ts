import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';

import { readFile } from './read_file.js';
import { smartEdit } from './smart_edit.js';
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

describe('assumption: unicode grapheme safety (A17)', () => {
  registerCleanup();

  test('smart_edit preserves untouched ZWJ emoji, combining marks, and RTL text', async () => {
    const initial = `Lead 👩‍💻 coder Cafe\u0301 says مرحبا بالعالم`;
    const opened = await openSession([initial], { prefix: 'safe-docx-assumption-unicode-preserve-' });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await smartEdit(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'coder',
      new_string: 'engineer',
      instruction: 'replace ascii token without touching unicode graphemes',
    });
    assertSuccess(edited, 'smart_edit');

    const after = await readCleanTextById(opened.mgr, opened.sessionId, paraId);
    expect(after).toBe(`Lead 👩‍💻 engineer Cafe\u0301 says مرحبا بالعالم`);
  });

  test('smart_edit replaces a ZWJ emoji grapheme sequence without corruption', async () => {
    const zwj = '👩\u200d💻';
    const toneZwJ = '🧑🏽\u200d💻';
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

    const opened = await openSession([], { xml, prefix: 'safe-docx-assumption-unicode-zwj-' });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await smartEdit(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: zwj,
      new_string: toneZwJ,
      instruction: 'replace full zwj grapheme cluster',
    });
    assertSuccess(edited, 'smart_edit');

    const after = await readCleanTextById(opened.mgr, opened.sessionId, paraId);
    expect(after).toBe('Role: 🧑🏽‍💻, status: active');
    expect(after.includes(zwj)).toBe(false);
  });

  test('smart_edit replaces decomposed combining sequence deterministically', async () => {
    const decomposed = `Cafe\u0301`;
    const opened = await openSession(
      [`Offer for ${decomposed} starts Monday`],
      { prefix: 'safe-docx-assumption-unicode-combining-' },
    );
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await smartEdit(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: decomposed,
      new_string: 'Café',
      instruction: 'replace decomposed sequence with precomposed form',
    });
    assertSuccess(edited, 'smart_edit');

    const after = await readCleanTextById(opened.mgr, opened.sessionId, paraId);
    expect(after).toBe('Offer for Café starts Monday');
  });
});
