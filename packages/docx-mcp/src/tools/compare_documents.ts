import path from 'node:path';
import { errorCode, errorMessage } from "../error_utils.js";
import fs from 'node:fs/promises';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { compareDocuments, type CompareOptions } from '@usejunior/docx-core';
import {
  mergeSessionResolutionMetadata,
  resolveSessionForTool,
  validateAndLoadDocxFromPath,
} from './session_resolution.js';
import { enforceWritePathPolicy } from './path_policy.js';
import { DEFAULT_RECONSTRUCTION_MODE } from './comparison_defaults.js';

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

async function runWithoutConsoleLog<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.SAFE_DOCX_ALLOW_COMPARISON_STDOUT === '1') return fn();
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

export async function compareDocuments_tool(
  manager: SessionManager,
  params: {
    original_file_path?: string;
    revised_file_path?: string;
    session_id?: string;
    file_path?: string;
    save_to_local_path: string;
    author?: string;
    engine?: string;
  },
): Promise<ToolResponse> {
  try {
    const hasOriginal = typeof params.original_file_path === 'string' && params.original_file_path.trim().length > 0;
    const hasRevised = typeof params.revised_file_path === 'string' && params.revised_file_path.trim().length > 0;
    const hasSession = (typeof params.session_id === 'string' && params.session_id.trim().length > 0) ||
      (typeof params.file_path === 'string' && params.file_path.trim().length > 0);

    // Determine mode
    const twoFileMode = hasOriginal && hasRevised;
    const sessionMode = !twoFileMode && hasSession;

    if (!twoFileMode && !sessionMode) {
      return err(
        'MISSING_PARAMS',
        'Provide original_file_path + revised_file_path for two-file comparison, or session_id/file_path for session comparison.',
        'Two-file mode compares two DOCX files. Session mode compares the current session state against the original.',
      );
    }

    // Validate engine
    const engine = params.engine ?? 'auto';
    if (engine !== 'auto' && engine !== 'atomizer' && engine !== 'diffmatch') {
      if (engine === 'wmlcomparer') {
        return err('INVALID_ENGINE', "Engine 'wmlcomparer' is not supported.", "Use 'auto', 'atomizer', or 'diffmatch'.");
      }
      return err('INVALID_ENGINE', `Invalid engine: ${String(engine)}`, "Use 'auto', 'atomizer', or 'diffmatch'.");
    }
    const compareEngine: CompareOptions['engine'] = engine;

    const author = params.author ?? 'Comparison';

    let originalBuffer: Buffer;
    let revisedBuffer: Buffer;
    let sessionMetadata: Record<string, unknown> = {};
    let originalFilePath: string | undefined;
    let revisedFilePath: string | undefined;

    if (twoFileMode) {
      // Mode 1: two file paths
      const originalLoaded = await validateAndLoadDocxFromPath(manager, params.original_file_path!);
      if (!originalLoaded.ok) return originalLoaded.response;

      const revisedLoaded = await validateAndLoadDocxFromPath(manager, params.revised_file_path!);
      if (!revisedLoaded.ok) return revisedLoaded.response;

      originalBuffer = originalLoaded.content;
      revisedBuffer = revisedLoaded.content;
      originalFilePath = originalLoaded.normalizedPath;
      revisedFilePath = revisedLoaded.normalizedPath;
    } else {
      // Mode 2: session edits
      const resolved = await resolveSessionForTool(manager, params, { toolName: 'compare_documents' });
      if (!resolved.ok) return resolved.response;
      const { session, metadata } = resolved;
      sessionMetadata = metadata;

      // Use comparison baseline (post-normalization with bookmarks) when available
      // to prevent normalization artifacts from appearing as false tracked changes.
      originalBuffer = session.comparisonBaselineWithBookmarks ?? session.originalBuffer;
      const revised = await session.doc.toBuffer({ cleanBookmarks: false });
      revisedBuffer = revised.buffer;
      originalFilePath = manager.normalizePath(session.originalPath);
    }

    // Run comparison
    const result = await runWithoutConsoleLog(() =>
      compareDocuments(originalBuffer, revisedBuffer, {
        author,
        engine: compareEngine,
        reconstructionMode: DEFAULT_RECONSTRUCTION_MODE,
      }),
    );

    // Validate and write output
    const savePath = expandPath(params.save_to_local_path);
    const writePolicy = await enforceWritePathPolicy(savePath);
    if (!writePolicy.ok) return writePolicy.response;

    await fs.mkdir(path.dirname(savePath), { recursive: true });
    await fs.writeFile(savePath, new Uint8Array(result.document));

    const response: Record<string, unknown> = {
      mode: twoFileMode ? 'two_file' : 'session',
      original_file_path: originalFilePath,
      revised_file_path: revisedFilePath,
      saved_to: savePath,
      size_bytes: result.document.length,
      engine_requested: compareEngine,
      engine_used: result.engine,
      author,
      stats: result.stats,
      reconstruction_mode_requested: result.reconstructionModeRequested,
      reconstruction_mode_used: result.reconstructionModeUsed,
      fallback_reason: result.fallbackReason,
      message: twoFileMode
        ? `Redline comparing '${path.basename(originalFilePath!)}' vs '${path.basename(revisedFilePath!)}' saved to ${savePath}`
        : `Redline of session edits saved to ${savePath}`,
    };

    if (sessionMode) {
      return ok(mergeSessionResolutionMetadata(response, sessionMetadata));
    }
    return ok(response);
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (String(errorCode(e) ?? '').toUpperCase() === 'EACCES') {
      return err('PERMISSION_DENIED', `Cannot write to: ${params.save_to_local_path}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
    }
    return err('COMPARE_ERROR', `Comparison failed: ${msg}`);
  }
}
