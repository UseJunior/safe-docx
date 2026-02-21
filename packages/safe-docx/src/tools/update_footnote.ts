import { SessionManager } from '../session/manager.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function updateFootnote(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    note_id?: number;
    new_text?: string;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'update_footnote' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

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

    await session.doc.updateFootnoteText({
      noteId: params.note_id,
      newText: params.new_text,
    });

    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      note_id: params.note_id,
      session_id: session.sessionId,
    }, metadata));
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes('not found')) {
      return err('NOTE_NOT_FOUND', msg, 'Use get_footnotes to list available footnotes.');
    }
    return err('FOOTNOTE_ERROR', msg);
  }
}
