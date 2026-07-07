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

// Non-revision parts add_footnote can mutate without a tracked-change wrapper.
// The note text runs and the body-story w:footnoteReference are wrapped in w:ins
// (Table A), but the <w:footnote> container element appended to footnotes.xml is
// a structural addition with no revision wrapper, and the content-type /
// relationship registration is created when footnote infrastructure is
// bootstrapped. [Content_Types].xml is declared so bootstrap registration is
// never under-reported.
const FOOTNOTE_NON_REVISION_PARTS = [
  'word/footnotes.xml',
  '[Content_Types].xml',
  'word/_rels/document.xml.rels',
];

export async function addFootnote(
  manager: SessionManager,
  params: {
    file_path?: string;
    target_paragraph_id?: string;
    after_text?: string;
    text?: string;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'add_footnote' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;
  const ctx = await getRevisionContextForSession(session);

  if (!params.target_paragraph_id) {
    return err('MISSING_PARAMETER', 'target_paragraph_id is required.', 'Provide the _bk_* ID of the paragraph to anchor the footnote to.');
  }
  if (!params.text) {
    return err('MISSING_PARAMETER', 'text is required.', 'Provide the footnote body text.');
  }

  const pid = params.target_paragraph_id;
  const text = params.text;
  const pEl = session.doc.getParagraphElementById(pid);
  if (!pEl) {
    return err('ANCHOR_NOT_FOUND', `Paragraph ID ${pid} not found in document`, 'Use grep or read_file to find valid paragraph IDs.');
  }

  try {
    const mutate = (doc: DocxDocument, activeCtx: RevisionContext | undefined) => doc.addFootnote({
      paragraphId: pid,
      afterText: params.after_text,
      text,
    }, activeCtx);

    const revisionPreflight = await preflightAiRevisionMutation(
      session,
      ctx,
      async (doc, activeCtx) => { await mutate(doc, activeCtx); },
      FOOTNOTE_TOUCHED_CONTEXT,
    );
    if (revisionPreflight) return revisionPreflight;

    const result = await mutate(session.doc, ctx);

    manager.markEdited(session);
    // The body-story w:footnoteReference and note text are tracked as w:ins
    // (Table A), but creating word/footnotes.xml and registering the part in
    // relationships/content-types is a package mutation with no revision
    // wrapper (#122): record it in the non-revision manifest.
    manager.recordNonRevisionChange(session, {
      tool: 'add_footnote',
      parts: FOOTNOTE_NON_REVISION_PARTS,
      description: `Footnote ${result.noteId}: the <w:footnote> container element is appended to word/footnotes.xml as a structural addition (the note text runs are tracked separately as w:ins). When the document lacked footnote infrastructure, the part and its content-type/relationship registration were bootstrapped. The body-story footnote reference is also tracked as a w:ins revision.`,
    });
    return ok(mergeSessionResolutionMetadata({
      note_id: result.noteId,
      target_paragraph_id: pid,
      after_text: params.after_text ?? null,
      file_path: manager.normalizePath(session.originalPath),
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    if (msg.includes('not found in paragraph')) {
      return err('TEXT_NOT_FOUND', msg, 'Verify after_text is present in the target paragraph.');
    }
    if (msg.includes('found') && msg.includes('times')) {
      return err('MULTIPLE_MATCHES', msg, 'Provide more specific after_text for a unique match.');
    }
    return err('FOOTNOTE_ERROR', msg);
  }
}
