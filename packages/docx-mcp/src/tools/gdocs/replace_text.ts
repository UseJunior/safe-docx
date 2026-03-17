import { type GDocsSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';
import { RESULT_PREVIEW_CHARS, previewText } from '../preview.js';
import { stripAllInlineTags } from '@usejunior/docx-core';

export async function gdocsReplaceText(
  manager: SessionManager,
  session: GDocsSession,
  params: { target_paragraph_id: string; old_string: string; new_string: string; instruction: string },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const pid = params.target_paragraph_id;
    const oldStr = stripAllInlineTags(params.old_string);
    const newStr = stripAllInlineTags(params.new_string);

    const beforeText = session.doc.getParagraphTextById(pid);
    if (beforeText === null) {
      return err('ANCHOR_NOT_FOUND', `Paragraph ID ${pid} not found in document`);
    }

    await session.doc.replaceText(pid, oldStr, newStr);
    manager.markEdited(session);

    const afterText = session.doc.getParagraphTextById(pid) ?? '';

    return ok({
      google_doc_id: session.docId,
      edit_count: session.editCount,
      target_paragraph_id: pid,
      replacements_made: 1,
      before_text: previewText(beforeText.trim(), RESULT_PREVIEW_CHARS),
      after_text: previewText(afterText.trim(), RESULT_PREVIEW_CHARS),
      ...metadata,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('ANCHOR_NOT_FOUND')) return err('ANCHOR_NOT_FOUND', msg);
    if (msg.includes('TEXT_NOT_FOUND')) return err('TEXT_NOT_FOUND', msg);
    return err('EDIT_ERROR', `Failed to edit Google Doc: ${msg}`);
  }
}
