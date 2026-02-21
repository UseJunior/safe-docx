import { SessionManager } from '../session/manager.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';

export async function addFootnote(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    target_paragraph_id?: string;
    after_text?: string;
    text?: string;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'add_footnote' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  if (!params.target_paragraph_id) {
    return err('MISSING_PARAMETER', 'target_paragraph_id is required.', 'Provide the jr_para_* ID of the paragraph to anchor the footnote to.');
  }
  if (!params.text) {
    return err('MISSING_PARAMETER', 'text is required.', 'Provide the footnote body text.');
  }

  const pid = params.target_paragraph_id;
  const pEl = session.doc.getParagraphElementById(pid);
  if (!pEl) {
    return err('ANCHOR_NOT_FOUND', `Paragraph ID ${pid} not found in document`, 'Use grep or read_file to find valid paragraph IDs.');
  }

  try {
    const result = await session.doc.addFootnote({
      paragraphId: pid,
      afterText: params.after_text,
      text: params.text,
    });

    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      note_id: result.noteId,
      target_paragraph_id: pid,
      after_text: params.after_text ?? null,
      session_id: session.sessionId,
    }, metadata));
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes('not found in paragraph')) {
      return err('TEXT_NOT_FOUND', msg, 'Verify after_text is present in the target paragraph.');
    }
    if (msg.includes('found') && msg.includes('times')) {
      return err('MULTIPLE_MATCHES', msg, 'Provide more specific after_text for a unique match.');
    }
    return err('FOOTNOTE_ERROR', msg);
  }
}
