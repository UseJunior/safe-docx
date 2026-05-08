import { SessionManager } from '../session/manager.js';
import { ok, err, type ToolResponse } from './types.js';
import { resolveSessionForTool, mergeSessionResolutionMetadata } from './session_resolution.js';
import {
  OOXML,
  W,
  buildRPrChangeElement,
  getDirectChildrenByName,
  type RevisionContext,
} from '@usejunior/docx-core';

function removeDescendantsByName(parent: Element, localNames: readonly string[]): boolean {
  let removed = false;

  for (const localName of localNames) {
    const matches = Array.from(parent.getElementsByTagNameNS(OOXML.W_NS, localName));
    if (matches.length === 0) continue;

    for (const match of matches) {
      match.parentNode?.removeChild(match);
    }
    removed = true;
  }

  return removed;
}

function removeDirectChildrenByName(parent: Element, localNames: readonly string[]): boolean {
  const names = new Set(localNames);
  const matches: Element[] = [];

  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes.item(i);
    if (
      child?.nodeType === 1
      && (child as Element).namespaceURI === OOXML.W_NS
      && names.has((child as Element).localName)
    ) {
      matches.push(child as Element);
    }
  }

  for (const match of matches) {
    parent.removeChild(match);
  }

  return matches.length > 0;
}

export async function clearFormatting(
  manager: SessionManager,
  params: {
    file_path?: string;
    paragraph_ids?: string[];
    clear_highlight?: boolean;
    clear_bold?: boolean;
    clear_italic?: boolean;
    clear_underline?: boolean;
    clear_color?: boolean;
    clear_font?: boolean;
  },
  ctx?: RevisionContext,
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

        const oldRPrClone = ctx ? (rPr.cloneNode(true) as Element) : null;
        const removeRunProps = ctx ? removeDirectChildrenByName : removeDescendantsByName;
        let rModified = false;

        if (params.clear_highlight && removeRunProps(rPr, [W.highlight])) {
          rModified = true;
        }

        if (params.clear_bold && removeRunProps(rPr, [W.b])) {
          rModified = true;
        }

        if (params.clear_italic && removeRunProps(rPr, [W.i])) {
          rModified = true;
        }

        if (params.clear_underline && removeRunProps(rPr, [W.u])) {
          rModified = true;
        }

        if (params.clear_color && removeRunProps(rPr, [W.color])) {
          rModified = true;
        }

        if (params.clear_font && removeRunProps(rPr, [W.rFonts, W.sz, W.szCs])) {
          rModified = true;
        }

        if (ctx && rModified) {
          for (const stale of getDirectChildrenByName(rPr, 'rPrChange')) {
            rPr.removeChild(stale);
          }
          rPr.appendChild(buildRPrChangeElement(oldRPrClone, ctx));
        }

        if (rModified) {
          pModified = true;
        }
      }
      if (pModified) modifiedCount++;
    }

    if (modifiedCount > 0) {
      manager.markEdited(session);
    }

    return ok(mergeSessionResolutionMetadata({
      success: true,
      file_path: manager.normalizePath(session.originalPath),
      paragraphs_modified: modifiedCount,
    }, metadata));
  } catch (e: any) {
    return err('CLEAR_FORMATTING_ERROR', `Failed to clear formatting: ${e.message}`);
  }
}
