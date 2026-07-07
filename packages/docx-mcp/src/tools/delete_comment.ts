import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { DocxDocument, type RevisionContext } from '@usejunior/docx-core';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';

const COMMENT_TOUCHED_CONTEXT = {
  relationshipParts: ['word/_rels/document.xml.rels'],
  sideParts: ['word/comments.xml', 'word/commentsExtended.xml', 'word/people.xml'],
};

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

    await mutate(session.doc, ctx);

    manager.markEdited(session);
    // The removed body-story w:commentReference run is wrapped in w:del (Table
    // A), but removing the comment/reply body text from comments.xml and the
    // reply graph from commentsExtended.xml is package-mutation side-part
    // cleanup with no revision wrapper (#122): record it.
    manager.recordNonRevisionChange(session, {
      tool: 'delete_comment',
      parts: [...COMMENT_TOUCHED_CONTEXT.sideParts, ...COMMENT_TOUCHED_CONTEXT.relationshipParts],
      description: `Comment ${params.comment_id} and its threaded replies removed from comment side-story parts (comments.xml, commentsExtended.xml). The body-story comment reference removal is tracked separately as a w:del revision.`,
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
