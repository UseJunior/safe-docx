import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import type { Comment } from '@usejunior/docx-core';

type McpComment = {
  id: number;
  author: string;
  date: string | null;
  initials: string;
  text: string;
  anchored_paragraph_id: string | null;
  replies: McpComment[];
};

const MAX_REPLY_DEPTH = 10;

function mapComment(c: Comment, depth = 0): McpComment {
  return {
    id: c.id,
    author: c.author,
    date: c.date || null,
    initials: c.initials,
    text: c.text,
    anchored_paragraph_id: c.anchoredParagraphId,
    replies: depth < MAX_REPLY_DEPTH ? c.replies.map((r) => mapComment(r, depth + 1)) : [],
  };
}

export async function getComments(
  manager: SessionManager,
  params: { session_id?: string; file_path?: string },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'get_comments' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    const comments = await session.doc.getComments();
    return ok(mergeSessionResolutionMetadata({
      comments: comments.map((c) => mapComment(c)),
      session_id: session.sessionId,
    }, metadata));
  } catch (e: unknown) {
    return err('COMMENT_ERROR', errorMessage(e));
  }
}
