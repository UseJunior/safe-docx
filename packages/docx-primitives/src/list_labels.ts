// Port of Python workflows/shared/list_label_utils.py (subset) for Safe-Docx TS.
//
// Used to extract/strip text-formatted list labels (non-auto-numbered) and to
// classify computed labels for style inference.

export enum LabelType {
  LETTER = 'letter',
  ROMAN = 'roman',
  NUMBER = 'number',
  SECTION = 'section',
  ARTICLE = 'article',
  NUMBERED_HEADING = 'numbered_heading',
}

export type ListLabelResult = {
  label: string | null;
  label_type: LabelType | null;
  match_end: number;
};

const LETTER_LABEL_RE = /^\(([a-zA-Z]+)\)\s*/;
const ROMAN_LABEL_RE = /^\(([ivxlcdm]+)\)\s*/i;
const NUMBER_LABEL_RE = /^\((\d+)\)\s*/;
const SECTION_LABEL_RE = /^(Section)\s+[\d.]+(?:\([a-z]\))?/i;
const ARTICLE_LABEL_RE = /^(Article)\s+[\dIVXLCDM.]+/i;
const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+)*)[.)]\s*/;

function isRomanNumeralCandidate(s: string): boolean {
  if (!/^[ivxlcdm]+$/i.test(s)) return false;
  // Single char should be treated as letter in legal docs: (i), (v), (x)
  return s.length > 1;
}

export function extractListLabel(text: string): ListLabelResult {
  if (!text) return { label: null, label_type: null, match_end: 0 };

  let m = SECTION_LABEL_RE.exec(text);
  if (m) return { label: m[0].trim(), label_type: LabelType.SECTION, match_end: m[0].length };

  m = ARTICLE_LABEL_RE.exec(text);
  if (m) return { label: m[0].trim(), label_type: LabelType.ARTICLE, match_end: m[0].length };

  m = NUMBERED_HEADING_RE.exec(text);
  if (m) return { label: m[0].trim(), label_type: LabelType.NUMBERED_HEADING, match_end: m[0].length };

  m = NUMBER_LABEL_RE.exec(text);
  if (m) return { label: `(${m[1]})`, label_type: LabelType.NUMBER, match_end: m[0].length };

  m = ROMAN_LABEL_RE.exec(text);
  if (m && isRomanNumeralCandidate(m[1])) {
    return { label: `(${m[1]})`, label_type: LabelType.ROMAN, match_end: m[0].length };
  }

  m = LETTER_LABEL_RE.exec(text);
  if (m) return { label: `(${m[1]})`, label_type: LabelType.LETTER, match_end: m[0].length };

  return { label: null, label_type: null, match_end: 0 };
}

export function stripListLabel(text: string): { stripped_text: string; result: ListLabelResult } {
  const result = extractListLabel(text);
  if (result.label) {
    return { stripped_text: text.slice(result.match_end).trimStart(), result };
  }
  return { stripped_text: text, result };
}
