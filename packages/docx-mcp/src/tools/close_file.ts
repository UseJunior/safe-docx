import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';

export async function closeFile(
  manager: SessionManager,
  params: {
    file_path?: string;
    clear_all?: boolean;
    confirm?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const clearAll = params.clear_all === true;
    const filePath = typeof params.file_path === 'string' ? params.file_path.trim() : '';
    const hasFilePath = filePath.length > 0;

    if (clearAll) {
      if (params.confirm !== true) {
        return err(
          'CONFIRMATION_REQUIRED',
          'clear_all=true requires confirm=true.',
          'Re-run with confirm=true to close every active file session.',
        );
      }
      if (hasFilePath) {
        return err(
          'INVALID_CLEAR_TARGET',
          'clear_all=true cannot be combined with file_path.',
          'Use clear_all=true, confirm=true by itself, or remove clear_all and target a file_path.',
        );
      }
      const clearedPaths = await manager.clearAllSessions();
      return ok({
        clear_mode: 'all',
        cleared_file_paths: clearedPaths,
        cleared_count: clearedPaths.length,
      });
    }

    if (!hasFilePath) {
      return err(
        'INVALID_CLEAR_TARGET',
        'close_file requires file_path, or clear_all=true.',
        'Provide file_path to close a file session, or clear_all=true with confirm=true.',
      );
    }

    const cleared = await manager.clearSessionByPath(filePath);
    if (!cleared) {
      return ok({
        clear_mode: 'file_path',
        file_path: filePath,
        cleared_file_paths: [],
        cleared_count: 0,
        message: 'No active session found for this file.',
      });
    }

    return ok({
      clear_mode: 'file_path',
      file_path: cleared,
      cleared_file_paths: [cleared],
      cleared_count: 1,
    });
  } catch (e: unknown) {
    return err(
      'CLOSE_FILE_ERROR',
      `Failed to close file session(s): ${errorMessage(e)}`,
    );
  }
}
