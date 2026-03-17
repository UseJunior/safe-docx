import { type GDocsSession, SessionManager } from '../../session/manager.js';
import { err, ok, type ToolResponse } from '../types.js';
import { RESULT_PREVIEW_CHARS, previewText } from '../preview.js';
import { stripAllInlineTags } from '@usejunior/docx-core';

export async function gdocsInsertParagraph(
  manager: SessionManager,
  session: GDocsSession,
  params: { positional_anchor_node_id: string; new_string: string; instruction: string; position?: string },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const anchorId = params.positional_anchor_node_id;
    const positionUpper = (params.position ?? 'AFTER').toUpperCase();
    if (positionUpper !== 'BEFORE' && positionUpper !== 'AFTER') {
      return err('INVALID_POSITION', `Invalid position: ${params.position}. Must be 'BEFORE' or 'AFTER'.`);
    }

    const anchorText = session.doc.getParagraphTextById(anchorId);
    if (anchorText === null) {
      return err('ANCHOR_NOT_FOUND', `Paragraph ID ${anchorId} not found in document`);
    }

    const plainText = stripAllInlineTags(params.new_string);
    const result = await session.doc.insertParagraph(anchorId, positionUpper as 'BEFORE' | 'AFTER', plainText);
    manager.markEdited(session);

    return ok({
      google_doc_id: session.docId,
      edit_count: session.editCount,
      anchor_paragraph_id: anchorId,
      new_paragraph_id: result.newAnchorId,
      position: positionUpper,
      inserted_text: previewText(plainText, RESULT_PREVIEW_CHARS),
      ...metadata,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('ANCHOR_NOT_FOUND')) return err('ANCHOR_NOT_FOUND', msg);
    return err('INSERT_ERROR', `Failed to insert paragraph: ${msg}`);
  }
}
