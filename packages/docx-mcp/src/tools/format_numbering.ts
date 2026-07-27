import {
  ParagraphNumberingMutationError,
  type DirectParagraphNumbering,
} from '@usejunior/docx-core';
import { errorMessage } from '../error_utils.js';
import { getRevisionContextForSession, type SessionManager } from '../session/manager.js';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';

export type FormatNumberingParams = {
  file_path?: string;
  target_paragraph_id?: unknown;
  remove?: unknown;
  match_paragraph_id?: unknown;
  num_id?: unknown;
  ilvl?: unknown;
};

type ParsedOperation =
  | { kind: 'remove'; numbering: null }
  | { kind: 'match'; sourceParagraphId: string; numbering: DirectParagraphNumbering }
  | { kind: 'set'; numbering: DirectParagraphNumbering };

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function mutationHint(code: ParagraphNumberingMutationError['code']): string {
  switch (code) {
    case 'PARAGRAPH_NOT_FOUND':
      return 'Re-read the document and pass a current paragraph anchor.';
    case 'INCOMPLETE_NUMBERING':
      return 'Choose a source paragraph with a complete direct num_id and ilvl, or repair the malformed OOXML first.';
    case 'NUMBERING_PART_MISSING':
      return 'Choose a paragraph from a DOCX that already contains numbering definitions.';
    case 'NUMBERING_INSTANCE_NOT_FOUND':
    case 'ABSTRACT_NUMBERING_NOT_FOUND':
      return 'Use read_file to select an existing paragraph numbering reference from this document.';
    case 'NUMBERING_LEVEL_NOT_FOUND':
      return 'Use a level that exists on the selected numbering instance, or match a valid numbered paragraph.';
    case 'INVALID_NUMBERING_REFERENCE':
      return 'Pass num_id as a positive decimal string and ilvl as a non-negative integer.';
  }
}

function parseTargetParagraphId(value: unknown): string | ToolResponse {
  const target = nonEmptyString(value);
  if (!target) {
    return err(
      'VALIDATION_ERROR',
      'target_paragraph_id must be a non-empty string.',
      'Pass a paragraph anchor returned by read_file.',
    );
  }
  return target;
}

function isToolResponse(value: string | ToolResponse): value is ToolResponse {
  return typeof value !== 'string';
}

function parseOperationShape(params: FormatNumberingParams):
  | { kind: 'remove' }
  | { kind: 'match'; sourceParagraphId: string }
  | { kind: 'set'; numbering: DirectParagraphNumbering }
  | ToolResponse {
  if (params.remove !== undefined && typeof params.remove !== 'boolean') {
    return err('VALIDATION_ERROR', 'remove must be a boolean.', 'Pass remove=true, or omit remove.');
  }

  const removeSelected = params.remove === true;
  const matchProvided = params.match_paragraph_id !== undefined;
  const directProvided = params.num_id !== undefined || params.ilvl !== undefined;
  const selectedCount = Number(removeSelected) + Number(matchProvided) + Number(directProvided);
  if (selectedCount !== 1) {
    return err(
      'VALIDATION_ERROR',
      'Provide exactly one numbering operation: remove, match_paragraph_id, or num_id with ilvl.',
      'Use remove=true; or match_paragraph_id="_bk_..."; or provide both num_id="..." and ilvl=0.',
    );
  }

  if (removeSelected) return { kind: 'remove' };

  if (matchProvided) {
    const sourceParagraphId = nonEmptyString(params.match_paragraph_id);
    if (!sourceParagraphId) {
      return err(
        'VALIDATION_ERROR',
        'match_paragraph_id must be a non-empty string.',
        'Pass an anchored paragraph with complete direct numbering.',
      );
    }
    return { kind: 'match', sourceParagraphId };
  }

  if (typeof params.num_id !== 'string' || !/^[1-9]\d*$/.test(params.num_id)) {
    return err(
      'VALIDATION_ERROR',
      'num_id must be a positive decimal string.',
      'Pass both num_id="..." and ilvl=0 using an existing reference from read_file.',
    );
  }
  if (
    typeof params.ilvl !== 'number'
    || !Number.isSafeInteger(params.ilvl)
    || params.ilvl < 0
  ) {
    return err(
      'VALIDATION_ERROR',
      'ilvl must be a non-negative safe integer.',
      'Pass both num_id="..." and an existing ilvl such as 0.',
    );
  }
  return {
    kind: 'set',
    numbering: { numId: params.num_id, ilvl: params.ilvl },
  };
}

export async function formatNumbering(
  manager: SessionManager,
  params: FormatNumberingParams,
): Promise<ToolResponse> {
  try {
    const targetParagraphId = parseTargetParagraphId(params.target_paragraph_id);
    if (isToolResponse(targetParagraphId)) return targetParagraphId;

    const operationShape = parseOperationShape(params);
    if ('success' in operationShape) return operationShape;

    const resolved = await resolveSessionForTool(manager, params, {
      toolName: 'format_numbering',
    });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    let operation: ParsedOperation;
    if (operationShape.kind === 'remove') {
      operation = { kind: 'remove', numbering: null };
    } else if (operationShape.kind === 'set') {
      operation = operationShape;
    } else {
      const numbering = session.doc.getDirectParagraphNumbering(
        operationShape.sourceParagraphId,
      );
      if (!numbering) {
        return err(
          'SOURCE_NUMBERING_NOT_DIRECT',
          `Paragraph '${operationShape.sourceParagraphId}' has no direct w:numPr.`,
          'Choose a source whose read_file numbering is explicit, or pass num_id with ilvl directly.',
        );
      }
      operation = {
        kind: 'match',
        sourceParagraphId: operationShape.sourceParagraphId,
        numbering,
      };
    }

    // Resolve the target before allocating revision metadata, and validate the
    // requested numbering through the same primitive used for the live edit.
    if (!session.doc.getParagraphElementById(targetParagraphId)) {
      return err(
        'PARAGRAPH_NOT_FOUND',
        `Paragraph '${targetParagraphId}' was not found.`,
        'Re-read the document and pass a current paragraph anchor.',
      );
    }
    const ctx = await getRevisionContextForSession(session);
    const revisionPreflight = await preflightAiRevisionMutation(
      session,
      ctx,
      (previewDoc, previewCtx) => {
        previewDoc.setDirectParagraphNumbering(
          { paragraphId: targetParagraphId, numbering: operation.numbering },
          previewCtx,
        );
      },
    );
    if (revisionPreflight) return revisionPreflight;

    const paragraphCountBefore = session.doc.getParagraphs().length;
    const result = session.doc.setDirectParagraphNumbering(
      { paragraphId: targetParagraphId, numbering: operation.numbering },
      ctx,
    );
    const paragraphCountAfter = session.doc.getParagraphs().length;
    if (paragraphCountBefore !== paragraphCountAfter) {
      return err(
        'INVARIANT_VIOLATION',
        `Numbering formatting changed paragraph count (${paragraphCountBefore} -> ${paragraphCountAfter}).`,
        'Paragraph numbering mutations must preserve document structure.',
      );
    }

    if (result.changed) manager.markEdited(session);
    manager.touch(session);

    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      target_paragraph_id: targetParagraphId,
      operation: operation.kind,
      match_paragraph_id: operation.kind === 'match'
        ? operation.sourceParagraphId
        : undefined,
      changed: result.changed,
      previous_numbering: result.previous
        ? { num_id: result.previous.numId, ilvl: result.previous.ilvl }
        : null,
      resulting_numbering: result.current
        ? { num_id: result.current.numId, ilvl: result.current.ilvl }
        : null,
      warning: result.warning,
      paragraph_count_before: paragraphCountBefore,
      paragraph_count_after: paragraphCountAfter,
      message: result.changed
        ? 'Paragraph direct numbering updated with a tracked property change.'
        : 'Paragraph direct numbering already matched the requested state; no edit was recorded.',
    }, metadata));
  } catch (error: unknown) {
    if (error instanceof ParagraphNumberingMutationError) {
      return err(error.code, error.message, mutationHint(error.code));
    }
    return err(
      'FORMAT_NUMBERING_ERROR',
      `Failed to apply paragraph numbering: ${errorMessage(error)}`,
      'Check paragraph anchors and numbering references, then retry.',
    );
  }
}
