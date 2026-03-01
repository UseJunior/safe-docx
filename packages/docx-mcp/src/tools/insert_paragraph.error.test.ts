import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';

import { readFile } from './read_file.js';
import { insertParagraph } from './insert_paragraph.js';
import { openSession, assertSuccess, registerCleanup } from '../testing/session-test-utils.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';

describe('insert_paragraph validation + tag handling', () => {
  registerCleanup();

  it('rejects invalid position values and missing anchors', async () => {
    const opened = await openSession(['Anchor paragraph']);
    const paraId = firstParaIdFromToon(opened.content);

    const invalidPosition = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string: 'new text',
      instruction: 'invalid position test',
      position: 'LEFT',
    });
    expect(invalidPosition.success).toBe(false);
    if (!invalidPosition.success) expect(invalidPosition.error.code).toBe('INVALID_POSITION');

    const missingAnchor = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: '_bk_missing',
      new_string: 'new text',
      instruction: 'missing anchor test',
      position: 'AFTER',
    });
    expect(missingAnchor.success).toBe(false);
    if (!missingAnchor.success) expect(missingAnchor.error.code).toBe('ANCHOR_NOT_FOUND');
  });

  it('returns INSERT_ERROR for malformed inline tags', async () => {
    const opened = await openSession(['Anchor paragraph']);
    const paraId = firstParaIdFromToon(opened.content);

    const malformed = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string: '<b>broken tag',
      instruction: 'malformed tags',
      position: 'AFTER',
    });
    expect(malformed.success).toBe(false);
    if (!malformed.success) {
      expect(malformed.error.code).toBe('UNBALANCED_BOLD_TAGS');
    }
  });

  it('strips hyperlink tags in default mode and inserts clean text', async () => {
    const opened = await openSession(['Anchor paragraph']);
    const paraId = firstParaIdFromToon(opened.content);

    const inserted = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string: 'Link: <a href="https://example.com">Example</a> and Term',
      instruction: 'strip unsupported tags',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert_paragraph default tags');

    const read = await readFile(opened.mgr, {
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
