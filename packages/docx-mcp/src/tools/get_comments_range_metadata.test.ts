import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { getComments } from './get_comments.js';

const TEST_FEATURE = 'expose-comment-range-metadata';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

function makeDocumentXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

function makeCommentReferenceRun(commentId: number): string {
  return `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${commentId}"/></w:r>`;
}

type CommentFixtureEntry = {
  id: number;
  author: string;
  initials: string;
  text: string;
  paraId: string;
};

function makeCommentsXml(entries: CommentFixtureEntry[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    entries
      .map(
        (entry) =>
          `<w:comment w:id="${entry.id}" w:author="${entry.author}" w:date="2025-01-01T00:00:00Z" w:initials="${entry.initials}">` +
          `<w:p w14:paraId="${entry.paraId}"><w:r><w:annotationRef/></w:r><w:r><w:t>${entry.text}</w:t></w:r></w:p>` +
          `</w:comment>`,
      )
      .join('') +
    `</w:comments>`
  );
}

async function openRangeFixture(params: {
  bodyXml: string;
  comments: CommentFixtureEntry[];
  commentsExtendedXml?: string;
}) {
  return openSession([], {
    xml: makeDocumentXml(params.bodyXml),
    extraFiles: {
      'word/comments.xml': makeCommentsXml(params.comments),
      ...(params.commentsExtendedXml
        ? { 'word/commentsExtended.xml': params.commentsExtendedXml }
        : {}),
    },
  });
}

describe('OpenSpec traceability: expose-comment-range-metadata', () => {
  registerCleanup();

  humanReadableTest.openspec('single-paragraph range comment exposes range metadata')(
    'Scenario: single-paragraph range comment exposes range metadata',
    async () => {
      const opened = await openRangeFixture({
        bodyXml:
          `<w:p><w:r><w:t>Lead text </w:t></w:r>` +
          `<w:commentRangeStart w:id="1"/><w:r><w:t>incorporated</w:t></w:r><w:commentRangeEnd w:id="1"/>` +
          makeCommentReferenceRun(1) +
          `</w:p>`,
        comments: [
          { id: 1, author: 'Alice', initials: 'AL', text: 'Range comment.', paraId: '00000001' },
        ],
      });

      const result = await getComments(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(result, 'get_comments');

      const comments = result.comments as Array<Record<string, unknown>>;
      expect(comments).toHaveLength(1);
      const comment = comments[0]!;

      expect(comment.anchored_paragraph_id).toBe(opened.paraIds[0]);
      expect(comment.end_paragraph_id).toBe(comment.anchored_paragraph_id);
      expect(comment.start_run_index).toBe(1);
      expect(comment.start_char_offset).toBe(0);
      expect(comment.end_run_index).toBe(1);
      expect(comment.end_char_offset).toBe('incorporated'.length);
    },
  );

  humanReadableTest.openspec('multi-paragraph range comment exposes start and end paragraph ids')(
    'Scenario: multi-paragraph range comment exposes start and end paragraph ids',
    async () => {
      const opened = await openRangeFixture({
        bodyXml:
          `<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>First clause sentence.</w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>Second clause sentence.</w:t></w:r><w:commentRangeEnd w:id="1"/>` +
          makeCommentReferenceRun(1) +
          `</w:p>`,
        comments: [
          { id: 1, author: 'Alice', initials: 'AL', text: 'Spans two paragraphs.', paraId: '00000001' },
        ],
      });

      const result = await getComments(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(result, 'get_comments');

      const comments = result.comments as Array<Record<string, unknown>>;
      expect(comments).toHaveLength(1);
      const comment = comments[0]!;

      expect(comment.anchored_paragraph_id).toBe(opened.paraIds[0]);
      expect(comment.end_paragraph_id).toBe(opened.paraIds[1]);
      expect(comment.end_paragraph_id).not.toBe(comment.anchored_paragraph_id);
    },
  );

  humanReadableTest.openspec('comment without range markers leaves range fields undefined')(
    'Scenario: comment without range markers leaves range fields undefined',
    async () => {
      const opened = await openRangeFixture({
        bodyXml: `<w:p><w:r><w:t>Plain paragraph.</w:t></w:r>${makeCommentReferenceRun(1)}</w:p>`,
        comments: [
          { id: 1, author: 'Alice', initials: 'AL', text: 'No range markers.', paraId: '00000001' },
        ],
      });

      const result = await getComments(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(result, 'get_comments');

      // Round-trip through JSON to assert on the serialized shape a client sees:
      // keys mapped to `undefined` must vanish entirely.
      const serialized = JSON.parse(JSON.stringify(result.comments)) as Array<
        Record<string, unknown>
      >;
      expect(serialized).toHaveLength(1);
      const comment = serialized[0]!;

      expect('end_paragraph_id' in comment).toBe(false);
      expect('start_run_index' in comment).toBe(false);
      expect('start_char_offset' in comment).toBe(false);
      expect('end_run_index' in comment).toBe(false);
      expect('end_char_offset' in comment).toBe(false);

      // Pre-existing fields are unchanged.
      expect(comment.author).toBe('Alice');
      expect(comment.text).toBe('No range markers.');
      expect('anchored_paragraph_id' in comment).toBe(true);
    },
  );

  humanReadableTest.openspec('threaded replies pass range metadata through')(
    'Scenario: threaded replies pass range metadata through',
    async () => {
      const commentsExtendedXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">` +
        `<w15:commentEx w15:paraId="00000001" w15:done="0"/>` +
        `<w15:commentEx w15:paraId="00000002" w15:paraIdParent="00000001" w15:done="0"/>` +
        `</w15:commentsEx>`;

      const opened = await openRangeFixture({
        bodyXml:
          `<w:p><w:r><w:t>Lead </w:t></w:r>` +
          `<w:commentRangeStart w:id="1"/><w:commentRangeStart w:id="2"/>` +
          `<w:r><w:t>Disputed clause</w:t></w:r>` +
          `<w:commentRangeEnd w:id="1"/><w:commentRangeEnd w:id="2"/>` +
          makeCommentReferenceRun(1) +
          makeCommentReferenceRun(2) +
          `</w:p>`,
        comments: [
          { id: 1, author: 'Alice', initials: 'AL', text: 'Root comment.', paraId: '00000001' },
          { id: 2, author: 'Bob', initials: 'BO', text: 'Reply comment.', paraId: '00000002' },
        ],
        commentsExtendedXml,
      });

      const result = await getComments(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(result, 'get_comments');

      const comments = result.comments as Array<Record<string, unknown>>;
      expect(comments).toHaveLength(1);
      const root = comments[0]!;
      expect(root.author).toBe('Alice');
      expect(root.end_paragraph_id).toBe(opened.paraIds[0]);

      const replies = root.replies as Array<Record<string, unknown>>;
      expect(replies).toHaveLength(1);
      const reply = replies[0]!;
      expect(reply.author).toBe('Bob');
      expect(reply.anchored_paragraph_id).toBe(opened.paraIds[0]);
      expect(reply.end_paragraph_id).toBe(opened.paraIds[0]);
      expect(typeof reply.start_run_index).toBe('number');
      expect(typeof reply.start_char_offset).toBe('number');
      expect(typeof reply.end_run_index).toBe('number');
      expect(typeof reply.end_char_offset).toBe('number');
    },
  );
});
