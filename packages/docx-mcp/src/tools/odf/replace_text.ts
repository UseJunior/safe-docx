import { stripAllInlineTags } from '@usejunior/docx-core';
import { type OdfSession, SessionManager } from '../../session/manager.js';
import { RESULT_PREVIEW_CHARS, previewText } from '../preview.js';
import { err, ok, type ToolResponse } from '../types.js';

export async function odfReplaceText(
  manager: SessionManager,
  session: OdfSession,
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

    const result = session.doc.replaceTextById(pid, oldStr, newStr);
    if (!result.ok) {
      return err(result.code, result.message);
    }
    manager.markEdited(session);

    const afterText = session.doc.getParagraphTextById(pid) ?? '';

    return ok({
      file_path: session.originalPath,
      provider: 'odf',
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
    if (msg.includes('MATCH_SPANS_MULTIPLE_NODES')) return err('MATCH_SPANS_MULTIPLE_NODES', msg);
    return err('EDIT_ERROR', `Failed to edit ODF document: ${msg}`);
  }
}
