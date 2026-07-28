import { SectionMutationError } from '@usejunior/docx-core';
import { errorMessage } from '../error_utils.js';
import {
  getRevisionContextForSession,
  type SessionManager,
} from '../session/manager.js';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';
import {
  mergeSessionResolutionMetadata,
  resolveSessionForTool,
} from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';

export type FormatSectionParams = {
  file_path?: string;
  section_index?: unknown;
  page_number_start?: unknown;
};

function mutationHint(code: SectionMutationError['code']): string {
  switch (code) {
    case 'INVALID_SECTION_INDEX':
      return 'Pass a non-negative section_index returned by get_sections.';
    case 'SECTION_NOT_FOUND':
      return 'Call get_sections again and choose a current section_index.';
    case 'INVALID_PAGE_NUMBER_START':
      return 'Pass page_number_start as a non-negative integer.';
  }
}

export async function formatSection(
  manager: SessionManager,
  params: FormatSectionParams,
): Promise<ToolResponse> {
  if (
    typeof params.section_index !== 'number'
    || !Number.isSafeInteger(params.section_index)
    || params.section_index < 0
  ) {
    return err(
      'VALIDATION_ERROR',
      'section_index must be a non-negative safe integer.',
      'Call get_sections and pass one of its section_index values.',
    );
  }
  if (
    typeof params.page_number_start !== 'number'
    || !Number.isSafeInteger(params.page_number_start)
    || params.page_number_start < 0
  ) {
    return err(
      'VALIDATION_ERROR',
      'page_number_start must be a non-negative safe integer.',
      'Pass an integer such as 0 or 1.',
    );
  }

  try {
    const resolved = await resolveSessionForTool(manager, params, {
      toolName: 'format_section',
    });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const sectionsBefore = session.doc.getSections();
    const targetBefore = sectionsBefore[params.section_index];
    if (!targetBefore) {
      return err(
        'SECTION_NOT_FOUND',
        `Section index ${params.section_index} was not found.`,
        'Call get_sections again and choose a current section_index.',
      );
    }

    const paragraphCountBefore = session.doc.getParagraphs().length;
    const ctx = await getRevisionContextForSession(session);
    const mutation = {
      sectionIndex: params.section_index,
      pageNumberStart: params.page_number_start,
    };
    const revisionPreflight = await preflightAiRevisionMutation(
      session,
      ctx,
      (previewDoc, previewCtx) => {
        previewDoc.setSectionPageNumberStart(mutation, previewCtx);
      },
    );
    if (revisionPreflight.blocked) return revisionPreflight.blocked;

    const result = session.doc.setSectionPageNumberStart(mutation, ctx);
    const sectionsAfter = session.doc.getSections();
    const paragraphCountAfter = session.doc.getParagraphs().length;
    if (
      sectionsBefore.length !== sectionsAfter.length
      || paragraphCountBefore !== paragraphCountAfter
    ) {
      return err(
        'INVARIANT_VIOLATION',
        'Section formatting changed section or paragraph count.',
        'Section page-number formatting must preserve document topology.',
      );
    }

    if (result.changed) manager.markEdited(session);
    manager.touch(session);

    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      section_index: result.sectionIndex,
      changed: result.changed,
      previous_page_number_start: result.previousPageNumberStart,
      resulting_page_number_start: result.currentPageNumberStart,
      section_count_before: sectionsBefore.length,
      section_count_after: sectionsAfter.length,
      paragraph_count_before: paragraphCountBefore,
      paragraph_count_after: paragraphCountAfter,
      message: result.changed
        ? 'Section page numbering updated with a tracked property change.'
        : 'Section page numbering already matched the requested state; no edit was recorded.',
    }, metadata));
  } catch (error: unknown) {
    if (error instanceof SectionMutationError) {
      return err(error.code, error.message, mutationHint(error.code));
    }
    return err(
      'FORMAT_SECTION_ERROR',
      `Failed to format section: ${errorMessage(error)}`,
      'Call get_sections, verify the target, and retry.',
    );
  }
}
