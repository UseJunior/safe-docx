// Inline formatting tag emission for run-level formatting visibility in TOON output.
//
// Adds <b>, <i>, <u>, <highlighting>, <font>, and <a href="..."> tags around runs that
// deviate from baselines. BIU uses a document-wide char-weighted modal baseline.
// Font properties (color, size, face) use paragraph-local baselines.
// When >=60% of non-header body chars share the same tuple/value, that becomes the
// suppressed baseline and only deviating runs get tags.

import { HIGHLIGHT_TAG } from './semantic_tags.js';
import type { RunFormatting } from './styles.js';

// ── Public types ─────────────────────────────────────────────────────

export type AnnotatedRun = {
  text: string;
  formatting: RunFormatting;
  hyperlinkUrl: string | null;
  charCount: number;
  isHeaderRun: boolean;
};

export type FormattingBaseline = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  suppressed: boolean; // true when baseline covers >= 60% of body chars
};

export type FontBaseline = {
  modalColor: string | null;
  colorSuppressed: boolean;
  modalFontSizePt: number;
  fontSizeSuppressed: boolean;
  modalFontName: string;
  fontNameSuppressed: boolean;
};

// ── Baseline computation ─────────────────────────────────────────────

const SUPPRESSION_THRESHOLD = 0.60;

type FormattingKey = `${boolean}|${boolean}|${boolean}`;

function fmtKey(bold: boolean, italic: boolean, underline: boolean): FormattingKey {
  return `${bold}|${italic}|${underline}` as FormattingKey;
}

export function computeModalBaseline(runs: AnnotatedRun[]): FormattingBaseline {
  // Only consider non-header body runs for baseline computation.
  const bodyRuns = runs.filter((r) => !r.isHeaderRun && r.charCount > 0);
  const totalChars = bodyRuns.reduce((sum, r) => sum + r.charCount, 0);

  if (totalChars === 0) {
    return { bold: false, italic: false, underline: false, suppressed: false };
  }

  const comboCounts = new Map<FormattingKey, { chars: number; firstIdx: number }>();
  for (let i = 0; i < bodyRuns.length; i++) {
    const r = bodyRuns[i]!;
    const key = fmtKey(r.formatting.bold, r.formatting.italic, r.formatting.underline);
    const existing = comboCounts.get(key);
    if (existing) {
      existing.chars += r.charCount;
    } else {
      comboCounts.set(key, { chars: r.charCount, firstIdx: i });
    }
  }

  // Find modal combo. Tie-break by earliest run index.
  let bestKey: FormattingKey = fmtKey(false, false, false);
  let bestChars = 0;
  let bestIdx = Number.MAX_SAFE_INTEGER;

  for (const [key, { chars, firstIdx }] of comboCounts) {
    if (chars > bestChars || (chars === bestChars && firstIdx < bestIdx)) {
      bestKey = key;
      bestChars = chars;
      bestIdx = firstIdx;
    }
  }

  const [boldStr, italicStr, underlineStr] = bestKey.split('|');
  const bold = boldStr === 'true';
  const italic = italicStr === 'true';
  const underline = underlineStr === 'true';
  const suppressed = bestChars / totalChars >= SUPPRESSION_THRESHOLD;

  return { bold, italic, underline, suppressed };
}

// ── Paragraph-local font baseline ───────────────────────────────────

function computeModalString(
  runs: AnnotatedRun[],
  extract: (r: AnnotatedRun) => string | null,
): { modal: string | null; suppressed: boolean } {
  const bodyRuns = runs.filter((r) => !r.isHeaderRun && r.charCount > 0);
  const totalChars = bodyRuns.reduce((sum, r) => sum + r.charCount, 0);
  if (totalChars === 0) return { modal: null, suppressed: false };

  const counts = new Map<string, number>();
  for (const r of bodyRuns) {
    const val = extract(r) ?? '';
    counts.set(val, (counts.get(val) ?? 0) + r.charCount);
  }

  let bestVal = '';
  let bestChars = 0;
  for (const [val, chars] of counts) {
    if (chars > bestChars) {
      bestVal = val;
      bestChars = chars;
    }
  }

  return {
    modal: bestVal || null,
    suppressed: bestChars / totalChars >= SUPPRESSION_THRESHOLD,
  };
}

function computeModalNumber(
  runs: AnnotatedRun[],
  extract: (r: AnnotatedRun) => number,
): { modal: number; suppressed: boolean } {
  const bodyRuns = runs.filter((r) => !r.isHeaderRun && r.charCount > 0);
  const totalChars = bodyRuns.reduce((sum, r) => sum + r.charCount, 0);
  if (totalChars === 0) return { modal: 0, suppressed: false };

  const counts = new Map<number, number>();
  for (const r of bodyRuns) {
    const val = extract(r);
    counts.set(val, (counts.get(val) ?? 0) + r.charCount);
  }

  let bestVal = 0;
  let bestChars = 0;
  for (const [val, chars] of counts) {
    if (chars > bestChars) {
      bestVal = val;
      bestChars = chars;
    }
  }

  return {
    modal: bestVal,
    suppressed: bestChars / totalChars >= SUPPRESSION_THRESHOLD,
  };
}

export function computeParagraphFontBaseline(runs: AnnotatedRun[]): FontBaseline {
  const color = computeModalString(runs, (r) => r.formatting.colorHex);
  const fontSize = computeModalNumber(runs, (r) => r.formatting.fontSizePt);
  const fontName = computeModalString(runs, (r) => r.formatting.fontName);

  return {
    modalColor: color.modal,
    colorSuppressed: color.suppressed,
    modalFontSizePt: fontSize.modal,
    fontSizeSuppressed: fontSize.suppressed,
    modalFontName: fontName.modal ?? '',
    fontNameSuppressed: fontName.suppressed,
  };
}

// ── Tag emission ─────────────────────────────────────────────────────

type ActiveTags = {
  hyperlinkUrl: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlighting: boolean;
  color: string | null;
  fontSize: number | null; // points (display units)
  fontName: string | null;
};

function tagsEqual(a: ActiveTags, b: ActiveTags): boolean {
  return (
    a.hyperlinkUrl === b.hyperlinkUrl &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.highlighting === b.highlighting &&
    a.color === b.color &&
    a.fontSize === b.fontSize &&
    a.fontName === b.fontName
  );
}

function fontTagString(tags: ActiveTags): string | null {
  const attrs: string[] = [];
  if (tags.color !== null) attrs.push(`color="${tags.color}"`);
  if (tags.fontSize !== null) attrs.push(`size="${tags.fontSize}"`);
  if (tags.fontName !== null) attrs.push(`face="${tags.fontName}"`);
  return attrs.length > 0 ? `<font ${attrs.join(' ')}>` : null;
}

function hasFontAttrs(tags: ActiveTags): boolean {
  return tags.color !== null || tags.fontSize !== null || tags.fontName !== null;
}

function closeTags(out: string[], tags: ActiveTags): void {
  if (tags.highlighting) out.push(`</${HIGHLIGHT_TAG}>`);
  if (tags.underline) out.push('</u>');
  if (tags.italic) out.push('</i>');
  if (tags.bold) out.push('</b>');
  if (hasFontAttrs(tags)) out.push('</font>');
  if (tags.hyperlinkUrl !== null) out.push('</a>');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function openTags(out: string[], tags: ActiveTags): void {
  if (tags.hyperlinkUrl !== null) {
    out.push(`<a href="${escapeHtmlAttribute(tags.hyperlinkUrl)}">`);
  }
  const ft = fontTagString(tags);
  if (ft) out.push(ft);
  if (tags.bold) out.push('<b>');
  if (tags.italic) out.push('<i>');
  if (tags.underline) out.push('<u>');
  if (tags.highlighting) out.push(`<${HIGHLIGHT_TAG}>`);
}

function desiredTagsForRun(
  run: AnnotatedRun,
  baseline: FormattingBaseline,
  fontBaseline: FontBaseline | null,
): ActiveTags {
  if (run.isHeaderRun) {
    return {
      hyperlinkUrl: null,
      bold: false, italic: false, underline: false, highlighting: false,
      color: null, fontSize: null, fontName: null,
    };
  }

  const highlighting = !!run.formatting.highlightVal;

  // BIU
  let bold: boolean;
  let italic: boolean;
  let underline: boolean;
  if (!baseline.suppressed) {
    bold = run.formatting.bold;
    italic = run.formatting.italic;
    underline = run.formatting.underline;
  } else {
    bold = run.formatting.bold !== baseline.bold ? run.formatting.bold : false;
    italic = run.formatting.italic !== baseline.italic ? run.formatting.italic : false;
    underline = run.formatting.underline !== baseline.underline ? run.formatting.underline : false;
  }

  // Font properties (paragraph-local baseline)
  let color: string | null = null;
  let fontSize: number | null = null;
  let fontName: string | null = null;

  if (fontBaseline) {
    // Color: emit only when suppressed and differs from modal, or not suppressed and has a value
    if (fontBaseline.colorSuppressed) {
      if (run.formatting.colorHex !== fontBaseline.modalColor) {
        color = run.formatting.colorHex;
      }
    } else if (run.formatting.colorHex) {
      color = run.formatting.colorHex;
    }

    // Font size: emit only when suppressed and differs from modal, or not suppressed and > 0
    if (fontBaseline.fontSizeSuppressed) {
      if (run.formatting.fontSizePt !== fontBaseline.modalFontSizePt) {
        fontSize = run.formatting.fontSizePt;
      }
    } else if (run.formatting.fontSizePt > 0) {
      fontSize = run.formatting.fontSizePt;
    }

    // Font name: emit only when suppressed and differs from modal, or not suppressed and has a value
    if (fontBaseline.fontNameSuppressed) {
      if (run.formatting.fontName !== fontBaseline.modalFontName) {
        fontName = run.formatting.fontName || null;
      }
    } else if (run.formatting.fontName) {
      fontName = run.formatting.fontName;
    }
  }

  return {
    hyperlinkUrl: run.hyperlinkUrl,
    bold, italic, underline, highlighting,
    color, fontSize, fontName,
  };
}

export function emitFormattingTags(params: {
  runs: AnnotatedRun[];
  baseline: FormattingBaseline;
  fontBaseline?: FontBaseline | null;
}): string {
  const { runs, baseline, fontBaseline } = params;
  if (runs.length === 0) return '';

  const out: string[] = [];
  let active: ActiveTags = {
    hyperlinkUrl: null,
    bold: false, italic: false, underline: false, highlighting: false,
    color: null, fontSize: null, fontName: null,
  };

  for (const run of runs) {
    if (!run.text) continue;
    const desired = desiredTagsForRun(run, baseline, fontBaseline ?? null);
    if (!tagsEqual(active, desired)) {
      closeTags(out, active);
      openTags(out, desired);
      active = desired;
    }
    out.push(run.text);
  }

  closeTags(out, active);
  return out.join('');
}

// ── Adjacent tag merging ─────────────────────────────────────────────

// Build a pattern matching </font><font ...> with identical attributes.
const FONT_ADJACENT_RE = /<\/font>(<font [^>]*>)/g;

export function mergeAdjacentTags(tagged: string): string {
  let result = tagged;
  let prev: string;
  do {
    prev = result;
    result = result
      .replace(/<\/b><b>/g, '')
      .replace(/<\/i><i>/g, '')
      .replace(/<\/u><u>/g, '')
      .replace(new RegExp(`</${HIGHLIGHT_TAG}><${HIGHLIGHT_TAG}>`, 'g'), '');

    // Collapse identical adjacent font tags: </font><font color="X" size="Y"> → remove if same
    FONT_ADJACENT_RE.lastIndex = 0;
    result = result.replace(FONT_ADJACENT_RE, (_match, nextOpen: string, offset: number) => {
      // Find the preceding <font ...> opening tag for this </font>
      const beforeClose = result.slice(0, offset);
      const lastOpenIdx = beforeClose.lastIndexOf('<font ');
      if (lastOpenIdx === -1) return _match;
      const lastOpenEnd = beforeClose.indexOf('>', lastOpenIdx);
      if (lastOpenEnd === -1) return _match;
      const prevOpen = beforeClose.slice(lastOpenIdx, lastOpenEnd + 1);
      if (prevOpen === nextOpen) return ''; // identical — merge
      return _match;
    });
  } while (result !== prev);
  return result;
}
