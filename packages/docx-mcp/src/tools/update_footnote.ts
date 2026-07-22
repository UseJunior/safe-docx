import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { DocxDocument, type RevisionContext } from '@usejunior/docx-core';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';

const FOOTNOTE_TOUCHED_CONTEXT = {
  relationshipParts: ['word/_rels/document.xml.rels'],
  sideParts: ['word/footnotes.xml'],
};

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

  if (params.note_id == null) {
    return err('MISSING_PARAMETER', 'note_id is required.', 'Provide the footnote ID to update.');
  }
  if (!params.new_text) {
    return err('MISSING_PARAMETER', 'new_text is required.', 'Provide the new footnote text.');
  }
  const noteId = params.note_id;
  const newText = params.new_text;

  try {
    // Verify footnote exists before updating
    const existing = await session.doc.getFootnote(noteId);
    if (!existing) {
      return err('NOTE_NOT_FOUND', `Footnote ID ${noteId} not found`, 'Use get_footnotes to list available footnotes.');
    }

    const mutate = (doc: DocxDocument, activeCtx: RevisionContext | undefined) => doc.updateFootnoteText({
      noteId,
      newText,
    }, activeCtx);

    const revisionPreflight = await preflightAiRevisionMutation(session, ctx, mutate, FOOTNOTE_TOUCHED_CONTEXT);
    if (revisionPreflight) return revisionPreflight;

    await mutate(session.doc, ctx);

    manager.markEdited(session);
    return ok(mergeSessionResolutionMetadata({
      note_id: noteId,
      file_path: manager.normalizePath(session.originalPath),
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (msg.includes('not found')) {
      return err('NOTE_NOT_FOUND', msg, 'Use get_footnotes to list available footnotes.');
    }
    return err('FOOTNOTE_ERROR', msg);
  }
}
