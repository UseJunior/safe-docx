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
  // Range metadata resolved from commentRangeStart/commentRangeEnd markers.
  // Absent for legacy paragraph-attached comments without range markers.
  end_paragraph_id?: string | null;
  start_run_index?: number;
  start_char_offset?: number;
  end_run_index?: number;
  end_char_offset?: number;
  replies: McpComment[];
};

const MAX_REPLY_DEPTH = 10;

function mapComment(c: Comment, depth = 0): McpComment {
  // The primitive resolver only yields a non-null anchoredParagraphId (and a
  // non-undefined run index) when range markers exist; without them every range
  // field stays undefined so the serialized shape is unchanged for legacy comments.
  const hasRangeMarkers =
    c.anchoredParagraphId !== null || c.startRunIndex !== undefined || c.endRunIndex !== undefined;
  return {
    id: c.id,
    author: c.author,
    date: c.date || null,
    initials: c.initials,
    text: c.text,
    anchored_paragraph_id: c.anchoredParagraphId,
    end_paragraph_id: hasRangeMarkers ? c.endParagraphId : undefined,
    start_run_index: c.startRunIndex,
    start_char_offset: c.startCharOffset,
    end_run_index: c.endRunIndex,
    end_char_offset: c.endCharOffset,
    replies: depth < MAX_REPLY_DEPTH ? c.replies.map((r) => mapComment(r, depth + 1)) : [],
  };
}

export async function getComments(
  manager: SessionManager,
  params: { file_path?: string },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'get_comments' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    const comments = await session.doc.getComments();
    return ok(mergeSessionResolutionMetadata({
      comments: comments.map((c) => mapComment(c)),
      file_path: manager.normalizePath(session.originalPath),
    }, metadata));
  } catch (e: unknown) {
    return err('COMMENT_ERROR', errorMessage(e));
  }
}
