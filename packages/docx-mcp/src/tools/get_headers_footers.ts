import type { DocxDocument, ResolvedHeaderFooterReference } from '@usejunior/docx-core';
import { errorMessage } from '../error_utils.js';
import type { SessionManager } from '../session/manager.js';
import {
  mergeSessionResolutionMetadata,
  resolveSessionForTool,
} from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';

/**
 * Give every selected header/footer paragraph a `_bk_*` id, the same id model
 * read_file uses for body paragraphs, so replace_text and insert_paragraph can
 * anchor on it. Idempotent: paragraphs that already have an id keep it.
 */
export async function ensureHeaderFooterParagraphIds(doc: DocxDocument, sessionId: string): Promise<void> {
  for (const partPath of await doc.getSelectedHeaderFooterPartPaths()) {
    await doc.insertStoryParagraphBookmarks(partPath, `mcp_${sessionId}`);
  }
}

export async function getHeadersFooters(
  manager: SessionManager,
  params: { file_path?: string },
): Promise<ToolResponse> {
  const resolved = await resolveSessionForTool(manager, params, { toolName: 'get_headers_footers' });
  if (!resolved.ok) return resolved.response;
  const { session, metadata } = resolved;

  try {
    const doc = session.doc;
    await ensureHeaderFooterParagraphIds(doc, session.sessionId);
    const selected = new Set(await doc.getSelectedHeaderFooterPartPaths());
    const { sections, evenAndOddHeaders } = await doc.getHeaderFooterSections();
    const paragraphCache = new Map<string, Array<{ id: string | null; text: string }>>();
    const paragraphsOf = async (partName: string | null) => {
      if (!partName || !selected.has(partName)) return [];
      if (!paragraphCache.has(partName)) paragraphCache.set(partName, await doc.getStoryParagraphs(partName));
      return paragraphCache.get(partName)!;
    };
    const project = async (ref: ResolvedHeaderFooterReference, titlePage: boolean) => ({
      type: ref.type,
      relationship_id: ref.relationshipId,
      part_name: ref.partName,
      inherited: ref.inherited,
      source_section_index: ref.sourceSectionIndex,
      // Whether Word shows this type at all: first needs w:titlePg on the
      // section, even needs w:evenAndOddHeaders in settings (§ 17.10.1).
      displayed: ref.type === 'default' ? true : ref.type === 'first' ? titlePage : evenAndOddHeaders,
      paragraphs: await paragraphsOf(ref.partName),
    });
    const out = [];
    for (const section of sections) {
      out.push({
        section_index: section.sectionIndex,
        title_page: section.titlePage,
        headers: await Promise.all(section.headers.map((ref) => project(ref, section.titlePage))),
        footers: await Promise.all(section.footers.map((ref) => project(ref, section.titlePage))),
      });
    }
    manager.touch(session);
    return ok(mergeSessionResolutionMetadata({
      file_path: manager.normalizePath(session.originalPath),
      section_count: out.length,
      even_and_odd_headers: evenAndOddHeaders,
      sections: out,
      selector_note:
        'Paragraph ids are session-relative _bk_* anchors, like read_file ids; pass them to replace_text or insert_paragraph to edit header/footer text. A part shared by several sections is one story: editing it changes every section that shows it.',
    }, metadata));
  } catch (error: unknown) {
    return err(
      'GET_HEADERS_FOOTERS_ERROR',
      `Failed to read headers and footers: ${errorMessage(error)}`,
      'Validate the DOCX structure and retry.',
    );
  }
}
