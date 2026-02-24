import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';

export async function clearSession(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    clear_all?: boolean;
    confirm?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const clearAll = params.clear_all === true;
    const sessionId = typeof params.session_id === 'string' ? params.session_id.trim() : '';
    const filePath = typeof params.file_path === 'string' ? params.file_path.trim() : '';
    const hasSessionId = sessionId.length > 0;
    const hasFilePath = filePath.length > 0;

    if (clearAll) {
      if (params.confirm !== true) {
        return err(
          'CONFIRMATION_REQUIRED',
          'clear_all=true requires confirm=true.',
          'Re-run with confirm=true to clear every active session.',
        );
      }
      if (hasSessionId || hasFilePath) {
        return err(
          'INVALID_CLEAR_TARGET',
          'clear_all=true cannot be combined with session_id or file_path.',
          'Use clear_all=true, confirm=true by itself, or remove clear_all and target a session_id/file_path.',
        );
      }
      const clearedIds = await manager.clearAllSessions();
      return ok({
        clear_mode: 'all',
        cleared_session_ids: clearedIds,
        cleared_count: clearedIds.length,
      });
    }

    if (hasSessionId && hasFilePath) {
      return err(
        'INVALID_CLEAR_TARGET',
        'Provide either session_id or file_path, not both.',
        'Use session_id to clear one session, or file_path to clear all sessions for one file.',
      );
    }

    if (!hasSessionId && !hasFilePath) {
      return err(
        'INVALID_CLEAR_TARGET',
        'clear_session requires session_id, file_path, or clear_all=true.',
        'Provide session_id to clear one session, file_path to clear all sessions for a file, or clear_all=true with confirm=true.',
      );
    }

    if (hasSessionId) {
      try {
        await manager.clearSessionById(sessionId);
      } catch (e: unknown) {
        const msg = errorMessage(e);
        if (msg.startsWith('INVALID_SESSION_ID:')) {
          return err(
            'INVALID_SESSION_ID',
            msg.replace(/^INVALID_SESSION_ID:/, 'Invalid session id: '),
            'Session IDs must match format: ses_[12 alphanumeric chars]',
          );
        }
        if (msg.startsWith('SESSION_NOT_FOUND:')) {
          return err('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
        }
        if (msg.startsWith('SESSION_EXPIRED:')) {
          return err('SESSION_EXPIRED', `Session expired: ${sessionId}`);
        }
        return err('CLEAR_SESSION_ERROR', `Failed to clear session: ${msg}`);
      }

      return ok({
        clear_mode: 'session_id',
        cleared_session_ids: [sessionId],
        cleared_count: 1,
      });
    }

    const normalizedPath = manager.normalizePath(filePath);
    const clearedIds = await manager.clearSessionsByPath(normalizedPath);
    return ok({
      clear_mode: 'file_path',
      file_path: normalizedPath,
      cleared_session_ids: clearedIds,
      cleared_count: clearedIds.length,
    });
  } catch (e: unknown) {
    return err(
      'CLEAR_SESSION_ERROR',
      `Failed to clear session(s): ${errorMessage(e)}`,
    );
  }
}
