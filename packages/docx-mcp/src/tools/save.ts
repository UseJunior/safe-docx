import path from 'node:path';
import { errorCode, errorMessage } from "../error_utils.js";
import fs from 'node:fs/promises';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import {
  DocxDocument,
  DocxZip,
  TRACKED_CHANGE_ELEMENT_NAME_SET,
  parseXml,
} from '@usejunior/docx-core';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { getAiRevisionBaseline, splitIntroducedDiagnostics } from './ai_revision_guard.js';
import { enforceWritePathPolicy, resolvesToSamePath } from './path_policy.js';

type SaveFormat = 'clean' | 'tracked' | 'both';
type SaveRevisionSummary = { count: number; author: string; ids?: number[] };
type TrackedChangesStats = { insertions: number; deletions: number; modifications: number };

const WORDPROCESSING_ML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

function isSaveFormat(value: string): value is SaveFormat {
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
    const explicitFormat = params.save_format;
    const hasTrackedSavePath =
      typeof params.tracked_save_to_local_path === 'string'
      && params.tracked_save_to_local_path.trim().length > 0;
    let formatSource: 'save_format' | 'tracked_save_to_local_path' | 'track_changes_alias' | 'default_both';
    let formatRaw: string;
    let parameterWarning: string | undefined;
    if (explicitFormat) {
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
      return err('INVALID_SAVE_FORMAT', `Invalid save_format: ${String(formatRaw)}`, "Use one of: 'clean', 'tracked', or 'both'.");
    }
    const format: SaveFormat = formatRaw;

    const clean = params.clean_bookmarks ?? true;
    // Display author for the tracked-changes report. The actual markup author is
    // whatever the write-time emitter recorded on session.doc (#120/#126); no
    // comparison re-authoring happens here.
    const author = params.tracked_changes_author ?? params.author ?? session.aiAuthor ?? 'SafeDocX';
    const allowOverwrite = params.allow_overwrite ?? false;
    const cacheKey = JSON.stringify({
      revision: session.editRevision,
      format,
      clean_bookmarks: clean,
      tracked_author: author,
    });

    const cached = manager.getSaveCache(session, cacheKey);
    const cacheHit = cached !== null;

    let revisedBuffer: Buffer;
    let trackedBuffer: Buffer | null;
    let trackedStats: TrackedChangesStats | null;
    let bookmarksRemoved: number;
    let blocksRestored: number;
    let exportTimestamp: string;

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

    if (cached) {
      revisedBuffer = cached.revisedBuffer;
      trackedBuffer = cached.trackedBuffer;
      trackedStats = cached.trackedStats;
      bookmarksRemoved = cached.bookmarksRemoved;
      blocksRestored = cached.blocksRestored;
      exportTimestamp = cached.exportedAtUtc;
    } else {
      exportTimestamp = formatUtcTimestamp(new Date());
      trackedBuffer = null;
      trackedStats = null;

      // CLEAN artifact (#126): accept the AI actor's write-time edits so the
      // artifact is a genuinely clean document. Pre-existing third-party tracked
      // changes are preserved — SafeDocX never silently accepts another
      // reviewer's revisions (normalizeFirst keeps the accept best-effort and
      // never hard-errors on an unusual overlap during finalization). With no AI
      // author there is no write-time AI markup, so the document serializes as-is
      // with a minimal, blast-radius-matching diff.
      if (session.aiAuthor) {
        const cleanDoc = await DocxDocument.load((await session.doc.toBuffer({ cleanBookmarks: false })).buffer);
        await cleanDoc.acceptAIEdits({ author: session.aiAuthor, normalizeFirst: true });
        const cleaned = await cleanDoc.toBuffer({ cleanBookmarks: clean });
        revisedBuffer = cleaned.buffer;
        bookmarksRemoved = cleaned.bookmarksRemoved;
        blocksRestored = cleaned.blocksRestored;
      } else {
        const revised = await session.doc.toBuffer({ cleanBookmarks: clean, minimalReserialization: clean });
        revisedBuffer = revised.buffer;
        bookmarksRemoved = revised.bookmarksRemoved;
        blocksRestored = revised.blocksRestored;
      }

      // TRACKED artifact (#126): the session's write-time tracked markup,
      // serialized directly. No comparison, no reconstruction — the redline is
      // exactly what the write-time emitter authored (author, stable ids, and any
      // pre-existing reviewer revisions preserved). Comparison-based redlining is
      // available only via the compare_documents tool.
      if (format === 'tracked' || format === 'both') {
        const tracked = await session.doc.toBuffer({ cleanBookmarks: clean });
        trackedBuffer = tracked.buffer;
        trackedStats = await collectTrackedStats(trackedBuffer, session.aiAuthor);
      }

      manager.setSaveCache(session, {
        cacheKey,
        revision: session.editRevision,
        format,
        cleanBookmarks: clean,
        trackedAuthor: author,
        revisedBuffer,
        trackedBuffer,
        trackedStats,
        bookmarksRemoved: clean ? bookmarksRemoved : 0,
        blocksRestored,
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

    // Compare against the original via realpath (issue #313) so a symlinked save_to_local_path pointing
    // back at the source can't slip past a purely lexical check and overwrite the original through the link.
    if (!allowOverwrite) {
      if ((format === 'clean' || format === 'both') && await resolvesToSamePath(savePath, session.originalPath)) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite original file: ${savePath}`,
          "Save to a different path, or set allow_overwrite=true if you explicitly want in-place overwrite.",
        );
      }
      if ((format === 'tracked' || format === 'both') && trackedPath && await resolvesToSamePath(trackedPath, session.originalPath)) {
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

    // Summarize the AI's revisions from the session's write-time markup (#126).
    // The clean artifact has accepted them away, so summarize the tracked
    // artifact when present, else the session document directly.
    const revisionSummarySource = trackedBuffer
      ?? (await session.doc.toBuffer({ cleanBookmarks: false })).buffer;
    const revisions = await collectAiRevisionSummary(revisionSummarySource, session.aiAuthor);

    const returnedVariants =
      format === 'clean'
        ? ['clean']
        : format === 'tracked'
          ? ['redline']
          : ['clean', 'redline'];

    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      original_filename: session.filename,
      edit_count: session.editCount,
      edit_revision: session.editRevision,
      save_format: format,
      saved_to: format === 'tracked' ? trackedPath : savePath,
      clean_saved_to: format === 'both' ? savePath : undefined,
      tracked_saved_to: trackedPath,
      size_bytes: format === 'tracked' ? trackedBuffer?.length : revisedBuffer.length,
      tracked_size_bytes: trackedBuffer?.length,
      // The redline is the write-time markup as authored — no comparison engine
      // or reconstruction is involved (#126).
      tracked_changes_source: format === 'tracked' || format === 'both' ? 'write-time' : undefined,
      tracked_changes_author: format === 'tracked' || format === 'both' ? author : undefined,
      tracked_changes_stats: trackedStats ?? undefined,
      revisions,
      // #122: package-level mutations with no native OOXML revision wrapper
      // (comment/footnote side parts, relationships, content types) are not
      // tracked changes, so surface them explicitly alongside the revisions
      // list rather than letting them land silently.
      non_revision_changes: session.nonRevisionManifest.length > 0
        ? session.nonRevisionManifest
        : undefined,
      exported_at_utc: exportTimestamp,
      bookmarks_removed: clean ? bookmarksRemoved : 0,
      blocks_restored: blocksRestored,
      returned_variants: returnedVariants,
      available_variants: ['clean', 'redline'],
      cache_hit: cacheHit,
      format_source: formatSource,
      parameter_warning: parameterWarning,
      validation: validation.warnings.length > 0 || (aiRevisionValidation?.warnings.length ?? 0) > 0
        ? {
            warnings: [
              ...validation.warnings.map(w => ({ code: w.code, message: w.message })),
              ...(aiRevisionValidation?.warnings ?? []),
            ],
          }
        : { valid: true },
      message:
        (format === 'clean'
          ? `${cacheHit ? 'Cached ' : ''}document saved to ${savePath}`
          : format === 'tracked'
            ? `${cacheHit ? 'Cached ' : ''}tracked changes document saved to ${trackedPath}`
            : `${cacheHit ? 'Cached ' : ''}clean document saved to ${savePath} and tracked changes document saved to ${trackedPath}`),
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (String(errorCode(e) ?? '').toUpperCase() === 'EACCES') {
      return err('PERMISSION_DENIED', `Cannot write to: ${params.save_to_local_path}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
    }
    return err('SAVE_ERROR', `Failed to save: ${msg}`, 'Check the path is valid and writable.');
  }
}
