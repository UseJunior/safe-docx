import { OOXML, W } from './namespaces.js';
import { getParagraphRuns } from './text.js';
import { extractEffectiveRunFormatting, type ParagraphAlignment, type StylesModel } from './styles.js';
import type { DocumentViewNode } from './document_view.js';

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

const SHORT_HEADER_MAX_LENGTH = 50;
const MAX_HEADER_TEXT_LENGTH = 60;
// Centered ALL-CAPS titles (e.g. NVCA COI's `AMENDED AND RESTATED CERTIFICATE
// OF INCORPORATION OF FOO INC.`) routinely exceed 60 chars in real corporate
// documents. The 60-char cap on `extractHeaderInfo` exists to avoid emitting a
// "leading words = header" guess from long body prose, which doesn't apply to
// the standalone-title detector.
const MAX_CENTERED_TITLE_LENGTH = 120;

// Pattern-based header detection fallback (ported from Python ingestor._extract_header_info).
const HEADER_PATTERN = /^([A-Z][^.!?:]*(?:\s+[A-Z][^.!?:]*)*)([.:]?)(?:\s|$)/;

export function extractHeaderInfo(cleanText: string): { header_text: string | null; header_style: HeuristicHeadingSource | null } {
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

export function deriveHeading(
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

export function detectRunInHeader(params: {
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
export function detectTitleCapsCentered(params: {
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

export function suppressSignatureClusters(nodes: DocumentViewNode[]): void {
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
