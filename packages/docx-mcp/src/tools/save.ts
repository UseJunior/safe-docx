import path from 'node:path';
import { errorCode, errorMessage } from "../error_utils.js";
import fs from 'node:fs/promises';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import {
  DocxZip,
  TRACKED_CHANGE_ELEMENT_NAME_SET,
  compareDocuments,
  parseXml,
  restoreUntouchedBlocks,
  serializeXml,
  type CompareOptions,
  type CompareResult,
} from '@usejunior/docx-core';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { getAiRevisionBaseline, splitIntroducedDiagnostics } from './ai_revision_guard.js';
import { enforceWritePathPolicy, resolvesToSamePath } from './path_policy.js';
import { DEFAULT_RECONSTRUCTION_MODE } from './comparison_defaults.js';

type SaveFormat = 'clean' | 'tracked' | 'both';
type SaveRevisionSummary = { count: number; author: string; ids?: number[] };

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
 * Restoration is best-effort: on any failure the tracked artifact degrades to
 * the unrestored comparison output (the pre-restore behavior), which is valid
 * — just fully re-serialized. The error is returned rather than thrown so the
 * save still succeeds, but callers must surface it: a swallowed error is
 * indistinguishable from "document fully edited, nothing to restore"
 * (`blocksRestored: 0` reads as benign), so a restore-path regression would
 * otherwise go dark.
 *
 * Exported for direct testing of the failure path; production callers go
 * through `save`.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/436
 */
export async function restoreTrackedUntouchedBlocks(
  trackedBuffer: Buffer,
  originalBuffer: Buffer,
): Promise<{ buffer: Buffer; blocksRestored: number; restoreError?: string }> {
  try {
    const [trackedZip, originalZip] = await Promise.all([
      DocxZip.load(trackedBuffer),
      DocxZip.load(originalBuffer),
    ]);
    const [trackedXml, originalXml] = await Promise.all([
      trackedZip.readText('word/document.xml'),
      originalZip.readText('word/document.xml'),
    ]);
    const trackedDoc = parseXml(trackedXml);
    const blocksRestored = restoreUntouchedBlocks(trackedDoc, originalXml);
    if (blocksRestored === 0) {
      return { buffer: trackedBuffer, blocksRestored };
    }

    trackedZip.writeText('word/document.xml', serializeXml(trackedDoc));
    return { buffer: await trackedZip.toBuffer(), blocksRestored };
  } catch (e: unknown) {
    return { buffer: trackedBuffer, blocksRestored: 0, restoreError: errorMessage(e) };
  }
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
    tracked_changes_engine?: CompareOptions['engine'];
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

    const engine = params.tracked_changes_engine ?? 'atomizer';
    if (engine !== 'auto' && engine !== 'atomizer' && engine !== 'wmlcomparer') {
      return err('INVALID_TRACKED_ENGINE', `Invalid tracked_changes_engine: ${String(engine)}`, "Use one of: 'auto' or 'atomizer'.");
    }
    if (engine === 'wmlcomparer') {
      return err('INVALID_TRACKED_ENGINE', "tracked_changes_engine 'wmlcomparer' is not supported here", "Use 'auto' or 'atomizer'.");
    }
    const trackedEngine: CompareOptions['engine'] = engine;

    const clean = params.clean_bookmarks ?? true;
    const author = params.tracked_changes_author ?? params.author ?? 'SafeDocX';
    const allowOverwrite = params.allow_overwrite ?? false;
    const cacheKey = JSON.stringify({
      revision: session.editRevision,
      format,
      clean_bookmarks: clean,
      tracked_engine: trackedEngine,
      tracked_author: author,
    });

    const cached = manager.getSaveCache(session, cacheKey);
    const cacheHit = cached !== null;

    let revisedBuffer: Buffer;
    let trackedBuffer: Buffer | null;
    let trackedStats: { insertions: number; deletions: number; modifications: number } | null;
    let trackedReconstructionMode: CompareResult['reconstructionModeUsed'];
    let trackedFallbackReason: CompareResult['fallbackReason'];
    let trackedFallbackDiagnostics: CompareResult['fallbackDiagnostics'];
    let bookmarksRemoved: number;
    let blocksRestored: number;
    let trackedBlocksRestored: number;
    let trackedRestoreError: string | undefined;
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
      trackedReconstructionMode = cached.trackedReconstructionMode;
      trackedFallbackReason = cached.trackedFallbackReason;
      trackedFallbackDiagnostics = cached.trackedFallbackDiagnostics;
      bookmarksRemoved = cached.bookmarksRemoved;
      blocksRestored = cached.blocksRestored;
      trackedBlocksRestored = cached.trackedBlocksRestored;
      trackedRestoreError = cached.trackedRestoreError;
      exportTimestamp = cached.exportedAtUtc;
    } else {
      // The clean artifact is the minimal one: untouched body blocks are
      // restored element-for-element from the original document.xml so the
      // on-disk diff matches the edit's actual blast radius.
      const revised = await session.doc.toBuffer({ cleanBookmarks: clean, minimalReserialization: clean });
      revisedBuffer = revised.buffer;
      bookmarksRemoved = revised.bookmarksRemoved;
      blocksRestored = revised.blocksRestored;
      trackedBuffer = null;
      trackedStats = null;
      trackedReconstructionMode = undefined;
      trackedFallbackReason = undefined;
      trackedFallbackDiagnostics = undefined;
      exportTimestamp = formatUtcTimestamp(new Date());
      trackedBlocksRestored = 0;
      trackedRestoreError = undefined;

      if (format === 'tracked' || format === 'both') {
        // Lazily generate comparison baselines if not yet available.
        await manager.ensureBaselines(session);
        const baselineBuffer = session.comparisonBaseline ?? session.originalBuffer;
        // The comparison input must stay fully normalized: the baseline is
        // normalized, and the atomizer compares normalized-vs-normalized.
        // Generated sequentially — toBuffer() swaps shared zip state, so
        // concurrent calls on one document are unsafe.
        const comparisonRevisedBuffer = clean
          ? (await session.doc.toBuffer({ cleanBookmarks: clean })).buffer
          : revisedBuffer;
        const trackedRes = await runWithoutConsoleLog(() =>
          compareDocuments(baselineBuffer, comparisonRevisedBuffer, {
            author,
            engine: trackedEngine,
            reconstructionMode: DEFAULT_RECONSTRUCTION_MODE,
          }),
        );
        const restoredTracked = await restoreTrackedUntouchedBlocks(trackedRes.document, session.originalBuffer);
        trackedBuffer = restoredTracked.buffer;
        trackedBlocksRestored = restoredTracked.blocksRestored;
        trackedRestoreError = restoredTracked.restoreError;
        trackedStats = trackedRes.stats;
        trackedReconstructionMode = trackedRes.reconstructionModeUsed;
        trackedFallbackReason = trackedRes.fallbackReason;
        trackedFallbackDiagnostics = trackedRes.fallbackDiagnostics;
      }

      if (params.fail_on_rebuild_fallback && trackedReconstructionMode === 'rebuild') {
        return err(
          'REBUILD_FALLBACK',
          'Tracked output would use rebuild mode which destroys table structure. ' +
            (trackedFallbackReason ? `Reason: ${trackedFallbackReason}.` : ''),
          "Use save_format: 'clean' or fix the document to pass inplace safety checks.",
        );
      }

      manager.setSaveCache(session, {
        cacheKey,
        revision: session.editRevision,
        format,
        cleanBookmarks: clean,
        trackedEngine,
        trackedAuthor: author,
        revisedBuffer,
        trackedBuffer,
        trackedStats,
        trackedReconstructionMode,
        trackedFallbackReason,
        trackedFallbackDiagnostics,
        bookmarksRemoved: clean ? bookmarksRemoved : 0,
        blocksRestored,
        trackedBlocksRestored,
        trackedRestoreError,
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

    const revisions = format === 'tracked'
      ? undefined
      : await collectAiRevisionSummary(revisedBuffer, session.aiAuthor);

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
      tracked_changes_engine: format === 'tracked' || format === 'both' ? trackedEngine : undefined,
      tracked_changes_author: format === 'tracked' || format === 'both' ? author : undefined,
      tracked_changes_stats: trackedStats ?? undefined,
      tracked_reconstruction_mode: trackedReconstructionMode,
      tracked_fallback_reason: trackedFallbackReason,
      tracked_fallback_diagnostics: trackedFallbackDiagnostics,
      tracked_rebuild_warning: trackedReconstructionMode === 'rebuild'
        ? 'Rebuild mode was used which may alter document structure (tables, fonts, etc.)'
        : undefined,
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
      tracked_blocks_restored: trackedBlocksRestored,
      tracked_restore_error: trackedRestoreError,
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
        (trackedReconstructionMode === 'rebuild' ? 'WARNING: Tracked output used REBUILD mode which may alter table structure and fonts. Verify tables in Word. ' : '') +
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
