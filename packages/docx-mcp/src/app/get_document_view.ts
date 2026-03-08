import { SessionManager } from '../session/manager.js';
import { errorMessage } from '../error_utils.js';
import { err, ok, type ToolResponse } from '../tools/types.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from '../tools/session_resolution.js';

export async function getDocumentView(
  manager: SessionManager,
  params: { session_id?: string; file_path?: string },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'get_document_view' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const { nodes, styles } = session.doc.buildDocumentView({
      includeSemanticTags: true,
      showFormatting: true,
    });

    const stylesObj: Record<string, unknown> = {};
    for (const [id, info] of styles.styles) {
      stylesObj[id] = {
        style_id: info.style_id,
        display_name: info.display_name,
        fingerprint: info.fingerprint,
        count: info.count,
        dominant_alignment: info.dominant_alignment,
      };
    }

    return ok(
      mergeSessionResolutionMetadata(
        {
          session_id: session.sessionId,
          edit_revision: session.editRevision,
          nodes,
          styles: stylesObj,
        },
        metadata,
      ),
    );
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('VIEW_ERROR', msg, 'Check session status and try again.');
  }
}
