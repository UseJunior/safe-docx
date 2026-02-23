import { describe, expect } from 'vitest';
import { testAllure, allureJsonAttachment } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { getComments } from './get_comments.js';
import { addComment } from './add_comment.js';
import { deleteComment } from './delete_comment.js';
import { MCP_TOOLS } from '../server.js';

const TEST_FEATURE = 'add-comment-delete-tool';
const test = testAllure.epic('OpenSpec Traceability').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

type CommentNode = {
  author?: string;
  replies?: CommentNode[];
};

function commentsList(value: unknown): CommentNode[] {
  return Array.isArray(value) ? (value as CommentNode[]) : [];
}

describe('OpenSpec traceability: add-comment-delete-tool', () => {
  registerCleanup();

  humanReadableTest.openspec('delete comment successfully')(
    'Scenario: delete root comment with no replies',
    async () => {
      const opened = await openSession(['Paragraph with a comment.']);

      const added = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Root comment to delete.',
      });
      assertSuccess(added, 'add_comment');

      const beforeDelete = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(beforeDelete, 'get_comments (before)');
      expect(commentsList(beforeDelete.comments)).toHaveLength(1);

      const result = await deleteComment(opened.mgr, {
        session_id: opened.sessionId,
        comment_id: added.comment_id as number,
      });
      assertSuccess(result, 'delete_comment');
      await allureJsonAttachment('delete_comment-response', result);
      expect(result.comment_id).toBe(added.comment_id);
      expect(result.session_id).toBe(opened.sessionId);

      const afterDelete = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(afterDelete, 'get_comments (after)');
      expect(commentsList(afterDelete.comments)).toHaveLength(0);
    },
  );

  humanReadableTest.openspec('delete comment with replies cascades')(
    'Scenario: delete root comment cascades to all replies',
    async () => {
      const opened = await openSession(['Paragraph for cascade test.']);

      const root = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Root with replies.',
      });
      assertSuccess(root, 'add_comment (root)');

      const reply = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        parent_comment_id: root.comment_id as number,
        author: 'Bob',
        text: 'Reply to root.',
      });
      assertSuccess(reply, 'add_comment (reply)');

      const beforeDelete = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(beforeDelete, 'get_comments (before)');
      const rootBefore = commentsList(beforeDelete.comments)[0];
      expect(rootBefore.replies).toHaveLength(1);

      const result = await deleteComment(opened.mgr, {
        session_id: opened.sessionId,
        comment_id: root.comment_id as number,
      });
      assertSuccess(result, 'delete_comment (cascade)');

      const afterDelete = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(afterDelete, 'get_comments (after)');
      expect(commentsList(afterDelete.comments)).toHaveLength(0);
    },
  );

  humanReadableTest.openspec('delete a single leaf reply')(
    'Scenario: delete single leaf reply',
    async () => {
      const opened = await openSession(['Paragraph for reply delete.']);

      const root = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Root stays intact.',
      });
      assertSuccess(root, 'add_comment (root)');

      const reply = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        parent_comment_id: root.comment_id as number,
        author: 'Bob',
        text: 'Reply to delete.',
      });
      assertSuccess(reply, 'add_comment (reply)');

      const result = await deleteComment(opened.mgr, {
        session_id: opened.sessionId,
        comment_id: reply.comment_id as number,
      });
      assertSuccess(result, 'delete_comment (reply)');

      const afterDelete = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(afterDelete, 'get_comments (after)');
      const comments = commentsList(afterDelete.comments);
      expect(comments).toHaveLength(1);
      expect(comments[0].author).toBe('Alice');
      expect(comments[0].replies).toHaveLength(0);
    },
  );

  humanReadableTest.openspec('delete a non-leaf reply cascades to descendants')(
    'Scenario: delete non-leaf reply cascades to descendants',
    async () => {
      const opened = await openSession(['Paragraph for deep cascade.']);

      const root = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        author: 'Alice',
        text: 'Root comment.',
      });
      assertSuccess(root, 'add_comment (root)');

      const reply1 = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        parent_comment_id: root.comment_id as number,
        author: 'Bob',
        text: 'Middle reply.',
      });
      assertSuccess(reply1, 'add_comment (reply1)');

      const reply2 = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        parent_comment_id: reply1.comment_id as number,
        author: 'Carol',
        text: 'Nested reply.',
      });
      assertSuccess(reply2, 'add_comment (reply2)');

      // Delete the middle reply — should cascade to reply2 but leave root intact
      const result = await deleteComment(opened.mgr, {
        session_id: opened.sessionId,
        comment_id: reply1.comment_id as number,
      });
      assertSuccess(result, 'delete_comment (non-leaf)');

      const afterDelete = await getComments(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(afterDelete, 'get_comments (after)');
      const comments = commentsList(afterDelete.comments);
      expect(comments).toHaveLength(1);
      expect(comments[0].author).toBe('Alice');
      expect(comments[0].replies).toHaveLength(0);
    },
  );

  humanReadableTest.openspec('comment not found returns error')(
    'Scenario: comment not found returns error',
    async () => {
      const opened = await openSession(['Paragraph for not-found test.']);

      const result = await deleteComment(opened.mgr, {
        session_id: opened.sessionId,
        comment_id: 999999,
      });
      assertFailure(result, 'COMMENT_NOT_FOUND', 'delete_comment');
    },
  );

  humanReadableTest.openspec('missing comment_id returns error')(
    'Scenario: missing comment_id returns error',
    async () => {
      const opened = await openSession(['Paragraph for missing param.']);

      const result = await deleteComment(opened.mgr, {
        session_id: opened.sessionId,
      });
      assertFailure(result, 'MISSING_PARAMETER', 'delete_comment');
    },
  );

  humanReadableTest.openspec('missing session context returns error')(
    'Scenario: missing session context returns error',
    async () => {
      const mgr = createTestSessionManager();
      const result = await deleteComment(mgr, { comment_id: 0 });
      assertFailure(result, 'MISSING_SESSION_CONTEXT', 'delete_comment');
    },
  );

  humanReadableTest.openspec('delete_comment supports session-or-file resolution')(
    'Scenario: session-or-file resolution',
    async () => {
      const opened = await openSession(['Paragraph for file resolution.']);

      const added = await addComment(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        author: 'Tester',
        text: 'File resolution comment.',
      });
      assertSuccess(added, 'add_comment');

      const result = await deleteComment(opened.mgr, {
        file_path: opened.inputPath,
        comment_id: added.comment_id as number,
      });
      assertSuccess(result, 'delete_comment (file_path)');
      expect(result.session_id).toBeTruthy();
    },
  );

  test('delete_comment tool is registered in MCP_TOOLS', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'delete_comment');
    expect(tool).toBeTruthy();
    expect(tool!.annotations.readOnlyHint).toBe(false);
    expect(tool!.annotations.destructiveHint).toBe(true);
  });
});
