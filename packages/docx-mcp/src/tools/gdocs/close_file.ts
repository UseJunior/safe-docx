import { type GDocsSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';

export async function gdocsCloseFile(
  manager: SessionManager,
  session: GDocsSession,
  _params: Record<string, unknown>,
  _metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const cleared = await manager.clearSessionByPath(`gdocs:${session.docId}`);
    return ok({
      clear_mode: 'google_doc_id',
      google_doc_id: session.docId,
      cleared_count: cleared ? 1 : 0,
    });
  } catch (e: unknown) {
    return err('CLOSE_FILE_ERROR', `Failed to close Google Doc session: ${e instanceof Error ? e.message : String(e)}`);
  }
}
