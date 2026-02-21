import { SessionManager } from '../session/manager.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function deleteFootnote(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    note_id?: number;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'delete_footnote' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  if (params.note_id == null) {
    return err('MISSING_PARAMETER', 'note_id is required.', 'Provide the footnote ID to delete.');
  }

  try {
    await session.doc.deleteFootnote({ noteId: params.note_id });

    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      note_id: params.note_id,
      session_id: session.sessionId,
    }, metadata));
  } catch (e: any) {
    const msg = e?.message ?? String(e);
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
