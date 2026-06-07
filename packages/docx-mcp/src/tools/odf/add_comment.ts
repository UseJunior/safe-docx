import { findUniqueSubstringMatch } from '@usejunior/docx-core';
import { type OdfSession, SessionManager } from '../../session/manager.js';
import { errorMessage } from '../../error_utils.js';
import { err, ok, type ToolResponse } from '../types.js';

/**
 * ODF (.odt) `add_comment`. Inserts an `office:annotation` either over the whole anchor paragraph
 * (no `anchor_text`) or bracketing a substring (`anchor_text`). Mirrors the DOCX tool's param and
 * response shapes.
 *
 * Replies (`parent_comment_id`) are NOT supported for ODF — ODF has no first-class reply graph, so a
 * reply request returns `UNSUPPORTED_FOR_ODF` (a documented Phase-2b limitation). Annotations are
 * inline children, so positional paragraph IDs do not shift; no ID-invalidation fields are emitted.
 */
export async function odfAddComment(
  manager: SessionManager,
  session: OdfSession,
  params: {
    file_path?: string;
    target_paragraph_id?: string;
    anchor_text?: string;
    parent_comment_id?: number;
    author: string;
    text: string;
    initials?: string;
  },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    if (params.parent_comment_id != null) {
      return err(
        'UNSUPPORTED_FOR_ODF',
        'Comment replies are not supported for ODF (.odt) files.',
        'ODF has no first-class reply graph; add a new root comment with target_paragraph_id instead.',
      );
    }

    if (!params.target_paragraph_id) {
      return err(
        'MISSING_PARAMETER',
        'target_paragraph_id is required for ODF comments.',
        'Provide target_paragraph_id (and optional anchor_text) to anchor the comment.',
      );
    }

    const pid = params.target_paragraph_id;
    const paraText = session.doc.getParagraphTextById(pid);
    if (paraText == null) {
      return err(
        'ANCHOR_NOT_FOUND',
        `Paragraph ID ${pid} not found in document`,
        'Use grep or read_file to find valid paragraph IDs.',
      );
    }

    let range: { start?: number; end?: number } = {};
    if (params.anchor_text) {
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
      range = { start: match.start, end: match.end };
    }

    const result = session.doc.addComment({
      paragraphId: pid,
      ...range,
      author: params.author,
      text: params.text,
      initials: params.initials,
    });
    if (!result.ok) {
      return err(result.code, result.message);
    }
    manager.markEdited(session);

    return ok({
      success: true,
      comment_id: result.commentId,
      anchor_paragraph_id: pid,
      anchor_text: params.anchor_text ?? null,
      mode: 'root',
      provider: 'odf',
      file_path: session.originalPath,
      edit_count: session.editCount,
      ...metadata,
    });
  } catch (e: unknown) {
    return err('COMMENT_ERROR', `Failed to add comment to ODF document: ${errorMessage(e)}`);
  }
}
