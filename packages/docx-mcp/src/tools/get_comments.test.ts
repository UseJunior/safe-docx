import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { getComments } from './get_comments.js';
import { addComment } from './add_comment.js';
import { MCP_TOOLS } from '../server.js';

const TEST_FEATURE = 'add-comment-read-tool';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

describe('OpenSpec traceability: add-comment-read-tool', () => {
  registerCleanup();

  humanReadableTest.openspec('get_comments returns comment metadata and text')(
    'Scenario: get_comments returns comment metadata and text',
    async () => {
      const opened = await openSession([
        'First paragraph with a comment.',
        'Second paragraph with another comment.',
      ]);

      await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.paraIds[0]!,
        author: 'Alice',
        text: 'Please review this clause.',
        initials: 'AL',
      });

      await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.paraIds[1]!,
        author: 'Bob',
        text: 'This needs clarification.',
        initials: 'BO',
      });

      const result = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(result, 'get_comments');

      const comments = result.comments as Array<Record<string, unknown>>;
      expect(comments).toHaveLength(2);

      expect(comments[0]).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          author: 'Alice',
          initials: 'AL',
          text: expect.stringContaining('Please review this clause.'),
        }),
      );
      // anchored_paragraph_id is string | null depending on primitives resolution
      expect(
        comments[0]!.anchored_paragraph_id === null ||
          typeof comments[0]!.anchored_paragraph_id === 'string',
      ).toBe(true);

      // date should be string or null
      expect(
        comments[0]!.date === null || typeof comments[0]!.date === 'string',
      ).toBe(true);

      expect(comments[1]).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          author: 'Bob',
          initials: 'BO',
          text: expect.stringContaining('This needs clarification.'),
        }),
      );
      expect(
        comments[1]!.anchored_paragraph_id === null ||
          typeof comments[1]!.anchored_paragraph_id === 'string',
      ).toBe(true);

      expect(result.session_id).toBe(opened.sessionId);
    },
  );

  humanReadableTest.openspec('threaded replies are nested under parent comments')(
    'Scenario: threaded replies are nested under parent comments',
    async () => {
      const opened = await openSession(['Contract clause for discussion.']);

      const root = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Is this clause enforceable?',
      });
      assertSuccess(root, 'add_comment (root)');

      const reply = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        parent_comment_id: root.comment_id as number,
        author: 'Bob',
        text: 'Yes, per section 4.2.',
      });
      assertSuccess(reply, 'add_comment (reply)');

      const result = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(result, 'get_comments');

      const comments = result.comments as Array<Record<string, unknown>>;
      expect(comments).toHaveLength(1);

      const rootComment = comments[0]!;
      expect(rootComment.author).toBe('Alice');

      const replies = rootComment.replies as Array<Record<string, unknown>>;
      expect(replies).toHaveLength(1);
      expect(replies[0]).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          author: 'Bob',
          text: expect.stringContaining('Yes, per section 4.2.'),
        }),
      );
    },
  );

  humanReadableTest.openspec('document with no comments returns empty array')(
    'Scenario: document with no comments returns empty array',
    async () => {
      const opened = await openSession(['No comments in this document.']);

      const result = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(result, 'get_comments');
      expect(result.comments).toEqual([]);
    },
  );

  humanReadableTest.openspec('get_comments supports session-or-file resolution')(
    'Scenario: get_comments supports session-or-file resolution',
    async () => {
      const opened = await openSession(['File resolution paragraph.']);

      await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        author: 'Tester',
        text: 'File resolution comment.',
      });

      const result = await getComments(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(result, 'get_comments (file_path)');
      expect(result.session_id).toBeTruthy();
      const comments = result.comments as Array<Record<string, unknown>>;
      expect(comments).toHaveLength(1);
    },
  );

  humanReadableTest.openspec('missing session context returns error')(
    'Scenario: missing session context returns error',
    async () => {
      const mgr = createTestSessionManager();
      const result = await getComments(mgr, {});
      assertFailure(result, 'MISSING_SESSION_CONTEXT', 'get_comments');
    },
  );

  humanReadableTest.openspec('get_comments does not mutate session state')(
    'Scenario: get_comments does not mutate session state',
    async () => {
      const opened = await openSession(['Immutability check paragraph.']);

      await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        author: 'Tester',
        text: 'Mutation guard comment.',
      });

      const session = opened.mgr.getSession(opened.sessionId);
      const revisionBefore = session.editRevision;
      const editCountBefore = session.editCount;

      const result = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(result, 'get_comments');

      expect(session.editRevision).toBe(revisionBefore);
      expect(session.editCount).toBe(editCountBefore);
    },
  );

  test('get_comments tool is registered in MCP_TOOLS as read-only', async ({ given, when, then }: AllureBddContext) => {
    let tool: (typeof MCP_TOOLS)[number] | undefined;
    await given('the MCP_TOOLS registry is loaded', () => {});
    await when('the get_comments tool entry is looked up', () => {
      tool = MCP_TOOLS.find((t) => t.name === 'get_comments');
    });
    await then('the tool is registered with readOnlyHint=true and destructiveHint=false', () => {
      expect(tool).toBeTruthy();
      expect(tool!.annotations.readOnlyHint).toBe(true);
      expect(tool!.annotations.destructiveHint).toBe(false);
    });
  });
});
