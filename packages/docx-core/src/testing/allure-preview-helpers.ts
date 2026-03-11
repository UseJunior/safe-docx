/**
 * Converts OOXML body XML into DocPreviewRun[] for Allure visual previews.
 *
 * Source of truth for the DocPreviewRun type:
 *   packages/allure-test-factory/src/index.d.ts
 *
 * This helper lives in docx-core (not allure-test-factory) because it depends
 * on @xmldom/xmldom for parsing.
 */

import { DOMParser } from '@xmldom/xmldom';

// Re-use the canonical type from allure-test-factory.
import type { DocPreviewRun } from '../../../../testing/allure-test-factory.js';

export type { DocPreviewRun };

// ── Constants ────────────────────────────────────────────────────────────────

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Minimal envelope for parsing XML fragments.
const ENVELOPE_PREFIX =
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
const ENVELOPE_SUFFIX = '</w:body></w:document>';

// Revision wrapper → DocPreviewRun.revision mapping.
const REVISION_MAP: Record<string, DocPreviewRun['revision']> = {
  ins: 'insertion',
  del: 'deletion',
  moveFrom: 'move-from',
  moveTo: 'move-to',
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function getWAttr(el: Element, localName: string): string | null {
  return (
    el.getAttributeNS(W_NS, localName) ??
    el.getAttribute(`w:${localName}`) ??
    el.getAttribute(localName) ??
    null
  );
}

/** Check if a string looks like it already has a document/body wrapper. */
function looksLikeFullDocument(xml: string): boolean {
  return xml.includes('<w:document') || xml.includes('<w:body');
}

/** Check if a string contains paragraph-level elements. */
function looksLikeParagraph(xml: string): boolean {
  return xml.includes('<w:p') || xml.includes('<w:p>');
}

/** Check if a string contains run-level elements but no paragraphs. */
function looksLikeRunOnly(xml: string): boolean {
  return (xml.includes('<w:r') || xml.includes('<w:r>')) && !looksLikeParagraph(xml);
}

/**
 * Wrap XML fragments so they parse as a complete OOXML document.
 *
 * - Full documents: returned as-is
 * - Paragraph fragments (`<w:p>...`): wrapped in body+document envelope
 * - Run fragments (`<w:r>...`): wrapped in paragraph+body+document envelope
 * - Bare text (`<w:t>...`): wrapped in run+paragraph+body+document envelope
 */
function wrapFragment(xml: string): string {
  if (looksLikeFullDocument(xml)) return xml;
  if (looksLikeParagraph(xml)) return `${ENVELOPE_PREFIX}${xml}${ENVELOPE_SUFFIX}`;
  if (looksLikeRunOnly(xml)) return `${ENVELOPE_PREFIX}<w:p>${xml}</w:p>${ENVELOPE_SUFFIX}`;
  // Bare text element — wrap in run + paragraph.
  if (xml.includes('<w:t')) {
    return `${ENVELOPE_PREFIX}<w:p><w:r>${xml}</w:r></w:p>${ENVELOPE_SUFFIX}`;
  }
  // Last resort: wrap in body.
  return `${ENVELOPE_PREFIX}${xml}${ENVELOPE_SUFFIX}`;
}

// ── Formatting extraction ────────────────────────────────────────────────────

interface RunFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  script?: 'superscript' | 'subscript';
  positionHpt?: number;
}

function extractFormatting(run: Element): RunFormatting {
  const fmt: RunFormatting = {};

  // Find w:rPr (direct child only).
  let rPr: Element | null = null;
  for (let i = 0; i < run.childNodes.length; i++) {
    const child = run.childNodes[i]!;
    if (child.nodeType === 1) {
      const el = child as Element;
      if (el.localName === 'rPr' && (el.namespaceURI === W_NS || el.prefix === 'w' || !el.namespaceURI)) {
        rPr = el;
        break;
      }
    }
  }
  if (!rPr) return fmt;

  for (let i = 0; i < rPr.childNodes.length; i++) {
    const child = rPr.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const ln = el.localName;

    if (ln === 'b') {
      // <w:b/> or <w:b w:val="1"/> means bold; <w:b w:val="0"/> means not bold.
      const val = getWAttr(el, 'val');
      fmt.bold = val !== '0' && val !== 'false';
    } else if (ln === 'i') {
      const val = getWAttr(el, 'val');
      fmt.italic = val !== '0' && val !== 'false';
    } else if (ln === 'u') {
      const val = getWAttr(el, 'val');
      fmt.underline = val !== 'none' && val !== '0' && val !== 'false';
    } else if (ln === 'vertAlign') {
      const val = getWAttr(el, 'val');
      if (val === 'superscript') fmt.script = 'superscript';
      else if (val === 'subscript') fmt.script = 'subscript';
    } else if (ln === 'position') {
      const val = getWAttr(el, 'val');
      if (val) {
        const n = parseInt(val, 10);
        if (!isNaN(n)) fmt.positionHpt = n;
      }
    }
  }

  return fmt;
}

// ── Field state machine (mirrors getParagraphRuns) ───────────────────────────

const enum FieldState {
  OUTSIDE = 0,
  IN_CODE = 1,
  IN_RESULT = 2,
}

// ── Core conversion ──────────────────────────────────────────────────────────

/**
 * Walk `<w:r>` elements within a container (paragraph or revision wrapper),
 * extracting text and formatting into DocPreviewRun[].
 *
 * Field codes are skipped; field result text is included.
 */
function processRunElements(
  container: Element,
  revision: DocPreviewRun['revision'] | undefined,
  revisionAuthor: string | undefined,
  fieldState: { state: FieldState },
): DocPreviewRun[] {
  const runs: DocPreviewRun[] = [];

  for (let i = 0; i < container.childNodes.length; i++) {
    const child = container.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const ln = el.localName;

    // Recurse into nested revision wrappers (e.g. <w:ins> inside <w:p>).
    if (REVISION_MAP[ln]) {
      const nestedRevision = REVISION_MAP[ln]!;
      const author = getWAttr(el, 'author') ?? undefined;
      const nested = processRunElements(el, nestedRevision, author, fieldState);
      runs.push(...nested);
      continue;
    }

    // Only process w:r elements.
    if (ln !== 'r') continue;

    const fmt = extractFormatting(el);
    let runText = '';

    for (let j = 0; j < el.childNodes.length; j++) {
      const rChild = el.childNodes[j]!;
      if (rChild.nodeType !== 1) continue;
      const rEl = rChild as Element;
      const rLn = rEl.localName;

      // Field state machine.
      if (rLn === 'fldChar') {
        const typ = getWAttr(rEl, 'fldCharType') ?? '';
        if (typ === 'begin') fieldState.state = FieldState.IN_CODE;
        else if (typ === 'separate') fieldState.state = FieldState.IN_RESULT;
        else if (typ === 'end') fieldState.state = FieldState.OUTSIDE;
        continue;
      }

      // Skip field instruction text.
      if (fieldState.state === FieldState.IN_CODE) continue;

      // Collect visible text.
      if (rLn === 't' || rLn === 'delText') {
        runText += rEl.textContent ?? '';
      } else if (rLn === 'tab') {
        runText += '\t';
      } else if (rLn === 'br') {
        runText += '\n';
      }
    }

    if (runText) {
      const run: DocPreviewRun = { text: runText };
      if (fmt.bold) run.bold = true;
      if (fmt.italic) run.italic = true;
      if (fmt.underline) run.underline = true;
      if (fmt.script) run.script = fmt.script;
      if (fmt.positionHpt !== undefined) run.positionHpt = fmt.positionHpt;
      if (revision) run.revision = revision;
      if (revisionAuthor) run.revisionAuthor = revisionAuthor;
      runs.push(run);
    }
  }

  return runs;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert an OOXML XML string into an array of DocPreviewRun objects suitable
 * for Allure visual document previews.
 *
 * **Supported OOXML subset (v1):**
 * - `<w:r>` runs with `<w:t>` and `<w:delText>` text
 * - `<w:rPr>` children: `<w:b/>`, `<w:i/>`, `<w:u/>`, `<w:vertAlign>`, `<w:position>`
 * - Revision wrappers: `<w:ins>`, `<w:del>`, `<w:moveFrom>`, `<w:moveTo>` + author
 * - Multi-paragraph: walks all `<w:p>` elements
 * - Field codes: skipped (field result text included)
 *
 * **Fallback behavior:** Never throws. On parse failure, returns a single run
 * with the raw text content.
 *
 * @example
 * ```ts
 * await attachXmlPreviews(xml, {
 *   docPreview: { runs: xmlToDocPreviewRuns(xml) },
 * });
 * ```
 */
export function xmlToDocPreviewRuns(xmlString: string): DocPreviewRun[] {
  try {
    const wrapped = wrapFragment(xmlString);

    // Suppress xmldom warnings/errors — we handle failures via fallback.
    const parser = new DOMParser({
      errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
    });
    const doc = parser.parseFromString(wrapped, 'text/xml');

    // Find all <w:p> elements.
    const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
    // Also try without namespace (common in test fixtures with xmlns on root).
    const paragraphsNoNs = paragraphs.length > 0 ? paragraphs : doc.getElementsByTagName('w:p');

    if (paragraphsNoNs.length === 0) {
      // No paragraphs found — extract any raw text as fallback.
      const raw = extractRawText(xmlString);
      return raw ? [{ text: raw }] : [];
    }

    const allRuns: DocPreviewRun[] = [];
    const fieldState = { state: FieldState.OUTSIDE as FieldState };

    for (let pi = 0; pi < paragraphsNoNs.length; pi++) {
      const p = paragraphsNoNs[pi]!;
      const paragraphRuns = processRunElements(p, undefined, undefined, fieldState);

      // Add paragraph separator between paragraphs (newline in last run, or empty separator run).
      if (pi > 0 && allRuns.length > 0) {
        // Insert a newline to indicate paragraph break.
        const lastRun = allRuns[allRuns.length - 1]!;
        lastRun.text += '\n';
      }

      allRuns.push(...paragraphRuns);
    }

    return allRuns;
  } catch {
    // Fallback: never throw. Extract raw text if possible.
    const raw = extractRawText(xmlString);
    return raw ? [{ text: raw }] : [];
  }
}

/**
 * Best-effort raw text extraction for fallback cases.
 * Strips all XML tags and returns trimmed text content.
 */
function extractRawText(xml: string): string {
  return xml.replace(/<[^>]+>/g, '').trim();
}
