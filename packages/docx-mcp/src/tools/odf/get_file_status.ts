import { type OdfSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';

export async function odfGetFileStatus(
  _manager: SessionManager,
  session: OdfSession,
  _params: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    return ok({
      file_path: session.originalPath,
      provider: 'odf',
      created_at: session.createdAt.toISOString(),
      expires_at: session.expiresAt.toISOString(),
      last_activity: session.lastAccessedAt.toISOString(),
      edit_count: session.editCount,
      edit_revision: session.editRevision,
      document: {
        filename: session.filename,
        paragraphs: session.doc.getParagraphs().length,
      },
      save_defaults: {
        default_save_format: 'odt',
        returned_variants: ['odt'],
        supports_variant_override: false,
      },
      ...metadata,
    });
  } catch (e: unknown) {
    return err('STATUS_ERROR', e instanceof Error ? e.message : String(e));
  }
}
