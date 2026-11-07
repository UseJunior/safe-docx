import path from 'node:path';
import { errorCode, errorMessage } from "../error_utils.js";
import fs from 'node:fs/promises';
import {
  SessionManager,
  type SaveCacheEntry,
  type SaveFormat,
  type TrackedChangesStats,
} from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import {
  DocxZip,
  TRACKED_CHANGE_ELEMENT_NAME_SET,
  parseXml,
} from '@usejunior/docx-core';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { getAiRevisionBaseline, splitIntroducedDiagnostics } from './ai_revision_guard.js';
import { enforceWritePathPolicy, resolvesToSamePath } from './path_policy.js';

export type { SaveFormat, TrackedChangesStats };
export type SaveRevisionSummary = { count: number; author: string; ids?: number[] };
export type SaveFormatSource =
  | 'save_format'
  | 'tracked_save_to_local_path'
  | 'track_changes_alias'
  | 'default_both';

type SaveArtifactsCommon = {
  bookmarksRemoved: number;
  blocksRestored: number;
  exportedAtUtc: string;
};

export type CleanSaveArtifacts = SaveArtifactsCommon & {
  format: 'clean';
  cleanBuffer: Buffer;
  revisedBuffer: Buffer;
  trackedBuffer?: null;
  trackedStats?: null;
};

export type TrackedSaveArtifacts = SaveArtifactsCommon & {
  format: 'tracked';
  revisedBuffer?: Buffer;
  trackedBuffer: Buffer;
  trackedStats: TrackedChangesStats;
};

export type BothSaveArtifacts = SaveArtifactsCommon & {
  format: 'both';
  cleanBuffer: Buffer;
  revisedBuffer: Buffer;
  trackedBuffer: Buffer;
  trackedStats: TrackedChangesStats;
};

export type SaveArtifactBundle =
  | CleanSaveArtifacts
  | TrackedSaveArtifacts
  | BothSaveArtifacts;

const WORDPROCESSING_ML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

function isSaveFormat(value: string): value is SaveFormat {
  return value === 'clean' || value === 'tracked' || value === 'both';
}

function isValidBuffer(value: unknown): value is Buffer {
  return Buffer.isBuffer(value) && value.length > 0;
}

function isValidTrackedStats(value: unknown): value is TrackedChangesStats {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.insertions === 'number'
    && Number.isFinite(candidate.insertions)
    && typeof candidate.deletions === 'number'
    && Number.isFinite(candidate.deletions)
    && typeof candidate.modifications === 'number'
    && Number.isFinite(candidate.modifications)
  );
}

export function resolveSaveFormat(params: {
  save_format?: SaveFormat;
  track_changes?: boolean;
  tracked_save_to_local_path?: string;
}):
  | {
      ok: true;
      format: SaveFormat;
      formatSource: SaveFormatSource;
      parameterWarning?: string;
    }
  | {
      ok: false;
      response: ToolResponse;
    } {
  const explicitFormat = params.save_format;
  const hasTrackedSavePath =
    typeof params.tracked_save_to_local_path === 'string'
    && params.tracked_save_to_local_path.trim().length > 0;

  let formatSource: SaveFormatSource;
  let formatRaw: string;
  let parameterWarning: string | undefined;

  if (explicitFormat !== undefined) {
    formatRaw = explicitFormat;
    formatSource = 'save_format';
  } else if (hasTrackedSavePath) {
    // If caller asks for explicit tracked path, always emit both variants unless
    // they explicitly override save_format.
    formatRaw = 'both';
    formatSource = 'tracked_save_to_local_path';
    if (params.track_changes === false) {
      parameterWarning =
        "track_changes=false was ignored because tracked_save_to_local_path was provided. Using save_format='both'.";
    }
  } else if (typeof params.track_changes === 'boolean') {
    formatRaw = params.track_changes ? 'tracked' : 'clean';
    formatSource = 'track_changes_alias';
  } else {
    formatRaw = 'both';
    formatSource = 'default_both';
  }

  if (!isSaveFormat(formatRaw)) {
    return {
      ok: false,
      response: err(
        'INVALID_SAVE_FORMAT',
        `Invalid save_format: ${String(formatRaw)}`,
        "Use one of: 'clean', 'tracked', or 'both'.",
      ),
    };
  }

  return {
    ok: true,
    format: formatRaw,
    formatSource,
    parameterWarning,
  };
}

export function assertSaveArtifactsForFormat(
  entry: {
    format: SaveFormat;
    revisedBuffer?: Buffer | null;
    trackedBuffer?: Buffer | null;
    trackedStats?: TrackedChangesStats | null;
    bookmarksRemoved: number;
    blocksRestored: number;
    exportedAtUtc: string;
  },
  expectedFormat: SaveFormat,
): SaveArtifactBundle {
  if (entry.format !== expectedFormat) {
    throw new Error(
      `Save artifact format mismatch: expected '${expectedFormat}', got '${String(entry.format)}'.`,
    );
  }

  if (expectedFormat === 'clean') {
    if (!isValidBuffer(entry.revisedBuffer)) {
      throw new Error("Missing required clean artifact buffer for save_format='clean'.");
    }
    return {
      format: 'clean',
      cleanBuffer: entry.revisedBuffer,
      revisedBuffer: entry.revisedBuffer,
      trackedBuffer: null,
      trackedStats: null,
      bookmarksRemoved: entry.bookmarksRemoved,
      blocksRestored: entry.blocksRestored,
      exportedAtUtc: entry.exportedAtUtc,
    };
  }

  if (expectedFormat === 'tracked') {
    if (!isValidBuffer(entry.trackedBuffer)) {
      throw new Error("Missing required tracked artifact buffer for save_format='tracked'.");
    }
    if (!isValidTrackedStats(entry.trackedStats)) {
      throw new Error("Missing required tracked changes stats for save_format='tracked'.");
    }
    return {
      format: 'tracked',
      revisedBuffer: isValidBuffer(entry.revisedBuffer) ? entry.revisedBuffer : undefined,
      trackedBuffer: entry.trackedBuffer,
      trackedStats: entry.trackedStats,
      bookmarksRemoved: entry.bookmarksRemoved,
      blocksRestored: entry.blocksRestored,
      exportedAtUtc: entry.exportedAtUtc,
    };
  }

  if (!isValidBuffer(entry.revisedBuffer)) {
    throw new Error("Missing required clean artifact buffer for save_format='both'.");
  }
  if (!isValidBuffer(entry.trackedBuffer)) {
    throw new Error("Missing required tracked artifact buffer for save_format='both'.");
  }
  if (!isValidTrackedStats(entry.trackedStats)) {
    throw new Error("Missing required tracked changes stats for save_format='both'.");
  }
  return {
    format: 'both',
    cleanBuffer: entry.revisedBuffer,
    revisedBuffer: entry.revisedBuffer,
    trackedBuffer: entry.trackedBuffer,
    trackedStats: entry.trackedStats,
    bookmarksRemoved: entry.bookmarksRemoved,
    blocksRestored: entry.blocksRestored,
    exportedAtUtc: entry.exportedAtUtc,
  };
}

function toSaveCacheEntry(
  cacheKey: string,
  revision: number,
  cleanBookmarks: boolean,
  trackedAuthor: string,
  artifacts: SaveArtifactBundle,
  cachedAtIso: string,
): SaveCacheEntry {
  const common = {
    cacheKey,
    revision,
    cleanBookmarks,
    trackedAuthor,
    bookmarksRemoved: artifacts.bookmarksRemoved,
    blocksRestored: artifacts.blocksRestored,
    exportedAtUtc: artifacts.exportedAtUtc,
    cachedAtIso,
  };

  if (artifacts.format === 'clean') {
    return {
      ...common,
      format: 'clean',
      revisedBuffer: artifacts.cleanBuffer,
      trackedBuffer: null,
      trackedStats: null,
    };
  }

  if (artifacts.format === 'tracked') {
    return {
      ...common,
      format: 'tracked',
      revisedBuffer: artifacts.revisedBuffer,
      trackedBuffer: artifacts.trackedBuffer,
      trackedStats: artifacts.trackedStats,
    };
  }

  return {
    ...common,
    format: 'both',
    revisedBuffer: artifacts.cleanBuffer,
    trackedBuffer: artifacts.trackedBuffer,
    trackedStats: artifacts.trackedStats,
  };
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

function getWordAttr(element: Element, localName: string): string | null {
  return (
    element.getAttributeNS(WORDPROCESSING_ML_NS, localName)
    ?? element.getAttribute(`w:${localName}`)
    ?? element.getAttribute(localName)
  );
}

async function collectAiRevisionSummary(
  buffer: Buffer,
  author: string | null,
): Promise<SaveRevisionSummary | undefined> {
  if (!author) return undefined;

  const zip = await DocxZip.load(buffer);
  const revisionIds = new Set<number>();
  let count = 0;

  for (const fileName of zip.listFiles()) {
    if (!fileName.startsWith('word/') || !fileName.endsWith('.xml')) continue;
    const xml = await zip.readTextOrNull(fileName);
    if (!xml) continue;

    const doc = parseXml(xml);
    for (const node of Array.from(doc.getElementsByTagName('*'))) {
      if (node.namespaceURI !== WORDPROCESSING_ML_NS || !TRACKED_CHANGE_ELEMENT_NAME_SET.has(node.localName)) {
        continue;
      }
      if (getWordAttr(node, 'author') !== author) continue;

      count += 1;
      const id = getWordAttr(node, 'id');
      if (!id) continue;

      const parsed = Number.parseInt(id, 10);
      if (Number.isFinite(parsed)) {
        revisionIds.add(parsed);
      }
    }
  }

  if (count === 0) return undefined;

  return {
    count,
    author,
    ...(revisionIds.size > 0 ? { ids: [...revisionIds].sort((a, b) => a - b) } : {}),
  };
}

/**
 * Count tracked-change stats directly from the write-time markup carried by the
 * session document (#126) — no comparison. Insertions/deletions are w:ins/w:del;
 * modifications are the property-change records (w:rPrChange/pPrChange/…).
 */
async function collectTrackedStats(buffer: Buffer, author: string | null): Promise<TrackedChangesStats> {
  const zip = await DocxZip.load(buffer);
  const stats: TrackedChangesStats = { insertions: 0, deletions: 0, modifications: 0 };
  for (const fileName of zip.listFiles()) {
    if (!fileName.startsWith('word/') || !fileName.endsWith('.xml')) continue;
    const xml = await zip.readTextOrNull(fileName);
    if (!xml) continue;
    const doc = parseXml(xml);
    for (const node of Array.from(doc.getElementsByTagName('*'))) {
      if (node.namespaceURI !== WORDPROCESSING_ML_NS || !TRACKED_CHANGE_ELEMENT_NAME_SET.has(node.localName)) continue;
      // When an author is set, count only that actor's write-time revisions.
      if (author && getWordAttr(node, 'author') !== author) continue;
      if (node.localName === 'ins') stats.insertions += 1;
      else if (node.localName === 'del') stats.deletions += 1;
      else if (node.localName.endsWith('Change')) stats.modifications += 1;
    }
  }
  return stats;
}

export async function save(
  manager: SessionManager,
  params: {
    file_path?: string;
    save_to_local_path: string;
    clean_bookmarks?: boolean;
    save_format?: SaveFormat;
    // Backward-compatible aliases used by older safe-docx prompts.
    track_changes?: boolean;
    author?: string;
    allow_overwrite?: boolean;
    allow_discard_preserved_revisions?: boolean;
    tracked_save_to_local_path?: string;
    tracked_changes_author?: string;
    // Deprecated (#126): comparison-based redlines moved to the compare_documents
    // tool. Accepted for backward compatibility but no longer affect the save path.
    tracked_changes_engine?: 'auto' | 'atomizer';
    fail_on_rebuild_fallback?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'save' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const savePath = expandPath(params.save_to_local_path);
    const formatResolved = resolveSaveFormat(params);
    if (!formatResolved.ok) return formatResolved.response;
    const { format, formatSource, parameterWarning } = formatResolved;

    const clean = params.clean_bookmarks ?? true;
    const preserveOriginalBookmarksInTracked = params.clean_bookmarks === undefined;
    // Display author for the tracked-changes report. The actual markup author is
    // whatever the write-time emitter recorded on session.doc (#120/#126); no
    // comparison re-authoring happens here.
    const author = params.tracked_changes_author ?? params.author ?? session.aiAuthor ?? 'SafeDocX';
    const allowOverwrite = params.allow_overwrite ?? false;

    let cleanArtifactDiscardedRevisions: SaveRevisionSummary | undefined;
    if (
      (format === 'clean' || format === 'both')
      && session.selectiveRevisionAction
      && session.aiAuthor
    ) {
      const current = await session.doc.toBuffer({ cleanBookmarks: false });
      const remaining = await collectAiRevisionSummary(current.buffer, session.aiAuthor);
      if (remaining && !params.allow_discard_preserved_revisions) {
        return {
          ...err(
            'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED',
            `Clean output would auto-accept ${remaining.count} remaining revision(s) by ${session.aiAuthor} after a selective revision operation.`,
            "Use save_format='tracked', finish accepting/rejecting the remaining revisions, or explicitly set allow_discard_preserved_revisions=true.",
          ),
          selective_revision_action: session.selectiveRevisionAction,
          preserved_revisions: remaining,
        };
      }
      cleanArtifactDiscardedRevisions = remaining;
    }

    const cacheKey = JSON.stringify({
      revision: session.editRevision,
      format,
      clean_bookmarks: clean,
      preserve_original_bookmarks_in_tracked: preserveOriginalBookmarksInTracked,
      tracked_author: author,
    });

    const cached = manager.getSaveCache(session, cacheKey);
    const cacheHit = cached !== null;

    // Run implicit validation before producing save artifacts.
    const validation = session.doc.validate();
    let aiRevisionValidation = session.aiAuthor
      ? await session.doc.validateAiRevisions(session.aiAuthor)
      : undefined;
    if (aiRevisionValidation && aiRevisionValidation.errors.length > 0) {
      // AI-attributed errors always fail the save. Unattributable errors
      // (field structure, package invariants — no w:author) fail only when
      // they were not already present in the originally-loaded file; the
      // session's AI edits did not introduce those.
      const attributed = aiRevisionValidation.errors.filter((e) => e.author === session.aiAuthor);
      const unattributed = aiRevisionValidation.errors.filter((e) => e.author !== session.aiAuthor);
      let introduced = unattributed;
      let demoted: typeof unattributed = [];
      if (unattributed.length > 0) {
        const baseline = await getAiRevisionBaseline(session);
        ({ introduced, demoted } = splitIntroducedDiagnostics(unattributed, baseline));
      }
      const failing = [...attributed, ...introduced];
      aiRevisionValidation = {
        valid: failing.length === 0,
        errors: failing,
        warnings: [...aiRevisionValidation.warnings, ...demoted],
      };
      if (failing.length > 0) {
        return {
          ...err(
            'INVALID_AI_REVISIONS',
            'Session contains invalid AI-authored tracked-change markup.',
            'Repair the AI-authored revisions before saving a redline artifact.',
          ),
          diagnostics: {
            errors: failing,
            warnings: aiRevisionValidation.warnings,
          },
        };
      }
    }

    let artifacts: SaveArtifactBundle;
    if (cached) {
      artifacts = assertSaveArtifactsForFormat(cached, format);
    } else {
      const exportTimestamp = formatUtcTimestamp(new Date());

      // CLEAN artifact (#126): accept the AI actor's write-time edits so the
      // artifact is a genuinely clean document. Pre-existing third-party tracked
      // changes are preserved — SafeDocX never silently accepts another
      // reviewer's revisions (normalizeFirst keeps the accept best-effort and
      // never hard-errors on an unusual overlap during finalization). With no AI
      // author there is no write-time AI markup, so the document serializes as-is
      // with a minimal, blast-radius-matching diff.
      let revisedBuffer: Buffer;
      let bookmarksRemoved: number;
      let blocksRestored: number;
      if (session.aiAuthor) {
        // Accept the AI actor's write-time edits on an isolated copy so the
        // session (and its tracked artifact) keep the markup, while untouched
        // body blocks stay byte-identical to the source via minimal
        // reserialization against the true original document.xml (#408).
        const cleaned = await session.doc.toAcceptedBuffer(
          { author: session.aiAuthor, normalizeFirst: true },
          { cleanBookmarks: clean },
        );
        revisedBuffer = cleaned.buffer;
        bookmarksRemoved = cleaned.bookmarksRemoved;
        blocksRestored = cleaned.blocksRestored;
      } else {
        const revised = await session.doc.toBuffer({ cleanBookmarks: clean, minimalReserialization: clean });
        revisedBuffer = revised.buffer;
        bookmarksRemoved = revised.bookmarksRemoved;
        blocksRestored = revised.blocksRestored;
      }

      if (format === 'clean') {
        artifacts = assertSaveArtifactsForFormat(
          {
            format: 'clean',
            revisedBuffer,
            trackedBuffer: null,
            trackedStats: null,
            bookmarksRemoved: clean ? bookmarksRemoved : 0,
            blocksRestored,
            exportedAtUtc: exportTimestamp,
          },
          'clean',
        );
      } else {
        // TRACKED artifact (#126): the session's write-time tracked markup,
        // serialized directly. No comparison, no reconstruction — the redline is
        // exactly what the write-time emitter authored (author, stable ids, and any
        // pre-existing reviewer revisions preserved). Comparison-based redlining is
        // available only via the compare_documents tool.
        const tracked = await session.doc.toBuffer({
          cleanBookmarks: clean,
          preserveOriginalBookmarks: preserveOriginalBookmarksInTracked,
        });
        const trackedStats = await collectTrackedStats(tracked.buffer, session.aiAuthor);
        const effectiveBookmarksRemoved = format === 'tracked' ? tracked.bookmarksRemoved : bookmarksRemoved;

        artifacts = assertSaveArtifactsForFormat(
          {
            format,
            revisedBuffer,
            trackedBuffer: tracked.buffer,
            trackedStats,
            bookmarksRemoved: clean ? effectiveBookmarksRemoved : 0,
            blocksRestored,
            exportedAtUtc: exportTimestamp,
          },
          format,
        );
      }

      manager.setSaveCache(
        session,
        toSaveCacheEntry(
          cacheKey,
          session.editRevision,
          clean,
          author,
          artifacts,
          new Date().toISOString(),
        ),
      );
    }

    if (artifacts.format === 'clean') {
      const cleanPath = savePath;
      if (!allowOverwrite && await resolvesToSamePath(cleanPath, session.originalPath)) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite original file: ${cleanPath}`,
          "Save to a different path, or set allow_overwrite=true if you explicitly want in-place overwrite.",
        );
      }

      const cleanPolicy = await enforceWritePathPolicy(cleanPath);
      if (!cleanPolicy.ok) return cleanPolicy.response;
      await fs.mkdir(path.dirname(cleanPath), { recursive: true });
      await fs.writeFile(cleanPath, new Uint8Array(artifacts.cleanBuffer));

      const revisionSummarySource = (await session.doc.toBuffer({ cleanBookmarks: false })).buffer;
      const revisions = await collectAiRevisionSummary(revisionSummarySource, session.aiAuthor);

      return ok(mergeSessionResolutionMetadata({
        file_path: manager.normalizePath(session.originalPath),
        original_filename: session.filename,
        edit_count: session.editCount,
        edit_revision: session.editRevision,
        save_format: 'clean',
        saved_to: cleanPath,
        clean_saved_to: undefined,
        tracked_saved_to: null,
        size_bytes: artifacts.cleanBuffer.length,
        tracked_size_bytes: undefined,
        tracked_changes_source: undefined,
        tracked_changes_author: undefined,
        tracked_changes_stats: undefined,
        revisions,
        non_revision_changes: session.nonRevisionManifest.length > 0
          ? session.nonRevisionManifest
          : undefined,
        exported_at_utc: artifacts.exportedAtUtc,
        bookmarks_removed: clean ? artifacts.bookmarksRemoved : 0,
        blocks_restored: artifacts.blocksRestored,
        returned_variants: ['clean'],
        available_variants: ['clean', 'redline'],
        cache_hit: cacheHit,
        format_source: formatSource,
        parameter_warning: parameterWarning,
        selective_revision_disposition: cleanArtifactDiscardedRevisions
          ? {
              acknowledged: true,
              clean_artifact_accepted_remaining_author_revisions: cleanArtifactDiscardedRevisions,
            }
          : undefined,
        validation: validation.warnings.length > 0 || (aiRevisionValidation?.warnings.length ?? 0) > 0
          ? {
              warnings: [
                ...validation.warnings.map(w => ({ code: w.code, message: w.message })),
                ...(aiRevisionValidation?.warnings ?? []),
              ],
            }
          : { valid: true },
        message: `${cacheHit ? 'Cached ' : ''}document saved to ${cleanPath}`,
      }, metadata));
    }

    if (artifacts.format === 'tracked') {
      const trackedPath = savePath;
      if (!allowOverwrite && await resolvesToSamePath(trackedPath, session.originalPath)) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite original file with tracked output: ${trackedPath}`,
          "Use tracked_save_to_local_path to write redline elsewhere, or set allow_overwrite=true to force overwrite.",
        );
      }

      const trackedPolicy = await enforceWritePathPolicy(trackedPath);
      if (!trackedPolicy.ok) return trackedPolicy.response;
      await fs.mkdir(path.dirname(trackedPath), { recursive: true });
      await fs.writeFile(trackedPath, new Uint8Array(artifacts.trackedBuffer));

      const revisions = await collectAiRevisionSummary(artifacts.trackedBuffer, session.aiAuthor);

      return ok(mergeSessionResolutionMetadata({
        file_path: manager.normalizePath(session.originalPath),
        original_filename: session.filename,
        edit_count: session.editCount,
        edit_revision: session.editRevision,
        save_format: 'tracked',
        saved_to: trackedPath,
        clean_saved_to: undefined,
        tracked_saved_to: trackedPath,
        size_bytes: artifacts.trackedBuffer.length,
        tracked_size_bytes: artifacts.trackedBuffer.length,
        tracked_changes_source: 'write-time',
        tracked_changes_author: author,
        tracked_changes_stats: artifacts.trackedStats,
        revisions,
        non_revision_changes: session.nonRevisionManifest.length > 0
          ? session.nonRevisionManifest
          : undefined,
        exported_at_utc: artifacts.exportedAtUtc,
        bookmarks_removed: clean ? artifacts.bookmarksRemoved : 0,
        blocks_restored: artifacts.blocksRestored,
        returned_variants: ['redline'],
        available_variants: ['clean', 'redline'],
        cache_hit: cacheHit,
        format_source: formatSource,
        parameter_warning: parameterWarning,
        selective_revision_disposition: undefined,
        validation: validation.warnings.length > 0 || (aiRevisionValidation?.warnings.length ?? 0) > 0
          ? {
              warnings: [
                ...validation.warnings.map(w => ({ code: w.code, message: w.message })),
                ...(aiRevisionValidation?.warnings ?? []),
              ],
            }
          : { valid: true },
        message: `${cacheHit ? 'Cached ' : ''}tracked changes document saved to ${trackedPath}`,
      }, metadata));
    }

    const cleanPath = savePath;
    const trackedPath = params.tracked_save_to_local_path
      ? expandPath(params.tracked_save_to_local_path)
      : defaultTrackedPath(savePath, artifacts.exportedAtUtc);

    if (!allowOverwrite) {
      if (await resolvesToSamePath(cleanPath, session.originalPath)) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite original file: ${cleanPath}`,
          "Save to a different path, or set allow_overwrite=true if you explicitly want in-place overwrite.",
        );
      }
      if (await resolvesToSamePath(trackedPath, session.originalPath)) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite original file with tracked output: ${trackedPath}`,
          "Use tracked_save_to_local_path to write redline elsewhere, or set allow_overwrite=true to force overwrite.",
        );
      }
    }

    const cleanPolicy = await enforceWritePathPolicy(cleanPath);
    if (!cleanPolicy.ok) return cleanPolicy.response;
    const trackedPolicy = await enforceWritePathPolicy(trackedPath);
    if (!trackedPolicy.ok) return trackedPolicy.response;

    await fs.mkdir(path.dirname(cleanPath), { recursive: true });
    await fs.writeFile(cleanPath, new Uint8Array(artifacts.cleanBuffer));
    await fs.mkdir(path.dirname(trackedPath), { recursive: true });
    await fs.writeFile(trackedPath, new Uint8Array(artifacts.trackedBuffer));

    const revisions = await collectAiRevisionSummary(artifacts.trackedBuffer, session.aiAuthor);

    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      original_filename: session.filename,
      edit_count: session.editCount,
      edit_revision: session.editRevision,
      save_format: 'both',
      saved_to: cleanPath,
      clean_saved_to: cleanPath,
      tracked_saved_to: trackedPath,
      size_bytes: artifacts.cleanBuffer.length,
      tracked_size_bytes: artifacts.trackedBuffer.length,
      tracked_changes_source: 'write-time',
      tracked_changes_author: author,
      tracked_changes_stats: artifacts.trackedStats,
      revisions,
      non_revision_changes: session.nonRevisionManifest.length > 0
        ? session.nonRevisionManifest
        : undefined,
      exported_at_utc: artifacts.exportedAtUtc,
      bookmarks_removed: clean ? artifacts.bookmarksRemoved : 0,
      blocks_restored: artifacts.blocksRestored,
      returned_variants: ['clean', 'redline'],
      available_variants: ['clean', 'redline'],
      cache_hit: cacheHit,
      format_source: formatSource,
      parameter_warning: parameterWarning,
      selective_revision_disposition: cleanArtifactDiscardedRevisions
        ? {
            acknowledged: true,
            clean_artifact_accepted_remaining_author_revisions: cleanArtifactDiscardedRevisions,
          }
        : undefined,
      validation: validation.warnings.length > 0 || (aiRevisionValidation?.warnings.length ?? 0) > 0
        ? {
            warnings: [
              ...validation.warnings.map(w => ({ code: w.code, message: w.message })),
              ...(aiRevisionValidation?.warnings ?? []),
            ],
          }
        : { valid: true },
      message: `${cacheHit ? 'Cached ' : ''}clean document saved to ${cleanPath} and tracked changes document saved to ${trackedPath}`,
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (String(errorCode(e) ?? '').toUpperCase() === 'EACCES') {
      return err('PERMISSION_DENIED', `Cannot write to: ${params.save_to_local_path}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
    }
    return err('SAVE_ERROR', `Failed to save: ${msg}`, 'Check the path is valid and writable.');
  }
}
