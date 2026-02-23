import { SessionManager } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { OOXML, W, renderToon } from '@usejunior/docx-primitives';
import { READ_SIMPLE_PREVIEW_CHARS, previewText } from './preview.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
}

function collectFootnoteMarkerSuffix(
  paragraphEl: Element,
  displayNumberById: Map<number, number>,
): string {
  const markers: string[] = [];
  const refs = paragraphEl.getElementsByTagNameNS(OOXML.W_NS, W.footnoteReference);
  for (let i = 0; i < refs.length; i++) {
    const ref = refs.item(i) as Element;
    const rawId = getWAttr(ref, 'id');
    if (!rawId) continue;
    const numericId = Number.parseInt(rawId, 10);
    if (Number.isNaN(numericId)) continue;
    const display = displayNumberById.get(numericId) ?? numericId;
    markers.push(`[^${display}]`);
  }
  return markers.join('');
}

export async function readFile(
  manager: SessionManager,
  params: { session_id?: string; file_path?: string; offset?: number; limit?: number; node_ids?: string[]; format?: string; show_formatting?: boolean },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'read_file' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const format = (params.format ?? 'toon').toLowerCase();
    if (format !== 'toon' && format !== 'json' && format !== 'simple') {
      return err('INVALID_FORMAT', `Invalid format: ${params.format}`, "Use 'toon' (default), 'json', or 'simple'.");
    }

    const showFormatting = params.show_formatting ?? true;
    const { nodes } = session.doc.buildDocumentView({
      includeSemanticTags: showFormatting,
      showFormatting,
    });
    const totalParagraphs = nodes.length;

    let filtered = nodes;
    if (params.node_ids && params.node_ids.length > 0) {
      const set = new Set(params.node_ids);
      filtered = nodes.filter((n) => set.has(n.id));
    } else {
      let startIdx = 0;
      if (typeof params.offset === 'number') {
        if (params.offset > 0) startIdx = Math.max(0, params.offset - 1);
        if (params.offset < 0) startIdx = Math.max(0, totalParagraphs + params.offset);
      }
      const endIdx = typeof params.limit === 'number' ? Math.min(totalParagraphs, startIdx + params.limit) : totalParagraphs;
      filtered = nodes.slice(startIdx, endIdx);
    }

    const paraIds = filtered.map((n) => n.id);

    let enriched = filtered;
    try {
      const footnotes = await session.doc.getFootnotes();
      if (footnotes.length > 0) {
        const displayById = new Map<number, number>();
        for (const note of footnotes) {
          displayById.set(note.id, note.displayNumber > 0 ? note.displayNumber : note.id);
        }
        enriched = filtered.map((node) => {
          const paragraphEl = session.doc.getParagraphElementById(node.id);
          if (!paragraphEl) return node;
          const markerSuffix = collectFootnoteMarkerSuffix(paragraphEl, displayById);
          if (!markerSuffix) return node;
          return {
            ...node,
            clean_text: `${node.clean_text}${markerSuffix}`,
            tagged_text: `${node.tagged_text}${markerSuffix}`,
            text: `${node.text}${markerSuffix}`,
          };
        });
      }
    } catch {
      enriched = filtered;
    }

    let content: string;
    if (format === 'json') {
      content = JSON.stringify(enriched, null, 2);
    } else if (format === 'simple') {
      const lines: string[] = ['#TOON id | text'];
      for (const n of enriched) {
        const text = previewText(n.clean_text, READ_SIMPLE_PREVIEW_CHARS);
        lines.push(`${n.id} | ${text}`);
      }
      content = lines.join('\n');
    } else {
      content = renderToon(enriched);
    }

    return ok(mergeSessionResolutionMetadata({
      session_id: session.sessionId,
      content,
      total_paragraphs: totalParagraphs,
      paragraphs_returned: enriched.length,
      paragraph_ids: paraIds,
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('READ_ERROR', msg, 'Check session status and try again.');
  }
}
