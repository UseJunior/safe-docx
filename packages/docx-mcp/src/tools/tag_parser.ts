/**
 * Shared DOM-based tag parser for inline formatting tags in replacement/insertion text.
 *
 * Supports: <b>, <i>, <u>, <highlight>, <highlighting>, <header>, <RunInHeader>, <font>
 * The <font> tag supports color, size, and face attributes.
 */

import { DOMParser } from '@xmldom/xmldom';
import { stripAllInlineTags } from '@usejunior/docx-core';
import type { ReplacementPart } from '@usejunior/docx-core';

// Re-export stripAllInlineTags for convenience
export { stripAllInlineTags };

// ── Public types ────────────────────────────────────────────────────

export type ParsedSegmentState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlighting: boolean;
  header: boolean;
  color: string | null;
  fontSize: number | null; // half-points (OOXML internal)
  fontName: string | null;
};

export type ParsedReplacementSegment = ParsedSegmentState & { text: string };

// ── Tag detection ───────────────────────────────────────────────────

const MARKUP_TAG_RE = /<\/?(?:b|i|u|highlight|highlighting|header|RunInHeader|font)[\s>\/]/;

export function hasAnyMarkupTags(text: string): boolean {
  return MARKUP_TAG_RE.test(text);
}

export function hasHeaderTags(text: string): boolean {
  return (
    text.includes('<header>') ||
    text.includes('</header>') ||
    text.includes('<RunInHeader>') ||
    text.includes('</RunInHeader>')
  );
}

export function hasInlineStyleTags(text: string): boolean {
  return (
    text.includes('<b>') ||
    text.includes('</b>') ||
    text.includes('<i>') ||
    text.includes('</i>') ||
    text.includes('<u>') ||
    text.includes('</u>')
  );
}

// ── Counter-based pre-validation ────────────────────────────────────

// Known tag names for counter-based balance checking.
// Maps opening tag patterns to { key, errCode, closePattern }.
type CounterKey = 'header' | 'highlighting' | 'bold' | 'italic' | 'underline' | 'font';

interface TagPattern {
  open: string;
  close: string;
  key: CounterKey;
  errOpen: string;
  errClose: string;
}

const TAG_PATTERNS: TagPattern[] = [
  { open: '<header>', close: '</header>', key: 'header', errOpen: 'UNBALANCED_HEADER_TAGS', errClose: 'UNBALANCED_HEADER_TAGS' },
  { open: '<RunInHeader>', close: '</RunInHeader>', key: 'header', errOpen: 'UNBALANCED_HEADER_TAGS', errClose: 'UNBALANCED_HEADER_TAGS' },
  { open: '<highlight>', close: '</highlight>', key: 'highlighting', errOpen: 'UNBALANCED_HIGHLIGHT_TAGS', errClose: 'UNBALANCED_HIGHLIGHT_TAGS' },
  { open: '<highlighting>', close: '</highlighting>', key: 'highlighting', errOpen: 'UNBALANCED_HIGHLIGHT_TAGS', errClose: 'UNBALANCED_HIGHLIGHT_TAGS' },
  { open: '<b>', close: '</b>', key: 'bold', errOpen: 'UNBALANCED_BOLD_TAGS', errClose: 'UNBALANCED_BOLD_TAGS' },
  { open: '<i>', close: '</i>', key: 'italic', errOpen: 'UNBALANCED_ITALIC_TAGS', errClose: 'UNBALANCED_ITALIC_TAGS' },
  { open: '<u>', close: '</u>', key: 'underline', errOpen: 'UNBALANCED_UNDERLINE_TAGS', errClose: 'UNBALANCED_UNDERLINE_TAGS' },
];

// Font tags need special handling because they have attributes: <font ...>
// We detect them separately.

function preValidateCounters(text: string): void {
  const counters: Record<CounterKey, number> = {
    header: 0,
    highlighting: 0,
    bold: 0,
    italic: 0,
    underline: 0,
    font: 0,
  };

  // Simple tag patterns (no attributes)
  for (const tp of TAG_PATTERNS) {
    let idx = 0;
    while ((idx = text.indexOf(tp.open, idx)) !== -1) {
      counters[tp.key]++;
      idx += tp.open.length;
    }
    idx = 0;
    while ((idx = text.indexOf(tp.close, idx)) !== -1) {
      counters[tp.key]--;
      if (counters[tp.key] < 0) throw new Error(tp.errClose);
      idx += tp.close.length;
    }
  }

  // Font open tags: <font ...> (with attributes)
  const fontOpenRe = /<font\b/g;
  let m: RegExpExecArray | null;
  while ((m = fontOpenRe.exec(text)) !== null) {
    counters.font++;
  }
  // Font close tags: </font>
  let fci = 0;
  while ((fci = text.indexOf('</font>', fci)) !== -1) {
    counters.font--;
    if (counters.font < 0) throw new Error('UNBALANCED_FONT_TAGS');
    fci += 7;
  }

  // Check remaining open counts
  if (counters.header > 0) throw new Error('UNBALANCED_HEADER_TAGS');
  if (counters.highlighting > 0) throw new Error('UNBALANCED_HIGHLIGHT_TAGS');
  if (counters.bold > 0) throw new Error('UNBALANCED_BOLD_TAGS');
  if (counters.italic > 0) throw new Error('UNBALANCED_ITALIC_TAGS');
  if (counters.underline > 0) throw new Error('UNBALANCED_UNDERLINE_TAGS');
  if (counters.font > 0) throw new Error('UNBALANCED_FONT_TAGS');
}

// ── Quote-aware tag boundary tokenizer ──────────────────────────────

const KNOWN_TAG_NAMES = new Set([
  'b', 'i', 'u', 'highlight', 'highlighting', 'header', 'RunInHeader', 'font',
]);

/**
 * Identify known tag boundaries in the input text, handling quoted attribute
 * values that may contain `>` or `&`. Returns the XML-escaped text wrapped
 * in `<root>...</root>` ready for DOM parsing.
 */
function prepareForDomParsing(text: string): string {
  const parts: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '<') {
      // Try to match a known tag boundary
      const tagResult = tryMatchKnownTag(text, i);
      if (tagResult) {
        parts.push(tagResult.tagText);
        i = tagResult.end;
        continue;
      }
      // Not a known tag — escape the `<` as `&lt;`
      parts.push('&lt;');
      i++;
    } else if (text[i] === '&') {
      parts.push('&amp;');
      i++;
    } else {
      parts.push(text[i]!);
      i++;
    }
  }

  return `<root>${parts.join('')}</root>`;
}

interface TagMatch {
  tagText: string;
  end: number;
}

function tryMatchKnownTag(text: string, start: number): TagMatch | null {
  // Must start with '<'
  if (text[start] !== '<') return null;

  const isClose = text[start + 1] === '/';
  const nameStart = isClose ? start + 2 : start + 1;

  // Extract tag name
  let nameEnd = nameStart;
  while (nameEnd < text.length && /[a-zA-Z]/.test(text[nameEnd]!)) {
    nameEnd++;
  }
  const tagName = text.slice(nameStart, nameEnd);
  if (!KNOWN_TAG_NAMES.has(tagName)) return null;

  // For close tags: expect `>`
  if (isClose) {
    if (text[nameEnd] !== '>') return null;
    return { tagText: `</${tagName}>`, end: nameEnd + 1 };
  }

  // For open tags: scan for closing `>`, respecting quoted attribute values
  let j = nameEnd;
  // Self-closing tags or tags with no attributes
  if (j < text.length && text[j] === '>') {
    return { tagText: `<${tagName}>`, end: j + 1 };
  }

  // Must have whitespace after tag name for attributes
  if (j >= text.length || text[j] !== ' ') return null;

  // Scan through attributes, handling quoted values
  const attrParts: string[] = [`<${tagName}`];
  while (j < text.length && text[j] !== '>') {
    if (text[j] === '"') {
      // Quoted attribute value — scan to closing quote
      attrParts.push('"');
      j++;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '&') {
          attrParts.push('&amp;');
        } else if (text[j] === '<') {
          attrParts.push('&lt;');
        } else {
          attrParts.push(text[j]!);
        }
        j++;
      }
      if (j < text.length) {
        attrParts.push('"');
        j++; // skip closing quote
      }
    } else if (text[j] === "'") {
      // Single-quoted attribute value
      attrParts.push("'");
      j++;
      while (j < text.length && text[j] !== "'") {
        if (text[j] === '&') {
          attrParts.push('&amp;');
        } else if (text[j] === '<') {
          attrParts.push('&lt;');
        } else {
          attrParts.push(text[j]!);
        }
        j++;
      }
      if (j < text.length) {
        attrParts.push("'");
        j++; // skip closing quote
      }
    } else {
      attrParts.push(text[j]!);
      j++;
    }
  }

  if (j >= text.length) return null; // no closing `>`
  attrParts.push('>');
  j++; // skip `>`

  return { tagText: attrParts.join(''), end: j };
}

// ── DOM walker ──────────────────────────────────────────────────────

const EMPTY_STATE: ParsedSegmentState = {
  bold: false,
  italic: false,
  underline: false,
  highlighting: false,
  header: false,
  color: null,
  fontSize: null,
  fontName: null,
};

function statesEqual(a: ParsedSegmentState, b: ParsedSegmentState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.highlighting === b.highlighting &&
    a.header === b.header &&
    a.color === b.color &&
    a.fontSize === b.fontSize &&
    a.fontName === b.fontName
  );
}

function pushSegment(out: ParsedReplacementSegment[], text: string, state: ParsedSegmentState): void {
  if (!text) return;
  const prev = out[out.length - 1];
  if (prev && statesEqual(prev, state)) {
    prev.text += text;
    return;
  }
  out.push({ text, ...state });
}

const TAG_NAME_TO_STATE_KEY: Record<string, keyof ParsedSegmentState | 'font'> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  highlight: 'highlighting',
  highlighting: 'highlighting',
  header: 'header',
  RunInHeader: 'header',
  font: 'font',
};

function walkNode(
  node: Node,
  state: ParsedSegmentState,
  out: ParsedReplacementSegment[],
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      pushSegment(out, child.nodeValue ?? '', state);
    } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const el = child as Element;
      const tagName = el.localName ?? el.nodeName;

      if (tagName === 'root') {
        walkNode(el, state, out);
        continue;
      }

      const stateKey = TAG_NAME_TO_STATE_KEY[tagName];
      if (!stateKey) {
        throw new Error('TAG_PARSE_ERROR');
      }

      if (stateKey === 'font') {
        // Read font attributes. getAttribute returns "" for absent attrs in xmldom,
        // so use || null to normalize empty strings.
        const colorAttr = el.getAttribute('color') || null;
        const sizeAttr = el.getAttribute('size') || null;
        const faceAttr = el.getAttribute('face') || null;

        const newState: ParsedSegmentState = {
          ...state,
          color: colorAttr ?? state.color,
          fontSize: sizeAttr ? Number(sizeAttr) * 2 : state.fontSize, // pt → half-points
          fontName: faceAttr ?? state.fontName,
        };
        walkNode(el, newState, out);
      } else {
        // Boolean toggle — set to true
        const newState: ParsedSegmentState = { ...state, [stateKey]: true };
        walkNode(el, newState, out);
      }
    }
  }
}

// ── Main parser entry point ─────────────────────────────────────────

export function splitTaggedText(text: string): ParsedReplacementSegment[] {
  // Step 1: Counter-based pre-validation (primary error gate)
  preValidateCounters(text);

  // Step 2: Prepare XML-safe string for DOM parsing
  const xmlText = prepareForDomParsing(text);

  // Step 3: Parse with xmldom
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const root = doc.documentElement;

  // Step 4: Walk DOM and build segments
  const out: ParsedReplacementSegment[] = [];
  walkNode(root, { ...EMPTY_STATE }, out);

  // Step 5: Return segments (coalescing happens in pushSegment)
  return out.length > 0 ? out : [{ text: '', ...EMPTY_STATE }];
}

// ── Utility exports ─────────────────────────────────────────────────

export function segmentAddRunProps(seg: ParsedReplacementSegment): NonNullable<ReplacementPart['addRunProps']> | undefined {
  const add: NonNullable<ReplacementPart['addRunProps']> = {};
  if (seg.bold) add.bold = true;
  if (seg.italic) add.italic = true;
  if (seg.underline) add.underline = true;
  if (seg.highlighting) add.highlight = true;
  if (seg.color) add.color = seg.color;
  if (seg.fontSize !== null) add.fontSize = seg.fontSize;
  if (seg.fontName) add.fontName = seg.fontName;
  return Object.keys(add).length > 0 ? add : undefined;
}
