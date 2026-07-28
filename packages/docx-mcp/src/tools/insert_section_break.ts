import {
  SectionMutationError,
  type InsertSectionBreakMutation,
  type SectionBreakType,
} from '@usejunior/docx-core';
import { errorMessage } from '../error_utils.js';
import {
  getRevisionContextForSession,
  type SessionManager,
} from '../session/manager.js';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';
import {
  parseSectionMargins,
  parseSectionPageSize,
} from './format_section.js';
import { projectSectionForTool } from './get_sections.js';
import {
  mergeSessionResolutionMetadata,
  resolveSessionForTool,
} from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';

const BREAK_TYPES = new Set<SectionBreakType>([
  'nextPage',
  'nextColumn',
  'continuous',
  'evenPage',
  'oddPage',
]);

export type InsertSectionBreakParams = {
  file_path?: string;
  paragraph_id?: unknown;
  break_type?: unknown;
  inherit_properties?: unknown;
  new_section?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sectionErrorHint(code: SectionMutationError['code']): string {
  switch (code) {
    case 'INVALID_SECTION_ANCHOR':
    case 'SECTION_ANCHOR_NOT_FOUND':
      return 'Call read_file and pass a current unique paragraph_id.';
    case 'SECTION_ANCHOR_NOT_BODY':
      return 'Choose a main-body paragraph that is not inside a table or side story.';
    case 'SECTION_BOUNDARY_EXISTS':
      return 'Choose a paragraph that does not already end a section.';
    case 'INVALID_SECTION_BREAK_TYPE':
      return 'Use nextPage, nextColumn, continuous, evenPage, or oddPage.';
    case 'INVALID_INHERIT_PROPERTIES':
      return 'Pass inherit_properties as true or false.';
    case 'SECTION_NOT_FOUND':
      return 'Call get_sections and choose an anchor inside a section with a live boundary.';
    case 'INCOMPLETE_PAGE_SIZE':
      return 'When the following section has no page size, provide both width_twips and height_twips.';
    case 'INCOMPLETE_PAGE_MARGINS':
      return 'When the following section has no margins, provide all seven margin values.';
    case 'INVALID_PAGE_NUMBER_START':
      return 'Pass new_section.page_number_start as a non-negative integer.';
    case 'INVALID_PAGE_SIZE':
    case 'INVALID_PAGE_ORIENTATION':
      return 'Use positive page dimensions and portrait or landscape orientation.';
    case 'INVALID_PAGE_MARGINS':
      return 'Use safe-integer twips; only top_twips and bottom_twips may be negative.';
    case 'EMPTY_SECTION_MUTATION':
      return 'Remove new_section or provide at least one page-number, page-size, or margin value.';
    case 'SECTION_INSERTION_INVARIANT':
      return 'Reopen the document, inspect get_sections, and retry with a current paragraph id.';
    case 'INVALID_SECTION_INDEX':
      return 'The resolved containing section was invalid; reopen the document and retry.';
  }
}

function parseNewSection(
  value: unknown,
): { ok: true; value: InsertSectionBreakMutation['newSection'] } | {
  ok: false;
  response: ToolResponse;
} {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) {
    return {
      ok: false,
      response: err(
        'VALIDATION_ERROR',
        'new_section must be an object.',
        'Pass page_number_start, page_size, or margins inside new_section.',
      ),
    };
  }
  const allowed = new Set(['page_number_start', 'page_size', 'margins']);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    return {
      ok: false,
      response: err(
        'VALIDATION_ERROR',
        `new_section contains unsupported field "${unknownKey}".`,
        'Use only page_number_start, page_size, and margins.',
      ),
    };
  }
  if (!Object.keys(value).some((key) => value[key] !== undefined)) {
    return {
      ok: false,
      response: err(
        'VALIDATION_ERROR',
        'new_section must contain at least one value.',
        'Remove new_section or provide page_number_start, page_size, or margins.',
      ),
    };
  }
  if (
    value.page_number_start !== undefined
    && (
      typeof value.page_number_start !== 'number'
      || !Number.isSafeInteger(value.page_number_start)
      || value.page_number_start < 0
    )
  ) {
    return {
      ok: false,
      response: err(
        'VALIDATION_ERROR',
        'new_section.page_number_start must be a non-negative safe integer.',
        'Pass an integer such as 0 or 1.',
      ),
    };
  }
  const pageSize = parseSectionPageSize(value.page_size);
  if (!pageSize.ok) return pageSize;
  const margins = parseSectionMargins(value.margins);
  if (!margins.ok) return margins;
  return {
    ok: true,
    value: {
      pageNumberStart: value.page_number_start as number | undefined,
      pageSize: pageSize.value,
      margins: margins.value,
    },
  };
}

export async function insertSectionBreakTool(
  manager: SessionManager,
  params: InsertSectionBreakParams,
): Promise<ToolResponse> {
  if (typeof params.paragraph_id !== 'string' || params.paragraph_id.trim().length === 0) {
    return err(
      'VALIDATION_ERROR',
      'paragraph_id must be a non-empty string.',
      'Call read_file and pass a current paragraph_id.',
    );
  }
  if (
    typeof params.break_type !== 'string'
    || !BREAK_TYPES.has(params.break_type as SectionBreakType)
  ) {
    return err(
      'VALIDATION_ERROR',
      'break_type must be nextPage, nextColumn, continuous, evenPage, or oddPage.',
      'Choose the Word section-start behavior for the following section.',
    );
  }
  if (
    params.inherit_properties !== undefined
    && typeof params.inherit_properties !== 'boolean'
  ) {
    return err(
      'VALIDATION_ERROR',
      'inherit_properties must be a boolean.',
      'Omit it to inherit current properties, or pass false to reset non-relationship properties.',
    );
  }
  const newSection = parseNewSection(params.new_section);
  if (!newSection.ok) return newSection.response;

  try {
    const resolved = await resolveSessionForTool(manager, params, {
      toolName: 'insert_section_break',
    });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;
    const sectionsBefore = session.doc.getSections();
    const paragraphCountBefore = session.doc.getParagraphs().length;
    const ctx = await getRevisionContextForSession(session);
    const mutation: InsertSectionBreakMutation = {
      anchorParagraphId: params.paragraph_id,
      breakType: params.break_type as SectionBreakType,
      inheritProperties: params.inherit_properties as boolean | undefined,
      newSection: newSection.value,
    };

    const revisionPreflight = await preflightAiRevisionMutation(
      session,
      ctx,
      (previewDoc, previewCtx) => {
        previewDoc.insertSectionBreak(mutation, previewCtx);
      },
    );
    if (revisionPreflight.blocked) return revisionPreflight.blocked;

    const result = session.doc.insertSectionBreak(mutation, ctx);
    const sectionsAfter = session.doc.getSections();
    const paragraphCountAfter = session.doc.getParagraphs().length;
    if (
      sectionsAfter.length !== sectionsBefore.length + 1
      || paragraphCountAfter !== paragraphCountBefore + 1
    ) {
      return err(
        'INVARIANT_VIOLATION',
        'Section-break insertion did not add exactly one section and one boundary paragraph.',
        'Reopen the document and retry with a current direct-body paragraph id.',
      );
    }

    manager.markEdited(session);
    manager.touch(session);
    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      changed: true,
      inserted_boundary_paragraph_id: result.insertedBoundaryParagraphId,
      preceding_section_index: result.precedingSectionIndex,
      following_section_index: result.followingSectionIndex,
      preceding_section: projectSectionForTool(result.precedingSection),
      following_section: projectSectionForTool(result.followingSection),
      section_count_before: result.sectionCountBefore,
      section_count_after: result.sectionCountAfter,
      paragraph_count_before: paragraphCountBefore,
      paragraph_count_after: paragraphCountAfter,
      message: 'Section break inserted with tracked topology and property changes.',
    }, metadata));
  } catch (error: unknown) {
    if (error instanceof SectionMutationError) {
      return err(error.code, error.message, sectionErrorHint(error.code));
    }
    return err(
      'INSERT_SECTION_BREAK_ERROR',
      `Failed to insert section break: ${errorMessage(error)}`,
      'Call read_file and get_sections, then retry with a current direct-body paragraph id.',
    );
  }
}

