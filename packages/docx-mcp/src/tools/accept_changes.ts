import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { revisionResultChangedDocument } from './revision_result.js';

export async function acceptChanges(
  manager: SessionManager,
  params: { file_path?: string },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'accept_changes' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    return await manager.mutateSession(session, async (tx) => {
      const stats = await session.doc.acceptChanges();
      // A no-op sweep must not look like an edit or drop cached views (#1084).
      tx.commit({ changed: revisionResultChangedDocument(stats) });
      return ok(mergeSessionResolutionMetadata({
        ...stats,
        file_path: manager.normalizePath(session.originalPath),
      }, metadata));
    });
  } catch (e: unknown) {
    return err('ACCEPT_CHANGES_ERROR', errorMessage(e));
  }
}
