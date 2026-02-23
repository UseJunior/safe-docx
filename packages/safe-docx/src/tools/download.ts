import path from 'node:path';
import { errorCode, errorMessage } from "../error_utils.js";
import fs from 'node:fs/promises';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { compareDocuments, type CompareOptions } from '@usejunior/docx-comparison';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { enforceWritePathPolicy } from './path_policy.js';
import { DEFAULT_RECONSTRUCTION_MODE } from './comparison_defaults.js';

type DownloadFormat = 'clean' | 'tracked' | 'both';

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

function isDownloadFormat(value: string): value is DownloadFormat {
  return value === 'clean' || value === 'tracked' || value === 'both';
}

function formatUtcTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}Z`;
}

function defaultTrackedPath(cleanPath: string, timestamp: string): string {
  const parsed = path.parse(cleanPath);
  const ext = parsed.ext || '.docx';
  return path.join(parsed.dir, `${parsed.name}.redline.${timestamp}${ext}`);
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

export async function download(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    save_to_local_path: string;
    clean_bookmarks?: boolean;
    download_format?: DownloadFormat;
    // Backward-compatible aliases used by older safe-docx prompts.
    track_changes?: boolean;
    author?: string;
    allow_overwrite?: boolean;
    tracked_save_to_local_path?: string;
    tracked_changes_author?: string;
    tracked_changes_engine?: CompareOptions['engine'];
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'download' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const savePath = expandPath(params.save_to_local_path);
    const explicitFormat = params.download_format;
    const hasTrackedSavePath =
      typeof params.tracked_save_to_local_path === 'string'
      && params.tracked_save_to_local_path.trim().length > 0;
    let formatSource: 'download_format' | 'tracked_save_to_local_path' | 'track_changes_alias' | 'default_both';
    let formatRaw: string;
    let parameterWarning: string | undefined;
    if (explicitFormat) {
      formatRaw = explicitFormat;
      formatSource = 'download_format';
    } else if (hasTrackedSavePath) {
      // If caller asks for explicit tracked path, always emit both variants unless
      // they explicitly override download_format.
      formatRaw = 'both';
      formatSource = 'tracked_save_to_local_path';
      if (params.track_changes === false) {
        parameterWarning =
          "track_changes=false was ignored because tracked_save_to_local_path was provided. Using download_format='both'.";
      }
    } else if (typeof params.track_changes === 'boolean') {
      formatRaw = params.track_changes ? 'tracked' : 'clean';
      formatSource = 'track_changes_alias';
    } else {
      formatRaw = 'both';
      formatSource = 'default_both';
    }
    if (!isDownloadFormat(formatRaw)) {
      return err('INVALID_DOWNLOAD_FORMAT', `Invalid download_format: ${String(formatRaw)}`, "Use one of: 'clean', 'tracked', or 'both'.");
    }
    const format: DownloadFormat = formatRaw;

    const engine = params.tracked_changes_engine ?? 'atomizer';
    if (engine !== 'auto' && engine !== 'atomizer' && engine !== 'diffmatch' && engine !== 'wmlcomparer') {
      return err('INVALID_TRACKED_ENGINE', `Invalid tracked_changes_engine: ${String(engine)}`, "Use one of: 'auto', 'atomizer', or 'diffmatch'.");
    }
    if (engine === 'wmlcomparer') {
      return err('INVALID_TRACKED_ENGINE', "tracked_changes_engine 'wmlcomparer' is not supported here", "Use 'auto', 'atomizer', or 'diffmatch'.");
    }
    const trackedEngine: CompareOptions['engine'] = engine;

    const clean = params.clean_bookmarks ?? true;
    const author = params.tracked_changes_author ?? params.author ?? 'Safe-Docx';
    const allowOverwrite = params.allow_overwrite ?? false;
    const cacheKey = JSON.stringify({
      revision: session.editRevision,
      format,
      clean_bookmarks: clean,
      tracked_engine: trackedEngine,
      tracked_author: author,
    });

    const cached = manager.getDownloadCache(session, cacheKey);
    const cacheHit = cached !== null;

    let revisedBuffer: Buffer;
    let trackedBuffer: Buffer | null;
    let trackedStats: { insertions: number; deletions: number; modifications: number } | null;
    let bookmarksRemoved: number;
    let exportTimestamp: string;

    // Run implicit validation before producing download artifacts.
    const validation = session.doc.validate();

    if (cached) {
      revisedBuffer = cached.revisedBuffer;
      trackedBuffer = cached.trackedBuffer;
      trackedStats = cached.trackedStats;
      bookmarksRemoved = cached.bookmarksRemoved;
      exportTimestamp = cached.exportedAtUtc;
    } else {
      const revised = await session.doc.toBuffer({ cleanBookmarks: clean });
      revisedBuffer = revised.buffer;
      bookmarksRemoved = revised.bookmarksRemoved;
      trackedBuffer = null;
      trackedStats = null;
      exportTimestamp = formatUtcTimestamp(new Date());

      if (format === 'tracked' || format === 'both') {
        const trackedRes = await runWithoutConsoleLog(() =>
          compareDocuments(session.originalBuffer, revisedBuffer, {
            author,
            engine: trackedEngine,
            reconstructionMode: DEFAULT_RECONSTRUCTION_MODE,
          }),
        );
        trackedBuffer = trackedRes.document;
        trackedStats = trackedRes.stats;
      }

      manager.setDownloadCache(session, {
        cacheKey,
        revision: session.editRevision,
        format,
        cleanBookmarks: clean,
        trackedEngine,
        trackedAuthor: author,
        revisedBuffer,
        trackedBuffer,
        trackedStats,
        bookmarksRemoved: clean ? bookmarksRemoved : 0,
        exportedAtUtc: exportTimestamp,
        cachedAtIso: new Date().toISOString(),
      });
    }

    let trackedPath: string | null = null;
    if (format === 'tracked' || format === 'both') {
      trackedPath = format === 'tracked'
        ? savePath
        : params.tracked_save_to_local_path
          ? expandPath(params.tracked_save_to_local_path)
          : defaultTrackedPath(savePath, exportTimestamp);
    }

    const originalPathResolved = path.resolve(session.originalPath);
    const cleanPathResolved = path.resolve(savePath);
    const trackedPathResolved = trackedPath ? path.resolve(trackedPath) : null;
    if (!allowOverwrite) {
      if ((format === 'clean' || format === 'both') && cleanPathResolved === originalPathResolved) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite original file: ${savePath}`,
          "Save to a different path, or set allow_overwrite=true if you explicitly want in-place overwrite.",
        );
      }
      if ((format === 'tracked' || format === 'both') && trackedPathResolved === originalPathResolved) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite original file with tracked output: ${trackedPath}`,
          "Use tracked_save_to_local_path to write redline elsewhere, or set allow_overwrite=true to force overwrite.",
        );
      }
    }

    if (format === 'clean' || format === 'both') {
      const cleanPolicy = await enforceWritePathPolicy(savePath);
      if (!cleanPolicy.ok) return cleanPolicy.response;
      await fs.mkdir(path.dirname(savePath), { recursive: true });
      await fs.writeFile(savePath, new Uint8Array(revisedBuffer));
    }
    if (trackedPath && trackedBuffer) {
      const trackedPolicy = await enforceWritePathPolicy(trackedPath);
      if (!trackedPolicy.ok) return trackedPolicy.response;
      await fs.mkdir(path.dirname(trackedPath), { recursive: true });
      await fs.writeFile(trackedPath, new Uint8Array(trackedBuffer));
    }

    const returnedVariants =
      format === 'clean'
        ? ['clean']
        : format === 'tracked'
          ? ['redline']
          : ['clean', 'redline'];

    return ok(mergeSessionResolutionMetadata({
      session_id: session.sessionId,
      original_filename: session.filename,
      edit_count: session.editCount,
      edit_revision: session.editRevision,
      download_format: format,
      saved_to: format === 'tracked' ? trackedPath : savePath,
      clean_saved_to: format === 'both' ? savePath : undefined,
      tracked_saved_to: trackedPath,
      size_bytes: format === 'tracked' ? trackedBuffer?.length : revisedBuffer.length,
      tracked_size_bytes: trackedBuffer?.length,
      tracked_changes_engine: format === 'tracked' || format === 'both' ? trackedEngine : undefined,
      tracked_changes_author: format === 'tracked' || format === 'both' ? author : undefined,
      tracked_changes_stats: trackedStats ?? undefined,
      exported_at_utc: exportTimestamp,
      bookmarks_removed: clean ? bookmarksRemoved : 0,
      returned_variants: returnedVariants,
      available_variants: ['clean', 'redline'],
      cache_hit: cacheHit,
      redownload_by_session_id: true,
      format_source: formatSource,
      parameter_warning: parameterWarning,
      validation: validation.warnings.length > 0
        ? { warnings: validation.warnings.map(w => ({ code: w.code, message: w.message })) }
        : { valid: true },
      message:
        format === 'clean'
          ? `${cacheHit ? 'Cached ' : ''}document saved to ${savePath}`
          : format === 'tracked'
            ? `${cacheHit ? 'Cached ' : ''}tracked changes document saved to ${trackedPath}`
            : `${cacheHit ? 'Cached ' : ''}clean document saved to ${savePath} and tracked changes document saved to ${trackedPath}`,
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (String(errorCode(e) ?? '').toUpperCase() === 'EACCES') {
      return err('PERMISSION_DENIED', `Cannot write to: ${params.save_to_local_path}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
    }
    return err('SAVE_ERROR', `Failed to save: ${msg}`, 'Check the path is valid and writable.');
  }
}
