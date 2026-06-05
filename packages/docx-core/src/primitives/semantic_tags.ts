// Semantic tag emission + stripping for Safe-Docx TS.
//
// Headers are represented via a dedicated column (not inline tags) in TOON output.

export const HIGHLIGHT_TAG = 'highlight';

// Formatting tag helpers ───────────────────────────────────────────

const FORMATTING_TAG_RE = /<\/?[biu]>/g;
const HYPERLINK_OPEN_RE = /<a\s+href="[^"]*">/g;
const HYPERLINK_CLOSE_RE = /<\/a>/g;

export function hasFormattingTags(text: string): boolean {
  return FORMATTING_TAG_RE.test(text);
}

export function stripFormattingTags(text: string): string {
  // Reset lastIndex since these are global regexes.
  FORMATTING_TAG_RE.lastIndex = 0;
  return text.replace(FORMATTING_TAG_RE, '');
}

export function hasHyperlinkTags(text: string): boolean {
  return text.includes('<a ') || text.includes('</a>');
}

export function stripHyperlinkTags(text: string): string {
  return text.replace(HYPERLINK_OPEN_RE, '').replace(HYPERLINK_CLOSE_RE, '');
}

export function hasHighlightTags(text: string): boolean {
  return (
    text.includes(`<${HIGHLIGHT_TAG}>`) ||
    text.includes(`</${HIGHLIGHT_TAG}>`) ||
    text.includes('<highlighting>') ||
    text.includes('</highlighting>')
  );
}

export function stripHighlightTags(text: string): string {
  return text
    .replaceAll(new RegExp(`<${HIGHLIGHT_TAG}>`, 'g'), '')
    .replaceAll(new RegExp(`</${HIGHLIGHT_TAG}>`, 'g'), '')
    .replaceAll(/<highlighting>/g, '')
    .replaceAll(/<\/highlighting>/g, '');
}

// Font tag helpers ─────────────────────────────────────────────────

const FONT_OPEN_RE = /<font\b[^>]*>/g;
const FONT_CLOSE_RE = /<\/font>/g;

export function hasFontTags(text: string): boolean {
  return text.includes('<font') || text.includes('</font>');
}

export function stripFontTags(text: string): string {
  FONT_OPEN_RE.lastIndex = 0;
  return text.replace(FONT_OPEN_RE, '').replace(FONT_CLOSE_RE, '');
}

// General-purpose inline tag stripper ──────────────────────────────

// A word boundary (`\b`) after the tag name keeps `<beta>` from matching `<b>` while letting
// `[^>]*>` consume any attributes linearly. Two earlier constructs were dropped: the
// `(?:\s[^>]*)?` group (its `\s` overlaps `[^>]`, the ambiguity CodeQL flags as polynomial
// ReDoS — `js/polynomial-redos` — on uncontrolled document text) and the trailing
// `|<a\s+href="[^"]*">` alternative (already covered by the `a` name + `[^>]*`).
const ALL_INLINE_TAGS_RE =
  /<\/?(?:b|i|u|highlight|highlighting|a|font|header|RunInHeader|definition)\b[^>]*>/g;

/**
 * Strip ALL known inline tags from text. Handles `<b>`, `<i>`, `<u>`,
 * `<highlight>`, `<highlighting>`, `<a href="...">`, `</a>`, `<font ...>`,
 * `</font>`, `<header>`, `</header>`, `<RunInHeader>`, `</RunInHeader>`,
 * `<definition>`, `</definition>`.
 *
 * The replacement runs to a fixpoint (loop until the string stops changing) rather than a
 * single pass: removing one tag can splice two halves together into a *new* tag occurrence
 * (e.g. `<b<b>i>` → `<bi>`), which a single pass would leave behind. Looping closes that
 * `js/incomplete-multi-character-sanitization` gap. Well-formed document `tagged_text`
 * (non-nested, known tags only) reaches the fixpoint on the first pass, so this is a no-op
 * for real input.
 */
export function stripAllInlineTags(text: string): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    ALL_INLINE_TAGS_RE.lastIndex = 0;
    current = current.replace(ALL_INLINE_TAGS_RE, '');
  } while (current !== previous);
  return current;
}
