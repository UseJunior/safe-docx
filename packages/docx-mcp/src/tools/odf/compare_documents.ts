import path from 'node:path';
import fs from 'node:fs/promises';

import { type OdfSession, SessionManager } from '../../session/manager.js';
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
 * ODF `compare_documents` — paragraph-granularity TWO-FILE mode.
 *
 * Stateless (mirrors the DOCX `compareDocuments_tool`): it does its own loading and takes no
 * resolved session, because two-file compare carries no `file_path` and so cannot route through
 * `resolveOdfSessionForTool` (which requires one). Session-mode `.odt` compare routes through
 * `dispatchOdf` to `odfCompareDocumentsSession` below.
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
        'Provide two .odt files, or pass file_path alone to compare a session against its original.',
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

/**
 * ODF `compare_documents` — SESSION mode: redline the live session's edits against the original
 * the session was opened from.
 *
 * Both the baseline and the redline package come from a FRESH archive loaded off
 * `session.originalBuffer`, never from `session.archive`: `SessionManager.saveOdfTo` stamps the
 * live archive's `content.xml` with the edited state on every save (so it is not a valid baseline
 * source), and writing redline markup into it would poison the session. The raw original
 * `content.xml` needs no normalization as a baseline because `compareOdf` diffs per-block visible
 * text, which a parse→serialize round-trip does not alter.
 *
 * Packaging the redline on the original package is valid under a CURRENT invariant: ODF session
 * edit tools mutate `content.xml` only (the same premise `saveOdfTo` rests on). If a future ODF
 * tool mutates non-content parts (styles.xml, manifest, …), session compare must switch to a
 * revised-session package baseline or copy those modified parts.
 */
export async function odfCompareDocumentsSession(
  manager: SessionManager,
  session: OdfSession,
  params: {
    file_path?: string;
    save_to_local_path?: string;
    author?: string;
  },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const rawSavePath = typeof params.save_to_local_path === 'string' ? params.save_to_local_path.trim() : '';
    if (!rawSavePath) {
      return err('MISSING_SAVE_PATH', 'compare_documents requires save_to_local_path.', 'Provide a writable .odt output path.');
    }

    // Refuse to clobber the comparison input via the output path (parity with two-file mode and
    // the DOCX tool, issue #313). No allow_overwrite escape: the original is an input here.
    const savePath = expandPath(rawSavePath);
    if (await resolvesToSamePath(savePath, session.originalPath)) {
      return err(
        'OVERWRITE_BLOCKED',
        `Refusing to overwrite a source document: ${manager.normalizePath(session.originalPath)}`,
        'Choose a different save_to_local_path.',
      );
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
    const originalArchive = await odf.OdfArchive.load(session.originalBuffer);
    const originalXml = await originalArchive.getContentXml();
    const revisedXml = session.doc.toXml();
    const result = odf.compareOdf(originalXml, revisedXml, { author });

    const writePolicy = await enforceWritePathPolicy(savePath);
    if (!writePolicy.ok) return writePolicy.response;

    originalArchive.setContentXml(result.contentXml);
    const buffer: Buffer = await originalArchive.save();

    await fs.mkdir(path.dirname(savePath), { recursive: true });
    await fs.writeFile(savePath, new Uint8Array(buffer));
    manager.touch(session);

    return ok({
      mode: 'session',
      provider: 'odf',
      original_file_path: manager.normalizePath(session.originalPath),
      saved_to: savePath,
      size_bytes: buffer.length,
      author,
      granularity: 'paragraph',
      stats: result.stats,
      message:
        `Redline of session edits to '${session.filename}' saved to ${savePath}. ` +
        'Changes are tracked at the whole-paragraph level (a modified paragraph counts as one ' +
        'deletion plus one insertion), so insertion/deletion counts may run higher than the DOCX path.',
      ...metadata,
    });
  } catch (e: unknown) {
    if (String(errorCode(e) ?? '').toUpperCase() === 'EACCES') {
      return err('PERMISSION_DENIED', `Cannot write to: ${params.save_to_local_path}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
    }
    return err('COMPARE_ERROR', `ODF comparison failed: ${errorMessage(e)}`);
  }
}
