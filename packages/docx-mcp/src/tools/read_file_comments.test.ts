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

function commentBlockLines(lines: string[]): string[] {
  const start = lines.indexOf('#COMMENTS');
  return start === -1 ? [] : lines.slice(start);
}

type CommentFixtureEntry = {
  id: number;
  author: string;
  initials: string;
  text: string;
  paraId: string;
  date?: string;
};

function makeDocumentXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

function withParagraphBookmark(params: {
  bookmarkId: number;
  name: string;
  paragraphInnerXml: string;
}): string {
  return `<w:bookmarkStart w:id="${params.bookmarkId}" w:name="${params.name}"/><w:p>${params.paragraphInnerXml}</w:p><w:bookmarkEnd w:id="${params.bookmarkId}"/>`;
}

function makeCommentReferenceRun(commentId: number): string {
  return `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${commentId}"/></w:r>`;
}

function makeCommentsXml(entries: CommentFixtureEntry[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    entries
      .map(
        (entry) =>
          `<w:comment w:id="${entry.id}" w:author="${entry.author}" w:date="${entry.date ?? '2025-01-01T00:00:00Z'}" w:initials="${entry.initials}">` +
          `<w:p w14:paraId="${entry.paraId}"><w:r><w:annotationRef/></w:r><w:r><w:t>${entry.text}</w:t></w:r></w:p>` +
          `</w:comment>`,
      )
      .join('') +
    `</w:comments>`
  );
}

async function openCommentFixture(params: {
  bodyXml: string;
  comments: CommentFixtureEntry[];
}) {
  return openSession([], {
    xml: makeDocumentXml(params.bodyXml),
    extraFiles: { 'word/comments.xml': makeCommentsXml(params.comments) },
  });
}

async function renderCommentFixture(params: {
  bodyXml: string;
  comments: CommentFixtureEntry[];
  readParams?: {
    format?: 'toon' | 'json' | 'simple';
    comment_rendering?: string;
    offset?: number;
    limit?: number;
  };
}) {
  const opened = await openCommentFixture({ bodyXml: params.bodyXml, comments: params.comments });
  const read = await readFile(opened.mgr, {
    file_path: opened.inputPath,
    ...params.readParams,
  });
  assertSuccess(read, 'read_file');
  return { opened, read, content: String(read.content), lines: toonLines(read.content) };
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

  test('endnotes mode emits one trailing #COMMENTS block after #END_TABLE with no inline comment lines', async ({ given, when, then }: AllureBddContext) => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:tbl>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Table cell text.</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>` +
      `</w:body></w:document>`;
    const opened = await given('a document with a one-cell table', async () => openSession([], { xml }));

    const rendered = await when('a table-cell comment is read in endnotes mode', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Cell comment.',
      });
      assertSuccess(result, 'add_comment');
      const read = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        comment_rendering: 'endnotes',
      });
      assertSuccess(read, 'read_file');
      return { commentId: Number(result.comment_id), read };
    });

    await then('the TOON view closes the table before a single trailing comments block', async () => {
      const lines = toonLines(rendered.read.content);
      const endTableIndex = lines.indexOf('#END_TABLE');
      const commentsIndex = lines.indexOf('#COMMENTS');
      expect(lines.filter((line) => line === '#COMMENTS')).toHaveLength(1);
      expect(lines.some((line) => line.startsWith('#COMMENT '))).toBe(false);
      expect(lines.some((line) => line.startsWith('#REPLY '))).toBe(false);
      expect(endTableIndex).toBeGreaterThan(-1);
      expect(commentsIndex).toBe(endTableIndex + 1);
      expect(lines[commentsIndex + 1]).toContain(`c${rendered.commentId} @ ${opened.firstParaId} Alice `);
      expect(lines[commentsIndex + 1]).toContain('| Cell comment.');
    });
  });

  test('endnotes mode renders a single root comment as one block entry', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Alpha paragraph.']));

    const rendered = await when('a root comment is added and read in endnotes mode', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Please review this clause.',
      });
      assertSuccess(result, 'add_comment');
      const read = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        comment_rendering: 'endnotes',
      });
      assertSuccess(read, 'read_file');
      return { commentId: Number(result.comment_id), read };
    });

    await then('the comments block contains exactly one root entry after the paragraph data', async () => {
      const lines = toonLines(rendered.read.content);
      const commentsBlock = commentBlockLines(lines);
      const paragraphIndex = lines.indexOf(findParagraphLine(lines, opened.firstParaId));
      expect(commentsBlock).toHaveLength(2);
      expect(commentsBlock[0]).toBe('#COMMENTS');
      expect(commentsBlock[1]).toContain(`c${rendered.commentId} @ ${opened.firstParaId} Alice `);
      expect(commentsBlock[1]).toContain('| Please review this clause.');
      expect(lines.indexOf('#COMMENTS')).toBe(paragraphIndex + 1);
      expect(Number(rendered.read.paragraphs_returned)).toBe(1);
    });
  });

  test('endnotes mode renders parent comments followed by ordered replies', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Discussion paragraph.']));

    const rendered = await when('a nested comment thread is added and read in endnotes mode', async () => {
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

      const read = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        comment_rendering: 'endnotes',
      });
      assertSuccess(read, 'read_file');
      return {
        rootId: Number(root.comment_id),
        replyId: Number(reply.comment_id),
        nestedReplyId: Number(nestedReply.comment_id),
        read,
      };
    });

    await then('the block emits the parent entry first and each reply directly after its parent chain', async () => {
      const commentsBlock = commentBlockLines(toonLines(rendered.read.content));
      const rootIndex = commentsBlock.findIndex((line) => line.startsWith(`c${rendered.rootId} @ ${opened.firstParaId} Alice `));
      const replyIndex = commentsBlock.findIndex((line) => line.startsWith(`c${rendered.replyId} -> c${rendered.rootId} Bob `));
      const nestedReplyIndex = commentsBlock.findIndex((line) => line.startsWith(`c${rendered.nestedReplyId} -> c${rendered.replyId} Cara `));
      expect(rootIndex).toBeGreaterThan(0);
      expect(replyIndex).toBe(rootIndex + 1);
      expect(nestedReplyIndex).toBe(replyIndex + 1);
    });
  });

  test('endnotes mode lists comments in document order by anchor paragraph', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with three paragraphs', async () => openSession([
      'First paragraph.',
      'Second paragraph.',
      'Third paragraph.',
    ]));

    const rendered = await when('comments are added out of paragraph order and read in endnotes mode', async () => {
      const second = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[1],
        author: 'Bob',
        text: 'Second paragraph comment.',
      });
      assertSuccess(second, 'add_comment(second)');
      const first = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[0],
        author: 'Alice',
        text: 'First paragraph comment.',
      });
      assertSuccess(first, 'add_comment(first)');
      const third = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[2],
        author: 'Cara',
        text: 'Third paragraph comment.',
      });
      assertSuccess(third, 'add_comment(third)');
      const read = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        comment_rendering: 'endnotes',
      });
      assertSuccess(read, 'read_file');
      return { read };
    });

    await then('the comments block follows paragraph order instead of comment creation order', async () => {
      const commentsBlock = commentBlockLines(toonLines(rendered.read.content));
      expect(commentsBlock[1]).toContain(`@ ${opened.paraIds[0]} `);
      expect(commentsBlock[2]).toContain(`@ ${opened.paraIds[1]} `);
      expect(commentsBlock[3]).toContain(`@ ${opened.paraIds[2]} `);
    });
  });

  test('paginated endnotes reads include only in-window anchored comments', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with three paragraphs', async () => openSession([
      'First paragraph.',
      'Second paragraph.',
      'Third paragraph.',
    ]));

    const rendered = await when('comments are added to multiple paragraphs and a one-paragraph endnotes window is read', async () => {
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
      const read = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        offset: 2,
        limit: 1,
        comment_rendering: 'endnotes',
      });
      assertSuccess(read, 'read_file');
      return read;
    });

    await then('the trailing comments block lists only the comment anchored to the returned paragraph', async () => {
      const content = String(rendered.content);
      const commentsBlock = commentBlockLines(toonLines(content));
      expect(content).toContain('Second paragraph');
      expect(commentsBlock).toHaveLength(2);
      expect(commentsBlock[1]).toContain(`@ ${opened.paraIds[1]} `);
      expect(commentsBlock[1]).toContain('Second window comment.');
      expect(content).not.toContain('First paragraph.');
      expect(content).not.toContain('First window comment.');
      expect(Number(rendered.paragraphs_returned)).toBe(1);
    });
  });

  test('endnotes mode and footnotes render independently in the same view', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Clause text.']));

    const rendered = await when('a footnote and comment are added to the same paragraph and read in endnotes mode', async () => {
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
      const read = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        comment_rendering: 'endnotes',
      });
      assertSuccess(read, 'read_file');
      return read;
    });

    await then('the paragraph keeps the footnote marker and the trailing comments block contains the comment', async () => {
      const lines = toonLines(rendered.content);
      const commentsBlock = commentBlockLines(lines);
      expect(findParagraphLine(lines, opened.firstParaId)).toContain('[^1]');
      expect(commentsBlock).toHaveLength(2);
      expect(commentsBlock[1]).toContain(`@ ${opened.firstParaId} `);
      expect(commentsBlock[1]).toContain('Comment body.');
    });
  });

  test('endnotes mode skips the #COMMENTS block when no in-window comments exist', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph and no comments', async () => openSession(['Plain paragraph.']));

    const rendered = await when('read_file is called in endnotes mode without comments', async () => {
      const read = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        comment_rendering: 'endnotes',
      });
      assertSuccess(read, 'read_file');
      return read;
    });

    await then('the output contains no stray comments header', async () => {
      expect(String(rendered.content)).not.toContain('#COMMENTS');
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

  test('endnotes mode keeps json node comments and paragraph-local simple suffixes', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Simple endnotes paragraph.']));

    const rendered = await when('a comment thread is added and json and simple reads use endnotes mode', async () => {
      const root = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Root endnote note.',
      });
      assertSuccess(root, 'add_comment(root)');
      const reply = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        parent_comment_id: Number(root.comment_id),
        author: 'Bob',
        text: 'Reply endnote note.',
      });
      assertSuccess(reply, 'add_comment(reply)');
      const jsonRead = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        format: 'json',
        comment_rendering: 'endnotes',
      });
      assertSuccess(jsonRead, 'read_file(json)');
      const simpleRead = await readFile(opened.mgr, {
        file_path: opened.inputPath,
        format: 'simple',
        comment_rendering: 'endnotes',
      });
      assertSuccess(simpleRead, 'read_file(simple)');
      return { rootId: Number(root.comment_id), replyId: Number(reply.comment_id), jsonRead, simpleRead };
    });

    await then('json still includes node-attached comments and simple format keeps paragraph-style suffixes for parity', async () => {
      const nodes = JSON.parse(String(rendered.jsonRead.content)) as Array<{
        id: string;
        comments?: Array<{ id: number; text: string; replies: Array<{ id: number; text: string }> }>;
      }>;
      const node = nodes.find((candidate) => candidate.id === opened.firstParaId);
      expect(node?.comments).toHaveLength(1);
      expect(node?.comments?.[0]?.id).toBe(rendered.rootId);
      expect(node?.comments?.[0]?.replies[0]?.id).toBe(rendered.replyId);
      expect(String(rendered.simpleRead.content)).toContain(`[c${rendered.rootId}: Root endnote note.]`);
      expect(String(rendered.simpleRead.content)).toContain(`[c${rendered.replyId}->c${rendered.rootId}: Reply endnote note.]`);
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

  test('multiline comment text is escaped to a single TOON line', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Multiline paragraph.']));

    const read = await when('a comment containing newlines is added', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Line one.\nLine two.\r\nLine three.\rLine four.',
      });
      assertSuccess(result, 'add_comment');
      const rendered = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(rendered, 'read_file');
      return rendered;
    });

    await then('the comment renders as exactly one #COMMENT line with literal escapes', async () => {
      const lines = toonLines(read.content);
      const commentLines = lines.filter((line) => line.startsWith('#COMMENT '));
      expect(commentLines).toHaveLength(1);
      expect(commentLines[0]).toContain('Line one.');
      expect(commentLines[0]).toContain('Line two.');
      expect(commentLines[0]).toContain('Line three.');
      expect(commentLines[0]).toContain('Line four.');
      expect(commentLines[0]).toMatch(/\\[nr]/);
      expect(commentLines[0]).not.toContain('\n');
      expect(commentLines[0]).not.toContain('\r');
    });
  });

  test('multiline comment text is escaped to a single line in simple format', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a document with one paragraph', async () => openSession(['Multiline simple paragraph.']));

    const read = await when('a comment containing newlines is added and read in simple format', async () => {
      const result = await addComment(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Alpha\nBeta\r\nGamma',
      });
      assertSuccess(result, 'add_comment');
      const rendered = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'simple' });
      assertSuccess(rendered, 'read_file');
      return rendered;
    });

    await then('the simple-format suffix renders on a single line with literal escapes', async () => {
      const lines = String(read.content).split('\n');
      const paragraphLines = lines.filter((line) => line.includes(opened.firstParaId));
      expect(paragraphLines).toHaveLength(1);
      expect(paragraphLines[0]).toContain('Alpha\\nBeta\\nGamma');
    });
  });

  const inlineMarkerParagraphCases = [
    {
      name: 'inline_markers wraps a single commented span in one paragraph',
      paragraphId: '_bk_inline_single',
      expected: 'Alpha [cm-start:0]Beta[cm-end:0] Gamma',
      bodyXml: withParagraphBookmark({
        bookmarkId: 310,
        name: '_bk_inline_single',
        paragraphInnerXml:
          `<w:r><w:t>Alpha </w:t></w:r><w:commentRangeStart w:id="0"/>` +
          `<w:r><w:t>Beta</w:t></w:r><w:commentRangeEnd w:id="0"/>${makeCommentReferenceRun(0)}` +
          `<w:r><w:t> Gamma</w:t></w:r>`,
      }),
      comments: [{ id: 0, author: 'Alice', initials: 'A', text: 'Inline note.', paraId: '00000040' }],
    },
    {
      name: 'inline_markers renders two non-overlapping ranges in one paragraph',
      paragraphId: '_bk_inline_non_overlapping',
      expected: '[cm-start:0]Alpha[cm-end:0] middle [cm-start:1]Gamma[cm-end:1]',
      bodyXml: withParagraphBookmark({
        bookmarkId: 311,
        name: '_bk_inline_non_overlapping',
        paragraphInnerXml:
          `<w:commentRangeStart w:id="0"/><w:r><w:t>Alpha</w:t></w:r>` +
          `<w:commentRangeEnd w:id="0"/>${makeCommentReferenceRun(0)}<w:r><w:t> middle </w:t></w:r>` +
          `<w:commentRangeStart w:id="1"/><w:r><w:t>Gamma</w:t></w:r>` +
          `<w:commentRangeEnd w:id="1"/>${makeCommentReferenceRun(1)}`,
      }),
      comments: [
        { id: 0, author: 'Alice', initials: 'A', text: 'Alpha note.', paraId: '00000041' },
        { id: 1, author: 'Bob', initials: 'B', text: 'Gamma note.', paraId: '00000042' },
      ],
    },
    {
      name: 'inline_markers preserves nested close ordering',
      paragraphId: '_bk_inline_nested',
      expected: 'Lead [cm-start:0]Alpha [cm-start:1]Beta[cm-end:1][cm-end:0] tail',
      bodyXml: withParagraphBookmark({
        bookmarkId: 312,
        name: '_bk_inline_nested',
        paragraphInnerXml:
          `<w:r><w:t>Lead </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>Alpha </w:t></w:r>` +
          `<w:commentRangeStart w:id="1"/><w:r><w:t>Beta</w:t></w:r>` +
          `<w:commentRangeEnd w:id="1"/>${makeCommentReferenceRun(1)}` +
          `<w:commentRangeEnd w:id="0"/>${makeCommentReferenceRun(0)}<w:r><w:t> tail</w:t></w:r>`,
      }),
      comments: [
        { id: 0, author: 'Alice', initials: 'A', text: 'Outer note.', paraId: '00000043' },
        { id: 1, author: 'Bob', initials: 'B', text: 'Inner note.', paraId: '00000044' },
      ],
    },
    {
      name: 'inline_markers preserves crossing ranges losslessly',
      paragraphId: '_bk_inline_crossing',
      expected: '[cm-start:0]A [cm-start:1]B[cm-end:0] C[cm-end:1]',
      bodyXml: withParagraphBookmark({
        bookmarkId: 313,
        name: '_bk_inline_crossing',
        paragraphInnerXml:
          `<w:commentRangeStart w:id="0"/><w:r><w:t>A </w:t></w:r><w:commentRangeStart w:id="1"/>` +
          `<w:r><w:t>B</w:t></w:r><w:commentRangeEnd w:id="0"/>${makeCommentReferenceRun(0)}` +
          `<w:r><w:t> C</w:t></w:r><w:commentRangeEnd w:id="1"/>${makeCommentReferenceRun(1)}`,
      }),
      comments: [
        { id: 0, author: 'Alice', initials: 'A', text: 'First crossing note.', paraId: '00000045' },
        { id: 1, author: 'Bob', initials: 'B', text: 'Second crossing note.', paraId: '00000046' },
      ],
    },
  ] satisfies Array<{
    name: string;
    paragraphId: string;
    expected: string;
    bodyXml: string;
    comments: CommentFixtureEntry[];
  }>;

  for (const scenario of inlineMarkerParagraphCases) {
    test(scenario.name, async () => {
      const { lines } = await renderCommentFixture({
        bodyXml: scenario.bodyXml,
        comments: scenario.comments,
        readParams: { comment_rendering: 'inline_markers' },
      });
      expect(findParagraphLine(lines, scenario.paragraphId)).toContain(scenario.expected);
    });
  }

  test('inline_markers suppresses whole-paragraph markers but keeps the thread block', async () => {
    const opened = await openSession(['Whole paragraph comment']);
    const result = await addComment(opened.mgr, {
      file_path: opened.inputPath,
      target_paragraph_id: opened.firstParaId,
      author: 'Alice',
      text: 'Whole-paragraph note.',
    });
    assertSuccess(result, 'add_comment');
    const read = await readFile(opened.mgr, { file_path: opened.inputPath, comment_rendering: 'inline_markers' });
    assertSuccess(read, 'read_file');
    const content = String(read.content);
    const line = findParagraphLine(toonLines(content), opened.firstParaId);
    expect(line).not.toContain('[cm-start:');
    expect(line).not.toContain('[cm-end:');
    expect(content).toContain(`#COMMENT ${opened.firstParaId} c${result.comment_id} Alice `);
  });

  test('inline_markers renders the anchor span when add_comment(anchor_text) hits a single-run paragraph (#151)', async () => {
    // Issue #151: paragraphs stored as one big <w:r> previously caused the writer to
    // wrap the whole run, which inline_markers would then suppress. With run-splitting,
    // the markers must bracket only the anchor span and inline_markers must render them.
    const opened = await openSession([
      'The terms below are incorporated into and form part of this agreement.',
    ]);
    const result = await addComment(opened.mgr, {
      file_path: opened.inputPath,
      target_paragraph_id: opened.firstParaId,
      anchor_text: 'incorporated',
      author: 'SmokeTest',
      text: 'Range comment on "incorporated".',
    });
    assertSuccess(result, 'add_comment');

    const read = await readFile(opened.mgr, {
      file_path: opened.inputPath,
      comment_rendering: 'inline_markers',
    });
    assertSuccess(read, 'read_file');
    const content = String(read.content);
    const line = findParagraphLine(toonLines(content), opened.firstParaId);
    const id = result.comment_id as number;
    expect(line).toContain(`[cm-start:${id}]incorporated[cm-end:${id}]`);
    expect(content).toContain(`#COMMENT ${opened.firstParaId} c${id} SmokeTest `);
  });

  test('inline_markers survives a pre-existing comments.xml that lacks xmlns:w14 (#154)', async () => {
    // Issue #154: real-world docx files (e.g., Balanced_Employee_IP_Agreement.docx) ship a
    // pre-existing comments.xml whose root <w:comments> element omits xmlns:w14. The writer
    // then writes <w:p w14:paraId="..."> into that document, and on the next read xmldom
    // rejects with "NamespaceError: prefix is non-null and namespace is null" — which
    // read_file silently swallowed, hiding both the markers AND the #COMMENT block.
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>The terms below are incorporated into and form part of this agreement.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    // comments.xml lacking xmlns:w14 — mirrors the third-party file shape that triggers #154.
    const commentsXmlNoW14 =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
      ` xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"` +
      ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`;
    const opened = await openSession([], {
      xml: documentXml,
      extraFiles: { 'word/comments.xml': commentsXmlNoW14 },
    });
    const result = await addComment(opened.mgr, {
      file_path: opened.inputPath,
      target_paragraph_id: opened.firstParaId,
      anchor_text: 'incorporated',
      author: 'SmokeTest',
      text: 'Range comment on "incorporated".',
    });
    assertSuccess(result, 'add_comment');

    const read = await readFile(opened.mgr, {
      file_path: opened.inputPath,
      comment_rendering: 'inline_markers',
    });
    assertSuccess(read, 'read_file');
    // No silent comment-load failure should leak through anymore.
    expect(read.comment_load_error).toBeUndefined();
    const content = String(read.content);
    const id = result.comment_id as number;
    const line = findParagraphLine(toonLines(content), opened.firstParaId);
    expect(line).toContain(`[cm-start:${id}]incorporated[cm-end:${id}]`);
    expect(content).toContain(`#COMMENT ${opened.firstParaId} c${id} SmokeTest `);
  });

  test('surfaces comment_load_error when comments.xml is unparseable (#154 peer-review follow-up)', async () => {
    // Negative-path companion to the #154 regression: read_file used to `catch {}` malformed
    // comments.xml silently — making the original bug invisible. The new behavior is to
    // continue serving body content but surface the underlying error via metadata.
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>Body content stays readable.</w:t></w:r></w:p></w:body>` +
      `</w:document>`;
    // Genuinely malformed: a w14: attribute on a root that doesn't declare xmlns:w14,
    // which triggers xmldom's NamespaceError on parse.
    const malformedComments =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:comment w:id="0" w:author="X" w:initials="X" w:date="2026-01-01T00:00:00Z">` +
      `<w:p w14:paraId="DEADBEEF"><w:r><w:t>boom</w:t></w:r></w:p>` +
      `</w:comment></w:comments>`;
    const opened = await openSession([], {
      xml: documentXml,
      extraFiles: { 'word/comments.xml': malformedComments },
    });

    const read = await readFile(opened.mgr, {
      file_path: opened.inputPath,
      comment_rendering: 'inline_markers',
    });
    assertSuccess(read, 'read_file');
    // Body content still reaches the caller — the comment-load failure must not abort read_file.
    const content = String(read.content);
    expect(content).toContain('Body content stays readable');
    // And the cause is surfaced rather than swallowed.
    expect(typeof read.comment_load_error).toBe('string');
    expect(String(read.comment_load_error)).toMatch(/NamespaceError|prefix/i);
  });

  test('inline_markers renders multi-paragraph ranges only at the boundary paragraphs', async () => {
    const { lines } = await renderCommentFixture({
      bodyXml:
        withParagraphBookmark({
          bookmarkId: 301,
          name: '_bk_multi_start',
          paragraphInnerXml:
            `<w:r><w:t>Lead </w:t></w:r><w:commentRangeStart w:id="11"/><w:r><w:t>First chunk</w:t></w:r>`,
        }) +
        withParagraphBookmark({
          bookmarkId: 302,
          name: '_bk_multi_middle',
          paragraphInnerXml: `<w:r><w:t>Middle paragraph</w:t></w:r>`,
        }) +
        withParagraphBookmark({
          bookmarkId: 303,
          name: '_bk_multi_end',
          paragraphInnerXml:
            `<w:r><w:t>Second chunk</w:t></w:r><w:commentRangeEnd w:id="11"/>${makeCommentReferenceRun(11)}` +
            `<w:r><w:t> tail</w:t></w:r>`,
        }),
      comments: [{ id: 11, author: 'Alice', initials: 'A', text: 'Across paragraphs.', paraId: '00000031' }],
      readParams: { comment_rendering: 'inline_markers' },
    });
    expect(findParagraphLine(lines, '_bk_multi_start')).toContain('Lead [cm-start:11]First chunk');
    expect(findParagraphLine(lines, '_bk_multi_middle')).not.toContain('[cm-');
    expect(findParagraphLine(lines, '_bk_multi_end')).toContain('Second chunk[cm-end:11] tail');
  });

  test('inline_markers supports ranges that start in a table cell and end after the table', async () => {
    const { lines } = await renderCommentFixture({
      bodyXml:
        `<w:tbl><w:tr><w:tc>` +
        withParagraphBookmark({
          bookmarkId: 304,
          name: '_bk_table_start',
          paragraphInnerXml:
            `<w:r><w:t>Left </w:t></w:r><w:commentRangeStart w:id="12"/><w:r><w:t>cell</w:t></w:r>`,
        }) +
        `</w:tc></w:tr></w:tbl>` +
        withParagraphBookmark({
          bookmarkId: 305,
          name: '_bk_after_table',
          paragraphInnerXml: `<w:r><w:t>After table</w:t></w:r><w:commentRangeEnd w:id="12"/>${makeCommentReferenceRun(12)}`,
        }),
      comments: [{ id: 12, author: 'Bob', initials: 'B', text: 'Cross-boundary note.', paraId: '00000032' }],
      readParams: { comment_rendering: 'inline_markers' },
    });
    const tableIndex = lines.indexOf('#TABLE _tbl_0 | 1 rows × 1 cols');
    const startIndex = lines.indexOf(findParagraphLine(lines, '_bk_table_start'));
    const endTableIndex = lines.indexOf('#END_TABLE');
    const afterTableIndex = lines.indexOf(findParagraphLine(lines, '_bk_after_table'));
    expect(tableIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(tableIndex);
    expect(findParagraphLine(lines, '_bk_table_start')).toContain('Left [cm-start:12]cell');
    expect(afterTableIndex).toBeGreaterThan(endTableIndex);
    expect(findParagraphLine(lines, '_bk_after_table')).toContain('After table[cm-end:12]');
  });

  test('inline_markers combined mode keeps #COMMENT and #REPLY lines', async () => {
    const opened = await openCommentFixture({
      bodyXml: withParagraphBookmark({
        bookmarkId: 314,
        name: '_bk_inline_combined',
        paragraphInnerXml:
          `<w:commentRangeStart w:id="20"/><w:r><w:t>Clause</w:t></w:r>` +
          `<w:commentRangeEnd w:id="20"/>${makeCommentReferenceRun(20)}<w:r><w:t> text</w:t></w:r>`,
      }),
      comments: [{ id: 20, author: 'Alice', initials: 'A', text: 'Root inline note.', paraId: '00000047' }],
    });
    const reply = await addComment(opened.mgr, {
      file_path: opened.inputPath,
      parent_comment_id: 20,
      author: 'Bob',
      text: 'Reply inline note.',
    });
    assertSuccess(reply, 'add_comment(reply)');
    const read = await readFile(opened.mgr, { file_path: opened.inputPath, comment_rendering: 'inline_markers' });
    assertSuccess(read, 'read_file');
    const content = String(read.content);
    const lines = toonLines(content);
    expect(findParagraphLine(lines, '_bk_inline_combined')).toContain('[cm-start:20]Clause[cm-end:20] text');
    expect(content).toContain('#COMMENT _bk_inline_combined c20 Alice ');
    expect(content).toContain(`#REPLY c${reply.comment_id} -> c20 Bob `);
  });

  test('pagination does not surface inline markers for out-of-window comment boundaries', async () => {
    const { content, read } = await renderCommentFixture({
      bodyXml:
        withParagraphBookmark({
          bookmarkId: 306,
          name: '_bk_window_start',
          paragraphInnerXml:
            `<w:r><w:t>Lead </w:t></w:r><w:commentRangeStart w:id="13"/><w:r><w:t>First chunk</w:t></w:r>`,
        }) +
        withParagraphBookmark({
          bookmarkId: 307,
          name: '_bk_window_middle',
          paragraphInnerXml: `<w:r><w:t>Middle paragraph</w:t></w:r>`,
        }) +
        withParagraphBookmark({
          bookmarkId: 308,
          name: '_bk_window_end',
          paragraphInnerXml: `<w:r><w:t>Second chunk</w:t></w:r><w:commentRangeEnd w:id="13"/>${makeCommentReferenceRun(13)}`,
        }),
      comments: [{ id: 13, author: 'Cara', initials: 'C', text: 'Windowed note.', paraId: '00000033' }],
      readParams: { offset: 3, limit: 1, comment_rendering: 'inline_markers' },
    });
    expect(findParagraphLine(toonLines(content), '_bk_window_end')).not.toContain('[cm-end:13]');
    expect(content).not.toContain('#COMMENT _bk_window_start');
    expect(Number(read.paragraphs_returned)).toBe(1);
  });

  test('inline_markers falls back to paragraph notes when range metadata is incomplete', async () => {
    const { content, lines } = await renderCommentFixture({
      bodyXml: withParagraphBookmark({
        bookmarkId: 309,
        name: '_bk_missing_start',
        paragraphInnerXml:
          `<w:r><w:t>Legacy attachment</w:t></w:r><w:commentRangeEnd w:id="14"/>${makeCommentReferenceRun(14)}`,
      }),
      comments: [{ id: 14, author: 'Dana', initials: 'D', text: 'Legacy comment.', paraId: '00000034' }],
      readParams: { comment_rendering: 'inline_markers' },
    });
    expect(findParagraphLine(lines, '_bk_missing_start')).not.toContain('[cm-');
    expect(content).toContain('#COMMENT _bk_missing_start c14 Dana ');
  });

  test('json output includes comment range metadata only in inline_markers mode', async () => {
    const fixture = {
      bodyXml: withParagraphBookmark({
        bookmarkId: 315,
        name: '_bk_json_range',
        paragraphInnerXml:
          `<w:r><w:t>Alpha </w:t></w:r><w:commentRangeStart w:id="30"/><w:r><w:t>Beta</w:t></w:r>` +
          `<w:commentRangeEnd w:id="30"/>${makeCommentReferenceRun(30)}<w:r><w:t> Gamma</w:t></w:r>`,
      }),
      comments: [{ id: 30, author: 'Alice', initials: 'A', text: 'JSON range note.', paraId: '00000048' }],
    };
    const inline = await renderCommentFixture({ ...fixture, readParams: { format: 'json', comment_rendering: 'inline_markers' } });
    const paragraphNotes = await renderCommentFixture({ ...fixture, readParams: { format: 'json', comment_rendering: 'paragraph_notes' } });
    const inlineNode = (JSON.parse(inline.content) as Array<{ id: string; comments?: Array<{ id: number; range?: unknown }> }>)
      .find((candidate) => candidate.id === '_bk_json_range');
    const paragraphNode = (JSON.parse(paragraphNotes.content) as Array<{ id: string; comments?: Array<{ range?: unknown }> }>)
      .find((candidate) => candidate.id === '_bk_json_range');
    expect(inlineNode?.comments?.[0]).toMatchObject({
      id: 30,
      range: {
        startParagraphId: '_bk_json_range',
        endParagraphId: '_bk_json_range',
        startRunIndex: 1,
        startCharOffset: 0,
        endRunIndex: 1,
        endCharOffset: 4,
      },
    });
    expect(paragraphNode?.comments?.[0]?.range).toBeUndefined();
  });

  test('simple output in inline_markers mode keeps comment suffixes but does not inline the milestones', async () => {
    const opened = await openSession(['Simple inline paragraph']);
    const result = await addComment(opened.mgr, {
      file_path: opened.inputPath,
      target_paragraph_id: opened.firstParaId,
      author: 'Alice',
      text: 'Simple inline note.',
      anchor_text: 'inline',
    });
    assertSuccess(result, 'add_comment');
    const read = await readFile(opened.mgr, {
      file_path: opened.inputPath,
      format: 'simple',
      comment_rendering: 'inline_markers',
    });
    assertSuccess(read, 'read_file');
    const content = String(read.content);
    expect(content).toContain(`[c${result.comment_id}: Simple inline note.]`);
    expect(content).not.toContain('[cm-start:');
    expect(content).not.toContain('[cm-end:');
  });

  test('inline_markers correctly positions markers around literal angle-bracket text like <Borrower>', async () => {
    // Regression: the marker injector previously treated any `<...>` in tagged_text as a
    // TOON formatting tag, so paragraphs containing literal angle-bracket placeholders
    // (common in legal templates: `<Borrower>`, `<Effective Date>`) misplaced the markers.
    // The fix recognizes only the known TOON tag set; literal `<...>` is counted as visible chars.
    const fixture = {
      bodyXml: withParagraphBookmark({
        bookmarkId: 320,
        name: '_bk_literal_angles',
        paragraphInnerXml:
          `<w:r><w:t>Alpha &lt;Borrower&gt; </w:t></w:r>` +
          `<w:commentRangeStart w:id="40"/>` +
          `<w:r><w:t>Beta</w:t></w:r>` +
          `<w:commentRangeEnd w:id="40"/>${makeCommentReferenceRun(40)}`,
      }),
      comments: [{ id: 40, author: 'Alice', initials: 'A', text: 'Should this be a placeholder?', paraId: '00000049' }],
      readParams: { comment_rendering: 'inline_markers' as const },
    };
    const rendered = await renderCommentFixture(fixture);
    const lines = String(rendered.content).split('\n');
    const paragraphLine = findParagraphLine(lines, '_bk_literal_angles');
    // Markers must wrap "Beta" exactly, not anything else.
    expect(paragraphLine).toContain('Alpha <Borrower> [cm-start:40]Beta[cm-end:40]');
  });

  test('inline_markers correctly positions markers when the paragraph has a manual list label', async () => {
    // Regression: `buildDocumentView` strips manual list labels (e.g., `(a) `) from
    // `tagged_text`, but comment range offsets are computed against the FULL raw paragraph
    // text. Without compensation, markers would shift left by the label length.
    // The fix: track stripped char count in `visible_offset_correction` on the node and
    // subtract it during marker injection.
    const fixture = {
      bodyXml: withParagraphBookmark({
        bookmarkId: 321,
        name: '_bk_manual_label',
        // "(a) Alpha Beta" — visible run layout:
        //   run 0: "(a) Alpha "  (10 chars)
        //   run 1 (with markers around it): "Beta" (4 chars)
        // After stripListLabel: "Alpha Beta" (label "(a)" + space stripped → 4 chars stripped)
        // Comment range covers run 1 → raw offsets 10..14; tagged_text offsets 6..10 (after correction).
        paragraphInnerXml:
          `<w:r><w:t>(a) Alpha </w:t></w:r>` +
          `<w:commentRangeStart w:id="50"/>` +
          `<w:r><w:t>Beta</w:t></w:r>` +
          `<w:commentRangeEnd w:id="50"/>${makeCommentReferenceRun(50)}`,
      }),
      comments: [{ id: 50, author: 'Alice', initials: 'A', text: 'Manual label note.', paraId: '00000050' }],
      readParams: { comment_rendering: 'inline_markers' as const },
    };
    const rendered = await renderCommentFixture(fixture);
    const lines = String(rendered.content).split('\n');
    const paragraphLine = findParagraphLine(lines, '_bk_manual_label');
    // Markers must wrap "Beta" inside the post-label text.
    expect(paragraphLine).toContain('Alpha [cm-start:50]Beta[cm-end:50]');
    // Sanity: there must be no stray markers at the end of the line.
    expect(paragraphLine).not.toMatch(/Beta\s*\[cm-start:50\]\[cm-end:50\]\s*$/);
  });

  test('inline_markers does not match bare <a> or <font> as TOON tags', async () => {
    // Regression: the TOON_INLINE_TAG_RE previously allowed bare `<a>` and `<font>` (no
    // attributes), but the formatter only emits `<a href="...">` and `<font ATTR=...>`.
    // Literal `<a>` or `<font>` text in document content was being silently skipped as
    // markup, shifting marker positions.
    const fixtureA = {
      bodyXml: withParagraphBookmark({
        bookmarkId: 322,
        name: '_bk_literal_a',
        paragraphInnerXml:
          `<w:r><w:t>Alpha &lt;a&gt; </w:t></w:r>` +
          `<w:commentRangeStart w:id="51"/>` +
          `<w:r><w:t>Beta</w:t></w:r>` +
          `<w:commentRangeEnd w:id="51"/>${makeCommentReferenceRun(51)}`,
      }),
      comments: [{ id: 51, author: 'Alice', initials: 'A', text: 'Literal a tag.', paraId: '00000051' }],
      readParams: { comment_rendering: 'inline_markers' as const },
    };
    const renderedA = await renderCommentFixture(fixtureA);
    expect(findParagraphLine(String(renderedA.content).split('\n'), '_bk_literal_a'))
      .toContain('Alpha <a> [cm-start:51]Beta[cm-end:51]');

    const fixtureFont = {
      bodyXml: withParagraphBookmark({
        bookmarkId: 323,
        name: '_bk_literal_font',
        paragraphInnerXml:
          `<w:r><w:t>Alpha &lt;font&gt; </w:t></w:r>` +
          `<w:commentRangeStart w:id="52"/>` +
          `<w:r><w:t>Beta</w:t></w:r>` +
          `<w:commentRangeEnd w:id="52"/>${makeCommentReferenceRun(52)}`,
      }),
      comments: [{ id: 52, author: 'Alice', initials: 'A', text: 'Literal font tag.', paraId: '00000052' }],
      readParams: { comment_rendering: 'inline_markers' as const },
    };
    const renderedFont = await renderCommentFixture(fixtureFont);
    expect(findParagraphLine(String(renderedFont.content).split('\n'), '_bk_literal_font'))
      .toContain('Alpha <font> [cm-start:52]Beta[cm-end:52]');
  });
});
