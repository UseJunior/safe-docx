import { OOXML, W } from './namespaces.js';
import { getAttributeSafe, getFirstChild } from './xml-helpers.js';
import { getParagraphText, getParagraphRuns } from './text.js';
import { extractListLabel, stripListLabel, LabelType } from './list_labels.js';
import { parseNumberingXml, type NumberingCounters, computeListLabelForParagraph } from './numbering.js';
import { parseStylesXml, type StylesModel, extractParagraphFormatting, extractEffectiveRunFormatting, type ParagraphAlignment, type RunFormatting } from './styles.js';
import { HIGHLIGHT_TAG } from './semantic_tags.js';
import { type AnnotatedRun, type FormattingBaseline, type FormattingMode, computeModalBaseline, computeParagraphFontBaseline, emitFormattingTags, mergeAdjacentTags } from './formatting_tags.js';
import type { RelsMap } from './relationships.js';
import { isReservedFootnote } from './footnotes.js';

const SHORT_HEADER_MAX_LENGTH = 50;
const MAX_HEADER_TEXT_LENGTH = 60;
// Centered ALL-CAPS titles (e.g. NVCA COI's `AMENDED AND RESTATED CERTIFICATE
// OF INCORPORATION OF FOO INC.`) routinely exceed 60 chars in real corporate
// documents. The 60-char cap on `extractHeaderInfo` exists to avoid emitting a
// "leading words = header" guess from long body prose, which doesn't apply to
// the standalone-title detector.
const MAX_CENTERED_TITLE_LENGTH = 120;
const STYLE_EXAMPLE_TEXT_PREVIEW_LENGTH = 50;

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

export type HeaderFormatting = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

export type HeadingSource =
  | 'word_style'
  | 'run_in_header'
  | 'title_with_period'
  | 'title_with_colon'
  | 'title_caps_centered'
  | 'title_bare';

export type HeuristicHeadingSource = Exclude<HeadingSource, 'word_style'>;

export type HeadingValue = {
  /**
   * Heading label text. Semantics depend on `source`:
   * - `word_style`: the full paragraph text (the entire paragraph IS the heading).
   * - All heuristic sources (`run_in_header`, `title_with_period`, `title_with_colon`,
   *   `title_caps_centered`, `title_bare`): only the extracted heading prefix.
   *   For example, on `"Indemnification. The Company shall …"` the value is
   *   `"Indemnification"`, not the whole paragraph.
   */
  text: string;
  source: HeadingSource;
  level: number | null;
};

export type ListMetadata = {
  list_level: number; // -1 for non-list
  label_type: LabelType | null;
  label_string: string;
  header_text: string | null;
  header_style: HeuristicHeadingSource | null;
  header_formatting: HeaderFormatting | null;
  is_auto_numbered: boolean;
};

export type FormattingFingerprint = {
  list_level: number;
  left_indent_pt: number;
  first_line_indent_pt: number;
  style_name: string;
  alignment: ParagraphAlignment;
};

export type DocumentStyleInfo = {
  style_id: string;
  display_name: string;
  fingerprint: FormattingFingerprint;
  example_node_id: string;
  example_text: string;
  count: number;
  dominant_alignment: ParagraphAlignment;
};

export type DocumentStyles = {
  styles: Map<string, DocumentStyleInfo>;
  fingerprint_to_style: Map<string, string>; // fingerprintKey -> style_id
};

export type TableContext = {
  table_id: string;         // "_tbl_0", "_tbl_1" — body-level table index
  table_index: number;      // 0-based among body-level w:tbl elements
  row_index: number;        // 0-based row within table (by w:tr position)
  col_index: number;        // Grid-aware column (accounts for gridSpan)
  col_header: string;       // Header text for this grid column (from row 0)
  total_rows: number;
  total_cols: number;       // Max grid columns (accounts for gridSpan)
  is_header_row: boolean;
  para_in_cell: number;     // 0-based paragraph index within cell
  cell_para_count: number;  // Total paragraphs in this cell
};

export type DocumentViewCommentRange = {
  startParagraphId: string;
  endParagraphId: string;
  startRunIndex?: number;
  startCharOffset?: number;
  endRunIndex?: number;
  endCharOffset?: number;
};

export type DocumentViewComment = {
  id: number;
  author: string;
  date: string | null;
  initials: string;
  text: string;
  replies: DocumentViewComment[];
  range?: DocumentViewCommentRange;
};

export const INLINE_COMMENT_MARKER_RUNTIME = Symbol('inline_comment_marker_runtime');

type InlineCommentMarkerRuntime = {
  startVisibleOffset: number;
  endVisibleOffset: number;
  suppressInlineMarkers: boolean;
};

type DocumentViewCommentWithRuntime = DocumentViewComment & {
  [INLINE_COMMENT_MARKER_RUNTIME]?: InlineCommentMarkerRuntime;
};

export type ToonCommentMarker = {
  offset: number;
  marker: string;
};

export type ToonCommentMarkerMap = Map<string, ToonCommentMarker[]>;

export type DocumentViewNode = {
  id: string; // _bk_*
  list_label: string;
  header: string;
  style: string;
  text: string;

  // Metadata for JSON mode / parity tooling.
  clean_text: string;
  tagged_text: string;
  list_metadata: ListMetadata;
  style_fingerprint: FormattingFingerprint;
  paragraph_style_id: string | null;
  paragraph_style_name: string;
  paragraph_alignment: ParagraphAlignment;
  paragraph_indents_pt: { left: number; first_line: number };
  numbering: { num_id: string | null; ilvl: number | null; is_auto_numbered: boolean };
  heading?: HeadingValue;
  header_formatting: HeaderFormatting | null;
  body_run_formatting: RunFormatting | null;
  table_context?: TableContext;
  comments?: DocumentViewComment[];
  /**
   * Number of visible characters stripped from the head of the raw paragraph text when
   * extracting a manual list label (and trimming the trailing whitespace). Used by the
   * inline-comment-marker injector to translate run/offset positions (which are computed
   * against the FULL paragraph visible text by `getComments()`) into positions within
   * `tagged_text` (which has the label stripped).
   *
   * Auto-numbered list paragraphs do NOT have their text stripped — their label lives in
   * the `list_label` field separately — so this stays 0 for them. Run-in header stripping
   * is handled separately at format time and is not included here.
   */
  visible_offset_correction?: number;
};

function fingerprintKey(fp: FormattingFingerprint): string {
  // Stable JSON-ish key used for Map lookups.
  return `${fp.list_level}|${fp.left_indent_pt.toFixed(1)}|${fp.first_line_indent_pt.toFixed(1)}|${fp.style_name}|${fp.alignment}`;
}

/**
 * v0.3: Compact style fingerprint token.
 * Concatenates style name, list level, alignment, and indentation for token-efficient LLM context.
 * Example: "Normal:L-1:LEFT:I0:H0"
 */
function computeFingerprintToken(fp: FormattingFingerprint, styleId?: string): string {
  const name = styleId || fp.style_name || 'body';
  const level = `L${fp.list_level}`;
  const align = fp.alignment;
  const indent = `I${Math.round(fp.left_indent_pt)}`;
  const hanging = `H${Math.round(fp.first_line_indent_pt)}`;
  return `${name}:${level}:${align}:${indent}:${hanging}`;
}

// Pattern-based header detection fallback (ported from Python ingestor._extract_header_info).
const HEADER_PATTERN = /^([A-Z][^.!?:]*(?:\s+[A-Z][^.!?:]*)*)([.:]?)(?:\s|$)/;

function extractHeaderInfo(cleanText: string): { header_text: string | null; header_style: HeuristicHeadingSource | null } {
  if (!cleanText || cleanText.length < 2) return { header_text: null, header_style: null };
  if (!/^[A-Z]/.test(cleanText)) return { header_text: null, header_style: null };

  const stripped = cleanText.trim();
  if (stripped.length <= SHORT_HEADER_MAX_LENGTH) {
    if (stripped.endsWith('.')) return { header_text: stripped.slice(0, -1), header_style: 'title_with_period' };
    if (stripped.endsWith(':')) return { header_text: stripped.slice(0, -1), header_style: 'title_with_colon' };

    const words = stripped.split(/\s+/);
    if (words.length <= 5) return { header_text: stripped, header_style: 'title_bare' };
    return { header_text: null, header_style: null };
  }

  const m = HEADER_PATTERN.exec(stripped);
  if (!m) return { header_text: null, header_style: null };
  const headerText = (m[1] ?? '').trim();
  const terminator = m[2] ?? '';
  const remaining = stripped.slice(m[0].length);
  if (!remaining || headerText.length > MAX_HEADER_TEXT_LENGTH) return { header_text: null, header_style: null };

  if (terminator === '.') return { header_text: headerText, header_style: 'title_with_period' };
  if (terminator === ':') return { header_text: headerText, header_style: 'title_with_colon' };
  // Long-paragraph regex matches without an explicit terminator are body prose
  // (e.g. "Termination of Section 2.2(d)(i) shall not affect ..."), not headers.
  // Bare titles only fire from the short-paragraph branch above.
  return { header_text: null, header_style: null };
}

function deriveHeading(
  paragraphStyleId: string | null,
  cleanText: string,
  headerText: string | null,
  headerStyle: HeuristicHeadingSource | null,
  isInTableCell: boolean,
): HeadingValue | undefined {
  const styleMatch = paragraphStyleId ? /^Heading([1-6])$/.exec(paragraphStyleId) : null;
  if (styleMatch) {
    return {
      text: cleanText,
      source: 'word_style',
      level: Number.parseInt(styleMatch[1]!, 10),
    };
  }

  // Inside table cells, heuristic detectors (run_in_header, title_with_period,
  // title_with_colon, title_bare) routinely fire on ordinary label/value content
  // — "Name", "Purchase Price:", "Name: Acme" — which are not structural document
  // headings. We keep the per-detector explanation on list_metadata.header_style
  // for debugging, but suppress heuristic promotion into the canonical heading
  // predicate. Word built-in heading styles inside cells remain real headings.
  if (isInTableCell) return undefined;

  if (headerText && headerStyle) {
    return {
      text: headerText,
      source: headerStyle,
      level: null,
    };
  }

  return undefined;
}

function detectRunInHeader(params: {
  paragraph: Element;
  paragraphPPr: Element | null;
  paragraphStyleId: string | null;
  styles: StylesModel;
}): { raw_text: string; formatting: HeaderFormatting; headerCharCount: number } | null {
  const { paragraph, paragraphPPr, paragraphStyleId, styles } = params;
  const punct = new Set(['.', ':', '-']);

  // Use visible runs only (field code text stripped in getParagraphRuns()).
  const runs = getParagraphRuns(paragraph);
  if (runs.length === 0) return null;

  // Group by run element, preserving order.
  const orderedUniqueRuns: Element[] = [];
  const seen = new Set<Element>();
  for (const tr of runs) {
    if (!seen.has(tr.r)) {
      seen.add(tr.r);
      orderedUniqueRuns.push(tr.r);
    }
  }

  // Walk runs once, splitting into bold/underline header-prefix text and
  // everything-after body text. The header → body transition is what
  // distinguishes a run-in header (bold prefix + body) from a fully-bold
  // signature label or defined-term lead-in.
  let headerText = '';
  let bodyText = '';
  let formatting: HeaderFormatting | null = null;
  let headerCharCount = 0;
  let inHeader = true;

  for (const r of orderedUniqueRuns) {
    const fmt = extractEffectiveRunFormatting({ run: r, paragraphPPr, paragraphStyleId, styles });
    const isHeaderStyle = fmt.bold || fmt.underline;
    const ts = Array.from(r.getElementsByTagNameNS(OOXML.W_NS, W.t));
    let runText = '';
    for (const t of ts) runText += t.textContent ?? '';

    if (inHeader && isHeaderStyle) {
      headerText += runText;
      headerCharCount += runText.length;
      if (!formatting) formatting = { bold: fmt.bold, italic: fmt.italic, underline: fmt.underline };
    } else {
      inHeader = false;
      bodyText += runText;
    }
  }

  const trimmed = headerText.trim();
  if (!trimmed) return null;
  if (!punct.has(trimmed[trimmed.length - 1]!)) return null;
  if (!formatting) return null;
  // Require a real header-prefix → body transition: there must be non-whitespace
  // body text after the bold/underline prefix. Trailing-whitespace-only "body"
  // (e.g. a single bold run followed by a non-bold run that holds just `" "`)
  // is not a transition — those are still whole-paragraph bold blocks
  // (signature labels, all-bold short titles, etc.) and must be rejected.
  if (!bodyText.trim()) return null;

  return { raw_text: trimmed, formatting, headerCharCount };
}

/**
 * Detect a centered, ALL-CAPS, bold standalone title (e.g. an NVCA SPA's
 * `SERIES […] PREFERRED STOCK PURCHASE AGREEMENT` title).
 *
 * Strict gates only — fires only when the paragraph cannot be confused with
 * body prose, a placeholder, or a signature line:
 *   - paragraph alignment is CENTER
 *   - clean text contains no lowercase letters
 *   - clean text contains ≥ 3 ASCII letters AND ≥ 2 whitespace-separated
 *     word-tokens (so single-token bracketed placeholders like `[COMPANY]`
 *     and underscore-only signature lines like `____________` are rejected)
 *   - clean text is non-empty and ≤ MAX_CENTERED_TITLE_LENGTH
 *   - all visible runs are bold (a single non-bold char disqualifies)
 */
function detectTitleCapsCentered(params: {
  paragraph: Element;
  paragraphPPr: Element | null;
  paragraphStyleId: string | null;
  alignment: ParagraphAlignment;
  cleanTextNoLabel: string;
  styles: StylesModel;
}): { raw_text: string; formatting: HeaderFormatting } | null {
  const { paragraph, paragraphPPr, paragraphStyleId, alignment, cleanTextNoLabel, styles } = params;
  if (alignment !== 'CENTER') return null;
  const trimmed = cleanTextNoLabel.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CENTERED_TITLE_LENGTH) return null;
  if (/[a-z]/.test(trimmed)) return null;
  // Content gate: punctuation/underscore-only signature lines and bracketed
  // single-token placeholders (`[COMPANY]`, `[___]`, `<NAME>`) must not
  // classify as titles. Real titles are multi-word ALL-CAPS phrases.
  const letterCount = (trimmed.match(/[A-Z]/g) ?? []).length;
  if (letterCount < 3) return null;
  const wordTokens = trimmed.split(/\s+/).filter((w) => /[A-Z]/.test(w));
  if (wordTokens.length < 2) return null;

  const runs = getParagraphRuns(paragraph);
  if (runs.length === 0) return null;
  const orderedUniqueRuns: Element[] = [];
  const seen = new Set<Element>();
  for (const tr of runs) {
    if (!seen.has(tr.r)) {
      seen.add(tr.r);
      orderedUniqueRuns.push(tr.r);
    }
  }

  let formatting: HeaderFormatting | null = null;
  let sawAnyText = false;
  for (const r of orderedUniqueRuns) {
    const ts = Array.from(r.getElementsByTagNameNS(OOXML.W_NS, W.t));
    let runHasText = false;
    for (const t of ts) {
      if ((t.textContent ?? '').length > 0) {
        runHasText = true;
        break;
      }
    }
    if (!runHasText) continue;
    const fmt = extractEffectiveRunFormatting({ run: r, paragraphPPr, paragraphStyleId, styles });
    if (!fmt.bold) return null;
    sawAnyText = true;
    if (!formatting) formatting = { bold: fmt.bold, italic: fmt.italic, underline: fmt.underline };
  }
  if (!sawAnyText || !formatting) return null;

  return { raw_text: trimmed, formatting };
}

const SIGNATURE_LABEL_LINE_RE = /^[A-Z][a-zA-Z ]{0,28}:\s*$/;
const SIGNATURE_LABEL_PREFIX_RE = /^[A-Z]+(?::\s|$)/;

function isSignatureClusterLabel(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SIGNATURE_LABEL_LINE_RE.test(trimmed) || SIGNATURE_LABEL_PREFIX_RE.test(trimmed);
}

function suppressSignatureClusters(nodes: DocumentViewNode[]): void {
  if (nodes.length < 4) return;

  const prefixMatches = new Array<number>(nodes.length + 1).fill(0);
  for (let idx = 0; idx < nodes.length; idx++) {
    prefixMatches[idx + 1] = prefixMatches[idx]! + (isSignatureClusterLabel(nodes[idx]!.clean_text) ? 1 : 0);
  }

  const coverage = new Array<number>(nodes.length + 1).fill(0);
  for (let start = 0; start <= nodes.length - 4; start++) {
    for (let end = start + 3; end < nodes.length; end++) {
      const runLength = end - start + 1;
      const matchCount = prefixMatches[end + 1]! - prefixMatches[start]!;
      if ((matchCount * 4) < (runLength * 3)) continue;
      coverage[start]! += 1;
      coverage[end + 1]! -= 1;
    }
  }

  let activeClusters = 0;
  for (let idx = 0; idx < nodes.length; idx++) {
    activeClusters += coverage[idx]!;
    if (activeClusters <= 0) continue;

    const node = nodes[idx]!;
    // The density gate authorizes us to clear *labels* inside the window;
    // non-label neighbors (real headings, body text) keep their detected
    // heading metadata regardless of paragraph style. This avoids erasing
    // an adjacent section heading or body line that happens to fall inside
    // a window meeting the density threshold.
    if (!isSignatureClusterLabel(node.clean_text)) continue;
    node.header = '';
    node.header_formatting = null;
    node.list_metadata.header_text = null;
    node.list_metadata.header_style = null;
    node.list_metadata.header_formatting = null;
  }
}

function inferSemanticName(params: {
  fp: FormattingFingerprint;
  nodes: DocumentViewNode[];
}): { base_id: string; display_name: string } {
  const { fp, nodes } = params;

  // Find first label_type if present.
  let labelType: LabelType | null = null;
  for (const n of nodes) {
    if (n.list_metadata.label_type) {
      labelType = n.list_metadata.label_type;
      break;
    }
  }

  const listLevel = fp.list_level;

  if (listLevel >= 0) {
    if (listLevel === 0) {
      if (labelType === LabelType.ARTICLE) return { base_id: 'article', display_name: 'Article Heading' };
      if (labelType === LabelType.SECTION) return { base_id: 'section', display_name: 'Section Heading' };
      if (labelType === LabelType.ROMAN) return { base_id: 'roman_section', display_name: 'Roman Numeral Section' };
      return { base_id: 'top_level', display_name: 'Top-Level List Item' };
    }
    if (listLevel === 1) {
      if (labelType === LabelType.LETTER) return { base_id: 'subsection', display_name: 'Subsection (a)/(A)' };
      if (labelType === LabelType.NUMBER) return { base_id: 'subsection_number', display_name: 'Numbered Subsection' };
      if (labelType === LabelType.ROMAN) return { base_id: 'subsection_roman', display_name: 'Roman Subsection' };
      return { base_id: 'level_1', display_name: `Level ${listLevel} List Item` };
    }
    if (labelType === LabelType.ROMAN) return { base_id: `level_${listLevel}_roman`, display_name: `Level ${listLevel} Roman` };
    if (labelType === LabelType.LETTER) return { base_id: `level_${listLevel}_letter`, display_name: `Level ${listLevel} Letter` };
    return { base_id: `level_${listLevel}`, display_name: `Level ${listLevel} List Item` };
  }

  // Non-list.
  const styleName = fp.style_name.toLowerCase().replace(/\s+/g, '_');
  if (fp.left_indent_pt > 0) return { base_id: 'indent_block', display_name: 'Indented Block' };
  if (styleName.includes('heading') || styleName.includes('title')) return { base_id: 'heading', display_name: 'Heading' };
  if (styleName.includes('quote') || styleName.includes('block')) return { base_id: 'block_quote', display_name: 'Block Quote' };
  return { base_id: 'body', display_name: 'Body Text' };
}

export function discoverStyles(nodes: DocumentViewNode[]): DocumentStyles {
  const groups = new Map<string, { fp: FormattingFingerprint; nodes: DocumentViewNode[] }>();
  for (const n of nodes) {
    const key = fingerprintKey(n.style_fingerprint);
    const g = groups.get(key);
    if (g) g.nodes.push(n);
    else groups.set(key, { fp: n.style_fingerprint, nodes: [n] });
  }

  const used: Record<string, number> = {};
  const styles = new Map<string, DocumentStyleInfo>();
  const fpToStyle = new Map<string, string>();

  for (const [fpKey, g] of groups.entries()) {
    const { base_id, display_name } = inferSemanticName({ fp: g.fp, nodes: g.nodes });
    let styleId = base_id;
    if (used[base_id] !== undefined) {
      used[base_id] += 1;
      styleId = `${base_id}_${used[base_id]}`;
    } else {
      used[base_id] = 0;
    }

    const median = g.nodes[Math.floor(g.nodes.length / 2)]!;
    const info: DocumentStyleInfo = {
      style_id: styleId,
      display_name,
      fingerprint: g.fp,
      example_node_id: median.id,
      example_text: median.clean_text.slice(0, STYLE_EXAMPLE_TEXT_PREVIEW_LENGTH),
      count: g.nodes.length,
      dominant_alignment: g.fp.alignment,
    };
    styles.set(styleId, info);
    fpToStyle.set(fpKey, styleId);
  }

  return { styles, fingerprint_to_style: fpToStyle };
}

function headerStripFromText(params: { header: string; text: string }): string {
  // Mirrors Python TOONRenderer header stripping.
  const { header } = params;
  let { text } = params;
  if (!header) return text;

  const headerNorm = header.trim().toLowerCase();
  const textLower = text.toLowerCase();

  for (const punct of [':', '.', '-', ';', ''] as const) {
    const testPrefix = `${headerNorm}${punct}`;
    if (textLower.startsWith(testPrefix)) {
      text = text.slice(testPrefix.length).trimStart();
      return text;
    }
  }

  if (text.startsWith(header)) {
    text = text.slice(header.length).replace(/^[.:\-;]+/, '').trimStart();
  }
  return text;
}

// Matches the exact set of TOON inline formatting tags that emitFormattingTags() can emit:
//   <b>, </b>, <i>, </i>, <u>, </u>, <highlight>, </highlight>,
//   <a href="...">, </a>, <font ATTR=...>, </font>
// Anything else in the form `<...>` is literal document text (e.g., `<Borrower>` placeholders
// in legal templates, or stylesheet samples like `<font>`) and must be counted as visible
// characters, not skipped as markup.
//
// Note the opening `a`/`font` alternative requires `\s[^>]*` (mandatory attributes), because
// the formatter only emits `<a href="...">` and `<font ATTR=...>` — never bare `<a>` or
// `<font>`. Allowing the bare forms would cause literal `<a>` / `<font>` in document text to
// be silently skipped, shifting marker positions.
export const TOON_INLINE_TAG_RE = /^(?:<\/?(?:b|i|u|highlight)>|<\/(?:a|font)>|<(?:a|font)\s[^>]*>)/;

/** A single token produced by {@link tokenizeToonInline}. */
export type ToonInlineToken =
  | { kind: 'tag'; value: string }
  | { kind: 'text'; value: string };

/**
 * Split a TOON inline-tag string (`DocumentViewNode.tagged_text` produced with
 * `show_formatting`) into an ordered list of `tag` and `text` tokens, using the exact same
 * grammar (`TOON_INLINE_TAG_RE`) the formatter emits. Consecutive literal characters are
 * coalesced into one `text` token. This is the shared tokenization primitive used by
 * downstream serializers (Markdown today, HTML next) so they never reason about the tag
 * grammar independently and drift from the emitter.
 */
export function tokenizeToonInline(text: string): ToonInlineToken[] {
  const tokens: ToonInlineToken[] = [];
  let buffer = '';
  for (let i = 0; i < text.length; i++) {
    const tagLen = toonTagLengthAt(text, i);
    if (tagLen > 0) {
      if (buffer) {
        tokens.push({ kind: 'text', value: buffer });
        buffer = '';
      }
      tokens.push({ kind: 'tag', value: text.slice(i, i + tagLen) });
      i += tagLen - 1;
      continue;
    }
    buffer += text[i];
  }
  if (buffer) tokens.push({ kind: 'text', value: buffer });
  return tokens;
}

function toonTagLengthAt(text: string, i: number): number {
  if (text[i] !== '<') return 0;
  const match = TOON_INLINE_TAG_RE.exec(text.slice(i));
  return match ? match[0].length : 0;
}

function countVisibleTextCharacters(text: string): number {
  let visibleCount = 0;
  for (let i = 0; i < text.length; i++) {
    const tagLen = toonTagLengthAt(text, i);
    if (tagLen > 0) {
      i += tagLen - 1;
      continue;
    }
    visibleCount++;
  }
  return visibleCount;
}

function findTaggedTextInsertionIndex(text: string, visibleOffset: number): number {
  if (visibleOffset <= 0) return 0;

  let visibleCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (visibleCount === visibleOffset) return i;

    const tagLen = toonTagLengthAt(text, i);
    if (tagLen > 0) {
      i += tagLen - 1;
      continue;
    }

    visibleCount++;
  }

  return text.length;
}

function injectToonCommentMarkers(
  text: string,
  markers: readonly ToonCommentMarker[],
): string {
  if (markers.length === 0) return text;

  let result = text;
  for (const { offset, marker } of markers) {
    const insertionIndex = findTaggedTextInsertionIndex(result, offset);
    result = result.slice(0, insertionIndex) + marker + result.slice(insertionIndex);
  }
  return result;
}

type InlineCommentMarkerCandidate = {
  id: number;
  startParagraphId: string;
  endParagraphId: string;
  startParagraphIndex: number;
  startOffset: number;
  endOffset: number;
};

type InlineCommentMarkerGroup = {
  closes: InlineCommentMarkerCandidate[];
  opens: InlineCommentMarkerCandidate[];
};

function collectInlineCommentMarkerCandidates(
  comments: readonly DocumentViewComment[],
  paragraphIndexById: ReadonlyMap<string, number>,
  candidates: InlineCommentMarkerCandidate[],
): void {
  for (const comment of comments) {
    const runtime = (comment as DocumentViewCommentWithRuntime)[INLINE_COMMENT_MARKER_RUNTIME];
    if (comment.range && runtime && !runtime.suppressInlineMarkers) {
      candidates.push({
        id: comment.id,
        startParagraphId: comment.range.startParagraphId,
        endParagraphId: comment.range.endParagraphId,
        startParagraphIndex: paragraphIndexById.get(comment.range.startParagraphId) ?? Number.MAX_SAFE_INTEGER,
        startOffset: runtime.startVisibleOffset,
        endOffset: runtime.endVisibleOffset,
      });
    }

    if (comment.replies.length > 0) {
      collectInlineCommentMarkerCandidates(comment.replies, paragraphIndexById, candidates);
    }
  }
}

function compareInlineCommentCloseOrder(
  left: InlineCommentMarkerCandidate,
  right: InlineCommentMarkerCandidate,
): number {
  if (left.startParagraphIndex !== right.startParagraphIndex) {
    return right.startParagraphIndex - left.startParagraphIndex;
  }
  if (left.startOffset !== right.startOffset) {
    return right.startOffset - left.startOffset;
  }
  return right.id - left.id;
}

export function collectInlineCommentMarkers(
  nodes: readonly DocumentViewNode[],
): ToonCommentMarkerMap {
  const paragraphIndexById = new Map<string, number>();
  for (let index = 0; index < nodes.length; index++) {
    paragraphIndexById.set(nodes[index]!.id, index);
  }

  const candidates: InlineCommentMarkerCandidate[] = [];
  for (const node of nodes) {
    if (node.comments && node.comments.length > 0) {
      collectInlineCommentMarkerCandidates(node.comments, paragraphIndexById, candidates);
    }
  }

  const groupedByParagraph = new Map<string, Map<number, InlineCommentMarkerGroup>>();
  for (const candidate of candidates) {
    const startOffsets = groupedByParagraph.get(candidate.startParagraphId) ?? new Map<number, InlineCommentMarkerGroup>();
    const startGroup = startOffsets.get(candidate.startOffset) ?? { closes: [], opens: [] };
    startGroup.opens.push(candidate);
    startOffsets.set(candidate.startOffset, startGroup);
    groupedByParagraph.set(candidate.startParagraphId, startOffsets);

    const endOffsets = groupedByParagraph.get(candidate.endParagraphId) ?? new Map<number, InlineCommentMarkerGroup>();
    const endGroup = endOffsets.get(candidate.endOffset) ?? { closes: [], opens: [] };
    endGroup.closes.push(candidate);
    endOffsets.set(candidate.endOffset, endGroup);
    groupedByParagraph.set(candidate.endParagraphId, endOffsets);
  }

  const markersByParagraph = new Map<string, ToonCommentMarker[]>();
  for (const [paragraphId, offsetGroups] of groupedByParagraph.entries()) {
    const markers: ToonCommentMarker[] = [];
    const sortedOffsets = Array.from(offsetGroups.keys()).sort((left, right) => right - left);
    for (const offset of sortedOffsets) {
      const group = offsetGroups.get(offset);
      if (!group) continue;

      const closes = [...group.closes].sort(compareInlineCommentCloseOrder);
      const opens = [...group.opens].sort((left, right) => left.id - right.id);
      const marker =
        closes.map((comment) => `[cm-end:${comment.id}]`).join('') +
        opens.map((comment) => `[cm-start:${comment.id}]`).join('');
      if (!marker) continue;
      markers.push({ offset, marker });
    }

    if (markers.length > 0) {
      markersByParagraph.set(paragraphId, markers);
    }
  }

  return markersByParagraph;
}

/**
 * Format a single toon data line for one DocumentViewNode.
 * Handles table-context-aware style (th/td) and header stripping.
 */
export function formatToonDataLine(
  n: DocumentViewNode,
  options?: { compact?: boolean; commentMarkers?: ToonCommentMarkerMap },
): string {
  let text = n.tagged_text;
  let header = n.header;
  let strippedPrefixVisibleLength = 0;

  if (header) {
    const strippedText = headerStripFromText({ header, text });
    strippedPrefixVisibleLength = Math.max(
      0,
      countVisibleTextCharacters(text) - countVisibleTextCharacters(strippedText),
    );
    text = strippedText;
  }
  if (header && !text) {
    text = header;
    header = '';
    strippedPrefixVisibleLength = 0;
  }

  const commentMarkers = options?.commentMarkers?.get(n.id);
  if (commentMarkers && commentMarkers.length > 0) {
    // Comment marker offsets are computed against the FULL paragraph visible text (raw
    // run/char counting in `getComments()`). To translate to `tagged_text` positions we
    // subtract:
    //  1. `visible_offset_correction` — chars stripped at build time when extracting the
    //     manual list label and trimming following whitespace.
    //  2. `strippedPrefixVisibleLength` — chars stripped at format time by the run-in-header
    //     extraction above.
    const totalCorrection = (n.visible_offset_correction ?? 0) + strippedPrefixVisibleLength;
    text = injectToonCommentMarkers(
      text,
      commentMarkers.map(({ offset, marker }) => ({
        offset: Math.max(0, offset - totalCorrection),
        marker,
      })),
    );
  }

  const tc = n.table_context;
  let style: string;
  if (tc) {
    style = tc.is_header_row
      ? `th(${tc.row_index},${tc.col_index})`
      : `td(${tc.row_index},${tc.col_index})`;
  } else {
    style = options?.compact
      ? computeFingerprintToken(n.style_fingerprint, n.style)
      : n.style;
  }
  return `${n.id} | ${n.list_label} | ${header} | ${style} | ${text}`;
}

/**
 * Collect table marker info (dimensions) from nodes for #TABLE markers.
 * Column headers are NOT included in the marker — they appear once in the th() rows.
 */
export function collectTableMarkerInfo(
  nodes: readonly Pick<DocumentViewNode, 'table_context'>[],
): Map<number, { id: string; totalRows: number; totalCols: number }> {
  const info = new Map<number, { id: string; totalRows: number; totalCols: number }>();
  for (const n of nodes) {
    const tc = n.table_context;
    if (!tc) continue;
    if (!info.has(tc.table_index)) {
      info.set(tc.table_index, {
        id: tc.table_id,
        totalRows: tc.total_rows,
        totalCols: tc.total_cols,
      });
    }
  }
  return info;
}

/**
 * Format a #TABLE marker line from collected table info.
 * Headers are omitted — they appear exactly once in the th(0,N) data rows.
 */
export function formatTableMarker(info: { id: string; totalRows: number; totalCols: number }): string {
  return `#TABLE ${info.id} | ${info.totalRows} rows × ${info.totalCols} cols`;
}

function escapeToonCommentField(value: string): string {
  return value
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('|', '\\|');
}

function formatCommentDate(date: string | null): string {
  return date ?? '-';
}

function collectToonCommentLines(
  comment: DocumentViewComment,
  paragraphId: string,
  parentId?: number,
): string[] {
  const author = escapeToonCommentField(comment.author || '-');
  const date = formatCommentDate(comment.date);
  const text = escapeToonCommentField(comment.text);
  const line = parentId == null
    ? `#COMMENT ${paragraphId} c${comment.id} ${author} ${date} | ${text}`
    : `#REPLY c${comment.id} -> c${parentId} ${author} ${date} | ${text}`;

  return [
    line,
    ...comment.replies.flatMap((reply) => collectToonCommentLines(reply, paragraphId, comment.id)),
  ];
}

export function formatToonCommentLines(node: Pick<DocumentViewNode, 'id' | 'comments'>): string[] {
  return node.comments?.flatMap((comment) => collectToonCommentLines(comment, node.id)) ?? [];
}

function collectToonCommentEndnoteLines(
  comment: DocumentViewComment,
  paragraphId: string,
  parentId?: number,
): string[] {
  const author = escapeToonCommentField(comment.author || '-');
  const date = formatCommentDate(comment.date);
  const text = escapeToonCommentField(comment.text);
  const line = parentId == null
    ? `c${comment.id} @ ${paragraphId} ${author} ${date} | ${text}`
    : `c${comment.id} -> c${parentId} ${author} ${date} | ${text}`;

  return [
    line,
    ...comment.replies.flatMap((reply) => collectToonCommentEndnoteLines(reply, paragraphId, comment.id)),
  ];
}

export function formatToonCommentEndnoteLines(node: Pick<DocumentViewNode, 'id' | 'comments'>): string[] {
  return node.comments?.flatMap((comment) => collectToonCommentEndnoteLines(comment, node.id)) ?? [];
}

export function formatToonCommentsEndnotesBlock(
  nodes: readonly Pick<DocumentViewNode, 'id' | 'comments'>[],
): string[] {
  const commentLines = nodes.flatMap((node) => formatToonCommentEndnoteLines(node));
  return commentLines.length > 0
    ? ['#COMMENTS', ...commentLines]
    : [];
}

export function renderToon(nodes: DocumentViewNode[], options: { compact?: boolean } = {}): string {
  const lines: string[] = ['#SCHEMA id | list_label | header | style | text'];
  const commentMarkers = collectInlineCommentMarkers(nodes);
  const lineOptions = { ...options, commentMarkers };

  // Pre-scan: collect table marker info for #TABLE lines
  const tableInfo = collectTableMarkerInfo(nodes);

  let currentTableIndex: number | null = null;

  for (const n of nodes) {
    const tc = n.table_context;
    const nodeTableIndex = tc ? tc.table_index : null;

    // Close previous table if we left it or moved to a different table
    if (currentTableIndex !== null && nodeTableIndex !== currentTableIndex) {
      lines.push('#END_TABLE');
      currentTableIndex = null;
    }

    // Open new table if entering one
    if (nodeTableIndex !== null && currentTableIndex === null) {
      const info = tableInfo.get(nodeTableIndex);
      if (info) lines.push(formatTableMarker(info));
      currentTableIndex = nodeTableIndex;
    }

    lines.push(formatToonDataLine(n, lineOptions));
    lines.push(...formatToonCommentLines(n));
  }

  // Close any open table at end
  if (currentTableIndex !== null) {
    lines.push('#END_TABLE');
  }

  return lines.join('\n');
}

export function renderToonWithCommentEndnotes(
  nodes: DocumentViewNode[],
  options: { compact?: boolean } = {},
): string {
  const lines: string[] = ['#SCHEMA id | list_label | header | style | text'];
  const tableInfo = collectTableMarkerInfo(nodes);

  let currentTableIndex: number | null = null;

  for (const n of nodes) {
    const tc = n.table_context;
    const nodeTableIndex = tc ? tc.table_index : null;

    if (currentTableIndex !== null && nodeTableIndex !== currentTableIndex) {
      lines.push('#END_TABLE');
      currentTableIndex = null;
    }

    if (nodeTableIndex !== null && currentTableIndex === null) {
      const info = tableInfo.get(nodeTableIndex);
      if (info) lines.push(formatTableMarker(info));
      currentTableIndex = nodeTableIndex;
    }

    lines.push(formatToonDataLine(n, options));
  }

  if (currentTableIndex !== null) {
    lines.push('#END_TABLE');
  }

  lines.push(...formatToonCommentsEndnotesBlock(nodes));

  return lines.join('\n');
}

export type BuildDocumentViewOptions = {
  include_semantic_tags?: boolean;
};

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
    // Preserve empty table cell paragraphs for structural completeness.
    if (!fullText && !tableContext) continue;

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
      tagged = emitFormattingTags({ runs: bodyRuns, baseline: docBaseline, fontBaseline: paraFontBaseline });
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
