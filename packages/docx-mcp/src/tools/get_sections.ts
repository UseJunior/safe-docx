import type { DocumentSection } from '@usejunior/docx-core';
import { errorMessage } from '../error_utils.js';
import type { SessionManager } from '../session/manager.js';
import {
  mergeSessionResolutionMetadata,
  resolveSessionForTool,
} from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';

export function projectSectionForTool(section: DocumentSection) {
  return {
    section_index: section.sectionIndex,
    location: section.location,
    anchor_paragraph_id: section.anchorParagraphId,
    break_type: section.breakType,
    page_numbering: {
      start: section.pageNumberStart,
      format: section.pageNumberFormat,
    },
    page_size: section.pageSize && {
      width_twips: section.pageSize.widthTwips,
      height_twips: section.pageSize.heightTwips,
      orientation: section.pageSize.orientation,
    },
    margins: section.margins && {
      top_twips: section.margins.topTwips,
      right_twips: section.margins.rightTwips,
      bottom_twips: section.margins.bottomTwips,
      left_twips: section.margins.leftTwips,
      header_twips: section.margins.headerTwips,
      footer_twips: section.margins.footerTwips,
      gutter_twips: section.margins.gutterTwips,
    },
    headers: section.headers.map((reference) => ({
      type: reference.type,
      relationship_id: reference.relationshipId,
    })),
    footers: section.footers.map((reference) => ({
      type: reference.type,
      relationship_id: reference.relationshipId,
    })),
  };
}

export async function getSections(
  manager: SessionManager,
  params: { file_path?: string },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, {
    toolName: 'get_sections',
  });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    const sections = session.doc.getSections().map(projectSectionForTool);
    manager.touch(session);
    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      section_count: sections.length,
      sections,
      selector_note:
        'section_index is session-relative; call get_sections again after changing section topology.',
    }, metadata));
  } catch (error: unknown) {
    return err(
      'GET_SECTIONS_ERROR',
      `Failed to read sections: ${errorMessage(error)}`,
      'Validate the DOCX structure and retry.',
    );
  }
}
