import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { insertParagraph } from './insert_paragraph.js';
import { readFile } from './read_file.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';

const test = it.epic('Document Editing').withLabels({ feature: 'Insert Paragraph' });

describe('insert_paragraph branch coverage', () => {
  registerCleanup();

  test('parses balanced header/highlighting/inline style tags across multiple inserted paragraphs', async () => {
    const opened = await openSession(['Anchor paragraph.']);
    const paraId = firstParaIdFromToon(opened.content);

    const inserted = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string:
        '<header><b>Section:</b></header> body <highlighting><i>alpha</i></highlighting>\n\n' +
        '<RunInHeader><u>Clause:</u></RunInHeader> beta',
      instruction: 'exercise balanced inline tags',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert_paragraph balanced tags');
    expect(inserted.new_paragraph_ids.length).toBe(2);

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: inserted.new_paragraph_ids.map((id) => String(id)),
      format: 'simple',
    });
    assertSuccess(read, 'read inserted paragraphs');
    const content = String(read.content);
    expect(content).toContain('Section: body alpha');
    expect(content).toContain('Clause: beta');
  });

  test('returns INSERT_ERROR for unbalanced non-definition tag variants', async () => {
    const opened = await openSession(['Anchor paragraph.']);
    const paraId = firstParaIdFromToon(opened.content);

    const cases: Array<{ newString: string; expected: string }> = [
      { newString: '</header>oops', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '<header>oops', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '</RunInHeader>oops', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '<RunInHeader>oops', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '</highlighting>oops', expected: 'UNBALANCED_HIGHLIGHT_TAGS' },
      { newString: '<highlighting>oops', expected: 'UNBALANCED_HIGHLIGHT_TAGS' },
      { newString: '</b>oops', expected: 'UNBALANCED_BOLD_TAGS' },
      { newString: '<b>oops', expected: 'UNBALANCED_BOLD_TAGS' },
      { newString: '</i>oops', expected: 'UNBALANCED_ITALIC_TAGS' },
      { newString: '<i>oops', expected: 'UNBALANCED_ITALIC_TAGS' },
      { newString: '</u>oops', expected: 'UNBALANCED_UNDERLINE_TAGS' },
      { newString: '<u>oops', expected: 'UNBALANCED_UNDERLINE_TAGS' },
    ];

    for (const tc of cases) {
      const result = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: paraId,
        new_string: tc.newString,
        instruction: `malformed tags: ${tc.expected}`,
        position: 'AFTER',
      });
      assertFailure(result, 'INSERT_ERROR', tc.newString);
      expect(result.error.message).toContain(tc.expected);
    }
  });

  test('legacy definition mode absorbs surrounding quotes and keeps single quoted terms', async () => {
    const previous = process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
    process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = '1';

    try {
      const opened = await openSession(['Anchor paragraph.']);
      const paraId = firstParaIdFromToon(opened.content);

      const inserted = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: paraId,
        new_string:
          'Defined as "<definition>Company</definition>" and "<definition>Service</definition>".',
        instruction: 'legacy definition quote absorption',
        position: 'AFTER',
      });
      assertSuccess(inserted, 'legacy definition insertion');

      const read = await readFile(opened.mgr, {
        session_id: opened.sessionId,
        node_ids: [String(inserted.new_paragraph_id)],
        format: 'simple',
      });
      assertSuccess(read, 'read legacy definition insertion');
      expect(String(read.content)).toContain('Defined as "Company" and "Service".');
      expect(String(read.content)).not.toContain('""Company""');
    } finally {
      if (typeof previous === 'undefined') {
        delete process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
      } else {
        process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = previous;
      }
    }
  });

  test('defaults to AFTER when position is omitted', async () => {
    const opened = await openSession(['Anchor paragraph', 'Tail paragraph']);
    const paraId = firstParaIdFromToon(opened.content);

    const inserted = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string: 'Inserted by default',
      instruction: 'default position should be AFTER',
    });
    assertSuccess(inserted, 'insert default position');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      format: 'toon',
    });
    assertSuccess(read, 'read full doc after default insert');
    const content = String(read.content);

    const anchorIndex = content.indexOf('Anchor paragraph');
    const insertedIndex = content.indexOf('Inserted by default');
    const tailIndex = content.indexOf('Tail paragraph');
    expect(anchorIndex).toBeGreaterThanOrEqual(0);
    expect(insertedIndex).toBeGreaterThan(anchorIndex);
    expect(tailIndex).toBeGreaterThan(insertedIndex);
  });

  test('normalizes definition and hyperlink tags in default mode before insertion', async () => {
    const opened = await openSession(['Anchor paragraph.']);
    const paraId = firstParaIdFromToon(opened.content);

    const inserted = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string: '<a href="https://example.test"><definition>Company</definition> means the buyer.</a>',
      instruction: 'strip tags in default insert mode',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert with normalized definition/hyperlink tags');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [String(inserted.new_paragraph_id)],
      format: 'simple',
    });
    assertSuccess(read, 'read inserted normalized paragraph');
    expect(String(read.content)).toContain('"Company" means the buyer.');
    expect(String(read.content)).not.toContain('<a ');
  });

  test('accepts true/yes/on env values for legacy definition-tag mode', async () => {
    const previous = process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;

    try {
      for (const truthy of ['true', 'yes', 'on'] as const) {
        process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = truthy;

        const opened = await openSession(['Anchor paragraph.']);
        const paraId = firstParaIdFromToon(opened.content);

        const inserted = await insertParagraph(opened.mgr, {
          session_id: opened.sessionId,
          positional_anchor_node_id: paraId,
          new_string: '<definition>Service</definition> means the platform services.',
          instruction: `legacy truthy insert mode: ${truthy}`,
          position: 'AFTER',
        });
        assertSuccess(inserted, `legacy insert mode: ${truthy}`);

        const read = await readFile(opened.mgr, {
          session_id: opened.sessionId,
          node_ids: [String(inserted.new_paragraph_id)],
          format: 'simple',
        });
        assertSuccess(read, `read legacy insert mode: ${truthy}`);
        expect(String(read.content)).toContain('"Service" means the platform services.');
      }
    } finally {
      if (typeof previous === 'undefined') {
        delete process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
      } else {
        process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = previous;
      }
    }
  });
});
