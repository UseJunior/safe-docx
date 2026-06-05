import path from 'node:path';
import fs from 'node:fs/promises';
import { type OdfSession, SessionManager } from '../../session/manager.js';
import { errorCode, errorMessage } from '../../error_utils.js';
import { enforceWritePathPolicy, resolvesToSamePath } from '../path_policy.js';
import { err, ok, type ToolResponse } from '../types.js';

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

export async function odfSave(
  manager: SessionManager,
  session: OdfSession,
  params: { save_to_local_path?: string; allow_overwrite?: boolean },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  const rawSavePath = typeof params.save_to_local_path === 'string' ? params.save_to_local_path.trim() : '';
  if (!rawSavePath) {
    return err('MISSING_SAVE_PATH', 'save requires save_to_local_path for ODF files.', 'Provide a writable .odt output path.');
  }

  try {
    const savePath = expandPath(rawSavePath);
    const allowOverwrite = params.allow_overwrite ?? false;
    if (!allowOverwrite && await resolvesToSamePath(savePath, session.originalPath)) {
      return err(
        'OVERWRITE_BLOCKED',
        `Refusing to overwrite original file: ${savePath}`,
        'Save to a different path, or set allow_overwrite=true if you explicitly want in-place overwrite.',
      );
    }

    const writePolicy = await enforceWritePathPolicy(savePath);
    if (!writePolicy.ok) return writePolicy.response;

    await fs.mkdir(path.dirname(savePath), { recursive: true });
    const buffer = await manager.saveOdfTo(session, savePath);
    manager.touch(session);

    return ok({
      file_path: manager.normalizePath(session.originalPath),
      provider: 'odf',
      original_filename: session.filename,
      edit_count: session.editCount,
      edit_revision: session.editRevision,
      saved_to: savePath,
      size_bytes: buffer.length,
      save_format: 'odt',
      returned_variants: ['odt'],
      message: `ODF document saved to ${savePath}`,
      ...metadata,
    });
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (String(errorCode(e) ?? '').toUpperCase() === 'EACCES') {
      return err('PERMISSION_DENIED', `Cannot write to: ${rawSavePath}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
    }
    return err('SAVE_ERROR', `Failed to save ODF document: ${msg}`, 'Check the path is valid and writable.');
  }
}
