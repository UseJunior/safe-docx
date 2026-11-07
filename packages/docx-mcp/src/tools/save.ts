import path from 'node:path';
import { errorCode, errorMessage } from "../error_utils.js";
import fs from 'node:fs/promises';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import {
  DocxZip,
  TRACKED_CHANGE_ELEMENT_NAME_SET,
  parseXml,
} from '@usejunior/docx-core';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { getAiRevisionBaseline, splitIntroducedDiagnostics } from './ai_revision_guard.js';
import { randomUUID } from 'node:crypto';
import { enforceWritePathPolicy, resolvesToSamePath, type PathPolicyOutcome } from './path_policy.js';

export type RollbackFailure = {
  path: string;
  error: string;
};

export type SaveWriteHooks = {
  /** Hook called right before publishing a staged file to its destination. */
  beforePublish?: (info: { destination: string; stagingPath: string; index: number }) => Promise<void> | void;
  /** Hook called right before restoring an existing file from backup during rollback. */
  beforeRestore?: (info: { destination: string; backupPath: string }) => Promise<void> | void;
  /** Hook called right before unlinking a new file during rollback. */
  beforeRemoveNew?: (info: { destination: string }) => Promise<void> | void;
  /** Hook called right before writing a staging file. */
  beforeStage?: (info: { destination: string; stagingPath: string; index: number }) => Promise<void> | void;
};

export class SaveStageError extends Error {
  rollbackFailures: RollbackFailure[];
  originalError: unknown;

  constructor(message: string, originalError: unknown, rollbackFailures: RollbackFailure[] = []) {
    super(message);
    this.name = 'SaveStageError';
    this.originalError = originalError;
    this.rollbackFailures = rollbackFailures;
  }
}

/**
 * Stages paired save writes in destination directories and publishes them with backups,
 * restoring original files and removing newly created files on ordinary failure.
 *
 * Atomicity note: Staging and renaming within each destination's directory provides atomic
 * directory entry replacement on supported filesystems. However, when paired outputs (clean
 * and tracked) reside on different filesystems or mount points, cross-filesystem crash
 * atomicity cannot be guaranteed across power-loss or kernel crash events.
 */
export async function stageAndPublishFiles(
  files: Array<{ destination: string; buffer: Buffer }>,
  hooks?: SaveWriteHooks,
): Promise<void> {
  if (files.length === 0) return;

  const stagedEntries: Array<{
    destination: string;
    stagingPath: string;
    buffer: Buffer;
  }> = [];

  // Stage 1: Stage all files in their respective destination directories
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const destDir = path.dirname(file.destination);
      await fs.mkdir(destDir, { recursive: true });
      const stagingName = `.${path.basename(file.destination)}.staging-${process.pid}-${Date.now()}-${randomUUID()}`;
      const stagingPath = path.join(destDir, stagingName);
      if (hooks?.beforeStage) {
        await hooks.beforeStage({ destination: file.destination, stagingPath, index: i });
      }
      await fs.writeFile(stagingPath, new Uint8Array(file.buffer));
      stagedEntries.push({
        destination: file.destination,
        stagingPath,
        buffer: file.buffer,
      });
    }
  } catch (stageErr) {
    for (const entry of stagedEntries) {
      try {
        await fs.unlink(entry.stagingPath);
      } catch {
        // ignore cleanup error
      }
    }
    throw new SaveStageError(errorMessage(stageErr), stageErr, []);
  }

  // Stage 2: Publish staged files with backups
  const publishedEntries: Array<{
    destination: string;
    stagingPath: string;
    backupPath: string | null;
    existed: boolean;
  }> = [];

  const backupsToCleanup: string[] = [];

  try {
    for (let i = 0; i < stagedEntries.length; i++) {
      const entry = stagedEntries[i]!;
      const dest = entry.destination;
      const stagingPath = entry.stagingPath;

      if (hooks?.beforePublish) {
        await hooks.beforePublish({ destination: dest, stagingPath, index: i });
      }

      let existed = false;
      try {
        await fs.stat(dest);
        existed = true;
      } catch {
        existed = false;
      }

      let backupPath: string | null = null;
      if (existed) {
        const backupName = `.${path.basename(dest)}.backup-${process.pid}-${Date.now()}-${randomUUID()}`;
        backupPath = path.join(path.dirname(dest), backupName);
        await fs.rename(dest, backupPath);
        backupsToCleanup.push(backupPath);
      }

      await fs.rename(stagingPath, dest);

      publishedEntries.push({
        destination: dest,
        stagingPath,
        backupPath,
        existed,
      });
    }

    // Success: clean up backups
    for (const backup of backupsToCleanup) {
      try {
        await fs.unlink(backup);
      } catch {
        // ignore backup removal error on success
      }
    }
  } catch (publishErr) {
    // Ordinary failure during publish: execute rollback recovery
    const rollbackFailures: RollbackFailure[] = [];

    // Roll back already-published items in reverse order
    for (const pub of [...publishedEntries].reverse()) {
      if (pub.existed && pub.backupPath) {
        try {
          if (hooks?.beforeRestore) {
            await hooks.beforeRestore({ destination: pub.destination, backupPath: pub.backupPath });
          }
          try {
            await fs.unlink(pub.destination);
          } catch {
            // might not exist if rename had failed
          }
          await fs.rename(pub.backupPath, pub.destination);
        } catch (restoreErr) {
          rollbackFailures.push({
            path: pub.destination,
            error: `Failed to restore original file from backup (${pub.backupPath}): ${errorMessage(restoreErr)}`,
          });
        }
      } else {
        try {
          if (hooks?.beforeRemoveNew) {
            await hooks.beforeRemoveNew({ destination: pub.destination });
          }
          await fs.unlink(pub.destination);
        } catch (removeErr) {
          try {
            await fs.stat(pub.destination);
            rollbackFailures.push({
              path: pub.destination,
              error: `Failed to remove new file during rollback: ${errorMessage(removeErr)}`,
            });
          } catch {
            // file removed or doesn't exist
          }
        }
      }
    }

    // Clean up any remaining staging files
    for (const entry of stagedEntries) {
      try {
        await fs.unlink(entry.stagingPath);
      } catch {
        // already moved or unlinked
      }
    }

    // Clean up any remaining backups that were not restored
    for (const backup of backupsToCleanup) {
      const isFailedBackup = rollbackFailures.some((rf) => rf.error.includes(backup));
      if (!isFailedBackup) {
        try {
          await fs.unlink(backup);
        } catch {
          // already restored or deleted
        }
      }
    }

    throw new SaveStageError(errorMessage(publishErr), publishErr, rollbackFailures);
  }
}

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
    _testHooks?: SaveWriteHooks;
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

      // TRACKED artifact (#126): the session's write-time tracked markup,
      // serialized directly. No comparison, no reconstruction — the redline is
      // exactly what the write-time emitter authored (author, stable ids, and any
      // pre-existing reviewer revisions preserved). Comparison-based redlining is
      // available only via the compare_documents tool.
      if (format === 'tracked' || format === 'both') {
        const tracked = await session.doc.toBuffer({
          cleanBookmarks: clean,
          preserveOriginalBookmarks: preserveOriginalBookmarksInTracked,
        });
        trackedBuffer = tracked.buffer;
        trackedStats = await collectTrackedStats(trackedBuffer, session.aiAuthor);
        if (format === 'tracked') {
          bookmarksRemoved = tracked.bookmarksRemoved;
        }
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

    // Preflight both destinations before any writes or directory creation.
    let cleanPolicy: PathPolicyOutcome | undefined;
    if (format === 'clean' || format === 'both') {
      cleanPolicy = await enforceWritePathPolicy(savePath);
      if (!cleanPolicy.ok) return cleanPolicy.response;
    }

    let trackedPolicy: PathPolicyOutcome | undefined;
    if ((format === 'tracked' || format === 'both') && trackedPath) {
      trackedPolicy = await enforceWritePathPolicy(trackedPath);
      if (!trackedPolicy.ok) return trackedPolicy.response;
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

    // Preflight destinations: reject aliased outputs before any writes.
    if (
      format === 'both'
      && trackedPath
      && (
        (cleanPolicy?.ok && trackedPolicy?.ok && cleanPolicy.resolvedPath === trackedPolicy.resolvedPath)
        || await resolvesToSamePath(savePath, trackedPath)
      )
    ) {
      return err(
        'ALIASED_OUTPUT_PATHS',
        `Refusing to save: clean and tracked output destinations resolve to the same path (${savePath})`,
        "Provide distinct paths for clean and tracked outputs, or set save_format='clean' or 'tracked'.",
      );
    }

    const filesToWrite: Array<{ destination: string; buffer: Buffer }> = [];
    if (format === 'clean' || format === 'both') {
      filesToWrite.push({ destination: savePath, buffer: revisedBuffer });
    }
    if ((format === 'tracked' || format === 'both') && trackedPath && trackedBuffer) {
      filesToWrite.push({ destination: trackedPath, buffer: trackedBuffer });
    }

    await stageAndPublishFiles(filesToWrite, params._testHooks);

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
    if (e instanceof SaveStageError) {
      if (e.rollbackFailures.length > 0) {
        const failedPaths = e.rollbackFailures.map((r) => r.path);
        return {
          ...err(
            'SAVE_ERROR',
            `Failed to save (${e.message}) and rollback failed for path(s): ${failedPaths.join(', ')}`,
            'Manual recovery may be required for the affected paths.',
          ),
          rollback_failures: e.rollbackFailures,
        };
      }
      const origCode = String(errorCode(e.originalError) ?? '').toUpperCase();
      if (origCode === 'EACCES') {
        return err('PERMISSION_DENIED', `Cannot write to: ${params.save_to_local_path}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
      }
      return err('SAVE_ERROR', `Failed to save: ${e.message}`, 'Check the path is valid and writable.');
    }

    const msg = errorMessage(e);
    if (String(errorCode(e) ?? '').toUpperCase() === 'EACCES') {
      return err('PERMISSION_DENIED', `Cannot write to: ${params.save_to_local_path}`, 'Try saving to ~/Downloads/ or ~/Documents/ instead.');
    }
    return err('SAVE_ERROR', `Failed to save: ${msg}`, 'Check the path is valid and writable.');
  }
}
