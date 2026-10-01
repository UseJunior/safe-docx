import { SessionManager } from '../session/manager.js';
import { errorMessage } from '../error_utils.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { revisionResultChangedDocument } from './revision_result.js';
import { AmbiguousRevisionOverlapError } from '@usejunior/docx-core';

/**
 * reject_ai_edits — selectively reject tracked changes by revision id or author
 * (#123), restoring their pre-edit state while leaving all other revisions
 * untouched. Symmetric to accept_ai_edits.
 */
export async function rejectAiEdits(
  manager: SessionManager,
  params: {
    file_path?: string;
    revision_ids?: Array<string | number>;
    author?: string;
    normalize_first?: boolean;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'reject_ai_edits' });
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
    const { result, selectedIds } = await session.doc.rejectAIEdits({
      revisionIds: params.revision_ids,
      author: params.author,
      normalizeFirst: params.normalize_first,
    });
    // A selector that resolved nothing must not look like an edit (#1084), and
    // a call that changed nothing has nothing to persist: it records no
    // selective action (which would make a later clean save fail with
    // SELECTIVE_REVISIONS_WOULD_BE_DISCARDED) and echoes no ids as selected.
    // The result counts are what prove a change; selectedIds lists only the
    // requested ids that named a revision present in the document (#1099).
    const changed = revisionResultChangedDocument(result);
    const effectiveIds = changed ? selectedIds : [];
    if (changed) {
      manager.markEdited(session);
      manager.recordSelectiveRevisionAction(session, {
        tool: 'reject_ai_edits',
        selector: hasIds ? 'revision_ids' : 'author',
        selectedRevisionIds: effectiveIds,
      });
    }
    return ok(mergeSessionResolutionMetadata({
      ...result,
      selected_revision_ids: effectiveIds,
      file_path: manager.normalizePath(session.originalPath),
      persistence_required: changed,
      ...(changed
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
    return err('REJECT_AI_EDITS_ERROR', errorMessage(e));
  }
}
