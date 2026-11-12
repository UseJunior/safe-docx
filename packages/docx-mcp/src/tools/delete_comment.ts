import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { ok, err, type ToolResponse } from './types.js';
import { DocxDocument, OOXML, type RevisionContext } from '@usejunior/docx-core';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';

const COMMENT_TOUCHED_CONTEXT = {
  relationshipParts: ['word/_rels/document.xml.rels'],
  sideParts: ['word/comments.xml', 'word/commentsExtended.xml', 'word/people.xml'],
};

// Non-revision parts a comment deletion mutates without a tracked-change
// wrapper. Every deletion touches the comment side parts. When the deleted
// comments carried w:commentRangeStart/End milestones in word/document.xml
// (always for an anchored root; also for Word-authored replies and for an
// orphaned reply that kept its own markers), those milestones are removed as
// structural markers (the reference-run removal is tracked separately as
// w:del). The mode is measured from the milestones actually removed rather
// than inferred from tree position, so the manifest neither under-reports nor
// over-reports document.xml (#1353: an orphaned reply without markers is listed
// at the top level of the tree but has nothing in the body to remove).
const COMMENT_SIDE_PARTS = ['word/comments.xml', 'word/commentsExtended.xml'];

function countCommentRangeMilestones(doc: DocxDocument): number {
  const documentXml = doc.getDocumentXmlClone();
  return documentXml.getElementsByTagNameNS(OOXML.W_NS, 'commentRangeStart').length
    + documentXml.getElementsByTagNameNS(OOXML.W_NS, 'commentRangeEnd').length;
}

export async function deleteComment(
  manager: SessionManager,
  params: {
    file_path?: string;
    comment_id?: number;
  },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'delete_comment' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;
  return await manager.mutateSession(session, async (session) => {
    const ctx = await getRevisionContextForSession(session);

    if (params.comment_id == null) {
      return err('MISSING_PARAMETER', 'comment_id is required.', 'Provide the comment ID to delete.');
    }

    try {
      const mutate = (doc: DocxDocument, activeCtx: RevisionContext | undefined) =>
        doc.deleteComment({ commentId: params.comment_id! }, activeCtx);

      const revisionPreflight = await preflightAiRevisionMutation(session, ctx, mutate, COMMENT_TOUCHED_CONTEXT);
      if (revisionPreflight.blocked) return revisionPreflight.blocked;

      const milestonesBefore = countCommentRangeMilestones(session.doc);

      await mutate(session.doc, ctx);

      const anchored = countCommentRangeMilestones(session.doc) < milestonesBefore;

      manager.markEdited(session);
      // The removed body-story w:commentReference run is wrapped in w:del (Table
      // A). Removing the comment/reply body text from comments.xml and the reply
      // graph from commentsExtended.xml — and, for a root comment, the structural
      // w:commentRangeStart/End milestones from document.xml — is package-mutation
      // cleanup with no revision wrapper (#122): record it.
      manager.recordNonRevisionChange(session, {
        tool: 'delete_comment',
        parts: anchored ? ['word/document.xml', ...COMMENT_SIDE_PARTS] : [...COMMENT_SIDE_PARTS],
        description: anchored
          ? `Comment ${params.comment_id} and its threaded replies removed from comment side parts (comments.xml, commentsExtended.xml); their w:commentRangeStart/End milestones were removed from word/document.xml as structural markers (the body-story reference removal is tracked separately as a w:del revision).`
          : `Comment ${params.comment_id} and its threaded replies removed from comment side parts (comments.xml, commentsExtended.xml). The deleted comments had no body range markers, so this package-mutation leaves word/document.xml untouched.`,
      });
      return ok(mergeSessionResolutionMetadata({
        comment_id: params.comment_id,
        file_path: manager.normalizePath(session.originalPath),
      }, metadata));
    } catch (e: unknown) {
      const msg = errorMessage(e);
      if (msg.includes('not found')) {
        return err('COMMENT_NOT_FOUND', msg, 'Use get_comments to list available comments.');
      }
      return err('COMMENT_ERROR', msg);
    }
  });
}
