import { stripAllInlineTags } from '@usejunior/docx-core';
import { type OdfSession, SessionManager } from '../../session/manager.js';
import { errorMessage } from '../../error_utils.js';
import { RESULT_PREVIEW_CHARS, previewText } from '../preview.js';
import { err, ok, type ToolResponse } from '../types.js';

/**
 * ODF (.odt) `insert_paragraph`. Inserts plain-text paragraph(s) BEFORE/AFTER an anchor.
 * `new_string` is split on blank lines into separate paragraphs; single newlines become
 * line breaks (parity with the DOCX tool). DOCX run-formatting tags are not yet supported
 * for ODF and are stripped.
 *
 * IMPORTANT: ODF paragraph IDs are positional ordinals, so inserting shifts every ID at or
 * after the insertion point. The response carries machine-actionable invalidation fields so
 * the agent re-reads before its next edit.
 */
export async function odfInsertParagraph(
  manager: SessionManager,
  session: OdfSession,
  params: { positional_anchor_node_id: string; new_string: string; instruction: string; position?: string },
  metadata: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const anchorId = params.positional_anchor_node_id;
    const positionUpper = (params.position ?? 'AFTER').toUpperCase();
    if (positionUpper !== 'BEFORE' && positionUpper !== 'AFTER') {
      return err('INVALID_POSITION', `Invalid position: ${params.position}. Must be 'BEFORE' or 'AFTER'.`);
    }

    const text = stripAllInlineTags(params.new_string ?? '');

    const result = session.doc.insertParagraph(anchorId, text, positionUpper as 'BEFORE' | 'AFTER');
    if (!result.ok) {
      return err(result.code, result.message);
    }
    manager.markEdited(session);

    const newIds = result.newIds;
    return ok({
      success: true,
      file_path: session.originalPath,
      provider: 'odf',
      edit_count: session.editCount,
      anchor_paragraph_id: anchorId,
      new_paragraph_id: newIds[0] ?? null,
      new_paragraph_ids: newIds,
      position: positionUpper,
      inserted_text: previewText(text, RESULT_PREVIEW_CHARS),
      // ODF IDs are positional; everything at/after the insertion point has shifted.
      invalidates_paragraph_ids_after: anchorId,
      requires_reread_before_next_edit: true,
      ids_note:
        'ODF paragraph IDs are positional and have shifted after this insertion. Call read_file or grep again to get current IDs before your next edit.',
      ...metadata,
    });
  } catch (e: unknown) {
    return err('INSERT_ERROR', `Failed to insert paragraph into ODF document: ${errorMessage(e)}`);
  }
}
