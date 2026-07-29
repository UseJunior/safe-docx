import {
  SectionMutationError,
  type SectionMarginsMutation,
  type SectionPageSizeMutation,
} from '@usejunior/docx-core';
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
import { projectSectionForTool } from './get_sections.js';

export type FormatSectionParams = {
  file_path?: string;
  section_index?: unknown;
  page_number_start?: unknown;
  page_size?: unknown;
  margins?: unknown;
};

function mutationHint(code: SectionMutationError['code']): string {
  switch (code) {
    case 'INVALID_SECTION_INDEX':
      return 'Pass a non-negative section_index returned by get_sections.';
    case 'SECTION_NOT_FOUND':
      return 'Call get_sections again and choose a current section_index.';
    case 'INVALID_SECTION_ANCHOR':
    case 'SECTION_ANCHOR_NOT_FOUND':
    case 'SECTION_ANCHOR_NOT_BODY':
    case 'SECTION_BOUNDARY_EXISTS':
    case 'INVALID_SECTION_BREAK_TYPE':
    case 'INVALID_INHERIT_PROPERTIES':
    case 'SECTION_INSERTION_INVARIANT':
      return 'Use insert_section_break for section topology changes.';
    case 'INVALID_PAGE_NUMBER_START':
      return 'Pass page_number_start as a non-negative integer.';
    case 'EMPTY_SECTION_MUTATION':
      return 'Provide page_number_start or at least one page_size or margins value.';
    case 'INVALID_PAGE_SIZE':
      return 'Pass positive safe-integer width_twips and height_twips values.';
    case 'INVALID_PAGE_ORIENTATION':
      return 'Pass orientation as "portrait" or "landscape".';
    case 'INCOMPLETE_PAGE_SIZE':
      return 'This section has no page size; provide both width_twips and height_twips.';
    case 'INVALID_PAGE_MARGINS':
      return 'Use safe-integer twips; only top_twips and bottom_twips may be negative.';
    case 'INCOMPLETE_PAGE_MARGINS':
      return 'This section has no margins; provide all seven margin values.';
  }
}

export type ValidationResult<T> =
  | { ok: true; value: T | undefined }
  | { ok: false; response: ToolResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(message: string, hint: string): ValidationResult<never> {
  return { ok: false, response: err('VALIDATION_ERROR', message, hint) };
}

export function parseSectionPageSize(value: unknown): ValidationResult<SectionPageSizeMutation> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) {
    return validationError(
      'page_size must be an object.',
      'Pass width_twips, height_twips, or orientation in page_size.',
    );
  }
  const allowed = new Set(['width_twips', 'height_twips', 'orientation']);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    return validationError(
      `page_size contains unsupported field "${unknownKey}".`,
      'Use only width_twips, height_twips, and orientation.',
    );
  }
  if (!Object.keys(value).some((key) => value[key] !== undefined)) {
    return validationError(
      'page_size must contain at least one value.',
      'Pass width_twips, height_twips, or orientation.',
    );
  }
  for (const key of ['width_twips', 'height_twips'] as const) {
    const member = value[key];
    if (
      member !== undefined
      && (
        typeof member !== 'number'
        || !Number.isSafeInteger(member)
        || member <= 0
      )
    ) {
      return validationError(
        `page_size.${key} must be a positive safe integer.`,
        'Pass dimensions in twentieths of a point, such as 12240 by 15840.',
      );
    }
  }
  if (
    value.orientation !== undefined
    && value.orientation !== 'portrait'
    && value.orientation !== 'landscape'
  ) {
    return validationError(
      'page_size.orientation must be "portrait" or "landscape".',
      'Orientation is literal; provide matching width_twips and height_twips when rotating paper.',
    );
  }
  return {
    ok: true,
    value: {
      widthTwips: value.width_twips as number | undefined,
      heightTwips: value.height_twips as number | undefined,
      orientation: value.orientation as SectionPageSizeMutation['orientation'],
    },
  };
}

export function parseSectionMargins(value: unknown): ValidationResult<SectionMarginsMutation> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) {
    return validationError(
      'margins must be an object.',
      'Pass one or more margin values in twips.',
    );
  }
  const keys = [
    'top_twips',
    'right_twips',
    'bottom_twips',
    'left_twips',
    'header_twips',
    'footer_twips',
    'gutter_twips',
  ] as const;
  const allowed = new Set<string>(keys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    return validationError(
      `margins contains unsupported field "${unknownKey}".`,
      `Use only ${keys.join(', ')}.`,
    );
  }
  if (!keys.some((key) => value[key] !== undefined)) {
    return validationError(
      'margins must contain at least one value.',
      'Pass one or more margin values in twips.',
    );
  }
  for (const key of keys) {
    const member = value[key];
    const signed = key === 'top_twips' || key === 'bottom_twips';
    if (
      member !== undefined
      && (
        typeof member !== 'number'
        || !Number.isSafeInteger(member)
        || (!signed && member < 0)
      )
    ) {
      return validationError(
        `margins.${key} must be ${signed ? 'a' : 'a non-negative'} safe integer.`,
        'Only top_twips and bottom_twips may be negative.',
      );
    }
  }
  return {
    ok: true,
    value: {
      topTwips: value.top_twips as number | undefined,
      rightTwips: value.right_twips as number | undefined,
      bottomTwips: value.bottom_twips as number | undefined,
      leftTwips: value.left_twips as number | undefined,
      headerTwips: value.header_twips as number | undefined,
      footerTwips: value.footer_twips as number | undefined,
      gutterTwips: value.gutter_twips as number | undefined,
    },
  };
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
    params.page_number_start !== undefined
    && (
      typeof params.page_number_start !== 'number'
      || !Number.isSafeInteger(params.page_number_start)
      || params.page_number_start < 0
    )
  ) {
    return err(
      'VALIDATION_ERROR',
      'page_number_start must be a non-negative safe integer.',
      'Pass an integer such as 0 or 1.',
    );
  }
  const parsedPageSize = parseSectionPageSize(params.page_size);
  if (!parsedPageSize.ok) return parsedPageSize.response;
  const parsedMargins = parseSectionMargins(params.margins);
  if (!parsedMargins.ok) return parsedMargins.response;
  if (
    params.page_number_start === undefined
    && parsedPageSize.value === undefined
    && parsedMargins.value === undefined
  ) {
    return err(
      'VALIDATION_ERROR',
      'At least one section page-setup value must be provided.',
      'Provide page_number_start, page_size, or margins.',
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
      pageNumberStart: params.page_number_start as number | undefined,
      pageSize: parsedPageSize.value,
      margins: parsedMargins.value,
    };
    const revisionPreflight = await preflightAiRevisionMutation(
      session,
      ctx,
      (previewDoc, previewCtx) => {
        previewDoc.updateSectionProperties(mutation, previewCtx);
      },
    );
    if (revisionPreflight.blocked) return revisionPreflight.blocked;

    const result = session.doc.updateSectionProperties(mutation, ctx);
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
      previous_page_number_start: result.previousSection.pageNumberStart,
      resulting_page_number_start: result.currentSection.pageNumberStart,
      previous_page_size: projectSectionForTool(result.previousSection).page_size,
      resulting_page_size: projectSectionForTool(result.currentSection).page_size,
      previous_margins: projectSectionForTool(result.previousSection).margins,
      resulting_margins: projectSectionForTool(result.currentSection).margins,
      section_count_before: sectionsBefore.length,
      section_count_after: sectionsAfter.length,
      paragraph_count_before: paragraphCountBefore,
      paragraph_count_after: paragraphCountAfter,
      message: result.changed
        ? 'Section page setup updated with a tracked property change.'
        : 'Section page setup already matched the requested state; no edit was recorded.',
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
