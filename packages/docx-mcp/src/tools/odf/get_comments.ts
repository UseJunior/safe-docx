import { type OdfSession, SessionManager } from '../../session/manager.js';
import { errorMessage } from '../../error_utils.js';
import { err, ok, type ToolResponse } from '../types.js';

type McpComment = {
  id: number;
  author: string;
  date: string | null;
  initials: string;
  text: string;
  anchored_paragraph_id: string | null;
  replies: McpComment[];
};

/**
 * ODF (.odt) `get_comments`. Walks `content.xml` for `office:annotation` elements and returns them
 * in document order in the same shape as the DOCX tool. ODF has no reply graph, so `replies` is
 * always empty.
 */
export async function odfGetComments(
  _manager: SessionManager,
  session: OdfSession,
  _params: { file_path?: string },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const comments = session.doc.getComments() as Array<{
      id: number;
      author: string;
      date: string | null;
      initials: string;
      text: string;
      anchoredParagraphId: string | null;
    }>;
    const mapped: McpComment[] = comments.map((c) => ({
      id: c.id,
      author: c.author,
      date: c.date || null,
      initials: c.initials,
      text: c.text,
      anchored_paragraph_id: c.anchoredParagraphId,
      replies: [],
    }));
    return ok({
      success: true,
      comments: mapped,
      provider: 'odf',
      file_path: session.originalPath,
      ...metadata,
    });
  } catch (e: unknown) {
    return err('COMMENT_ERROR', `Failed to read comments from ODF document: ${errorMessage(e)}`);
  }
}
