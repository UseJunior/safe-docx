import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function acceptChanges(
  manager: SessionManager,
  params: { session_id?: string; file_path?: string },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'accept_changes' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    const stats = session.doc.acceptChanges();
    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      ...stats,
      session_id: session.sessionId,
    }, metadata));
  } catch (e: unknown) {
    return err('ACCEPT_CHANGES_ERROR', errorMessage(e));
  }
}
