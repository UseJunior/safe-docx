import { type OdfSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';

export async function odfCloseFile(
  manager: SessionManager,
  session: OdfSession,
  _params: Record<string, unknown>,
  _metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const cleared = await manager.clearSessionByPath(session.originalPath);
    return ok({
      clear_mode: 'file_path',
      file_path: cleared ?? session.originalPath,
      cleared_file_paths: cleared ? [cleared] : [],
      cleared_count: cleared ? 1 : 0,
    });
  } catch (e: unknown) {
    return err('CLOSE_FILE_ERROR', `Failed to close ODF session: ${e instanceof Error ? e.message : String(e)}`);
  }
}
