import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

import { readFile } from './read_file.js';
import { insertParagraph } from './insert_paragraph.js';
import { openSession, assertSuccess, registerCleanup } from '../testing/session-test-utils.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Insert Paragraph Errors' });

describe('insert_paragraph validation + tag handling', () => {
  registerCleanup();

  test('rejects invalid position values and missing anchors', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let paraId: string;
    let invalidPosition: Awaited<ReturnType<typeof insertParagraph>>;
    let missingAnchor: Awaited<ReturnType<typeof insertParagraph>>;

    await given('a session with an anchor paragraph', async () => {
      opened = await openSession(['Anchor paragraph']);
      paraId = firstParaIdFromToon(opened.content);
    });
    await when('insertParagraph is called with an invalid position', async () => {
      invalidPosition = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: paraId,
        new_string: 'new text',
        instruction: 'invalid position test',
        position: 'LEFT',
      });
    });
    await then('it fails with INVALID_POSITION', () => {
      expect(invalidPosition.success).toBe(false);
      if (!invalidPosition.success) expect(invalidPosition.error.code).toBe('INVALID_POSITION');
    });
    await when('insertParagraph is called with a missing anchor', async () => {
      missingAnchor = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: '_bk_missing',
        new_string: 'new text',
        instruction: 'missing anchor test',
        position: 'AFTER',
      });
    });
    await and('it fails with ANCHOR_NOT_FOUND', () => {
      expect(missingAnchor.success).toBe(false);
      if (!missingAnchor.success) expect(missingAnchor.error.code).toBe('ANCHOR_NOT_FOUND');
    });
  });

  test('returns INSERT_ERROR for malformed inline tags', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let paraId: string;
    let malformed: Awaited<ReturnType<typeof insertParagraph>>;

    await given('a session with an anchor paragraph', async () => {
      opened = await openSession(['Anchor paragraph']);
      paraId = firstParaIdFromToon(opened.content);
    });
    await when('insertParagraph is called with malformed inline tags', async () => {
      malformed = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: paraId,
        new_string: '<b>broken tag',
        instruction: 'malformed tags',
        position: 'AFTER',
      });
    });
    await then('it fails with UNBALANCED_BOLD_TAGS', () => {
      expect(malformed.success).toBe(false);
      if (!malformed.success) {
        expect(malformed.error.code).toBe('UNBALANCED_BOLD_TAGS');
      }
    });
  });

  test('strips hyperlink tags in default mode and inserts clean text', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let paraId: string;
    let inserted: Awaited<ReturnType<typeof insertParagraph>>;
    let read: Awaited<ReturnType<typeof readFile>>;

    await given('a session with an anchor paragraph', async () => {
      opened = await openSession(['Anchor paragraph']);
      paraId = firstParaIdFromToon(opened.content);
    });
    await when('insertParagraph is called with a hyperlink tag', async () => {
      inserted = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: paraId,
        new_string: 'Link: <a href="https://example.com">Example</a> and Term',
        instruction: 'strip unsupported tags',
        position: 'AFTER',
      });
    });
    await then('the insert succeeds', () => { assertSuccess(inserted, 'insert_paragraph default tags'); });
    await and('the inserted paragraph contains plain text without the anchor tag', async () => {
      read = await readFile(opened.mgr, {
        session_id: opened.sessionId,
        node_ids: [String(inserted.new_paragraph_id)],
        format: 'simple',
      });
      assertSuccess(read, 'read inserted');
      const content = String(read.content);
      expect(content).toContain('Link: Example and Term');
      expect(content).not.toContain('<a ');
    });
  });
});
