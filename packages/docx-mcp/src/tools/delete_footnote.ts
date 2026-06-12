import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { beginGuardedAiWrite, type AiWriteGuard } from '../session/post_write_guard.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function deleteFootnote(
  manager: SessionManager,
  params: {
    file_path?: string;
    note_id?: number;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'delete_footnote' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;
  const ctx = await getRevisionContextForSession(session);
  let guard: AiWriteGuard | null = null;

  if (params.note_id == null) {
    return err('MISSING_PARAMETER', 'note_id is required.', 'Provide the footnote ID to delete.');
  }

  try {
    guard = ctx ? await beginGuardedAiWrite(session) : null;
    await session.doc.deleteFootnote({ noteId: params.note_id }, ctx);

    const validationFailure = guard ? await guard.verify() : null;
    if (validationFailure) return validationFailure;
    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      note_id: params.note_id,
      file_path: manager.normalizePath(session.originalPath),
    }, metadata));
  } catch (e: unknown) {
    if (guard) await guard.rollback();
    const msg = errorMessage(e);
    if (msg.includes('reserved')) {
      return err('RESERVED_TYPE', msg, 'Reserved footnotes (separator, continuationSeparator) cannot be deleted.');
    }
    if (msg.includes('Missing file in .docx: word/footnotes.xml')) {
      return err('NOTE_NOT_FOUND', `Footnote ID ${params.note_id} not found`, 'Use get_footnotes to list available footnotes.');
    }
    if (msg.includes('not found')) {
      return err('NOTE_NOT_FOUND', msg, 'Use get_footnotes to list available footnotes.');
    }
    return err('FOOTNOTE_ERROR', msg);
  }
}
