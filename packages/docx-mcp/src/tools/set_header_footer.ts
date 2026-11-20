import {
  HeaderFooterError,
  type HeaderFooterKind,
  type HeaderFooterParagraphContent,
  type HeaderFooterType,
  type SetHeaderFooterSource,
} from '@usejunior/docx-core';
import { errorMessage } from '../error_utils.js';
import { getRevisionContextForSession, type SessionManager } from '../session/manager.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { err, ok, type ToolResponse } from './types.js';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';

export type SetHeaderFooterParams = {
  file_path?: string;
  kind?: unknown;
  section_index?: unknown;
  type?: unknown;
  link_to_previous?: unknown;
  paragraphs?: unknown;
  existing_relationship_id?: unknown;
};

function validation(message: string, hint: string): ToolResponse {
  return err('VALIDATION_ERROR', message, hint);
}

/** Map the tool's paragraph objects ({text?, alignment?, runs?}) to docx-core content. */
function parseParagraphs(raw: unknown): HeaderFooterParagraphContent[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'paragraphs must be a non-empty array.';
  const out: HeaderFooterParagraphContent[] = [];
  for (const [i, p] of raw.entries()) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return `paragraphs[${i}] must be an object.`;
    const para = p as { text?: unknown; alignment?: unknown; runs?: unknown };
    if (para.text !== undefined && para.runs !== undefined) return `paragraphs[${i}] takes text or runs, not both.`;
    let runs: HeaderFooterParagraphContent['runs'];
    if (para.runs !== undefined) {
      if (!Array.isArray(para.runs)) return `paragraphs[${i}].runs must be an array.`;
      runs = [];
      for (const [j, run] of para.runs.entries()) {
        const r = run as { text?: unknown; field?: unknown };
        if (r && typeof r.text === 'string' && r.field === undefined) runs.push({ text: r.text });
        else if (r && (r.field === 'PAGE' || r.field === 'NUMPAGES') && r.text === undefined) runs.push({ field: r.field });
        else return `paragraphs[${i}].runs[${j}] must be {"text": "..."} or {"field": "PAGE" | "NUMPAGES"}.`;
      }
    } else if (typeof para.text === 'string') {
      runs = para.text.length > 0 ? [{ text: para.text }] : [];
    } else if (para.text === undefined) {
      runs = [];
    } else {
      return `paragraphs[${i}].text must be a string.`;
    }
    if (para.alignment !== undefined && !['left', 'center', 'right', 'both'].includes(para.alignment as string)) {
      return `paragraphs[${i}].alignment must be left, center, right or both.`;
    }
    out.push({ alignment: para.alignment as HeaderFooterParagraphContent['alignment'], runs });
  }
  return out;
}

export async function setHeaderFooterTool(
  manager: SessionManager,
  params: SetHeaderFooterParams,
): Promise<ToolResponse> {
  if (params.kind !== 'header' && params.kind !== 'footer') {
    return validation('kind must be "header" or "footer".', 'Pass kind="footer" to set a footer.');
  }
  const kind: HeaderFooterKind = params.kind;
  if (typeof params.section_index !== 'number' || !Number.isSafeInteger(params.section_index) || params.section_index < 0) {
    return validation('section_index must be a non-negative safe integer.', 'Call get_sections or get_headers_footers and pass one of its section_index values.');
  }
  const sectionIndex = params.section_index;
  const type = (params.type ?? 'default') as HeaderFooterType;
  if (!['default', 'first', 'even'].includes(type)) {
    return validation('type must be "default", "first" or "even".', 'Omit type for the default header/footer.');
  }
  const sources = [
    params.link_to_previous === true,
    params.paragraphs !== undefined,
    params.existing_relationship_id !== undefined,
  ].filter(Boolean).length;
  if (params.link_to_previous !== undefined && typeof params.link_to_previous !== 'boolean') {
    return validation('link_to_previous must be a boolean.', 'Pass link_to_previous=true to inherit from the previous section.');
  }
  if (sources !== 1) {
    return validation(
      'Provide exactly one of paragraphs, existing_relationship_id or link_to_previous=true.',
      'paragraphs creates a new part; existing_relationship_id reuses a part get_headers_footers reported; link_to_previous=true removes the section\'s own reference.',
    );
  }
  let source: SetHeaderFooterSource;
  if (params.link_to_previous === true) {
    source = { kind: 'link_to_previous' };
  } else if (params.existing_relationship_id !== undefined) {
    if (typeof params.existing_relationship_id !== 'string' || params.existing_relationship_id.length === 0) {
      return validation('existing_relationship_id must be a non-empty string.', 'Pass a relationship_id reported by get_headers_footers.');
    }
    source = { kind: 'existing', relationshipId: params.existing_relationship_id };
  } else {
    const parsed = parseParagraphs(params.paragraphs);
    if (typeof parsed === 'string') {
      return validation(parsed, 'Pass paragraphs like [{"alignment": "center", "runs": [{"field": "PAGE"}]}].');
    }
    source = { kind: 'content', paragraphs: parsed };
  }

  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'set_header_footer' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;
    return await manager.mutateSession(session, async (session) => {
      const ctx = await getRevisionContextForSession(session);
      const mutation = { kind, sectionIndex, type, source };
      const preflight = await preflightAiRevisionMutation(session, ctx, async (previewDoc, previewCtx) => {
        await previewDoc.setHeaderFooter(mutation, previewCtx);
      }, undefined, { untrackedStoryBindings: true });
      if (preflight.blocked) return preflight.blocked;
      const result = await session.doc.setHeaderFooter(mutation, ctx);
      if (result.changed || result.partsCreated.length > 0) {
        manager.markEdited(session);
      }
      if (result.changed) {
        // Header/footer parts, relationships and content types have no
        // tracked-change form, and w:sectPrChange cannot hold header/footer
        // references (CT_SectPrBase), so the reference change itself is not
        // reversible by rejecting revisions. The save report lists both (#1200).
        const created = result.partsCreated.length > 0
          ? `created ${result.partsCreated.join(', ')} with document relationships and content-type overrides; `
          : '';
        const rewritten = result.packagePartsChanged.filter((p) => p.startsWith('word/') && !result.partsCreated.includes(p) && !p.includes('_rels'));
        manager.recordNonRevisionChange(session, {
          tool: 'set_header_footer',
          parts: ['word/document.xml', ...result.packagePartsChanged],
          description: `Section ${sectionIndex} ${kind} (${type}) reference set to ${result.relationshipId ?? 'the previous section'}${result.pinnedSections.length > 0 ? ` and section ${result.pinnedSections.map((p) => p.sectionIndex).join(', ')} pinned to its previous ${kind}` : ''}: ${created}${rewritten.length > 0 ? `rewrote ${rewritten.join(', ')}; ` : ''}header/footer references and part content are untracked${ctx ? ' (other section properties are tracked as w:sectPrChange, but rejecting it does not restore the references)' : ''}.`,
        });
      }
      manager.touch(session);
      const warnings: string[] = [...preflight.warnings];
      if (type === 'even' && !result.evenAndOddHeaders) {
        warnings.push('The even-page header/footer is shown only when w:evenAndOddHeaders is on in word/settings.xml, and it is off in this document; Word and LibreOffice show the default one on every page.');
      }
      if (source.kind !== 'content' && result.pinnedSections.some((p) => p.partCreated)) {
        warnings.push('A following section had no header/footer of this type; it was given an empty part so it stays blank.');
      }
      return ok(mergeSessionResolutionMetadata({
        file_path: manager.normalizePath(session.originalPath),
        changed: result.changed,
        kind,
        type,
        section_index: sectionIndex,
        relationship_id: result.relationshipId,
        part_name: result.partName,
        parts_created: result.partsCreated,
        package_parts_changed: result.packagePartsChanged,
        pinned_sections: result.pinnedSections.map((p) => ({
          section_index: p.sectionIndex,
          relationship_id: p.relationshipId,
          part_name: p.partName,
          part_created: p.partCreated,
        })),
        title_page_set: result.titlePageSet,
        even_and_odd_headers: result.evenAndOddHeaders,
        tracked: !!ctx && result.changed,
        ...(warnings.length > 0 ? { warnings } : {}),
        message: result.changed
          ? `Section ${sectionIndex} ${kind} (${type}) set. Call get_headers_footers to read the new paragraph ids.`
          : `Section ${sectionIndex} already had that ${kind}; nothing was changed.`,
      }, metadata));
    });
  } catch (error: unknown) {
    if (error instanceof HeaderFooterError) {
      return err(error.code, error.message, 'Call get_headers_footers, check section_index and relationship ids, and retry.');
    }
    return err('SET_HEADER_FOOTER_ERROR', `Failed to set ${kind}: ${errorMessage(error)}`, 'Call get_headers_footers, verify the document, and retry.');
  }
}
