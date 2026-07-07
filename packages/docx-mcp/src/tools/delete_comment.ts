import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { DocxDocument, type Comment, type RevisionContext } from '@usejunior/docx-core';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';

const COMMENT_TOUCHED_CONTEXT = {
  relationshipParts: ['word/_rels/document.xml.rels'],
  sideParts: ['word/comments.xml', 'word/commentsExtended.xml', 'word/people.xml'],
};

// Non-revision parts a comment deletion mutates without a tracked-change
// wrapper. Both cases touch the comment side parts. A *root* (anchored) comment
// additionally has its w:commentRangeStart/End milestones removed from
// word/document.xml as structural markers (the reference-run removal is tracked
// separately as w:del); a reply-only deletion has no body anchor and touches the
// side parts only. The mode is resolved from the live comment tree so the
// manifest neither under-reports (root) nor over-reports (reply) document.xml.
const COMMENT_SIDE_PARTS = ['word/comments.xml', 'word/commentsExtended.xml'];

/**
 * A comment is a *root* (anchored) comment iff it appears at the top level of
 * the comment tree; threaded replies are always nested under a parent's
 * `replies`. Only root comments carry w:commentRangeStart/End milestones in
 * word/document.xml, so this structural check — not the derived paragraphId
 * fields, which replies can also inherit — determines whether a deletion mutates
 * document.xml.
 */
function isRootComment(comments: Comment[], id: number): boolean {
  return comments.some((c) => c.id === id);
}

export async function deleteComment(
  manager: SessionManager,
  params: {
    file_path?: string;
    comment_id?: number;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'delete_comment' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;
  const ctx = await getRevisionContextForSession(session);

  if (params.comment_id == null) {
    return err('MISSING_PARAMETER', 'comment_id is required.', 'Provide the comment ID to delete.');
  }

  try {
    const mutate = (doc: DocxDocument, activeCtx: RevisionContext | undefined) =>
      doc.deleteComment({ commentId: params.comment_id! }, activeCtx);

    const revisionPreflight = await preflightAiRevisionMutation(session, ctx, mutate, COMMENT_TOUCHED_CONTEXT);
    if (revisionPreflight) return revisionPreflight;

    // Resolve root-vs-reply before mutating: an anchored (root) comment removes
    // structural range markers from document.xml, a reply does not.
    const anchored = isRootComment(await session.doc.getComments(), params.comment_id);

    await mutate(session.doc, ctx);

    manager.markEdited(session);
    // The removed body-story w:commentReference run is wrapped in w:del (Table
    // A). Removing the comment/reply body text from comments.xml and the reply
    // graph from commentsExtended.xml — and, for a root comment, the structural
    // w:commentRangeStart/End milestones from document.xml — is package-mutation
    // cleanup with no revision wrapper (#122): record it.
    manager.recordNonRevisionChange(session, {
      tool: 'delete_comment',
      parts: anchored ? ['word/document.xml', ...COMMENT_SIDE_PARTS] : [...COMMENT_SIDE_PARTS],
      description: anchored
        ? `Root comment ${params.comment_id} and its threaded replies removed from comment side parts (comments.xml, commentsExtended.xml); its w:commentRangeStart/End milestones were removed from word/document.xml as structural markers (the body-story reference removal is tracked separately as a w:del revision).`
        : `Reply comment ${params.comment_id} removed from comment side parts (comments.xml, commentsExtended.xml). Reply-only deletion is package-mutation with no body anchor, so word/document.xml is untouched.`,
    });
    return ok(mergeSessionResolutionMetadata({
      comment_id: params.comment_id,
      file_path: manager.normalizePath(session.originalPath),
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (msg.includes('not found')) {
      return err('COMMENT_NOT_FOUND', msg, 'Use get_comments to list available comments.');
    }
    return err('COMMENT_ERROR', msg);
  }
}
