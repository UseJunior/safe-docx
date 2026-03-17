import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';

export async function getFileStatus(
  manager: SessionManager,
  params: { file_path?: string },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'get_file_status' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;
    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      created_at: session.createdAt.toISOString(),
      expires_at: session.expiresAt.toISOString(),
      last_activity: session.lastAccessedAt.toISOString(),
      edit_count: session.editCount,
      edit_revision: session.editRevision,
      cached_save_artifacts: session.saveCache.size,
      save_defaults: {
        default_variants: ['clean', 'redline'],
        default_save_format: 'both',
        supports_variant_override: true,
      },
      document: { filename: session.filename },
      normalization: session.normalizationStats
        ? {
            runs_merged: session.normalizationStats.runsMerged,
            proof_errors_removed: session.normalizationStats.proofErrRemoved,
            redlines_simplified: session.normalizationStats.wrappersConsolidated,
            double_elevations_fixed: session.normalizationStats.doubleElevationsFixed,
            normalization_skipped: false,
          }
        : { runs_merged: 0, redlines_simplified: 0, double_elevations_fixed: 0, normalization_skipped: true },
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('STATUS_ERROR', msg);
  }
}
