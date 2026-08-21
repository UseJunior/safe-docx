import path from 'node:path';
import { errorCode, errorMessage } from "../error_utils.js";
import fs from 'node:fs/promises';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { compareDocuments } from '@usejunior/docx-compare';
import {
  mergeSessionResolutionMetadata,
  resolveSessionForTool,
  validateAndLoadDocxFromPath,
} from './session_resolution.js';
import { enforceWritePathPolicy, resolvesToSamePath } from './path_policy.js';

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

export async function compareDocuments_tool(
  manager: SessionManager,
  params: {
    original_file_path?: string;
    revised_file_path?: string;
    file_path?: string;
    save_to_local_path: string;
    author?: string;
    ignore_formatting?: boolean;
    compare_moves?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const hasOriginal = typeof params.original_file_path === 'string' && params.original_file_path.trim().length > 0;
    const hasRevised = typeof params.revised_file_path === 'string' && params.revised_file_path.trim().length > 0;
    const hasSession = typeof params.file_path === 'string' && params.file_path.trim().length > 0;

    // Determine mode
    const twoFileMode = hasOriginal && hasRevised;
    const sessionMode = !twoFileMode && hasSession;

    if (!twoFileMode && !sessionMode) {
      return err(
        'MISSING_PARAMS',
        'Provide original_file_path + revised_file_path for two-file comparison, or file_path for session comparison.',
        'Two-file mode compares two DOCX files. Session mode compares the current session state against the original.',
      );
    }

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

      // Lazily generate comparison baselines if not yet available.
      await manager.ensureBaselines(session);
      originalBuffer = session.comparisonBaselineWithBookmarks ?? session.originalBuffer;
      const revised = await session.doc.toBuffer({ cleanBookmarks: false });
      revisedBuffer = revised.buffer;
      originalFilePath = manager.normalizePath(session.originalPath);
    }

    // Refuse to clobber an input document via the output path (issue #313). compare has no
    // allow_overwrite — the source files are inputs and must never be overwritten. Check before the
    // (expensive) comparison so we fail fast, and compare via realpath so a symlinked save path can't
    // mask a clobber of a source through the link.
    const savePath = expandPath(params.save_to_local_path);
    for (const source of [originalFilePath, revisedFilePath]) {
      if (source && (await resolvesToSamePath(savePath, source))) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite a source document: ${source}`,
          'Choose a different save_to_local_path.',
        );
      }
    }

    // Run comparison. The comparison library writes nothing to stdout by default
    // (issue #783 / PR #785 removed the last unconditional emit; remaining debug
    // output is opt-in via DOCX_COMPARISON_DEBUG), so the stdio JSON-RPC stream
    // stays clean without suppressing the process-global console.log — which was
    // never concurrency-safe across an await (issue #809).
    const result = await compareDocuments(originalBuffer, revisedBuffer, {
      author,
      ignoreFormatting: params.ignore_formatting,
      detectMoves: params.compare_moves,
    });

    // Validate and write output
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
      package_base: 'revised',
      author,
      stats: result.stats,
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
