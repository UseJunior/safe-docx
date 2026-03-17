import { type GDocsSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';

export async function gdocsGetFileStatus(
  _manager: SessionManager,
  session: GDocsSession,
  _params: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    return ok({
      google_doc_id: session.docId,
      provider: 'gdocs',
      created_at: session.createdAt.toISOString(),
      expires_at: session.expiresAt.toISOString(),
      last_activity: session.lastAccessedAt.toISOString(),
      edit_count: session.editCount,
      edit_revision: session.editRevision,
      revision_id: session.doc.getRevisionId(),
      is_revision_fresh: session.doc.isRevisionFresh(),
      tabs: session.doc.getTabs(),
      ...metadata,
    });
  } catch (e: unknown) {
    return err('STATUS_ERROR', e instanceof Error ? e.message : String(e));
  }
}
