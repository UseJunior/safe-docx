import { extractRevisions } from '@usejunior/docx-core';
import { errorCode, errorMessage } from "../error_utils.js";
import { SessionManager } from '../session/manager.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function extractRevisions_tool(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    offset?: number;
    limit?: number;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'extract_revisions' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  // Validate limit
  const limit = params.limit ?? 50;
  if (typeof limit !== 'number' || limit < 1 || limit > 500) {
    return err('INVALID_LIMIT', `limit must be between 1 and 500, got ${limit}`, 'Provide a limit in the range 1–500.');
  }

  // Validate offset
  const offset = params.offset ?? 0;
  if (typeof offset !== 'number' || offset < 0) {
    return err('INVALID_OFFSET', `offset must be >= 0, got ${offset}`, 'Provide a non-negative offset.');
  }

  try {
    // Check extraction cache
    const cached = manager.getExtractionCache(session);
    let allChanges;

    if (cached) {
      allChanges = cached.changes;
    } else {
      // Compute extraction from DOM clones
      const docClone = session.doc.getDocumentXmlClone();
      const comments = await session.doc.getComments();
      const result = extractRevisions(docClone, comments);
      allChanges = result.changes;
      // Cache the full result for pagination
      manager.setExtractionCache(session, allChanges);
    }

    // Apply pagination
    const totalChanges = allChanges.length;
    const page = allChanges.slice(offset, offset + limit);
    const hasMore = offset + limit < totalChanges;

    return ok(mergeSessionResolutionMetadata({
      changes: page,
      total_changes: totalChanges,
      has_more: hasMore,
      edit_revision: session.editRevision,
      session_id: session.sessionId,
    }, metadata));
  } catch (e: unknown) {
    return err('EXTRACTION_ERROR', errorMessage(e));
  }
}
