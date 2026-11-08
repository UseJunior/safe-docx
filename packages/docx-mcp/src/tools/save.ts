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
import { artifactsFromCache, type SaveArtifacts } from './save_artifacts.js';

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
    const preserveOriginalBookmarksInTracked = params.clean_bookmarks === undefined;
    // Display author for the tracked-changes report. The actual markup author is
    // whatever the write-time emitter recorded on session.doc (#120/#126); no
    // comparison re-authoring happens here.
    const author = params.tracked_changes_author ?? params.author ?? session.aiAuthor ?? 'SafeDocX';
    const allowOverwrite = params.allow_overwrite ?? false;

    // Capture metadata before starting exports. All serializers below capture
    // their isolated ZIP/DOM synchronously, before any of them yields (#1318).
    const doc = session.doc;
    const revision = session.editRevision;
    const editCount = session.editCount;
    const aiAuthor = session.aiAuthor;
    const selectivePolicy = session.selectiveRevisionAction;
    const selectiveRevisionAction = selectivePolicy
      ? { ...selectivePolicy, selectedRevisionIds: [...selectivePolicy.selectedRevisionIds] }
      : null;
    const nonRevisionManifest = session.nonRevisionManifest.map(change => ({
      ...change, parts: [...change.parts],
    }));
    const cacheKey = JSON.stringify({
      revision,
      format,
      clean_bookmarks: clean,
      preserve_original_bookmarks_in_tracked: preserveOriginalBookmarksInTracked,
      tracked_author: author,
    });
    const cached = manager.getSaveCache(session, cacheKey);
    const cacheHit = cached !== null;
    const cachedArtifacts = cached ? artifactsFromCache(cached, format) : undefined;
    const exportTimestamp = cached?.exportedAtUtc ?? formatUtcTimestamp(new Date());
    const [current, revised, tracked] = await Promise.all([
      doc.toBuffer({ cleanBookmarks: false }),
      // Accept only the AI actor on an isolated copy, retaining the original
      // minimal-reserialization baseline and all third-party revisions.
      // Tracked-only saves retain this export for legacy blocks_restored stats.
      cached ? undefined : aiAuthor
        ? doc.toAcceptedBuffer(
          { author: aiAuthor, normalizeFirst: true },
          { cleanBookmarks: clean },
        )
        : doc.toBuffer({ cleanBookmarks: clean, minimalReserialization: clean }),
      // The redline is the write-time markup, never a comparison reconstruction.
      cached || format === 'clean' ? undefined : doc.toBuffer({
        cleanBookmarks: clean,
        preserveOriginalBookmarks: preserveOriginalBookmarksInTracked,
      }),
    ]);

    let cleanArtifactDiscardedRevisions: SaveRevisionSummary | undefined;
    if (
      (format === 'clean' || format === 'both')
      && selectiveRevisionAction
      && aiAuthor
    ) {
      const remaining = await collectAiRevisionSummary(current.buffer, aiAuthor);
      if (remaining && !params.allow_discard_preserved_revisions) {
        return {
          ...err(
            'SELECTIVE_REVISIONS_WOULD_BE_DISCARDED',
            `Clean output would auto-accept ${remaining.count} remaining revision(s) by ${aiAuthor} after a selective revision operation.`,
            "Use save_format='tracked', finish accepting/rejecting the remaining revisions, or explicitly set allow_discard_preserved_revisions=true.",
          ),
          selective_revision_action: selectiveRevisionAction,
          preserved_revisions: remaining,
        };
      }
      cleanArtifactDiscardedRevisions = remaining;
    }

    // Validate the same captured document that supplies all artifacts/stats.
    const snapshot = await DocxDocument.load(current.buffer);
    const validation = snapshot.validate();
    let aiRevisionValidation = aiAuthor
      ? await snapshot.validateAiRevisions(aiAuthor)
      : undefined;
    if (aiRevisionValidation && aiRevisionValidation.errors.length > 0) {
      // AI-attributed errors always fail the save. Unattributable errors
      // (field structure, package invariants — no w:author) fail only when
      // they were not already present in the originally-loaded file; the
      // session's AI edits did not introduce those.
      const attributed = aiRevisionValidation.errors.filter((e) => e.author === aiAuthor);
      const unattributed = aiRevisionValidation.errors.filter((e) => e.author !== aiAuthor);
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

    let artifacts: SaveArtifacts;
    if (cachedArtifacts) {
      artifacts = cachedArtifacts;
    } else {
      if (!revised) throw new Error('Missing clean save artifact');
      const common = {
        revisedBuffer: revised.buffer,
        bookmarksRemoved: clean
          ? (format === 'tracked' && tracked ? tracked.bookmarksRemoved : revised.bookmarksRemoved)
          : 0,
        blocksRestored: revised.blocksRestored,
        exportedAtUtc: exportTimestamp,
      };
      if (format === 'clean') {
        artifacts = { ...common, format, trackedBuffer: null, trackedStats: null };
      } else {
        if (!tracked) throw new Error('Missing tracked save artifact');
        artifacts = {
          ...common, format, trackedBuffer: tracked.buffer,
          trackedStats: await collectTrackedStats(tracked.buffer, aiAuthor),
        };
      }
      artifacts = artifactsFromCache(artifacts, format);

      // An in-flight save may finish after a mutation invalidated the cache.
      // Return its captured generation, but never publish it as current.
      if (session.doc === doc && session.editRevision === revision
        && session.aiAuthor === aiAuthor && session.selectiveRevisionAction === selectivePolicy) {
        manager.setSaveCache(session, {
          ...artifacts,
          cacheKey,
          revision,
          cleanBookmarks: clean,
          trackedAuthor: author,
          cachedAtIso: new Date().toISOString(),
        });
      }
    }
    const trackedPath = artifacts.format !== 'both'
      ? savePath
      : params.tracked_save_to_local_path
        ? expandPath(params.tracked_save_to_local_path)
        : defaultTrackedPath(savePath, exportTimestamp);

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
      if (artifacts.format !== 'clean' && await resolvesToSamePath(trackedPath, session.originalPath)) {
        return err(
          'OVERWRITE_BLOCKED',
          `Refusing to overwrite original file with tracked output: ${trackedPath}`,
          "Use tracked_save_to_local_path to write redline elsewhere, or set allow_overwrite=true to force overwrite.",
        );
      }
    }

    if (artifacts.format !== 'tracked') {
      const cleanPolicy = await enforceWritePathPolicy(savePath);
      if (!cleanPolicy.ok) return cleanPolicy.response;
      await fs.mkdir(path.dirname(savePath), { recursive: true });
      await fs.writeFile(savePath, new Uint8Array(artifacts.revisedBuffer));
    }
    if (artifacts.format !== 'clean') {
      const trackedPolicy = await enforceWritePathPolicy(trackedPath);
      if (!trackedPolicy.ok) return trackedPolicy.response;
      await fs.mkdir(path.dirname(trackedPath), { recursive: true });
      await fs.writeFile(trackedPath, new Uint8Array(artifacts.trackedBuffer));
    }

    // Summarize the AI's revisions from the session's write-time markup (#126).
    // The clean artifact has accepted them away, so summarize the tracked
    // artifact when present, else the session document directly.
    const revisionSummarySource = artifacts.format === 'clean' ? current.buffer : artifacts.trackedBuffer;
    const revisions = await collectAiRevisionSummary(revisionSummarySource, aiAuthor);

    const returnedVariants =
      format === 'clean'
        ? ['clean']
        : format === 'tracked'
          ? ['redline']
          : ['clean', 'redline'];

    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      original_filename: session.filename,
      edit_count: editCount,
      edit_revision: revision,
      save_format: format,
      saved_to: format === 'tracked' ? trackedPath : savePath,
      clean_saved_to: format === 'both' ? savePath : undefined,
      tracked_saved_to: artifacts.format === 'clean' ? null : trackedPath,
      size_bytes: artifacts.format === 'tracked' ? artifacts.trackedBuffer.length : artifacts.revisedBuffer.length,
      tracked_size_bytes: artifacts.format === 'clean' ? undefined : artifacts.trackedBuffer.length,
      // The redline is the write-time markup as authored — no comparison engine
      // or reconstruction is involved (#126).
      tracked_changes_source: format === 'tracked' || format === 'both' ? 'write-time' : undefined,
      tracked_changes_author: format === 'tracked' || format === 'both' ? author : undefined,
      tracked_changes_stats: artifacts.format === 'clean' ? undefined : artifacts.trackedStats,
      revisions,
      // #122: package-level mutations with no native OOXML revision wrapper
      // (comment/footnote side parts, relationships, content types) are not
      // tracked changes, so surface them explicitly alongside the revisions
      // list rather than letting them land silently.
      non_revision_changes: nonRevisionManifest.length > 0
        ? nonRevisionManifest
        : undefined,
      exported_at_utc: exportTimestamp,
      bookmarks_removed: artifacts.bookmarksRemoved,
      blocks_restored: artifacts.blocksRestored,
      returned_variants: returnedVariants,
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
