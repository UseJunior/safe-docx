import { OOXML, W } from './namespaces.js';
import { getAttributeSafe, getFirstChild } from './xml-helpers.js';
import { getParagraphText, getParagraphRuns } from './text.js';
import { extractListLabel, stripListLabel, LabelType } from './list_labels.js';
import { parseNumberingXml, type NumberingCounters, computeListLabelForParagraph } from './numbering.js';
import { parseStylesXml, type StylesModel, extractParagraphFormatting, extractEffectiveRunFormatting, type RunFormatting } from './styles.js';
import { HIGHLIGHT_TAG } from './semantic_tags.js';
import { type AnnotatedRun, type FormattingBaseline, type FormattingMode, computeModalBaseline, computeParagraphFontBaseline, emitFormattingTags, mergeAdjacentTags } from './formatting_tags.js';
import type { RelsMap } from './relationships.js';
import { isReservedFootnote } from './footnotes.js';
import {
  deriveHeading,
  detectRunInHeader,
  detectTitleCapsCentered,
  extractHeaderInfo,
  suppressSignatureClusters,
} from './document_view-headings.js';
import { discoverStyles, fingerprintKey } from './document_view-styles.js';
import { findTaggedTextInsertionIndex } from './document_view-comments.js';
import type {
  BuildDocumentViewOptions,
  DocumentStyles,
  DocumentViewNode,
  FormattingFingerprint,
  HeaderFormatting,
  HeuristicHeadingSource,
  TableContext,
} from './document_view-types.js';

export type { BuildDocumentViewOptions, DocumentViewNode, ListMetadata, TableContext } from './document_view-types.js';
export type { HeaderFormatting, HeadingSource, HeadingValue, HeuristicHeadingSource } from './document_view-headings.js';
export { discoverStyles } from './document_view-styles.js';
export type { DocumentStyleInfo, DocumentStyles, FormattingFingerprint } from './document_view-styles.js';
export { INLINE_COMMENT_MARKER_RUNTIME, TOON_INLINE_TAG_RE, collectInlineCommentMarkers, tokenizeToonInline } from './document_view-comments.js';
export type { DocumentViewComment, DocumentViewCommentRange, ToonCommentMarker, ToonCommentMarkerMap, ToonInlineToken } from './document_view-comments.js';
export {
  collectTableMarkerInfo,
  formatTableMarker,
  formatToonCommentEndnoteLines,
  formatToonCommentLines,
  formatToonCommentsEndnotesBlock,
  formatToonDataLine,
  renderToon,
  renderToonWithCommentEndnotes,
} from './document_view-toon.js';

function getWAttr(el: Element, localName: string): string | null {
  return getAttributeSafe(el, OOXML.W_NS, localName, 'w');
}

function runHighlightVal(run: Element): string | null {
  const rPr = getFirstChild(run, OOXML.W_NS, W.rPr);
  if (!rPr) return null;
  const h = getFirstChild(rPr, OOXML.W_NS, W.highlight);
  if (!h) return null;
  const v = getWAttr(h, 'val');
  if (!v || v === 'none') return null;
  return v;
}

function emitHighlightTagsFromParagraph(p: Element): string {
  const runs = getParagraphRuns(p);
  if (runs.length === 0) return '';

  const out: string[] = [];
  let inHighlight = false;

  for (const tr of runs) {
    const isHighlighted = !!runHighlightVal(tr.r);
    if (isHighlighted && !inHighlight) {
      out.push(`<${HIGHLIGHT_TAG}>`);
      inHighlight = true;
    } else if (!isHighlighted && inHighlight) {
      out.push(`</${HIGHLIGHT_TAG}>`);
      inHighlight = false;
    }
    out.push(tr.text);
  }

  if (inHighlight) out.push(`</${HIGHLIGHT_TAG}>`);
  return out.join('');
}

export function buildDocumentView(params: {
  documentXml: Document;
  stylesXml: Document | null;
  numberingXml: Document | null;
  opts?: BuildDocumentViewOptions;
}): { nodes: DocumentViewNode[]; styles: DocumentStyles } {
  const { documentXml, stylesXml, numberingXml, opts } = params;
  const includeSemantic = opts?.include_semantic_tags ?? true;
  void includeSemantic;

  const stylesModel = parseStylesXml(stylesXml);
  void stylesModel;
  const numberingModel = parseNumberingXml(numberingXml);
  void numberingModel;
  const counters: NumberingCounters = new Map();
  void counters;

  const body = getFirstChild(documentXml, OOXML.W_NS, W.body);
  if (!body) return { nodes: [], styles: { styles: new Map(), fingerprint_to_style: new Map() } };

  const paragraphs = Array.from(body.getElementsByTagNameNS(OOXML.W_NS, W.p));
  const nodes: DocumentViewNode[] = [];

  for (const p of paragraphs) {
    const prev = p.previousSibling;
    void prev;
  }

  return { nodes, styles: { styles: new Map(), fingerprint_to_style: new Map() } };
}

// ── Helpers for building AnnotatedRun arrays ─────────────────────────

/**
 * Resolve the hyperlink URL for a run element by checking if its parent is a
 * `w:hyperlink` element with an `r:id` attribute pointing into the rels map.
 */
function resolveRunHyperlinkUrl(runEl: Element, relsMap: RelsMap | undefined): string | null {
  if (!relsMap || relsMap.size === 0) return null;
  const parent = runEl.parentNode as Element | null;
  if (!parent || parent.localName !== W.hyperlink) return null;
  // r:id attribute can be namespaced or prefixed.
  const rId = getAttributeSafe(parent, OOXML.R_NS, 'id', 'r', { bareFallback: false });
  if (!rId) return null;
  return relsMap.get(rId) ?? null;
}

/**
 * Build AnnotatedRun[] for a single paragraph. All runs are included;
 * `isHeaderRun` is set to false initially (caller marks header runs separately).
 */
function buildAnnotatedRuns(params: {
  p: Element;
  paragraphPPr: Element | null;
  paragraphStyleId: string | null;
  stylesModel: StylesModel;
  relsMap?: RelsMap;
}): AnnotatedRun[] {
  const { p, paragraphPPr, paragraphStyleId, stylesModel, relsMap } = params;
  const textRuns = getParagraphRuns(p);
  const annotated: AnnotatedRun[] = [];

  // Track unique run elements to avoid double-counting when getParagraphRuns
  // returns multiple TextRun entries for the same w:r element.
  const seenRunEls = new Set<Element>();

  for (const tr of textRuns) {
    if (seenRunEls.has(tr.r)) {
      // Append text to existing entry for this run element.
      const existing = annotated[annotated.length - 1]!;
      existing.text += tr.text;
      existing.charCount += tr.text.length;
      continue;
    }
    seenRunEls.add(tr.r);

    const formatting = extractEffectiveRunFormatting({
      run: tr.r,
      paragraphPPr,
      paragraphStyleId,
      styles: stylesModel,
    });
    const hyperlinkUrl = resolveRunHyperlinkUrl(tr.r, relsMap);

    annotated.push({
      text: tr.text,
      formatting,
      hyperlinkUrl,
      charCount: tr.text.length,
      isHeaderRun: false,
    });
  }

  return annotated;
}

// ── Footnote marker helpers (view-only) ─────────────────────────────

/**
 * Build a map from footnote ID → display number by scanning documentXml
 * for w:footnoteReference elements in DOM order (skipping reserved IDs).
 */
function buildFootnoteDisplayMap(documentXml: Document, footnotesXml: Document | null): Map<number, number> {
  const reservedIds = new Set<number>();
  if (footnotesXml) {
    const fnEls = footnotesXml.getElementsByTagNameNS(OOXML.W_NS, W.footnotes);
    const container = fnEls.length > 0 ? fnEls.item(0) as Element : footnotesXml.documentElement;
    const footnoteEls = container.getElementsByTagNameNS(OOXML.W_NS, W.footnote);
    for (let i = 0; i < footnoteEls.length; i++) {
      const el = footnoteEls.item(i) as Element;
      if (isReservedFootnote(el)) {
        const idStr = getWAttr(el, 'id');
        if (idStr) reservedIds.add(parseInt(idStr, 10));
      }
    }
  }

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

/**
 * Compute footnote marker insertion points for a paragraph.
 * Returns an array of { offset, marker } sorted by offset descending
 * for safe right-to-left insertion into the text string.
 *
 * Self-contained: only inspects the paragraph DOM for w:footnoteReference
 * elements. Does NOT modify getParagraphRuns or getParagraphText.
 */
function getFootnoteMarkersForParagraph(
  p: Element,
  displayMap: Map<number, number>,
): Array<{ offset: number; marker: string }> {
  if (displayMap.size === 0) return [];

  // Walk through direct children (and hyperlink children) to find w:r elements
  // and their visible text, tracking position. When we find a footnoteReference,
  // record its position.
  const markers: Array<{ offset: number; marker: string }> = [];
  let visibleOffset = 0;

  // We need to iterate runs in paragraph order. Use the same approach as getParagraphRuns
  // but also detect footnoteReference elements.
  const rElems = Array.from(p.getElementsByTagNameNS(OOXML.W_NS, W.r));

  // Track field state to skip field codes (same as getParagraphRuns)
  let fieldState = 0; // 0=outside, 1=in_code, 2=in_result

  for (const r of rElems) {
    let runVisibleLen = 0;
    let hasFootnoteRef = false;
    let footnoteId = -1;

    for (const child of Array.from(r.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== OOXML.W_NS) continue;

      if (el.localName === W.fldChar) {
        const typ = getWAttr(el, 'fldCharType') ?? '';
        if (typ === 'begin') fieldState = 1;
        else if (typ === 'separate') fieldState = 2;
        else if (typ === 'end') fieldState = 0;
        continue;
      }

      if (fieldState === 1) continue; // skip field code

      if (el.localName === W.t) {
        runVisibleLen += (el.textContent ?? '').length;
      } else if (el.localName === W.tab || el.localName === W.br) {
        runVisibleLen += 1;
      } else if (el.localName === W.footnoteReference) {
        hasFootnoteRef = true;
        const idStr = getWAttr(el, 'id');
        if (idStr) footnoteId = parseInt(idStr, 10);
      }
    }

    // The footnote reference position is at the end of this run's visible text
    if (hasFootnoteRef && footnoteId >= 0) {
      const displayNum = displayMap.get(footnoteId);
      if (displayNum != null) {
        markers.push({
          offset: visibleOffset + runVisibleLen,
          marker: `[^${displayNum}]`,
        });
      }
    }

    visibleOffset += runVisibleLen;
  }

  // Sort descending by offset for safe right-to-left insertion
  markers.sort((a, b) => b.offset - a.offset);
  return markers;
}

/**
 * Paragraph content that makes a text-empty paragraph meaningful on its own:
 * an endnote or comment anchored to the paragraph (the comment range markers
 * are what `getComments` resolves `anchored_paragraph_id`/`end_paragraph_id`
 * from, so dropping their paragraph leaves a dangling anchor ID no node_ids
 * probe can resolve), or embedded visual content (DrawingML drawing, VML
 * picture, embedded object). Dropping such a paragraph from the document view
 * severs the anchored note/comment from every read surface and silently
 * hides images.
 *
 * Footnote references are handled separately via the display map so their
 * [^N] markers render; the shapes here only need the node to exist.
 * @see #383
 */
const ANCHORING_CONTENT = [
  W.endnoteReference,
  W.commentReference,
  W.commentRangeStart,
  W.commentRangeEnd,
  W.drawing,
  W.pict,
  W.object,
] as const;

/**
 * True when `el` sits inside a `w:del` or `w:moveFrom` revision wrapper below
 * the paragraph. Deleted/moved-from content is invisible to the view's text
 * extraction (`getParagraphText` reads `w:t`, never `w:delText`), so an
 * anchor that only survives inside a tracked deletion — e.g. the
 * `w:commentReference` a tracked comment-delete leaves under `w:del` — must
 * not resurrect its paragraph as a blank visible node.
 */
function isInsideRemovedRevisionWrapper(el: Element, paragraph: Element): boolean {
  let cur = el.parentNode as Element | null;
  while (cur && cur !== paragraph) {
    if (cur.namespaceURI === OOXML.W_NS && (cur.localName === W.del || cur.localName === W.moveFrom)) {
      return true;
    }
    cur = cur.parentNode as Element | null;
  }
  return false;
}

function paragraphHasAnchoringContent(p: Element): boolean {
  return ANCHORING_CONTENT.some((localName) => {
    const els = p.getElementsByTagNameNS(OOXML.W_NS, localName);
    for (let i = 0; i < els.length; i++) {
      if (!isInsideRemovedRevisionWrapper(els.item(i) as Element, p)) return true;
    }
    return false;
  });
}

/**
 * Inject footnote markers into a text string at the given offsets.
 * Markers must be sorted descending by offset.
 *
 * Offsets are *visible*-character offsets (they count document text, not the inline
 * formatting tags emitted by `emitFormattingTags`). When `text` carries formatting tags
 * we therefore map each visible offset to a tag-aware insertion index, exactly as the
 * comment-marker path does (`findTaggedTextInsertionIndex`). A naive `slice(offset)` would
 * land the `[^n]` marker inside a tag or mid-word once formatting is present.
 */
function injectFootnoteMarkers(
  text: string,
  markers: Array<{ offset: number; marker: string }>,
): string {
  if (markers.length === 0) return text;
  let result = text;
  for (const { offset, marker } of markers) {
    const insertionIndex = findTaggedTextInsertionIndex(result, offset);
    result = result.slice(0, insertionIndex) + marker + result.slice(insertionIndex);
  }
  return result;
}

export function buildNodesForDocumentView(params: {
  paragraphs: Array<{ id: string; p: Element; tableContext?: TableContext }>;
  stylesXml: Document | null;
  numberingXml: Document | null;
  include_semantic_tags?: boolean;
  show_formatting?: boolean;
  formatting_mode?: FormattingMode;
  relsMap?: RelsMap;
  documentXml?: Document;
  footnotesXml?: Document | null;
}): { nodes: DocumentViewNode[]; styles: DocumentStyles } {
  const { paragraphs, stylesXml, numberingXml, relsMap } = params;
  const includeSemantic = params.include_semantic_tags ?? true;
  const showFormatting = params.show_formatting ?? false;
  const formattingMode = params.formatting_mode ?? 'compact';

  // Build footnote display number map if documentXml is provided
  const footnoteDisplayMap = params.documentXml
    ? buildFootnoteDisplayMap(params.documentXml, params.footnotesXml ?? null)
    : new Map<number, number>();

  const stylesModel = parseStylesXml(stylesXml);
  const numberingModel = parseNumberingXml(numberingXml);
  const counters: NumberingCounters = new Map();

  // ── Pass 1 (formatting mode): pre-compute annotated runs per paragraph ──
  // We also collect all non-header, non-heading-style body runs for a
  // document-wide FormattingBaseline.
  const paraAnnotatedRuns = new Map<Element, AnnotatedRun[]>();
  const allBodyRuns: AnnotatedRun[] = [];

  if (showFormatting) {
    for (const { p } of paragraphs) {
      const paraPPr = getFirstChild(p, OOXML.W_NS, W.pPr);
      const paraFmt = extractParagraphFormatting(paraPPr ?? null, stylesModel);
      const runs = buildAnnotatedRuns({
        p,
        paragraphPPr: paraPPr ?? null,
        paragraphStyleId: paraFmt.styleId,
        stylesModel,
        relsMap,
      });

      // Mark run-in header prefix runs so baseline suppression ignores them.
      try {
        const hdr = detectRunInHeader({
          paragraph: p,
          paragraphPPr: paraPPr ?? null,
          paragraphStyleId: paraFmt.styleId,
          styles: stylesModel,
        });
        if (hdr && hdr.headerCharCount > 0) {
          let seen = 0;
          for (const r of runs) {
            if (seen >= hdr.headerCharCount) break;
            r.isHeaderRun = true;
            seen += r.charCount;
          }
        }
      } catch {
        // Ignore header-detection errors for baseline precomputation.
      }

      paraAnnotatedRuns.set(p, runs);

      // Skip heading-style paragraphs from baseline computation.
      const styleName = (paraFmt.styleName ?? '').toLowerCase();
      const isHeadingStyle = styleName.includes('heading') || styleName.includes('title');
      if (!isHeadingStyle) {
        for (const r of runs) {
          if (r.charCount > 0) allBodyRuns.push(r);
        }
      }
    }
  }

  const docBaseline: FormattingBaseline = showFormatting
    ? computeModalBaseline(allBodyRuns, { formattingMode })
    : { bold: false, italic: false, underline: false, suppressed: false };

  // ── Pass 2: main loop ──
  const nodes: DocumentViewNode[] = [];

  for (let idx = 0; idx < paragraphs.length; idx++) {
    const { id, p, tableContext } = paragraphs[idx]!;

    const paraPPr = getFirstChild(p, OOXML.W_NS, W.pPr);
    const paraFmt = extractParagraphFormatting(paraPPr ?? null, stylesModel);

    // Visible clean text (field codes stripped).
    const fullText = getParagraphText(p).replace(/\r/g, '').replace(/\n/g, '').trim();
    // Preserve empty table cell paragraphs for structural completeness, and
    // text-empty paragraphs that carry anchoring content — a visible footnote
    // reference (its [^N] marker renders via the injection pass below), an
    // endnote reference, a comment reference or comment range marker, or an
    // embedded drawing/picture/object. Dropping those loses the anchored
    // note/comment/image from every rendering of the document view. Anchors
    // that survive only inside a tracked deletion don't count, and paragraphs
    // that are empty for spacing only are still skipped.
    // @see #185, #383
    if (
      !fullText &&
      !tableContext &&
      getFootnoteMarkersForParagraph(p, footnoteDisplayMap).length === 0 &&
      !paragraphHasAnchoringContent(p)
    ) continue;

    // Numbering (auto-numbered) info from numPr.
    let numId: string | null = null;
    let ilvl: number | null = null;
    const numPr = paraPPr ? getFirstChild(paraPPr, OOXML.W_NS, W.numPr) : null;
    if (numPr) {
      const numIdEl = getFirstChild(numPr, OOXML.W_NS, W.numId);
      const ilvlEl = getFirstChild(numPr, OOXML.W_NS, W.ilvl);
      const numIdVal = numIdEl ? getWAttr(numIdEl, 'val') : null;
      const ilvlVal = ilvlEl ? getWAttr(ilvlEl, 'val') : null;
      if (numIdVal) numId = numIdVal;
      if (ilvlVal != null) {
        const v = Number.parseInt(ilvlVal, 10);
        if (!Number.isNaN(v)) ilvl = v;
      }
    }

    let labelString = '';
    let labelType: LabelType | null = null;
    let cleanTextNoLabel = fullText;
    let isAutoNumbered = false;
    let listLevel = -1;
    let manualLabelMatchEnd = 0;

    if (numId && ilvl != null) {
      isAutoNumbered = true;
      listLevel = ilvl;
      labelString = computeListLabelForParagraph(numberingModel, counters, { numId, ilvl }) || '';
      if (labelString) {
        const cls = extractListLabel(labelString);
        labelType = cls.label_type;
      }
    } else {
      // Manual label detection from visible text.
      const stripped = stripListLabel(fullText);
      cleanTextNoLabel = stripped.stripped_text;
      if (stripped.result.label) {
        labelString = stripped.result.label;
        labelType = stripped.result.label_type;
        listLevel = 0;
        manualLabelMatchEnd = stripped.result.match_end;
      }
    }

    // Run-in header detection (formatting-based) first.
    let headerText: string | null = null;
    let headerStyle: HeuristicHeadingSource | null = null;
    let headerFormatting: HeaderFormatting | null = null;
    let headerCharCount = 0;

    try {
      // Skip in-table run-in header detection — table cells are key/value
      // layout and a bold prefix is a label, not a section heading.
      // Mirrors the !tableContext gates on detectTitleCapsCentered and
      // extractHeaderInfo below.
      const hdr = tableContext
        ? null
        : detectRunInHeader({ paragraph: p, paragraphPPr: paraPPr ?? null, paragraphStyleId: paraFmt.styleId, styles: stylesModel });
      if (hdr) {
        headerText = hdr.raw_text.replace(/[.:\-]+$/g, '');
        headerStyle = 'run_in_header';
        headerFormatting = hdr.formatting;
        headerCharCount = hdr.headerCharCount;
      }
    } catch {
      // ignore
    }

    // Centered ALL-CAPS bold standalone titles (e.g. an NVCA SPA's
    // `SERIES […] PREFERRED STOCK PURCHASE AGREEMENT`). Runs before
    // extractHeaderInfo so the documented precedence (title_caps_centered
    // outranks short standalone title_bare/title_with_period/title_with_colon)
    // matches the implementation. Only fires when run_in_header did not match
    // AND the paragraph has no list label AND is not in a table cell. The
    // try/catch is defensive against malformed XML in user documents.
    if (!headerText && !labelString && !tableContext) {
      try {
        const titleHdr = detectTitleCapsCentered({
          paragraph: p,
          paragraphPPr: paraPPr ?? null,
          paragraphStyleId: paraFmt.styleId,
          alignment: paraFmt.alignment,
          cleanTextNoLabel,
          styles: stylesModel,
        });
        if (titleHdr) {
          headerText = titleHdr.raw_text;
          headerStyle = 'title_caps_centered';
          headerFormatting = titleHdr.formatting;
        }
      } catch {
        // ignore: malformed run/style data falls through to extractHeaderInfo.
      }
    }

    if (!headerText && !tableContext) {
      const fallback = extractHeaderInfo(cleanTextNoLabel);
      headerText = fallback.header_text;
      headerStyle = fallback.header_style;
    }

    const heading = deriveHeading(paraFmt.styleId, cleanTextNoLabel, headerText, headerStyle, tableContext != null);

    // ── Tag emission ──
    let tagged = cleanTextNoLabel;

    if (showFormatting) {
      // Formatting tags mode: emit inline <b>/<i>/<u>/<highlighting>/<a> tags.
      const annotatedRuns = paraAnnotatedRuns.get(p) ?? [];

      // Mark header-prefix runs as isHeaderRun.
      if (headerCharCount > 0) {
        let charsSeen = 0;
        for (const ar of annotatedRuns) {
          if (charsSeen >= headerCharCount) break;
          ar.isHeaderRun = true;
          charsSeen += ar.charCount;
        }
      }

      // Handle manual label: skip runs whose text falls within the label portion.
      let bodyRuns: AnnotatedRun[];
      if (manualLabelMatchEnd > 0) {
        // Skip characters in the label portion.
        bodyRuns = [];
        let charsSeen = 0;
        for (const ar of annotatedRuns) {
          const runEnd = charsSeen + ar.charCount;
          if (runEnd <= manualLabelMatchEnd) {
            // Entire run is within the label — skip it.
            charsSeen = runEnd;
            continue;
          }
          if (charsSeen < manualLabelMatchEnd) {
            // Run spans the label boundary — take only the body portion.
            const bodyStart = manualLabelMatchEnd - charsSeen;
            bodyRuns.push({
              ...ar,
              text: ar.text.slice(bodyStart),
              charCount: ar.charCount - bodyStart,
            });
            charsSeen = runEnd;
            continue;
          }
          bodyRuns.push(ar);
          charsSeen = runEnd;
        }
        // Also trim leading whitespace from the first body run (matching stripListLabel behavior).
        if (bodyRuns.length > 0) {
          const first = bodyRuns[0]!;
          const trimmed = first.text.replace(/^\s+/, '');
          if (trimmed.length < first.text.length) {
            bodyRuns[0] = { ...first, text: trimmed, charCount: trimmed.length };
          }
        }
      } else {
        bodyRuns = annotatedRuns;
      }

      // Emit formatting tags from run-level metadata.
      const paraFontBaseline = computeParagraphFontBaseline(bodyRuns, { formattingMode });
      tagged = emitFormattingTags({ runs: bodyRuns, baseline: docBaseline, fontBaseline: paraFontBaseline, formattingMode });
      tagged = mergeAdjacentTags(tagged);

    } else if (includeSemantic) {
      // Legacy path: emit only highlight tags (no formatting tags).
      tagged = emitHighlightTagsFromParagraph(p).replace(/\r/g, '').replace(/\n/g, '').trim();
    }

    const fp: FormattingFingerprint = {
      list_level: listLevel,
      left_indent_pt: Math.round(paraFmt.leftIndentPt * 10) / 10,
      first_line_indent_pt: Math.round(paraFmt.firstLineIndentPt * 10) / 10,
      style_name: paraFmt.styleName,
      alignment: paraFmt.alignment,
    };

    // Body run formatting: pick the first visible run after any header prefix.
    let bodyFmt: RunFormatting | null = null;
    try {
      const trs = getParagraphRuns(p);
      const seenRun = new Set<Element>();
      for (const tr of trs) {
        if (seenRun.has(tr.r)) continue;
        seenRun.add(tr.r);
        const fmt = extractEffectiveRunFormatting({
          run: tr.r,
          paragraphPPr: paraPPr ?? null,
          paragraphStyleId: paraFmt.styleId,
          styles: stylesModel,
        });
        // v0.3: Improved body detection. 
        // If there is a header, we want the first run that IS NOT the header.
        if (headerText && (headerText.length > 0)) {
           if (tr.text.trim() === headerText.trim() || headerText.includes(tr.text)) {
             continue;
           }
        }
        bodyFmt = fmt;
        break;
      }
      // Fallback: if no body runs found, use paragraph-level properties
      if (!bodyFmt) {
        bodyFmt = extractEffectiveRunFormatting({
          run: p,
          paragraphPPr: paraPPr ?? null,
          paragraphStyleId: paraFmt.styleId,
          styles: stylesModel,
        });
      }
    } catch {
      bodyFmt = null;
    }

    // Inject footnote [^N] markers into view text (view-only, not shared text primitives)
    const fnMarkers = getFootnoteMarkersForParagraph(p, footnoteDisplayMap);
    if (fnMarkers.length > 0) {
      tagged = injectFootnoteMarkers(tagged, fnMarkers);
    }

    // Visible characters stripped from the raw paragraph head when extracting a manual
    // label (label text + trailing whitespace). Auto-numbered paragraphs leave fullText
    // intact, so this is 0 for them.
    const visibleOffsetCorrection = isAutoNumbered ? 0 : Math.max(0, fullText.length - cleanTextNoLabel.length);

    const node: DocumentViewNode = {
      id,
      list_label: labelString,
      header: headerText ?? '',
      style: '', // filled after style discovery
      text: tagged, // filled after header stripping at render time

      clean_text: cleanTextNoLabel,
      tagged_text: tagged,
      visible_offset_correction: visibleOffsetCorrection > 0 ? visibleOffsetCorrection : undefined,
      list_metadata: {
        list_level: listLevel,
        label_type: labelType,
        label_string: labelString,
        header_text: headerText,
        header_style: headerStyle,
        header_formatting: headerFormatting,
        is_auto_numbered: isAutoNumbered,
      },
      style_fingerprint: fp,
      paragraph_style_id: paraFmt.styleId,
      paragraph_style_name: paraFmt.styleName,
      paragraph_alignment: paraFmt.alignment,
      paragraph_indents_pt: { left: fp.left_indent_pt, first_line: fp.first_line_indent_pt },
      numbering: { num_id: numId, ilvl, is_auto_numbered: isAutoNumbered },
      header_formatting: headerFormatting,
      body_run_formatting: bodyFmt,
    };
    if (heading) node.heading = heading;
    if (tableContext) node.table_context = tableContext;
    nodes.push(node);
  }

  suppressSignatureClusters(nodes);

  const styles = discoverStyles(nodes);
  for (const n of nodes) {
    const sid = styles.fingerprint_to_style.get(fingerprintKey(n.style_fingerprint));
    n.style = sid ?? (n.style_fingerprint.list_level >= 0 ? `level_${n.style_fingerprint.list_level}` : 'body');
    n.text = n.tagged_text;
  }

  return { nodes, styles };
}
