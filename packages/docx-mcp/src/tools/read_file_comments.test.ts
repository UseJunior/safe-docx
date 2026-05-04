import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { addComment } from './add_comment.js';
import { addFootnote } from './add_footnote.js';
import { readFile } from './read_file.js';

const test = testAllure.epic('Document Reading');

function toonLines(content: unknown): string[] {
  return String(content).split('\n');
}

function findParagraphLine(lines: string[], paragraphId: string): string {
  const line = lines.find((candidate) => candidate.startsWith(`${paragraphId} | `));
  if (!line) throw new Error(`Paragraph line not found for ${paragraphId}`);
  return line;
}

describe('read_file comment rendering', () => {
  registerCleanup();

  test('single root comment renders one #COMMENT line', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Alpha paragraph.']));

    const created = await when('a root comment is added and read_file is called', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Please review this clause.',
      });
      assertSuccess(result, 'add_comment');
      const read = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(read, 'read_file');
      return { commentId: Number(result.comment_id), read };
    });

    await then('the paragraph row is followed by one #COMMENT line and no replies', async () => {
      const lines = toonLines(created.read.content);
      const paragraphIndex = lines.indexOf(findParagraphLine(lines, opened.firstParaId));
      const commentLine = lines.find((line) => line.startsWith(`#COMMENT ${opened.firstParaId} c${created.commentId} Alice `));
      expect(commentLine).toContain('| Please review this clause.');
      expect(lines.filter((line) => line.startsWith('#COMMENT '))).toHaveLength(1);
      expect(lines.filter((line) => line.startsWith('#REPLY '))).toHaveLength(0);
      expect(lines[paragraphIndex + 1]).toBe(commentLine);
      expect(Number(created.read.paragraphs_returned)).toBe(1);
    });
  });

  test('comment with replies renders ordered #REPLY lines', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Discussion paragraph.']));

    const created = await when('a nested comment thread is added', async () => {
      const root = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Root note.',
      });
      assertSuccess(root, 'add_comment(root)');
      const reply = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        parent_comment_id: Number(root.comment_id),
        author: 'Bob',
        text: 'First reply.',
      });
      assertSuccess(reply, 'add_comment(reply)');
      const nestedReply = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        parent_comment_id: Number(reply.comment_id),
        author: 'Cara',
        text: 'Nested reply.',
      });
      assertSuccess(nestedReply, 'add_comment(nested reply)');

      const read = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(read, 'read_file');
      return {
        rootId: Number(root.comment_id),
        replyId: Number(reply.comment_id),
        nestedReplyId: Number(nestedReply.comment_id),
        read,
      };
    });

    await then('the thread is emitted in parent-child order', async () => {
      const lines = toonLines(created.read.content);
      const rootIndex = lines.findIndex((line) => line.startsWith(`#COMMENT ${opened.firstParaId} c${created.rootId} Alice `));
      const replyIndex = lines.findIndex((line) => line.startsWith(`#REPLY c${created.replyId} -> c${created.rootId} Bob `));
      const nestedReplyIndex = lines.findIndex((line) => line.startsWith(`#REPLY c${created.nestedReplyId} -> c${created.replyId} Cara `));
      expect(rootIndex).toBeGreaterThan(-1);
      expect(replyIndex).toBeGreaterThan(rootIndex);
      expect(nestedReplyIndex).toBeGreaterThan(replyIndex);
    });
  });

  test('multiple root comments on one paragraph all render', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Shared paragraph.']));

    const read = await when('two root comments are added to the same paragraph', async () => {
      const first = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'First root.',
      });
      assertSuccess(first, 'add_comment(first)');
      const second = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Bob',
        text: 'Second root.',
      });
      assertSuccess(second, 'add_comment(second)');
      const result = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(result, 'read_file');
      return result;
    });

    await then('both root comments appear under the paragraph', async () => {
      const commentLines = toonLines(read.content).filter((line) => line.startsWith('#COMMENT '));
      expect(commentLines).toHaveLength(2);
      expect(commentLines[0]).toContain('First root.');
      expect(commentLines[1]).toContain('Second root.');
    });
  });

  test('comment on a table-cell paragraph renders inside the #TABLE block', async ({ given, when, then }: AllureBddContext) => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:tbl>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Table cell text.</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>` +
      `</w:body></w:document>`;
    const opened = await given('a document with a one-cell table', async () => openSession([], { xml }));

    const read = await when('a comment is added to the table cell paragraph', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Cell comment.',
      });
      assertSuccess(result, 'add_comment');
      const rendered = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(rendered, 'read_file');
      return rendered;
    });

    await then('the comment line stays inside the table block after the cell paragraph', async () => {
      const lines = toonLines(read.content);
      const tableIndex = lines.indexOf('#TABLE _tbl_0 | 1 rows × 1 cols');
      const paragraphIndex = lines.indexOf(findParagraphLine(lines, opened.firstParaId));
      const commentIndex = lines.findIndex((line) => line.startsWith(`#COMMENT ${opened.firstParaId} `));
      const endIndex = lines.indexOf('#END_TABLE');
      expect(tableIndex).toBeGreaterThan(-1);
      expect(paragraphIndex).toBeGreaterThan(tableIndex);
      expect(commentIndex).toBe(paragraphIndex + 1);
      expect(endIndex).toBeGreaterThan(commentIndex);
    });
  });

  test('paragraph with footnote and comment shows both with no interaction', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Clause text.']));

    const read = await when('a footnote and comment are added to the same paragraph', async () => {
      const note = await addFootnote(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Footnote body',
      });
      assertSuccess(note, 'add_footnote');
      const comment = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Comment body.',
      });
      assertSuccess(comment, 'add_comment');
      const result = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(result, 'read_file');
      return result;
    });

    await then('the paragraph retains the footnote marker and gains a comment line', async () => {
      const lines = toonLines(read.content);
      expect(findParagraphLine(lines, opened.firstParaId)).toContain('[^1]');
      expect(lines.some((line) => line.startsWith(`#COMMENT ${opened.firstParaId} `) && line.includes('Comment body.'))).toBe(true);
    });
  });

  test('paginated reads render only comments for in-window paragraphs', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with three paragraphs', async () => openSession([
      'First paragraph.',
      'Second paragraph.',
      'Third paragraph.',
    ]));

    const read = await when('comments are added to two paragraphs and a windowed read is requested', async () => {
      const first = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[0],
        author: 'Alice',
        text: 'First window comment.',
      });
      assertSuccess(first, 'add_comment(first)');
      const second = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        author: 'Bob',
        text: 'Second window comment.',
      });
      assertSuccess(second, 'add_comment(second)');
      const result = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        offset: 2,
        limit: 1,
      });
      assertSuccess(result, 'read_file');
      return result;
    });

    await then('only the in-window paragraph and its comments are rendered', async () => {
      const content = String(read.content);
      expect(content).toContain('Second paragraph');
      expect(content).toContain('Second window comment.');
      expect(content).not.toContain('First paragraph.');
      expect(content).not.toContain('First window comment.');
      expect(Number(read.paragraphs_returned)).toBe(1);
    });
  });

  test('comment_rendering none preserves the previous output exactly', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Regression paragraph.']));

    const read = await when('a comment is added but comment rendering is disabled', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Hidden comment.',
      });
      assertSuccess(result, 'add_comment');
      const rendered = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        comment_rendering: 'none',
      });
      assertSuccess(rendered, 'read_file');
      return rendered;
    });

    await then('the TOON output matches the pre-comment baseline exactly', async () => {
      expect(String(read.content)).toBe(opened.content);
    });
  });

  test('paragraph_notes is the default comment rendering mode', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Default behavior paragraph.']));

    const read = await when('a comment is added and read_file is called without the option', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Default comment.',
      });
      assertSuccess(result, 'add_comment');
      const rendered = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(rendered, 'read_file');
      return rendered;
    });

    await then('the comment line is present by default', async () => {
      expect(String(read.content)).toContain('Default comment.');
      expect(String(read.content)).toContain(`#COMMENT ${opened.firstParaId} `);
    });
  });

  test('json mode populates comments and simple mode appends comment suffixes', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['JSON paragraph.']));

    const rendered = await when('a comment thread is added and json and simple reads are requested', async () => {
      const root = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Root json note.',
      });
      assertSuccess(root, 'add_comment(root)');
      const reply = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        parent_comment_id: Number(root.comment_id),
        author: 'Bob',
        text: 'Reply json note.',
      });
      assertSuccess(reply, 'add_comment(reply)');
      const jsonRead = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'json' });
      assertSuccess(jsonRead, 'read_file(json)');
      const simpleRead = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'simple' });
      assertSuccess(simpleRead, 'read_file(simple)');
      return { rootId: Number(root.comment_id), replyId: Number(reply.comment_id), jsonRead, simpleRead };
    });

    await then('json nodes include comments and simple output includes flattened comment suffixes', async () => {
      const nodes = JSON.parse(String(rendered.jsonRead.content)) as Array<{
        id: string;
        comments?: Array<{ id: number; text: string; replies: Array<{ id: number; text: string }> }>;
      }>;
      const node = nodes.find((candidate) => candidate.id === opened.firstParaId);
      expect(node?.comments).toHaveLength(1);
      expect(node?.comments?.[0]?.id).toBe(rendered.rootId);
      expect(node?.comments?.[0]?.text).toBe('Root json note.');
      expect(node?.comments?.[0]?.replies).toHaveLength(1);
      expect(node?.comments?.[0]?.replies[0]?.id).toBe(rendered.replyId);
      expect(String(rendered.simpleRead.content)).toContain(`[c${rendered.rootId}: Root json note.]`);
      expect(String(rendered.simpleRead.content)).toContain(`[c${rendered.replyId}->c${rendered.rootId}: Reply json note.]`);
    });
  });

  test('comment text containing literal pipes is escaped on TOON emit', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Pipe paragraph.']));

    const read = await when('a comment with pipe characters is added', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'A|B',
        text: 'Clause | note.',
      });
      assertSuccess(result, 'add_comment');
      const rendered = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(rendered, 'read_file');
      return rendered;
    });

    await then('the rendered comment line escapes literal pipes', async () => {
      expect(String(read.content)).toContain('A\\|B');
      expect(String(read.content)).toContain('Clause \\| note.');
    });
  });
});
