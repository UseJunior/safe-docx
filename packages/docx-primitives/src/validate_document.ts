/**
 * validate_document — structural integrity checks for OOXML documents.
 *
 * Runs before download/pack to catch common issues that could produce
 * corrupt or unexpected output. Returns warnings (non-blocking) that are
 * surfaced in response metadata.
 */

import { OOXML, W } from './namespaces.js';

export type ValidationWarning = {
  code: string;
  message: string;
  /** Optional element context (e.g. bookmark name, paragraph index). */
  context?: string;
};

export type ValidateDocumentResult = {
  warnings: ValidationWarning[];
  isValid: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

// ── Check: orphaned bookmarks ─────────────────────────────────────────

function checkOrphanedBookmarks(body: Element): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const starts = new Map<string, Element>();
  const ends = new Set<string>();

  const bookmarkStarts = body.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart);
  for (let i = 0; i < bookmarkStarts.length; i++) {
    const el = bookmarkStarts.item(i)!;
    const id = getWAttr(el, 'id');
    if (id) starts.set(id, el);
  }

  const bookmarkEnds = body.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkEnd);
  for (let i = 0; i < bookmarkEnds.length; i++) {
    const el = bookmarkEnds.item(i)!;
    const id = getWAttr(el, 'id');
    if (id) ends.add(id);
  }

  // bookmarkStart without matching bookmarkEnd
  for (const [id, el] of starts) {
    if (!ends.has(id)) {
      const name = getWAttr(el, 'name') ?? '(unnamed)';
      warnings.push({
        code: 'ORPHANED_BOOKMARK_START',
        message: `bookmarkStart id="${id}" name="${name}" has no matching bookmarkEnd`,
        context: `name=${name}`,
      });
    }
  }

  // bookmarkEnd without matching bookmarkStart
  for (const id of ends) {
    if (!starts.has(id)) {
      warnings.push({
        code: 'ORPHANED_BOOKMARK_END',
        message: `bookmarkEnd id="${id}" has no matching bookmarkStart`,
        context: `id=${id}`,
      });
    }
  }

  return warnings;
}

// ── Check: malformed tracked-change wrappers ──────────────────────────

const TC_LOCALS = ['ins', 'del', 'moveFrom', 'moveTo'];
const REQUIRED_TC_ATTRS = ['id', 'author', 'date'];

function checkTrackedChangeWrappers(body: Element): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  for (const local of TC_LOCALS) {
    const elements = body.getElementsByTagNameNS(OOXML.W_NS, local);
    for (let i = 0; i < elements.length; i++) {
      const el = elements.item(i)!;
      for (const attr of REQUIRED_TC_ATTRS) {
        const val = getWAttr(el, attr);
        if (!val) {
          warnings.push({
            code: 'MALFORMED_TRACKED_CHANGE',
            message: `<w:${local}> missing required attribute w:${attr}`,
            context: `element=w:${local}, missing=w:${attr}`,
          });
        }
      }

      // Check for empty tracked-change wrappers (no child elements)
      let hasChildElement = false;
      let c = el.firstChild;
      while (c) {
        if (c.nodeType === 1) { hasChildElement = true; break; }
        c = c.nextSibling;
      }
      if (!hasChildElement) {
        const tcId = getWAttr(el, 'id') ?? '?';
        warnings.push({
          code: 'EMPTY_TRACKED_CHANGE',
          message: `<w:${local} w:id="${tcId}"> has no child elements`,
          context: `element=w:${local}, id=${tcId}`,
        });
      }
    }
  }

  return warnings;
}

// ── Check: mismatched field markers ───────────────────────────────────

function checkFieldMarkers(body: Element): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Collect all fldChar elements in document order
  const fldChars = body.getElementsByTagNameNS(OOXML.W_NS, W.fldChar);
  let depth = 0;

  for (let i = 0; i < fldChars.length; i++) {
    const el = fldChars.item(i)!;
    const fldCharType = getWAttr(el, 'fldCharType');
    if (fldCharType === 'begin') {
      depth++;
    } else if (fldCharType === 'end') {
      depth--;
      if (depth < 0) {
        warnings.push({
          code: 'UNMATCHED_FIELD_END',
          message: 'fldChar type="end" without matching type="begin"',
        });
        depth = 0;
      }
    }
  }

  if (depth > 0) {
    warnings.push({
      code: 'UNMATCHED_FIELD_BEGIN',
      message: `${depth} fldChar type="begin" without matching type="end"`,
    });
  }

  return warnings;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Validate structural integrity of the document body.
 * Returns warnings for issues that may cause problems during download/pack.
 * All checks are non-destructive and read-only.
 */
export function validateDocument(doc: Document): ValidateDocumentResult {
  const body = doc.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0);
  if (!body) return { warnings: [], isValid: true };

  const warnings: ValidationWarning[] = [
    ...checkOrphanedBookmarks(body as Element),
    ...checkTrackedChangeWrappers(body as Element),
    ...checkFieldMarkers(body as Element),
  ];

  return {
    warnings,
    isValid: warnings.length === 0,
  };
}
