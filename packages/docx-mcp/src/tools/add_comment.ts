import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { findUniqueSubstringMatch, getParagraphRuns } from '@usejunior/docx-core';

export async function addComment(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    target_paragraph_id?: string;
    anchor_text?: string;
    parent_comment_id?: number;
    author: string;
    text: string;
    initials?: string;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'add_comment' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    // Reply mode: parent_comment_id provided
    if (params.parent_comment_id != null) {
      const result = await session.doc.addCommentReply({
        parentCommentId: params.parent_comment_id,
        author: params.author,
        text: params.text,
        initials: params.initials,
      });
      manager.markEdited(session);
      return ok(mergeSessionResolutionMetadata({
        comment_id: result.commentId,
        parent_comment_id: result.parentCommentId,
        mode: 'reply',
        session_id: session.sessionId,
      }, metadata));
    }

    // Root comment mode: target_paragraph_id required
    if (!params.target_paragraph_id) {
      return err(
        'MISSING_PARAMETER',
        'Either target_paragraph_id (for root comments) or parent_comment_id (for replies) is required.',
        'Provide target_paragraph_id + optional anchor_text for root comments, or parent_comment_id for threaded replies.',
      );
    }

    const pid = params.target_paragraph_id;
    const pEl = session.doc.getParagraphElementById(pid);
    if (!pEl) {
      return err(
        'ANCHOR_NOT_FOUND',
        `Paragraph ID ${pid} not found in document`,
        'Use grep or read_file to find valid paragraph IDs.',
      );
    }

    let start = 0;
    let end: number;

    if (params.anchor_text) {
      // Find anchor_text within the paragraph
      const paraText = session.doc.getParagraphTextById(pid) ?? '';
      const match = findUniqueSubstringMatch(paraText, params.anchor_text);

      if (match.status === 'not_found') {
        return err(
          'TEXT_NOT_FOUND',
          `anchor_text '${params.anchor_text}' not found in paragraph ${pid}`,
          'Verify anchor_text is present in the target paragraph.',
        );
      }
      if (match.status === 'multiple') {
        return err(
          'MULTIPLE_MATCHES',
          `Found ${match.matchCount} matches for anchor_text in paragraph ${pid}`,
          'Provide more specific anchor_text for a unique match.',
        );
      }

      start = match.start;
      end = match.end;
    } else {
      // Anchor to entire paragraph
      const paraText = session.doc.getParagraphTextById(pid) ?? '';
      end = paraText.length;
    }

    const result = await session.doc.addComment({
      paragraphId: pid,
      start,
      end,
      author: params.author,
      text: params.text,
      initials: params.initials,
    });

    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      comment_id: result.commentId,
      anchor_paragraph_id: pid,
      anchor_text: params.anchor_text ?? null,
      mode: 'root',
      session_id: session.sessionId,
    }, metadata));
  } catch (e: unknown) {
    return err('COMMENT_ERROR', errorMessage(e));
  }
}
