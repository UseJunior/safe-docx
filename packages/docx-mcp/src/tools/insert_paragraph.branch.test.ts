import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { insertParagraph } from './insert_paragraph.js';
import { readFile } from './read_file.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Insert Paragraph' });

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

describe('insert_paragraph branch coverage', () => {
  registerCleanup();

  test('parses balanced header/highlight/inline style tags across multiple inserted paragraphs', async () => {
    const opened = await openSession(['Anchor paragraph.']);
    const paraId = firstParaIdFromToon(opened.content);

    const inserted = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string:
        '<header><b>Section:</b></header> body <highlight><i>alpha</i></highlight>\n\n' +
        '<RunInHeader><u>Clause:</u></RunInHeader> beta',
      instruction: 'exercise balanced inline tags',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert_paragraph balanced tags');
    const newParagraphIds = asStringArray((inserted as { new_paragraph_ids?: unknown }).new_paragraph_ids);
    expect(newParagraphIds.length).toBe(2);

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: newParagraphIds,
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
      { newString: '</highlight>oops', expected: 'UNBALANCED_HIGHLIGHT_TAGS' },
      { newString: '<highlight>oops', expected: 'UNBALANCED_HIGHLIGHT_TAGS' },
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
      assertFailure(result, tc.expected, tc.newString);
    }
  });

  test('applies <font> tags in inserted paragraph text', async () => {
    const opened = await openSession(['Anchor paragraph.']);
    const paraId = firstParaIdFromToon(opened.content);

    const inserted = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string: 'Normal and <font color="FF0000" size="14">red large</font> text.',
      instruction: 'font tag insertion test',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert with font tags');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [String(inserted.new_paragraph_id)],
      format: 'simple',
    });
    assertSuccess(read, 'read inserted font tag paragraph');
    expect(String(read.content)).toContain('Normal and red large text.');
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

  test('normalizes hyperlink tags in default mode before insertion', async () => {
    const opened = await openSession(['Anchor paragraph.']);
    const paraId = firstParaIdFromToon(opened.content);

    const inserted = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: paraId,
      new_string: '<a href="https://example.test">Company means the buyer.</a>',
      instruction: 'strip tags in default insert mode',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert with normalized hyperlink tags');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [String(inserted.new_paragraph_id)],
      format: 'simple',
    });
    assertSuccess(read, 'read inserted normalized paragraph');
    expect(String(read.content)).toContain('Company means the buyer.');
    expect(String(read.content)).not.toContain('<a ');
  });
});
