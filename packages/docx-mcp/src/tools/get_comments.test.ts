import { describe, expect } from 'vitest';
import { testAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';
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
      const opened = await allureStep('Given a session with two commented paragraphs', async () => {
        const o = await openSession([
          'First paragraph with a comment.',
          'Second paragraph with another comment.',
        ]);

        await addComment(o.mgr, {
          session_id: o.sessionId,
          target_paragraph_id: o.paraIds[0]!,
          author: 'Alice',
          text: 'Please review this clause.',
          initials: 'AL',
        });

        await addComment(o.mgr, {
          session_id: o.sessionId,
          target_paragraph_id: o.paraIds[1]!,
          author: 'Bob',
          text: 'This needs clarification.',
          initials: 'BO',
        });

        return o;
      });

      const result = await allureStep('When get_comments is called', async () => {
        const r = await getComments(opened.mgr, { session_id: opened.sessionId });
        assertSuccess(r, 'get_comments');
        await allureJsonAttachment('get_comments-response', r);
        return r;
      });

      await allureStep('Then both comments are returned with correct metadata', async () => {
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
      });
    },
  );

  humanReadableTest.openspec('threaded replies are nested under parent comments')(
    'Scenario: threaded replies are nested under parent comments',
    async () => {
      const { opened, root } = await allureStep('Given a root comment with a threaded reply', async () => {
        const o = await openSession(['Contract clause for discussion.']);

        const r = await addComment(o.mgr, {
          session_id: o.sessionId,
          target_paragraph_id: o.firstParaId,
          author: 'Alice',
          text: 'Is this clause enforceable?',
        });
        assertSuccess(r, 'add_comment (root)');

        const reply = await addComment(o.mgr, {
          session_id: o.sessionId,
          parent_comment_id: r.comment_id as number,
          author: 'Bob',
          text: 'Yes, per section 4.2.',
        });
        assertSuccess(reply, 'add_comment (reply)');

        return { opened: o, root: r };
      });

      const result = await allureStep('When get_comments is called', async () => {
        const r = await getComments(opened.mgr, { session_id: opened.sessionId });
        assertSuccess(r, 'get_comments');
        await allureJsonAttachment('get_comments-threaded', r);
        return r;
      });

      await allureStep('Then the reply is nested under the root comment', async () => {
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
      });
    },
  );

  humanReadableTest.openspec('document with no comments returns empty array')(
    'Scenario: document with no comments returns empty array',
    async () => {
      const opened = await allureStep('Given a session with no comments', async () => {
        return await openSession(['No comments in this document.']);
      });

      const result = await allureStep('When get_comments is called', async () => {
        const r = await getComments(opened.mgr, { session_id: opened.sessionId });
        assertSuccess(r, 'get_comments');
        return r;
      });

      await allureStep('Then an empty comments array is returned', async () => {
        expect(result.comments).toEqual([]);
      });
    },
  );

  humanReadableTest.openspec('get_comments supports session-or-file resolution')(
    'Scenario: get_comments supports session-or-file resolution',
    async () => {
      const opened = await allureStep('Given a session with a comment added via session_id', async () => {
        const o = await openSession(['File resolution paragraph.']);

        await addComment(o.mgr, {
          session_id: o.sessionId,
          target_paragraph_id: o.firstParaId,
          author: 'Tester',
          text: 'File resolution comment.',
        });

        return o;
      });

      const result = await allureStep('When get_comments is called with file_path instead', async () => {
        const r = await getComments(opened.mgr, { file_path: opened.inputPath });
        assertSuccess(r, 'get_comments (file_path)');
        return r;
      });

      await allureStep('Then the comment is returned with a resolved session_id', async () => {
        expect(result.session_id).toBeTruthy();
        const comments = result.comments as Array<Record<string, unknown>>;
        expect(comments).toHaveLength(1);
      });
    },
  );

  humanReadableTest.openspec('missing session context returns error')(
    'Scenario: missing session context returns error',
    async () => {
      const mgr = await allureStep('Given a session manager with no context provided', async () => {
        return createTestSessionManager();
      });

      const result = await allureStep('When get_comments is called without session_id or file_path', async () => {
        return await getComments(mgr, {});
      });

      await allureStep('Then a MISSING_SESSION_CONTEXT error is returned', async () => {
        assertFailure(result, 'MISSING_SESSION_CONTEXT', 'get_comments');
      });
    },
  );

  humanReadableTest.openspec('get_comments does not mutate session state')(
    'Scenario: get_comments does not mutate session state',
    async () => {
      const { opened, revisionBefore, editCountBefore } = await allureStep(
        'Given a session with a comment and recorded revision state',
        async () => {
          const o = await openSession(['Immutability check paragraph.']);

          await addComment(o.mgr, {
            session_id: o.sessionId,
            target_paragraph_id: o.firstParaId,
            author: 'Tester',
            text: 'Mutation guard comment.',
          });

          const session = o.mgr.getSession(o.sessionId);
          return {
            opened: o,
            revisionBefore: session.editRevision,
            editCountBefore: session.editCount,
          };
        },
      );

      await allureStep('When get_comments is called', async () => {
        const r = await getComments(opened.mgr, { session_id: opened.sessionId });
        assertSuccess(r, 'get_comments');
      });

      await allureStep('Then session revision and edit count are unchanged', async () => {
        const session = opened.mgr.getSession(opened.sessionId);
        expect(session.editRevision).toBe(revisionBefore);
        expect(session.editCount).toBe(editCountBefore);
      });
    },
  );

  test('get_comments tool is registered in MCP_TOOLS as read-only', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'get_comments');
    expect(tool).toBeTruthy();
    expect(tool!.annotations.readOnlyHint).toBe(true);
    expect(tool!.annotations.destructiveHint).toBe(false);
  });
});
