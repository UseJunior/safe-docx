import { SessionManager } from '../session/manager.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function getFootnotes(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'get_footnotes' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    const footnotes = await session.doc.getFootnotes();
    return ok(mergeSessionResolutionMetadata({
      footnotes: footnotes.map((f) => ({
        id: f.id,
        display_number: f.displayNumber,
        text: f.text,
        anchored_paragraph_id: f.anchoredParagraphId,
      })),
      session_id: session.sessionId,
    }, metadata));
  } catch (e: any) {
    return err('FOOTNOTE_ERROR', e?.message ?? String(e));
  }
}
