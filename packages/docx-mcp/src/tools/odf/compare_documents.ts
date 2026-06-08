import path from 'node:path';
import fs from 'node:fs/promises';

import { SessionManager } from '../../session/manager.js';
import { errorCode, errorMessage } from '../../error_utils.js';
import { loadOdfCore } from '../../odf_loader.js';
import { enforceWritePathPolicy, resolvesToSamePath } from '../path_policy.js';
import { validateAndLoadOdfFromPath } from '../session_resolution.js';
import { err, ok, type ToolResponse } from '../types.js';

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

/** Default change author for ODF comparison: the env-configured AI author, else `SafeDocX`. */
function resolveAuthor(explicit?: string): string {
  const trimmed = typeof explicit === 'string' ? explicit.trim() : '';
  if (trimmed) return trimmed;
  const env = process.env.SAFE_DOCX_AI_AUTHOR;
  return env && env.trim() ? env.trim() : 'SafeDocX';
}

/**
 * ODF `compare_documents` — Slice 1: paragraph-granularity, TWO-FILE mode only.
 *
 * Stateless (mirrors the DOCX `compareDocuments_tool`): it does its own loading and takes no
 * resolved session, because two-file compare carries no `file_path` and so cannot route through
 * `resolveOdfSessionForTool` (which requires one). Session-mode `.odt` compare is guarded upstream
 * in `server.ts` and is a later slice.
 */
export async function odfCompareDocuments(
  manager: SessionManager,
  params: {
    original_file_path?: string;
    revised_file_path?: string;
    file_path?: string;
    save_to_local_path?: string;
    author?: string;
  },
): Promise<ToolResponse> {
  try {
    const hasOriginal = typeof params.original_file_path === 'string' && params.original_file_path.trim().length > 0;
    const hasRevised = typeof params.revised_file_path === 'string' && params.revised_file_path.trim().length > 0;
    if (!hasOriginal || !hasRevised) {
      return err(
        'MISSING_PARAMS',
        'ODF comparison requires both original_file_path and revised_file_path.',
        'Session-mode compare (file_path) is not yet supported for .odt; provide two .odt files.',
      );
    }

    const rawSavePath = typeof params.save_to_local_path === 'string' ? params.save_to_local_path.trim() : '';
    if (!rawSavePath) {
      return err('MISSING_SAVE_PATH', 'compare_documents requires save_to_local_path.', 'Provide a writable .odt output path.');
    }

    const originalLoaded = await validateAndLoadOdfFromPath(manager, params.original_file_path!);
    if (!originalLoaded.ok) return originalLoaded.response;
    const revisedLoaded = await validateAndLoadOdfFromPath(manager, params.revised_file_path!);
    if (!revisedLoaded.ok) return revisedLoaded.response;

    // Refuse to clobber either source via the output path (parity with the DOCX tool, issue #313).
    const savePath = expandPath(rawSavePath);
    for (const source of [originalLoaded.normalizedPath, revisedLoaded.normalizedPath]) {
      if (await resolvesToSamePath(savePath, source)) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite a source document: ${source}`,
          'Choose a different save_to_local_path.',
        );
      }
    }

    const odf = await loadOdfCore();
    if (!odf) {
      return err(
        'MISSING_DEPENDENCY',
        'ODF (.odt) support requires @usejunior/odf-core.',
        'Install @usejunior/odf-core to enable ODF comparison.',
      );
    }

    const author = resolveAuthor(params.author);
    const originalXml = await originalLoaded.archive.getContentXml();
    const revisedXml = await revisedLoaded.archive.getContentXml();
    const result = odf.compareOdf(originalXml, revisedXml, { author });

    // Build the redline on the revised package (its styles/manifest/untouched parts are preserved).
    const writePolicy = await enforceWritePathPolicy(savePath);
    if (!writePolicy.ok) return writePolicy.response;

    revisedLoaded.archive.setContentXml(result.contentXml);
    const buffer: Buffer = await revisedLoaded.archive.save();

    await fs.mkdir(path.dirname(savePath), { recursive: true });
    await fs.writeFile(savePath, new Uint8Array(buffer));

    return ok({
      mode: 'two_file',
      provider: 'odf',
      original_file_path: originalLoaded.normalizedPath,
      revised_file_path: revisedLoaded.normalizedPath,
      saved_to: savePath,
      size_bytes: buffer.length,
      author,
      granularity: 'paragraph',
      stats: result.stats,
      message:
        `Redline comparing '${originalLoaded.filename}' vs '${revisedLoaded.filename}' saved to ${savePath}. ` +
        'Changes are tracked at the whole-paragraph level (a modified paragraph counts as one ' +
        'deletion plus one insertion), so insertion/deletion counts may run higher than the DOCX path.',
    });
  } catch (e: unknown) {
    if (String(errorCode(e) ?? '').toUpperCase() === 'EACCES') {
      return err('PERMISSION_DENIED', `Cannot write to: ${params.save_to_local_path}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
    }
    return err('COMPARE_ERROR', `ODF comparison failed: ${errorMessage(e)}`);
  }
}
