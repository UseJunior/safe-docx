import { SessionManager } from '../session/manager.js';
import { ok, err, type ToolResponse } from './types.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import { OOXML, W } from '@usejunior/docx-core';

export async function clearFormatting(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    paragraph_ids?: string[];
    clear_highlight?: boolean;
    clear_bold?: boolean;
    clear_italic?: boolean;
    clear_underline?: boolean;
    clear_color?: boolean;
    clear_font?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'clear_formatting' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const { nodes } = session.doc.buildDocumentView({ includeSemanticTags: false });
    const pids = params.paragraph_ids ?? nodes.map((n) => n.id);
    let modifiedCount = 0;

    for (const pid of pids) {
      const pEl = session.doc.getParagraphElementById(pid);
      if (!pEl) continue;

      const rElems = Array.from(pEl.getElementsByTagNameNS(OOXML.W_NS, W.r));
      let pModified = false;

      for (const r of rElems) {
        const rPr = r.getElementsByTagNameNS(OOXML.W_NS, W.rPr).item(0);
        if (!rPr) continue;

        if (params.clear_highlight) {
          const highlights = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.highlight));
          if (highlights.length > 0) {
            for (const h of highlights) h.parentNode?.removeChild(h);
            pModified = true;
          }
        }

        if (params.clear_bold) {
          const bolds = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.b));
          if (bolds.length > 0) {
            for (const b of bolds) b.parentNode?.removeChild(b);
            pModified = true;
          }
        }

        if (params.clear_italic) {
          const italics = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.i));
          if (italics.length > 0) {
            for (const i of italics) i.parentNode?.removeChild(i);
            pModified = true;
          }
        }

        if (params.clear_underline) {
          const underlines = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.u));
          if (underlines.length > 0) {
            for (const u of underlines) u.parentNode?.removeChild(u);
            pModified = true;
          }
        }

        if (params.clear_color) {
          const colors = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.color));
          if (colors.length > 0) {
            for (const c of colors) c.parentNode?.removeChild(c);
            pModified = true;
          }
        }

        if (params.clear_font) {
          const fonts = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.rFonts));
          const sizes = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.sz));
          const csSizes = Array.from(rPr.getElementsByTagNameNS(OOXML.W_NS, W.szCs));
          if (fonts.length > 0 || sizes.length > 0 || csSizes.length > 0) {
            for (const f of fonts) f.parentNode?.removeChild(f);
            for (const s of sizes) s.parentNode?.removeChild(s);
            for (const s of csSizes) s.parentNode?.removeChild(s);
            pModified = true;
          }
        }
      }
      if (pModified) modifiedCount++;
    }

    if (modifiedCount > 0) {
      manager.markEdited(session);
    }

    return ok(mergeSessionResolutionMetadata({
      success: true,
      session_id: session.sessionId,
      paragraphs_modified: modifiedCount,
    }, metadata));
  } catch (e: any) {
    return err('CLEAR_FORMATTING_ERROR', `Failed to clear formatting: ${e.message}`);
  }
}
