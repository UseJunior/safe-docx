import { SessionManager } from '../session/manager.js';
import { errorMessage } from '../error_utils.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { AmbiguousRevisionOverlapError } from '@usejunior/docx-core';

/**
 * accept_ai_edits — selectively accept tracked changes by revision id or author
 * (#123), leaving all other (e.g. third-party reviewer) revisions untouched.
 */
export async function acceptAiEdits(
  manager: SessionManager,
  params: {
    file_path?: string;
    revision_ids?: Array<string | number>;
    author?: string;
    normalize_first?: boolean;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'accept_ai_edits' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  const hasIds = Array.isArray(params.revision_ids) && params.revision_ids.length > 0;
  if (!hasIds && (params.author == null || params.author === '')) {
    return err(
      'MISSING_PARAMETER',
      'Provide revision_ids or author.',
      "Target specific w:id values with revision_ids, or every revision by one actor with author.",
    );
  }

  try {
    const { result, selectedIds } = await session.doc.acceptAIEdits({
      revisionIds: params.revision_ids,
      author: params.author,
      normalizeFirst: params.normalize_first,
    });
    manager.markEdited(session);
    if (selectedIds.length > 0) {
      manager.recordSelectiveRevisionAction(session, {
        tool: 'accept_ai_edits',
        selector: hasIds ? 'revision_ids' : 'author',
        selectedRevisionIds: selectedIds,
      });
    }
    return ok(mergeSessionResolutionMetadata({
      ...result,
      selected_revision_ids: selectedIds,
      file_path: manager.normalizePath(session.originalPath),
      persistence_required: selectedIds.length > 0,
      ...(selectedIds.length > 0
        ? { next_step: "Call save with save_format='tracked' or 'both' to persist this session-scoped mutation." }
        : {}),
    }, metadata));
  } catch (e: unknown) {
    if (e instanceof AmbiguousRevisionOverlapError) {
      return {
        ...err(
          'AMBIGUOUS_REVISION_OVERLAP',
          e.message,
          'Pass normalize_first=true for best-effort resolution, or target a non-overlapping revision set.',
        ),
        overlaps: e.overlaps,
      };
    }
    return err('ACCEPT_AI_EDITS_ERROR', errorMessage(e));
  }
}
