/**
 * footnotes — OOXML footnote bootstrapping, CRUD, and display numbering.
 *
 * Creates footnote XML parts when missing, inserts footnote reference runs,
 * and supports reading, updating, and deleting footnotes.
 */

import { OOXML, W } from './namespaces.js';
import { parseXml, serializeXml } from './xml.js';
import { DocxZip } from './zip.js';
import { buildParagraphIndex } from './paragraph-index.js';
import { getParagraphBookmarkId } from './bookmarks.js';
import { findUniqueSubstringMatch } from './matching.js';
import { childElements, isW } from './dom-helpers.js';
import { getFirstChild } from './xml-helpers.js';
import {
  extractEffectiveRunFormatting,
  parseStylesXml,
  parseThemeXml,
  type StylesModel,
  type ThemeModel,
} from './styles.js';
import { emitFormattingTags, mergeAdjacentTags, type AnnotatedRun } from './formatting_tags.js';
import {
  createRevisionContainer,
  prepareElementForDeletion,
  type RevisionContext,
} from './track-changes-emitter.js';

// ── Relationship & content types ────────────────────────────────────────

const REL_TYPE_FOOTNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const CT_FOOTNOTES = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';

// ── Minimal XML template ────────────────────────────────────────────────

const FOOTNOTES_XML_TEMPLATE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
  ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
  `<w:footnote w:type="separator" w:id="-1">` +
  `<w:p><w:r><w:separator/></w:r></w:p>` +
  `</w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0">` +
  `<w:p><w:r><w:continuationSeparator/></w:r></w:p>` +
  `</w:footnote>` +
  `</w:footnotes>`;

// ── Types ───────────────────────────────────────────────────────────────

/**
 * One paragraph of a footnote body, retained at the same node-level fidelity as
 * a document-body paragraph: the flattened visible `text`, an inline-tagged
 * rendering (`tagged_text`) that preserves run-level bold/italic/underline/
 * highlight/color/font (via {@link emitFormattingTags} in `full` mode — no
 * baseline suppression, so every deviation survives), and the paragraph's
 * `w:pStyle` id (e.g. `FootnoteText`).
 */
export type FootnoteParagraph = {
  text: string;
  tagged_text: string;
  style: string | null;
};

export type Footnote = {
  id: number;
  displayNumber: number;
  /**
   * Flattened body text, `\n`-joined across paragraphs. Retained for
   * backward-compatibility with serializers and `get_footnotes`; new consumers
   * that need multi-paragraph structure or run formatting should read
   * {@link Footnote.paragraphs}.
   */
  text: string;
  /**
   * First paragraph that references this footnote. Retained for
   * backward-compatibility; prefer {@link Footnote.refParagraphIds}, which
   * captures every referencing paragraph (a malformed DOCX can illegally reuse
   * one footnote id from multiple paragraphs).
   */
  anchoredParagraphId: string | null;
  /**
   * Every distinct paragraph (by bookmark id) that carries a
   * `w:footnoteReference` to this footnote, in document order. Usually one
   * entry; empty when the note is orphaned (no reference in the body).
   */
  refParagraphIds: string[];
  /**
   * Structured, run-formatting-preserving body paragraphs. Present at
   * node-level fidelity — see {@link FootnoteParagraph}.
   */
  paragraphs: FootnoteParagraph[];
};

export type AddFootnoteParams = {
  paragraphEl: Element;
  afterText?: string;
  visibleOffset?: number;
  text: string;
  presentation?: FootnoteNotePresentation;
};

export type FootnoteRunStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  highlight?: 'black' | 'blue' | 'cyan' | 'green' | 'magenta' | 'red' | 'yellow' | 'white' | 'darkBlue' | 'darkCyan' | 'darkGreen' | 'darkMagenta' | 'darkRed' | 'darkYellow' | 'darkGray' | 'lightGray' | 'none';
};

export type FootnoteNotePresentation = {
  prefix?: string;
  prefixSeparator?: string;
  prefixStyle?: FootnoteRunStyle;
  bodyStyle?: FootnoteRunStyle;
};

export type AddFootnoteResult = {
  noteId: number;
};

export type BootstrapFootnoteResult = {
  partsCreated: string[];
};

// ── Reserved entry detection ────────────────────────────────────────────

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
}

export function isReservedFootnote(footnoteEl: Element): boolean {
  const typ = getWAttr(footnoteEl, 'type');
  return typ === 'separator' || typ === 'continuationSeparator';
}

// ── Part bootstrapping ──────────────────────────────────────────────────

export async function bootstrapFootnoteParts(zip: DocxZip): Promise<BootstrapFootnoteResult> {
  const created: string[] = [];

  if (!zip.hasFile('word/footnotes.xml')) {
    zip.writeText('word/footnotes.xml', FOOTNOTES_XML_TEMPLATE);
    created.push('word/footnotes.xml');
  }

  if (created.length === 0) return { partsCreated: [] };

  // Update [Content_Types].xml
  await ensureFootnoteContentTypes(zip, created);

  // Update word/_rels/document.xml.rels
  await ensureFootnoteRelationships(zip, created);

  return { partsCreated: created };
}

async function ensureFootnoteContentTypes(zip: DocxZip, newParts: string[]): Promise<void> {
  const ctPath = '[Content_Types].xml';
  let ctXml: string;
  try {
    ctXml = await zip.readText(ctPath);
  } catch {
    ctXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
  }
  const ctDoc = parseXml(ctXml);
  const typesEl = ctDoc.documentElement;
  const ctNs = 'http://schemas.openxmlformats.org/package/2006/content-types';

  const partToCt: Record<string, string> = {
    'word/footnotes.xml': CT_FOOTNOTES,
  };

  const overrides = Array.from(typesEl.getElementsByTagNameNS(ctNs, 'Override')) as Element[];
  const existingPartNames = new Set(overrides.map((o) => o.getAttribute('PartName')));

  for (const part of newParts) {
    const partName = `/${part}`;
    const contentType = partToCt[part];
    if (!contentType || existingPartNames.has(partName)) continue;

    const override = ctDoc.createElementNS(ctNs, 'Override');
    override.setAttribute('PartName', partName);
    override.setAttribute('ContentType', contentType);
    typesEl.appendChild(override);
  }

  zip.writeText(ctPath, serializeXml(ctDoc));
}

async function ensureFootnoteRelationships(zip: DocxZip, newParts: string[]): Promise<void> {
  const relsPath = 'word/_rels/document.xml.rels';
  let relsXml: string;
  try {
    relsXml = await zip.readText(relsPath);
  } catch {
    relsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
  }
  const relsDoc = parseXml(relsXml);
  const relsEl = relsDoc.documentElement;
  const relNs = OOXML.REL_NS;

  const partToRelType: Record<string, string> = {
    'word/footnotes.xml': REL_TYPE_FOOTNOTES,
  };

  const existingRels = Array.from(relsEl.getElementsByTagNameNS(relNs, 'Relationship')) as Element[];
  const existingTypes = new Set(existingRels.map((r) => r.getAttribute('Type')));

  let maxId = 0;
  for (const rel of existingRels) {
    const id = rel.getAttribute('Id') ?? '';
    const match = /^rId(\d+)$/.exec(id);
    if (match) maxId = Math.max(maxId, parseInt(match[1]!, 10));
  }

  for (const part of newParts) {
    const relType = partToRelType[part];
    if (!relType || existingTypes.has(relType)) continue;

    maxId++;
    const rel = relsDoc.createElementNS(relNs, 'Relationship');
    rel.setAttribute('Id', `rId${maxId}`);
    rel.setAttribute('Type', relType);
    rel.setAttribute('Target', part.replace('word/', ''));
    relsEl.appendChild(rel);
  }

  zip.writeText(relsPath, serializeXml(relsDoc));
}

// ── ID allocation ───────────────────────────────────────────────────────

function allocateNextFootnoteId(footnotesDoc: Document): number {
  const fnEls = footnotesDoc.getElementsByTagNameNS(OOXML.W_NS, W.footnote);
  let maxId = 0;
  for (let i = 0; i < fnEls.length; i++) {
    const el = fnEls.item(i) as Element;
    const idStr = getWAttr(el, 'id');
    if (idStr) {
      const id = parseInt(idStr, 10);
      if (id > maxId) maxId = id;
    }
  }
  return maxId + 1;
}

// ── Display number computation ──────────────────────────────────────────

function buildDisplayNumberMap(documentXml: Document, footnotesDoc: Document): Map<number, number> {
  // Build set of reserved IDs (by type)
  const reservedIds = new Set<number>();
  const fnEls = footnotesDoc.getElementsByTagNameNS(OOXML.W_NS, W.footnote);
  for (let i = 0; i < fnEls.length; i++) {
    const el = fnEls.item(i) as Element;
    if (isReservedFootnote(el)) {
      const idStr = getWAttr(el, 'id');
      if (idStr) reservedIds.add(parseInt(idStr, 10));
    }
  }

  // Scan document.xml for w:footnoteReference in DOM order
  const refs = documentXml.getElementsByTagNameNS(OOXML.W_NS, W.footnoteReference);
  const map = new Map<number, number>();
  let displayNum = 1;

  for (let i = 0; i < refs.length; i++) {
    const ref = refs.item(i) as Element;
    const idStr = getWAttr(ref, 'id');
    if (!idStr) continue;
    const id = parseInt(idStr, 10);
    if (reservedIds.has(id)) continue;
    if (!map.has(id)) {
      map.set(id, displayNum++);
    }
  }

  return map;
}

// ── Reading ─────────────────────────────────────────────────────────────

/**
 * Read every user footnote body, retaining multi-paragraph structure and
 * run-level formatting.
 *
 * `styles` is optional: when provided (from `DocxDocument.getStylesModel()`),
 * the per-paragraph `tagged_text` resolves run formatting through the character-
 * and paragraph-style chains (so e.g. a `Strong` character style renders `<b>`).
 * When omitted, formatting is read from direct `w:rPr` only — the flattened
 * `text` and the plural anchor map are unaffected either way, so existing
 * callers that pass `(zip, documentXml)` keep their exact behavior.
 */
export async function getFootnotes(
  zip: DocxZip,
  documentXml: Document,
  styles?: StylesModel,
  theme?: ThemeModel,
): Promise<Footnote[]> {
  const footnotesText = await zip.readTextOrNull('word/footnotes.xml');
  if (!footnotesText) return [];

  const footnotesDoc = parseXml(footnotesText);
  const fnEls = footnotesDoc.getElementsByTagNameNS(OOXML.W_NS, W.footnote);
  if (fnEls.length === 0) return [];

  const displayMap = buildDisplayNumberMap(documentXml, footnotesDoc);
  const stylesModel = styles ?? parseStylesXml(null);
  const themeText = theme ? null : await zip.readTextOrNull('word/theme/theme1.xml');
  const themeModel = theme ?? parseThemeXml(themeText ? parseXml(themeText) : null);

  // Build map of footnoteReference id → every anchored paragraph bookmark id, in
  // document order (deduplicated). The FIRST entry feeds the legacy
  // `anchoredParagraphId`; the whole ordered list feeds `refParagraphIds`.
  // A conforming DOCX references a footnote from exactly one paragraph, but a
  // malformed one has been observed reusing an id across several — so we keep
  // them all rather than silently dropping the extras.
  const anchorMap = new Map<number, string[]>();
  const refs = documentXml.getElementsByTagNameNS(OOXML.W_NS, W.footnoteReference);
  for (let i = 0; i < refs.length; i++) {
    const ref = refs.item(i) as Element;
    const idStr = getWAttr(ref, 'id');
    if (!idStr) continue;
    const id = parseInt(idStr, 10);

    // Walk up to enclosing <w:p>
    let parent = ref.parentNode;
    while (parent && parent.nodeType === 1) {
      const pel = parent as Element;
      if (pel.localName === W.p && pel.namespaceURI === OOXML.W_NS) {
        const bookmarkId = getParagraphBookmarkId(pel);
        if (bookmarkId != null) {
          const existing = anchorMap.get(id) ?? [];
          if (!existing.includes(bookmarkId)) existing.push(bookmarkId);
          anchorMap.set(id, existing);
        }
        break;
      }
      parent = parent.parentNode;
    }
  }

  const footnotes: Footnote[] = [];

  for (let i = 0; i < fnEls.length; i++) {
    const el = fnEls.item(i) as Element;
    if (isReservedFootnote(el)) continue;

    const idStr = getWAttr(el, 'id');
    if (!idStr) continue;
    const id = parseInt(idStr, 10);

    const paragraphs = extractFootnoteParagraphs(el, stylesModel, themeModel);
    const text = paragraphs.map((p) => p.text).join('\n');
    const displayNumber = displayMap.get(id) ?? 0;
    const refParagraphIds = anchorMap.get(id) ?? [];
    const anchoredParagraphId = refParagraphIds[0] ?? null;

    footnotes.push({ id, displayNumber, text, anchoredParagraphId, refParagraphIds, paragraphs });
  }

  // Sort by display number (document order)
  footnotes.sort((a, b) => a.displayNumber - b.displayNumber);

  return footnotes;
}

export async function getFootnote(
  zip: DocxZip,
  documentXml: Document,
  noteId: number,
  styles?: StylesModel,
  theme?: ThemeModel,
): Promise<Footnote | null> {
  const all = await getFootnotes(zip, documentXml, styles, theme);
  return all.find((f) => f.id === noteId) ?? null;
}

function extractFootnoteText(footnoteEl: Element): string {
  return extractFootnoteParagraphs(footnoteEl, parseStylesXml(null))
    .map((p) => p.text)
    .join('\n');
}

/**
 * Extract a footnote body as structured paragraphs, one {@link FootnoteParagraph}
 * per `<w:p>`, preserving run-level formatting in `tagged_text`.
 *
 * The flattened `text` intentionally reproduces {@link extractFootnoteText}'s
 * historical behavior byte-for-byte: `w:t` content concatenated, `w:tab`/`w:br`
 * ignored, and runs carrying a `w:footnoteRef` marker (the auto-number glyph)
 * skipped so the footnote number never leaks into the body text. The reserved
 * separator paragraphs are filtered out by the caller (`isReservedFootnote`).
 */
function extractFootnoteParagraphs(
  footnoteEl: Element,
  styles: StylesModel,
  theme?: ThemeModel,
): FootnoteParagraph[] {
  const paragraphs = footnoteEl.getElementsByTagNameNS(OOXML.W_NS, W.p);
  const out: FootnoteParagraph[] = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs.item(pi) as Element;
    const style = getFootnoteParagraphStyle(p);
    const paraPPr = getFirstChild(p, OOXML.W_NS, W.pPr);

    const annotated: AnnotatedRun[] = [];
    const textParts: string[] = [];
    const runs = p.getElementsByTagNameNS(OOXML.W_NS, W.r);

    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs.item(ri) as Element;
      // Skip runs that contain footnoteRef (the auto-number glyph, not body text).
      if (run.getElementsByTagNameNS(OOXML.W_NS, W.footnoteRef).length > 0) continue;

      // Flattened text mirrors extractFootnoteText: only w:t content.
      let runText = '';
      const ts = run.getElementsByTagNameNS(OOXML.W_NS, W.t);
      for (let ti = 0; ti < ts.length; ti++) {
        runText += (ts.item(ti) as Element).textContent ?? '';
      }
      if (!runText) continue;
      textParts.push(runText);

      const formatting = extractEffectiveRunFormatting({
        run,
        paragraphPPr: paraPPr ?? null,
        paragraphStyleId: style,
        styles,
        theme,
      });
      annotated.push({ text: runText, formatting, hyperlinkUrl: null, charCount: runText.length, isHeaderRun: false });
    }

    // `full` mode: no baseline suppression, so every run's bold/italic/etc.
    // survives into tagged_text at node-level fidelity.
    const tagged = mergeAdjacentTags(
      emitFormattingTags({ runs: annotated, baseline: FOOTNOTE_TAG_BASELINE, formattingMode: 'full' }),
    );

    out.push({ text: textParts.join(''), tagged_text: tagged, style });
  }

  return out;
}

// `full` formatting mode ignores the baseline, but emitFormattingTags still
// requires one; an all-false, unsuppressed baseline is the neutral choice.
const FOOTNOTE_TAG_BASELINE = { bold: false, italic: false, underline: false, suppressed: false } as const;

function getFootnoteParagraphStyle(p: Element): string | null {
  const pPr = getFirstChild(p, OOXML.W_NS, W.pPr);
  if (!pPr) return null;
  const pStyle = getFirstChild(pPr, OOXML.W_NS, W.pStyle);
  if (!pStyle) return null;
  return getWAttr(pStyle, 'val');
}

// ── Insertion ───────────────────────────────────────────────────────────

export async function addFootnote(
  documentXml: Document,
  zip: DocxZip,
  params: AddFootnoteParams,
  ctx?: RevisionContext,
): Promise<AddFootnoteResult> {
  const { paragraphEl, afterText, visibleOffset, text, presentation } = params;
  if (afterText !== undefined && visibleOffset !== undefined) {
    throw new Error('afterText and visibleOffset are mutually exclusive footnote anchors');
  }

  // Load or bootstrap footnotes.xml
  const footnotesXml = await zip.readText('word/footnotes.xml');
  const footnotesDoc = parseXml(footnotesXml);

  // Allocate next ID
  const noteId = allocateNextFootnoteId(footnotesDoc);

  // Insert footnoteReference run in document body
  insertFootnoteReference(documentXml, paragraphEl, noteId, afterText, visibleOffset, ctx);

  // Add footnote body to footnotes.xml
  const footnoteEl = addFootnoteElement(footnotesDoc, noteId, text, presentation);
  if (ctx) {
    wrapFootnoteParagraphTextRuns(getFirstFootnoteParagraph(footnoteEl), 'ins', ctx);
  }
  zip.writeText('word/footnotes.xml', serializeXml(footnotesDoc));

  return { noteId };
}

function insertFootnoteReference(
  documentXml: Document,
  paragraphEl: Element,
  noteId: number,
  afterText?: string,
  requestedVisibleOffset?: number,
  ctx?: RevisionContext,
): void {
  // Create the reference run
  const refRun = documentXml.createElementNS(OOXML.W_NS, 'w:r');
  const rPr = documentXml.createElementNS(OOXML.W_NS, 'w:rPr');
  const rStyle = documentXml.createElementNS(OOXML.W_NS, 'w:rStyle');
  rStyle.setAttributeNS(OOXML.W_NS, 'w:val', 'FootnoteReference');
  rPr.appendChild(rStyle);
  // Some source documents omit or redefine the FootnoteReference character
  // style. Keep the semantic style and make the required visual elevation
  // explicit so the marker remains superscript across those documents.
  const vertAlign = documentXml.createElementNS(OOXML.W_NS, 'w:vertAlign');
  vertAlign.setAttributeNS(OOXML.W_NS, 'w:val', 'superscript');
  rPr.appendChild(vertAlign);
  refRun.appendChild(rPr);
  const fnRef = documentXml.createElementNS(OOXML.W_NS, 'w:footnoteReference');
  fnRef.setAttributeNS(OOXML.W_NS, 'w:id', String(noteId));
  refRun.appendChild(fnRef);
  const refAnchor = ctx ? createRevisionContainer(documentXml, 'ins', ctx) : refRun;
  if (ctx) {
    refAnchor.appendChild(refRun);
  }

  if (afterText === undefined && requestedVisibleOffset === undefined) {
    // Default: append at end of paragraph
    paragraphEl.appendChild(refAnchor);
    return;
  }

  const index = buildParagraphIndex(paragraphEl);
  const runs = index.runs.filter((run) => run.visibleText.length > 0);
  let insertOffset: number;
  if (requestedVisibleOffset !== undefined) {
    if (!Number.isInteger(requestedVisibleOffset) || requestedVisibleOffset < 0 || requestedVisibleOffset > index.text.length) {
      throw new Error(`visibleOffset ${requestedVisibleOffset} is outside paragraph visible text [0, ${index.text.length}]`);
    }
    insertOffset = requestedVisibleOffset;
  } else {
    const match = findUniqueSubstringMatch(index.text, afterText!);
    if (match.status === 'not_found') throw new Error(`after_text '${afterText}' not found in paragraph`);
    if (match.status === 'multiple') throw new Error(`after_text '${afterText}' found ${match.matchCount} times in paragraph`);
    insertOffset = match.end;
  }

  // Map offset to run position
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const runEnd = pos + run.visibleText.length;

    if (insertOffset <= pos) {
      // Insert before this run
      const parent = run.element.parentNode!;
      parent.insertBefore(refAnchor, run.element);
      return;
    }

    if (insertOffset > pos && insertOffset < runEnd) {
      // Need to split this run at the offset
      const splitOffset = insertOffset - pos;
      splitRunAndInsertReference(run.element, splitOffset, refAnchor);
      return;
    }

    if (insertOffset === runEnd) {
      // Insert after this run
      const parent = run.element.parentNode!;
      parent.insertBefore(refAnchor, run.element.nextSibling);
      return;
    }

    pos = runEnd;
  }

  // Fallback: append at end
  paragraphEl.appendChild(refAnchor);
}

function splitRunAndInsertReference(
  run: Element,
  visibleOffset: number,
  referenceNode: Element,
): void {
  const doc = run.ownerDocument;
  if (!doc) throw new Error('Run has no ownerDocument');

  const parent = run.parentNode;
  if (!parent) throw new Error('Run has no parent');

  // Clone the run for the right portion
  const rightRun = run.cloneNode(true) as Element;
  parent.insertBefore(rightRun, run.nextSibling);

  // Split text content in the runs
  const leftContent = getDirectContentElements(run);
  const rightContent = getDirectContentElements(rightRun);

  let pos = 0;
  for (let i = 0; i < leftContent.length; i++) {
    const lEl = leftContent[i]!;
    const rEl = rightContent[i]!;

    if (lEl.namespaceURI !== OOXML.W_NS) continue;

    if (lEl.localName === W.t) {
      const full = lEl.textContent ?? '';
      const len = full.length;
      const start = pos;
      const end = pos + len;

      if (visibleOffset <= start) {
        // Entire element belongs to right
        lEl.parentNode?.removeChild(lEl);
        pos += len;
        continue;
      }
      if (visibleOffset >= end) {
        // Entire element belongs to left
        rEl.parentNode?.removeChild(rEl);
        pos += len;
        continue;
      }

      // Split inside this element
      const leftText = full.slice(0, visibleOffset - start);
      const rightText = full.slice(visibleOffset - start);
      lEl.textContent = leftText;
      rEl.textContent = rightText;
      setXmlSpacePreserve(lEl, leftText);
      setXmlSpacePreserve(rEl, rightText);
      if (!leftText) lEl.parentNode?.removeChild(lEl);
      if (!rightText) rEl.parentNode?.removeChild(rEl);
      pos += len;
    } else if (lEl.localName === W.tab || lEl.localName === W.br) {
      if (visibleOffset <= pos) {
        lEl.parentNode?.removeChild(lEl);
      } else {
        rEl.parentNode?.removeChild(rEl);
      }
      pos += 1;
    } else {
      // Non-visible elements (rPr is already handled by cloneNode)
      if (lEl.localName !== W.rPr) {
        if (pos < visibleOffset) rEl.parentNode?.removeChild(rEl);
        else lEl.parentNode?.removeChild(lEl);
      }
    }
  }

  // Insert the reference run between left and right
  parent.insertBefore(referenceNode, rightRun);

  // Clean up empty runs
  if (!hasVisibleContent(run)) run.parentNode?.removeChild(run);
  if (!hasVisibleContent(rightRun)) rightRun.parentNode?.removeChild(rightRun);
}

function getDirectContentElements(run: Element): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType !== 1) continue;
    out.push(child as Element);
  }
  return out;
}

function hasVisibleContent(run: Element): boolean {
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI !== OOXML.W_NS) continue;
    if (el.localName === W.rPr) continue;
    return true;
  }
  return false;
}

function setXmlSpacePreserve(t: Element, text: string): void {
  if (!text) return;
  if (text.startsWith(' ') || text.endsWith(' ')) {
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  }
}

function addFootnoteElement(
  footnotesDoc: Document,
  noteId: number,
  text: string,
  presentation?: FootnoteNotePresentation,
): Element {
  const root = footnotesDoc.documentElement;

  const footnoteEl = footnotesDoc.createElementNS(OOXML.W_NS, 'w:footnote');
  footnoteEl.setAttributeNS(OOXML.W_NS, 'w:id', String(noteId));

  // Word-compatible body skeleton
  const p = footnotesDoc.createElementNS(OOXML.W_NS, 'w:p');

  // Paragraph properties with FootnoteText style
  const pPr = footnotesDoc.createElementNS(OOXML.W_NS, 'w:pPr');
  const pStyle = footnotesDoc.createElementNS(OOXML.W_NS, 'w:pStyle');
  pStyle.setAttributeNS(OOXML.W_NS, 'w:val', 'FootnoteText');
  pPr.appendChild(pStyle);
  p.appendChild(pPr);

  // footnoteRef run (required by Word to display the footnote number)
  const refRun = footnotesDoc.createElementNS(OOXML.W_NS, 'w:r');
  const refRPr = footnotesDoc.createElementNS(OOXML.W_NS, 'w:rPr');
  const refRStyle = footnotesDoc.createElementNS(OOXML.W_NS, 'w:rStyle');
  refRStyle.setAttributeNS(OOXML.W_NS, 'w:val', 'FootnoteReference');
  refRPr.appendChild(refRStyle);
  const refVertAlign = footnotesDoc.createElementNS(OOXML.W_NS, 'w:vertAlign');
  refVertAlign.setAttributeNS(OOXML.W_NS, 'w:val', 'superscript');
  refRPr.appendChild(refVertAlign);
  refRun.appendChild(refRPr);
  const fnRefEl = footnotesDoc.createElementNS(OOXML.W_NS, 'w:footnoteRef');
  refRun.appendChild(fnRefEl);
  p.appendChild(refRun);

  // Space separator run
  const spaceRun = footnotesDoc.createElementNS(OOXML.W_NS, 'w:r');
  const spaceT = footnotesDoc.createElementNS(OOXML.W_NS, 'w:t');
  spaceT.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  spaceT.appendChild(footnotesDoc.createTextNode(' '));
  spaceRun.appendChild(spaceT);
  p.appendChild(spaceRun);

  if (presentation?.prefix) {
    p.appendChild(buildStyledTextRun(footnotesDoc, presentation.prefix, presentation.prefixStyle));
    if (presentation.prefixSeparator) {
      p.appendChild(buildStyledTextRun(footnotesDoc, presentation.prefixSeparator));
    }
  }
  p.appendChild(buildStyledTextRun(footnotesDoc, text, presentation?.bodyStyle));

  footnoteEl.appendChild(p);
  root.appendChild(footnoteEl);
  return footnoteEl;
}

function buildStyledTextRun(doc: Document, text: string, style?: FootnoteRunStyle): Element {
  const run = doc.createElementNS(OOXML.W_NS, 'w:r');
  if (style && Object.values(style).some((value) => value !== undefined && value !== false)) {
    const rPr = doc.createElementNS(OOXML.W_NS, 'w:rPr');
    const onOff = (name: string): void => {
      const el = doc.createElementNS(OOXML.W_NS, `w:${name}`);
      rPr.appendChild(el);
    };
    if (style.bold) onOff('b');
    if (style.italic) onOff('i');
    if (style.underline) {
      const u = doc.createElementNS(OOXML.W_NS, 'w:u');
      u.setAttributeNS(OOXML.W_NS, 'w:val', 'single');
      rPr.appendChild(u);
    }
    if (style.color) {
      const color = doc.createElementNS(OOXML.W_NS, 'w:color');
      color.setAttributeNS(OOXML.W_NS, 'w:val', style.color);
      rPr.appendChild(color);
    }
    if (style.highlight && style.highlight !== 'none') {
      const highlight = doc.createElementNS(OOXML.W_NS, 'w:highlight');
      highlight.setAttributeNS(OOXML.W_NS, 'w:val', style.highlight);
      rPr.appendChild(highlight);
    }
    run.appendChild(rPr);
  }
  const t = doc.createElementNS(OOXML.W_NS, 'w:t');
  if (text.startsWith(' ') || text.endsWith(' ')) {
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  }
  t.appendChild(doc.createTextNode(text));
  run.appendChild(t);
  return run;
}

// ── Update ──────────────────────────────────────────────────────────────

export async function updateFootnoteText(
  zip: DocxZip,
  params: { noteId: number; newText: string },
  ctx?: RevisionContext,
): Promise<void> {
  const { noteId, newText } = params;

  const footnotesXml = await zip.readText('word/footnotes.xml');
  const footnotesDoc = parseXml(footnotesXml);

  const fnEl = findFootnoteById(footnotesDoc, noteId);
  if (!fnEl) throw new Error(`Footnote ID ${noteId} not found`);
  if (isReservedFootnote(fnEl)) throw new Error(`Cannot update reserved footnote ID ${noteId}`);

  // Find first paragraph
  const paragraphs = fnEl.getElementsByTagNameNS(OOXML.W_NS, W.p);
  if (paragraphs.length === 0) throw new Error(`Footnote ID ${noteId} has no paragraphs`);

  const firstP = paragraphs.item(0) as Element;

  if (ctx) {
    // The deletion wrapper may land inside an existing revision container if
    // the prior text already carried a tracked-change wrapper (e.g., another
    // author had inserted that text). Always hoist the AI's replacement
    // insertion to the paragraph level so its w:author attribution is not
    // nested inside the prior author's wrapper.
    wrapFootnoteParagraphTextRuns(firstP, 'del', ctx);
    const insertion = createRevisionContainer(footnotesDoc, 'ins', ctx);
    const [spaceRun, textRun] = buildFootnoteTextRuns(footnotesDoc, newText);
    insertion.appendChild(spaceRun);
    insertion.appendChild(textRun);
    firstP.appendChild(insertion);
  } else {
    removeFootnoteParagraphTextRuns(firstP);
    const [spaceRun, textRun] = buildFootnoteTextRuns(footnotesDoc, newText);
    firstP.appendChild(spaceRun);
    firstP.appendChild(textRun);
  }

  zip.writeText('word/footnotes.xml', serializeXml(footnotesDoc));
}

// ── Deletion ────────────────────────────────────────────────────────────

export async function deleteFootnote(
  documentXml: Document,
  zip: DocxZip,
  params: { noteId: number },
  ctx?: RevisionContext,
): Promise<void> {
  const { noteId } = params;

  const footnotesXml = await zip.readText('word/footnotes.xml');
  const footnotesDoc = parseXml(footnotesXml);

  const fnEl = findFootnoteById(footnotesDoc, noteId);
  if (!fnEl) throw new Error(`Footnote ID ${noteId} not found`);
  if (isReservedFootnote(fnEl)) throw new Error(`Cannot delete reserved footnote ID ${noteId}`);

  if (ctx) {
    // Wrap text runs across ALL paragraphs in the footnote, not just the first.
    // A multi-paragraph footnote with only the first paragraph wrapped would
    // leave a "zombie" footnote where paragraphs 2+ still appear active under
    // accept-all. Iterate every paragraph in the footnote element.
    const paragraphs = fnEl.getElementsByTagNameNS(OOXML.W_NS, W.p);
    for (let i = 0; i < paragraphs.length; i++) {
      wrapFootnoteParagraphTextRuns(paragraphs.item(i) as Element, 'del', ctx);
    }
  } else {
    fnEl.parentNode?.removeChild(fnEl);
  }
  zip.writeText('word/footnotes.xml', serializeXml(footnotesDoc));

  // Remove or track-delete footnoteReference elements from document.xml
  const refs = documentXml.getElementsByTagNameNS(OOXML.W_NS, W.footnoteReference);
  const refsToRemove: Element[] = [];

  for (let i = 0; i < refs.length; i++) {
    const ref = refs.item(i) as Element;
    const idStr = getWAttr(ref, 'id');
    if (idStr && parseInt(idStr, 10) === noteId) {
      refsToRemove.push(ref);
    }
  }

  for (const ref of refsToRemove) {
    const run = ref.parentNode as Element | null;
    if (!run) continue;

    if (ctx) {
      const isolatedRun = isolateReferenceRun(run, ref);
      const parent = isolatedRun.parentNode;
      if (!parent) continue;

      const deletion = createRevisionContainer(documentXml, 'del', ctx);
      parent.replaceChild(deletion, isolatedRun);
      deletion.appendChild(prepareElementForDeletion(isolatedRun));
      continue;
    }

    // Remove only the footnoteReference element, not the entire run
    run.removeChild(ref);

    // If the run is now empty (no visible content), remove it
    if (!hasVisibleContent(run)) {
      run.parentNode?.removeChild(run);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findFootnoteById(footnotesDoc: Document, noteId: number): Element | null {
  const fnEls = footnotesDoc.getElementsByTagNameNS(OOXML.W_NS, W.footnote);
  for (let i = 0; i < fnEls.length; i++) {
    const el = fnEls.item(i) as Element;
    const idStr = getWAttr(el, 'id');
    if (idStr && parseInt(idStr, 10) === noteId) return el;
  }
  return null;
}

function getFirstFootnoteParagraph(footnoteEl: Element): Element {
  const paragraphs = footnoteEl.getElementsByTagNameNS(OOXML.W_NS, W.p);
  if (paragraphs.length === 0) {
    throw new Error(`Footnote ID ${getWAttr(footnoteEl, 'id') ?? '(unknown)'} has no paragraphs`);
  }
  return paragraphs.item(0) as Element;
}

function buildFootnoteTextRuns(doc: Document, text: string): [Element, Element] {
  const spaceRun = doc.createElementNS(OOXML.W_NS, 'w:r');
  const spaceT = doc.createElementNS(OOXML.W_NS, 'w:t');
  spaceT.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  spaceT.appendChild(doc.createTextNode(' '));
  spaceRun.appendChild(spaceT);

  const textRun = doc.createElementNS(OOXML.W_NS, 'w:r');
  const t = doc.createElementNS(OOXML.W_NS, 'w:t');
  if (text.startsWith(' ') || text.endsWith(' ')) {
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  }
  t.appendChild(doc.createTextNode(text));
  textRun.appendChild(t);

  return [spaceRun, textRun];
}

function removeFootnoteParagraphTextRuns(paragraph: Element): void {
  const collected = collectFootnoteTextRuns(paragraph);
  if (!collected) return;

  for (const run of collected.runs) {
    run.parentNode?.removeChild(run);
  }

  cleanupEmptyRevisionWrappers(paragraph);
}

function wrapFootnoteParagraphTextRuns(
  paragraph: Element,
  kind: 'ins' | 'del',
  ctx: RevisionContext,
): Element | null {
  const collected = collectFootnoteTextRuns(paragraph);
  if (!collected) return null;

  const doc = paragraph.ownerDocument;
  if (!doc) throw new Error('Paragraph has no ownerDocument');

  const { parent: anchorParent, before: anchorBefore } = collected.insertionAnchor;
  const wrapper = createRevisionContainer(doc, kind, ctx);
  anchorParent.insertBefore(wrapper, anchorBefore);

  for (const run of collected.runs) {
    run.parentNode?.removeChild(run);
    wrapper.appendChild(kind === 'del' ? prepareElementForDeletion(run) : run);
  }

  cleanupEmptyRevisionWrappers(paragraph);

  return wrapper;
}

/**
 * Collect every `<w:r>` descendant of the paragraph that does NOT contain a
 * `footnoteRef` marker. This intentionally crosses into `<w:ins>` / `<w:del>`
 * wrappers so that footnote text already carrying revision history (e.g.,
 * third-party documents or prior tracked edits in the same session) is still
 * captured by `updateFootnoteText` and `deleteFootnote`. The first-found
 * insertion-anchor (the parent of the first match) is returned so callers
 * can place a new wrapper at the same structural position.
 */
function collectFootnoteTextRuns(paragraph: Element): {
  insertionAnchor: { parent: Element; before: Node | null };
  runs: Element[];
} | null {
  const collected: Array<{ parent: Element; run: Element }> = [];

  function visit(parent: Element): void {
    for (const child of childElements(parent)) {
      if (isW(child, W.r)) {
        if (!runContainsFootnoteRef(child)) {
          collected.push({ parent, run: child });
        }
        continue;
      }
      if (isW(child, 'ins') || isW(child, 'del')) {
        visit(child);
      }
    }
  }

  visit(paragraph);

  if (collected.length === 0) return null;

  const first = collected[0]!;
  return {
    insertionAnchor: { parent: first.parent, before: first.run },
    runs: collected.map((entry) => entry.run),
  };
}

function runContainsFootnoteRef(run: Element): boolean {
  return run.getElementsByTagNameNS(OOXML.W_NS, W.footnoteRef).length > 0;
}

/**
 * After detaching runs from their parents, sweep up any now-empty
 * `<w:ins>`/`<w:del>` siblings of the paragraph so we do not leave orphan
 * revision wrappers behind. This pairs with `collectFootnoteTextRuns`'s
 * cross-wrapper traversal.
 */
function cleanupEmptyRevisionWrappers(paragraph: Element): void {
  for (const child of Array.from(childElements(paragraph))) {
    if ((isW(child, 'ins') || isW(child, 'del')) && childElements(child).length === 0) {
      paragraph.removeChild(child);
    }
  }
}

function isolateReferenceRun(run: Element, ref: Element): Element {
  if (canWrapRunAsIs(run, ref)) {
    return run;
  }

  const parent = run.parentNode;
  const doc = run.ownerDocument;
  if (!parent || !doc) {
    throw new Error('Footnote reference run is detached');
  }

  const beforeNodes: Node[] = [];
  const afterNodes: Node[] = [];
  let seenRef = false;

  for (const child of Array.from(run.childNodes)) {
    if (child === ref) {
      seenRef = true;
      continue;
    }
    if (child.nodeType === 1 && isW(child as Element, W.rPr)) {
      continue;
    }
    if (seenRef) {
      afterNodes.push(child);
    } else {
      beforeNodes.push(child);
    }
  }

  const beforeRun = beforeNodes.length > 0 ? cloneRunShell(run) : null;
  const referenceRun = cloneRunShell(run);
  const afterRun = afterNodes.length > 0 ? cloneRunShell(run) : null;

  if (beforeRun) {
    parent.insertBefore(beforeRun, run);
    for (const child of beforeNodes) {
      beforeRun.appendChild(child);
    }
  }

  parent.insertBefore(referenceRun, run);
  run.removeChild(ref);
  referenceRun.appendChild(ref);

  if (afterRun) {
    parent.insertBefore(afterRun, run);
    for (const child of afterNodes) {
      afterRun.appendChild(child);
    }
  }

  parent.removeChild(run);
  return referenceRun;
}

function canWrapRunAsIs(run: Element, ref: Element): boolean {
  for (const child of childElements(run)) {
    if (child === ref) continue;
    if (isW(child, W.rPr)) continue;
    return false;
  }
  return true;
}

function cloneRunShell(run: Element): Element {
  const doc = run.ownerDocument;
  if (!doc) throw new Error('Run has no ownerDocument');

  const clone = doc.createElementNS(OOXML.W_NS, 'w:r');
  for (const child of childElements(run)) {
    if (isW(child, W.rPr)) {
      clone.appendChild(child.cloneNode(true));
      break;
    }
  }
  return clone;
}
