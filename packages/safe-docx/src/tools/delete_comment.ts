import { SessionManager } from '../session/manager.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function deleteComment(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    comment_id?: number;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'delete_comment' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  if (params.comment_id == null) {
    return err('MISSING_PARAMETER', 'comment_id is required.', 'Provide the comment ID to delete.');
  }

  try {
    await session.doc.deleteComment({ commentId: params.comment_id });

    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      comment_id: params.comment_id,
      session_id: session.sessionId,
    }, metadata));
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes('not found')) {
      return err('COMMENT_NOT_FOUND', msg, 'Use get_comments to list available comments.');
    }
    return err('COMMENT_ERROR', msg);
  }
}
