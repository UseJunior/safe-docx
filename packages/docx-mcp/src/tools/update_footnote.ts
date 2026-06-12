import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { beginGuardedAiWrite, rollbackGuardedAiWrite, type AiWriteGuard } from '../session/post_write_guard.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function updateFootnote(
  manager: SessionManager,
  params: {
    file_path?: string;
    note_id?: number;
    new_text?: string;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'update_footnote' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;
  const ctx = await getRevisionContextForSession(session);
  let guard: AiWriteGuard | null = null;

  if (params.note_id == null) {
    return err('MISSING_PARAMETER', 'note_id is required.', 'Provide the footnote ID to update.');
  }
  if (!params.new_text) {
    return err('MISSING_PARAMETER', 'new_text is required.', 'Provide the new footnote text.');
  }

  try {
    // Verify footnote exists before updating
    const existing = await session.doc.getFootnote(params.note_id);
    if (!existing) {
      return err('NOTE_NOT_FOUND', `Footnote ID ${params.note_id} not found`, 'Use get_footnotes to list available footnotes.');
    }

    guard = ctx ? await beginGuardedAiWrite(session) : null;
    await session.doc.updateFootnoteText({
      noteId: params.note_id,
      newText: params.new_text,
    }, ctx);

    const validationFailure = guard ? await guard.verify() : null;
    if (validationFailure) return validationFailure;
    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      note_id: params.note_id,
      file_path: manager.normalizePath(session.originalPath),
    }, metadata));
  } catch (e: unknown) {
    const guardFailure = await rollbackGuardedAiWrite(guard, e);
    if (guardFailure) return guardFailure;
    const msg = errorMessage(e);
    if (msg.includes('not found')) {
      return err('NOTE_NOT_FOUND', msg, 'Use get_footnotes to list available footnotes.');
    }
    return err('FOOTNOTE_ERROR', msg);
  }
}
