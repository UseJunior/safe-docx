import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { DocxDocument, findUniqueSubstringMatch, type RevisionContext } from '@usejunior/docx-core';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';

const COMMENT_TOUCHED_CONTEXT = {
  relationshipParts: ['word/_rels/document.xml.rels'],
  sideParts: ['word/comments.xml', 'word/commentsExtended.xml', 'word/people.xml'],
};

// Non-revision parts a *root* comment can mutate without a tracked-change
// wrapper. Unlike the body-story w:commentReference run (which is wrapped in
// w:ins, Table A), the w:commentRangeStart/End milestones are written to
// word/document.xml as structural markers and are NOT revision-wrapped (Word's
// own behavior; see SUPPORT.md Table A note), so document.xml belongs here. The
// content-types and relationship parts are touched only when comment
// infrastructure is bootstrapped; they are declared conservatively so the
// manifest never under-reports a package mutation.
const ROOT_COMMENT_NON_REVISION_PARTS = [
  'word/document.xml',
  'word/comments.xml',
  'word/commentsExtended.xml',
  'word/people.xml',
  '[Content_Types].xml',
  'word/_rels/document.xml.rels',
];

// A threaded reply has no body anchor at all: the entire write is side-part
// metadata (comments.xml text + commentsExtended.xml graph + people.xml), so no
// tracked-change marker is emitted and document.xml is untouched.
const REPLY_COMMENT_NON_REVISION_PARTS = [
  'word/comments.xml',
  'word/commentsExtended.xml',
  'word/people.xml',
];

export async function addComment(
  manager: SessionManager,
  params: {
    file_path?: string;
    target_paragraph_id?: string;
    anchor_text?: string;
    parent_comment_id?: number;
    author: string;
    text: string;
    initials?: string;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'add_comment' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;
  const ctx = await getRevisionContextForSession(session);

  try {
    // Reply mode: parent_comment_id provided
    if (params.parent_comment_id != null) {
      const parentCommentId = params.parent_comment_id;
      const mutate = (doc: DocxDocument, activeCtx: RevisionContext | undefined) => doc.addCommentReply({
        parentCommentId,
        author: params.author,
        text: params.text,
        initials: params.initials,
      }, activeCtx);

      const revisionPreflight = await preflightAiRevisionMutation(
        session,
        ctx,
        async (doc, activeCtx) => { await mutate(doc, activeCtx); },
        COMMENT_TOUCHED_CONTEXT,
      );
      if (revisionPreflight) return revisionPreflight;

      const result = await mutate(session.doc, ctx);
      manager.markEdited(session);
      // Replies have no body anchor, so the whole write is package-mutation
      // side-part metadata (#122): record it in the non-revision manifest.
      manager.recordNonRevisionChange(session, {
        tool: 'add_comment',
        parts: REPLY_COMMENT_NON_REVISION_PARTS,
        description: `Threaded reply to comment ${parentCommentId} written to comment side-story parts (comments.xml, commentsExtended.xml, people.xml). Reply mode is package-mutation only: it has no body anchor, so no tracked-change marker is emitted and word/document.xml is untouched.`,
      });
      return ok(mergeSessionResolutionMetadata({
        comment_id: result.commentId,
        parent_comment_id: result.parentCommentId,
        mode: 'reply',
        file_path: manager.normalizePath(session.originalPath),
      }, metadata));
    }

    // Root comment mode: target_paragraph_id required
    if (!params.target_paragraph_id) {
      return err(
        'MISSING_PARAMETER',
        'Either target_paragraph_id (for root comments) or parent_comment_id (for replies) is required.',
        'Provide target_paragraph_id + optional anchor_text for root comments, or parent_comment_id for threaded replies.',
      );
    }

    const pid = params.target_paragraph_id;
    const pEl = session.doc.getParagraphElementById(pid);
    if (!pEl) {
      return err(
        'ANCHOR_NOT_FOUND',
        `Paragraph ID ${pid} not found in document`,
        'Use grep or read_file to find valid paragraph IDs.',
      );
    }

    let start = 0;
    let end: number;

    if (params.anchor_text) {
      // Find anchor_text within the paragraph
      const paraText = session.doc.getParagraphTextById(pid) ?? '';
      const match = findUniqueSubstringMatch(paraText, params.anchor_text);

      if (match.status === 'not_found') {
        return err(
          'TEXT_NOT_FOUND',
          `anchor_text '${params.anchor_text}' not found in paragraph ${pid}`,
          'Verify anchor_text is present in the target paragraph.',
        );
      }
      if (match.status === 'multiple') {
        return err(
          'MULTIPLE_MATCHES',
          `Found ${match.matchCount} matches for anchor_text in paragraph ${pid}`,
          'Provide more specific anchor_text for a unique match.',
        );
      }

      start = match.start;
      end = match.end;
    } else {
      // Anchor to entire paragraph
      const paraText = session.doc.getParagraphTextById(pid) ?? '';
      end = paraText.length;
    }

    const mutate = (doc: DocxDocument, activeCtx: RevisionContext | undefined) => doc.addComment({
      paragraphId: pid,
      start,
      end,
      author: params.author,
      text: params.text,
      initials: params.initials,
    }, activeCtx);

    const revisionPreflight = await preflightAiRevisionMutation(
      session,
      ctx,
      async (doc, activeCtx) => { await mutate(doc, activeCtx); },
      COMMENT_TOUCHED_CONTEXT,
    );
    if (revisionPreflight) return revisionPreflight;

    const result = await mutate(session.doc, ctx);

    manager.markEdited(session);
    // The body-story w:commentReference run is wrapped in w:ins (Table A), but
    // the comment body text, author metadata, and any comment-infrastructure
    // bootstrap are package-mutation side-part writes with no revision wrapper
    // (#122): record them in the non-revision manifest.
    manager.recordNonRevisionChange(session, {
      tool: 'add_comment',
      parts: ROOT_COMMENT_NON_REVISION_PARTS,
      description: `Comment ${result.commentId}: body text and author metadata written to comment side parts (comments.xml, people.xml), and w:commentRangeStart/End milestones written to word/document.xml as structural markers (not revision-wrapped). Comment infrastructure and its content-type/relationship registration are created when the package lacked them. The body-story w:commentReference run is tracked separately as a w:ins revision.`,
    });
    return ok(mergeSessionResolutionMetadata({
      comment_id: result.commentId,
      anchor_paragraph_id: pid,
      anchor_text: params.anchor_text ?? null,
      mode: 'root',
      file_path: manager.normalizePath(session.originalPath),
    }, metadata));
  } catch (e: unknown) {
    return err('COMMENT_ERROR', errorMessage(e));
  }
}
