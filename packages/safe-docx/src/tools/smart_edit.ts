import { SessionManager, type Session } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { ERROR_PREVIEW_CHARS, RESULT_PREVIEW_CHARS, previewText } from './preview.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import {
  OOXML,
  W,
  findInlineDefinitionSpan,
  findUniqueSubstringMatch,
  getParagraphRuns,
  hasDefinitionTags,
  hasHighlightTags,
  hasFormattingTags,
  hasHyperlinkTags,
  stripDefinitionTags,
  stripHighlightTags,
  stripFormattingTags,
  stripHyperlinkTags,
  type ReplacementPart,
} from '@usejunior/docx-primitives';

type ParsedSegmentState = {
  definition: boolean;
  highlighting: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  header: boolean;
};
type ParsedReplacementSegment = ParsedSegmentState & { text: string };

const OPEN_DEF = '<definition>';
const CLOSE_DEF = '</definition>';
const OPEN_HEADER = '<header>';
const CLOSE_HEADER = '</header>';
const OPEN_RUN_IN_HEADER = '<RunInHeader>';
const CLOSE_RUN_IN_HEADER = '</RunInHeader>';
const OPEN_HL = '<highlighting>';
const CLOSE_HL = '</highlighting>';
const OPEN_B = '<b>';
const CLOSE_B = '</b>';
const OPEN_I = '<i>';
const CLOSE_I = '</i>';
const OPEN_U = '<u>';
const CLOSE_U = '</u>';

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function useLegacyDefinitionTags(): boolean {
  return isTruthyEnv(process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS);
}

function hasInlineStyleTags(text: string): boolean {
  return (
    text.includes(OPEN_B) ||
    text.includes(CLOSE_B) ||
    text.includes(OPEN_I) ||
    text.includes(CLOSE_I) ||
    text.includes(OPEN_U) ||
    text.includes(CLOSE_U)
  );
}

function hasHeaderTags(text: string): boolean {
  return (
    text.includes(OPEN_HEADER) ||
    text.includes(CLOSE_HEADER) ||
    text.includes(OPEN_RUN_IN_HEADER) ||
    text.includes(CLOSE_RUN_IN_HEADER)
  );
}

function statesEqual(a: ParsedSegmentState, b: ParsedSegmentState): boolean {
  return (
    a.definition === b.definition &&
    a.highlighting === b.highlighting &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.header === b.header
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

function splitTaggedText(
  text: string,
  opts: { allowDefinitionTags: boolean },
): ParsedReplacementSegment[] {
  const counters = {
    definition: 0,
    header: 0,
    highlighting: 0,
    bold: 0,
    italic: 0,
    underline: 0,
  };
  const out: ParsedReplacementSegment[] = [];
  let i = 0;
  let buf = '';

  const state = (): ParsedSegmentState => ({
    definition: counters.definition > 0,
    header: counters.header > 0,
    highlighting: counters.highlighting > 0,
    bold: counters.bold > 0,
    italic: counters.italic > 0,
    underline: counters.underline > 0,
  });

  const flush = () => {
    pushSegment(out, buf, state());
    buf = '';
  };

  const open = (key: keyof typeof counters) => {
    flush();
    counters[key] += 1;
  };
  const close = (key: keyof typeof counters, errCode: string) => {
    flush();
    if (counters[key] === 0) throw new Error(errCode);
    counters[key] -= 1;
  };

  while (i < text.length) {
    if (opts.allowDefinitionTags && text.startsWith(OPEN_DEF, i)) {
      open('definition');
      i += OPEN_DEF.length;
      continue;
    }
    if (opts.allowDefinitionTags && text.startsWith(CLOSE_DEF, i)) {
      close('definition', 'UNBALANCED_DEFINITION_TAGS');
      i += CLOSE_DEF.length;
      continue;
    }
    if (text.startsWith(OPEN_HEADER, i)) {
      open('header');
      i += OPEN_HEADER.length;
      continue;
    }
    if (text.startsWith(CLOSE_HEADER, i)) {
      close('header', 'UNBALANCED_HEADER_TAGS');
      i += CLOSE_HEADER.length;
      continue;
    }
    if (text.startsWith(OPEN_RUN_IN_HEADER, i)) {
      open('header');
      i += OPEN_RUN_IN_HEADER.length;
      continue;
    }
    if (text.startsWith(CLOSE_RUN_IN_HEADER, i)) {
      close('header', 'UNBALANCED_HEADER_TAGS');
      i += CLOSE_RUN_IN_HEADER.length;
      continue;
    }
    if (text.startsWith(OPEN_HL, i)) {
      open('highlighting');
      i += OPEN_HL.length;
      continue;
    }
    if (text.startsWith(CLOSE_HL, i)) {
      close('highlighting', 'UNBALANCED_HIGHLIGHT_TAGS');
      i += CLOSE_HL.length;
      continue;
    }
    if (text.startsWith(OPEN_B, i)) {
      open('bold');
      i += OPEN_B.length;
      continue;
    }
    if (text.startsWith(CLOSE_B, i)) {
      close('bold', 'UNBALANCED_BOLD_TAGS');
      i += CLOSE_B.length;
      continue;
    }
    if (text.startsWith(OPEN_I, i)) {
      open('italic');
      i += OPEN_I.length;
      continue;
    }
    if (text.startsWith(CLOSE_I, i)) {
      close('italic', 'UNBALANCED_ITALIC_TAGS');
      i += CLOSE_I.length;
      continue;
    }
    if (text.startsWith(OPEN_U, i)) {
      open('underline');
      i += OPEN_U.length;
      continue;
    }
    if (text.startsWith(CLOSE_U, i)) {
      close('underline', 'UNBALANCED_UNDERLINE_TAGS');
      i += CLOSE_U.length;
      continue;
    }

    buf += text[i]!;
    i += 1;
  }

  flush();
  if (counters.definition > 0) throw new Error('UNBALANCED_DEFINITION_TAGS');
  if (counters.header > 0) throw new Error('UNBALANCED_HEADER_TAGS');
  if (counters.highlighting > 0) throw new Error('UNBALANCED_HIGHLIGHT_TAGS');
  if (counters.bold > 0) throw new Error('UNBALANCED_BOLD_TAGS');
  if (counters.italic > 0) throw new Error('UNBALANCED_ITALIC_TAGS');
  if (counters.underline > 0) throw new Error('UNBALANCED_UNDERLINE_TAGS');
  return out.length > 0 ? out : [{ text: '', ...state() }];
}

const QUOTE_CHARS = new Set([
  '"',
  "'",
  '\u201c',
  '\u201d',
  '\u2018',
  '\u2019',
  '\u00ab',
  '\u00bb',
  '\u2039',
  '\u203a',
]);

function isQuoteChar(ch: string): boolean {
  return QUOTE_CHARS.has(ch);
}

function stripOuterQuotes(term: string): string {
  let t = term;
  while (t && isQuoteChar(t[0]!)) t = t.slice(1);
  while (t && isQuoteChar(t[t.length - 1]!)) t = t.slice(0, -1);
  return t;
}

function absorbSurroundingQuotes(segs: ParsedReplacementSegment[]): void {
  // Python parity: <definition> absorbs quotes. If the LLM returns surrounding quotes
  // like: "<definition>Term</definition>" we should not double-quote.
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (!seg.definition) continue;

    const prev = i > 0 ? segs[i - 1] : null;
    if (prev && !prev.definition && prev.text && isQuoteChar(prev.text[prev.text.length - 1]!)) {
      prev.text = prev.text.slice(0, -1);
    }

    const next = i + 1 < segs.length ? segs[i + 1] : null;
    if (next && !next.definition && next.text && isQuoteChar(next.text[0]!)) {
      next.text = next.text.slice(1);
    }
  }
}

function segmentAddRunProps(seg: ParsedReplacementSegment): NonNullable<ReplacementPart['addRunProps']> | undefined {
  const add: NonNullable<ReplacementPart['addRunProps']> = {};
  if (seg.bold) add.bold = true;
  if (seg.italic) add.italic = true;
  if (seg.underline) add.underline = true;
  if (seg.highlighting) add.highlight = true;
  return Object.keys(add).length > 0 ? add : undefined;
}

function chooseRunByOverlap(runs: Array<{ r: Element; text: string }>, start: number, end: number): Element | null {
  let pos = 0;
  let bestRun: Element | null = null;
  let best = -1;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    const overlap = Math.max(0, Math.min(end, runEnd) - Math.max(start, runStart));
    if (overlap > best) {
      best = overlap;
      bestRun = run.r;
    }
    pos = runEnd;
  }
  return bestRun;
}

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
}

function runHasHighlight(run: Element): boolean {
  const rPr = run.getElementsByTagNameNS(OOXML.W_NS, W.rPr).item(0);
  if (!rPr) return false;
  const h = rPr.getElementsByTagNameNS(OOXML.W_NS, W.highlight).item(0);
  if (!h) return false;
  const v = getWAttr(h, 'val');
  return !!v && v !== 'none';
}

function isLikelyFieldPlaceholder(text: string): boolean {
  return /(\[[^\]]+\])|(\{\{[^}]+\}\})|(_{3,})/.test(text);
}

function chooseContextTemplateRun(
  runs: Array<{ r: Element; text: string }>,
  matchStart: number,
  matchEnd: number,
): { templateRun: Element | null; allOverlappedRunsHighlighted: boolean } {
  const overlapIndices: number[] = [];
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const end = pos + runs[i]!.text.length;
    if (Math.min(matchEnd, end) > Math.max(matchStart, pos)) overlapIndices.push(i);
    pos = end;
  }
  if (overlapIndices.length === 0) return { templateRun: null, allOverlappedRunsHighlighted: false };

  let allHl = true;
  for (const idx of overlapIndices) {
    if (!runHasHighlight(runs[idx]!.r)) {
      allHl = false;
      break;
    }
  }

  // Prefer a non-highlight run inside overlap.
  for (const idx of overlapIndices) {
    const r = runs[idx]!;
    if (!runHasHighlight(r.r)) return { templateRun: r.r, allOverlappedRunsHighlighted: allHl };
  }

  // Then search nearest non-highlight run around overlap.
  const left = overlapIndices[0]!;
  const right = overlapIndices[overlapIndices.length - 1]!;
  for (let d = 1; d < runs.length; d++) {
    const li = left - d;
    if (li >= 0 && !runHasHighlight(runs[li]!.r)) return { templateRun: runs[li]!.r, allOverlappedRunsHighlighted: allHl };
    const ri = right + d;
    if (ri < runs.length && !runHasHighlight(runs[ri]!.r)) return { templateRun: runs[ri]!.r, allOverlappedRunsHighlighted: allHl };
  }

  // Fallback to predominant run in overlap.
  return {
    templateRun: chooseRunByOverlap(runs, matchStart, matchEnd),
    allOverlappedRunsHighlighted: allHl,
  };
}

function mergeAddRunProps(
  a: NonNullable<ReplacementPart['addRunProps']> | null | undefined,
  b: NonNullable<ReplacementPart['addRunProps']> | null | undefined,
): NonNullable<ReplacementPart['addRunProps']> | undefined {
  const out: NonNullable<ReplacementPart['addRunProps']> = {};
  if (a?.bold) out.bold = true;
  if (a?.italic) out.italic = true;
  if (a?.underline) out.underline = a.underline;
  if (a?.highlight) out.highlight = a.highlight;
  if (b?.bold) out.bold = true;
  if (b?.italic) out.italic = true;
  if (b?.underline) out.underline = b.underline;
  if (b?.highlight) out.highlight = b.highlight;
  return Object.keys(out).length > 0 ? out : undefined;
}

function headerFormattingToAddRunProps(formatting: unknown): NonNullable<ReplacementPart['addRunProps']> | null {
  if (!formatting || typeof formatting !== 'object') return null;
  const fmt = formatting as { bold?: unknown; italic?: unknown; underline?: unknown };
  const add: NonNullable<ReplacementPart['addRunProps']> = {};
  if (fmt.bold === true) add.bold = true;
  if (fmt.italic === true) add.italic = true;
  if (fmt.underline === true) add.underline = true;
  return Object.keys(add).length > 0 ? add : null;
}

function extractDefinitionAddRunProps(run: Element | null): NonNullable<ReplacementPart['addRunProps']> | null {
  if (!run) return null;
  const rPr = run.getElementsByTagNameNS(OOXML.W_NS, W.rPr).item(0);
  if (!rPr) return null;

  const add: NonNullable<ReplacementPart['addRunProps']> = {};

  const bEl = rPr.getElementsByTagNameNS(OOXML.W_NS, W.b).item(0);
  if (bEl) {
    const v = getWAttr(bEl, 'val');
    if (v !== '0' && v !== 'false') add.bold = true;
  }

  const iEl = rPr.getElementsByTagNameNS(OOXML.W_NS, W.i).item(0);
  if (iEl) {
    const v = getWAttr(iEl, 'val');
    if (v !== '0' && v !== 'false') add.italic = true;
  }

  const uEl = rPr.getElementsByTagNameNS(OOXML.W_NS, W.u).item(0);
  if (uEl) {
    const v = getWAttr(uEl, 'val');
    if (!v || v !== 'none') add.underline = v ?? true;
  }

  return Object.keys(add).length > 0 ? add : null;
}

function findDefinitionRoleModelAddRunProps(
  session: Session,
  anchorParagraphId: string,
): NonNullable<ReplacementPart['addRunProps']> | null {
  const { nodes } = session.doc.buildDocumentView({ includeSemanticTags: false });
  const anchorIdx = nodes.findIndex((n) => n.id === anchorParagraphId);
  if (anchorIdx < 0) return null;

  for (let delta = 0; delta < nodes.length; delta++) {
    const candidates = [anchorIdx - delta, anchorIdx + delta];
    for (const idx of candidates) {
      if (idx < 0 || idx >= nodes.length) continue;
      const nid = nodes[idx]!.id;
      const pEl = session.doc.getParagraphElementById(nid);
      if (!pEl) continue;
      const text = session.doc.getParagraphTextById(nid) ?? '';
      const span = findInlineDefinitionSpan(text);
      if (!span) continue;
      const runs = getParagraphRuns(pEl);
      const r = chooseRunByOverlap(runs, span.term_start, span.term_end);
      const add = extractDefinitionAddRunProps(r);
      if (add) return add;
    }
  }

  return null;
}

function findHeaderRoleModelAddRunProps(
  session: Session,
  anchorParagraphId: string,
): NonNullable<ReplacementPart['addRunProps']> | null {
  const { nodes } = session.doc.buildDocumentView({ includeSemanticTags: false });
  const anchorIdx = nodes.findIndex((n) => n.id === anchorParagraphId);
  if (anchorIdx < 0) return null;

  for (let delta = 0; delta < nodes.length; delta++) {
    const candidates = [anchorIdx - delta, anchorIdx + delta];
    for (const idx of candidates) {
      if (idx < 0 || idx >= nodes.length) continue;
      const candidate = nodes[idx]!;
      const add = headerFormattingToAddRunProps(candidate.header_formatting);
      if (add) return add;
    }
  }

  return null;
}

function buildDistributedPartsAcrossRuns(
  runs: Array<{ r: Element; text: string }>,
  matchStart: number,
  matchEnd: number,
  replacementText: string,
  clearHighlight: boolean,
): ReplacementPart[] | null {
  if (replacementText.length === 0) return [];

  const overlaps: Array<{ run: Element; overlap: number }> = [];
  let pos = 0;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    const overlap = Math.max(0, Math.min(matchEnd, runEnd) - Math.max(matchStart, runStart));
    if (overlap > 0) overlaps.push({ run: run.r, overlap });
    pos = runEnd;
  }

  if (overlaps.length <= 1) return null;

  const totalOverlap = overlaps.reduce((sum, x) => sum + x.overlap, 0);
  if (totalOverlap <= 0) return null;

  const allocations = overlaps.map((x) => {
    const exact = (replacementText.length * x.overlap) / totalOverlap;
    const base = Math.floor(exact);
    return { ...x, base, frac: exact - base, alloc: base };
  });

  let assigned = allocations.reduce((sum, x) => sum + x.alloc, 0);
  let remaining = replacementText.length - assigned;
  allocations.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < allocations.length && remaining > 0; i++) {
    allocations[i]!.alloc += 1;
    remaining -= 1;
  }
  allocations.sort((a, b) => runs.findIndex((r) => r.r === a.run) - runs.findIndex((r) => r.r === b.run));

  const parts: ReplacementPart[] = [];
  let cursor = 0;
  for (const a of allocations) {
    if (a.alloc <= 0) continue;
    const text = replacementText.slice(cursor, cursor + a.alloc);
    cursor += a.alloc;
    parts.push({
      text,
      templateRun: a.run,
      clearHighlight,
    });
  }

  if (cursor < replacementText.length && parts.length > 0) {
    parts[parts.length - 1]!.text += replacementText.slice(cursor);
  }

  return parts.length > 0 ? parts : null;
}

export async function smartEdit(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    target_paragraph_id: string;
    old_string: string;
    new_string: string;
    instruction: string;
    normalize_first?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'smart_edit' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    // Optional run normalization before search to handle fragmented runs
    if (params.normalize_first) {
      session.doc.mergeRunsOnly();
    }

    const { target_paragraph_id: pid } = params;
    const legacyDefinitionTags = useLegacyDefinitionTags();
    let oldStr = params.old_string;
    if (hasDefinitionTags(oldStr)) oldStr = stripDefinitionTags(oldStr);
    if (hasHighlightTags(oldStr)) oldStr = stripHighlightTags(oldStr);
    if (hasFormattingTags(oldStr)) oldStr = stripFormattingTags(oldStr);
    if (hasHyperlinkTags(oldStr)) oldStr = stripHyperlinkTags(oldStr);
    let newStr = params.new_string;
    if (!legacyDefinitionTags && hasDefinitionTags(newStr)) {
      // Default mode: definition tags are normalized into plain quoted text.
      newStr = stripDefinitionTags(newStr);
    }
    // Strip <a> tags from new_string — hyperlinks are read-only and cannot be created via smart_edit.
    if (hasHyperlinkTags(newStr)) newStr = stripHyperlinkTags(newStr);

    // Find the paragraph and do a unique find/replace.
    const beforeTextRaw = session.doc.getParagraphTextById(pid);
    if (beforeTextRaw === null) {
      return err(
        'ANCHOR_NOT_FOUND',
        `Paragraph ID ${pid} not found in document`,
        'Use grep or read_file to find valid paragraph IDs',
      );
    }

    const paraText = beforeTextRaw;
    const textMatch = findUniqueSubstringMatch(paraText, oldStr);
    if (textMatch.status === 'not_found') {
      return err(
        'TEXT_NOT_FOUND',
        `Text '${previewText(oldStr, ERROR_PREVIEW_CHARS)}' not found in paragraph ${pid}`,
        'Verify old_string and paragraph context. Matching is tolerant to quote/whitespace variants but still requires a unique match.',
      );
    }

    if (textMatch.status === 'multiple') {
      return err(
        'MULTIPLE_MATCHES',
        `Found ${textMatch.matchCount} matches for '${previewText(oldStr, ERROR_PREVIEW_CHARS)}' in paragraph using ${textMatch.mode} matching. Need unique match.`,
        'Provide more context in old_string to make the match unique.',
      );
    }

    const pEl = session.doc.getParagraphElementById(pid);
    if (!pEl) {
      return err(
        'ANCHOR_NOT_FOUND',
        `Paragraph ID ${pid} not found in document`,
        'Use grep or read_file to find valid paragraph IDs',
      );
    }

    const matchedOldStr = textMatch.matchedText;
    const matchStart = textMatch.start;
    const matchEnd = textMatch.end;
    const paraRuns = getParagraphRuns(pEl);
    const { templateRun: contextTemplateRun, allOverlappedRunsHighlighted } = chooseContextTemplateRun(paraRuns, matchStart, matchEnd);
    const shouldClearHighlight = allOverlappedRunsHighlighted && !hasHighlightTags(newStr) && isLikelyFieldPlaceholder(oldStr);

    // Apply edit.
    let replaceText: string | ReplacementPart[] = newStr;
    const hasMarkup =
      hasHighlightTags(newStr) ||
      hasHeaderTags(newStr) ||
      hasInlineStyleTags(newStr) ||
      (legacyDefinitionTags && hasDefinitionTags(newStr));
    if (hasMarkup) {
      const segs = splitTaggedText(newStr, { allowDefinitionTags: legacyDefinitionTags });
      if (legacyDefinitionTags) absorbSurroundingQuotes(segs);

      const defAddProps =
        legacyDefinitionTags && segs.some((s) => s.definition)
          ? findDefinitionRoleModelAddRunProps(session, pid)
          : null;
      const headerAddProps = segs.some((s) => s.header)
        ? findHeaderRoleModelAddRunProps(session, pid)
        : null;

      const parts: ReplacementPart[] = [];
      for (const s of segs) {
        if (!s.text) continue;
        const segAddProps = mergeAddRunProps(
          segmentAddRunProps(s),
          s.header ? headerAddProps : null,
        );
        const clearHighlight = shouldClearHighlight && !s.highlighting;

        if (legacyDefinitionTags && s.definition) {
          const term = stripOuterQuotes(s.text);
          if (!term) continue;
          parts.push({
            text: '"',
            templateRun: contextTemplateRun ?? undefined,
            addRunProps: segAddProps,
            clearHighlight,
          });
          parts.push({
            text: term,
            templateRun: contextTemplateRun ?? undefined,
            addRunProps: mergeAddRunProps(defAddProps, segAddProps),
            clearHighlight,
          });
          parts.push({
            text: '"',
            templateRun: contextTemplateRun ?? undefined,
            addRunProps: segAddProps,
            clearHighlight,
          });
        } else {
          parts.push({
            text: s.text,
            templateRun: contextTemplateRun ?? undefined,
            addRunProps: segAddProps,
            clearHighlight,
          });
        }
      }
      replaceText = parts;
    } else {
      const defAddProps = findDefinitionRoleModelAddRunProps(session, pid);
      const explicitDefSpan = defAddProps ? findInlineDefinitionSpan(newStr) : null;
      if (explicitDefSpan && explicitDefSpan.term_start >= 0 && explicitDefSpan.term_end > explicitDefSpan.term_start) {
        const before = newStr.slice(0, explicitDefSpan.term_start);
        const term = newStr.slice(explicitDefSpan.term_start, explicitDefSpan.term_end);
        const after = newStr.slice(explicitDefSpan.term_end);
        replaceText = [
          ...(before ? [{ text: before, templateRun: contextTemplateRun ?? undefined, clearHighlight: shouldClearHighlight }] : []),
          {
            text: term,
            templateRun: contextTemplateRun ?? undefined,
            addRunProps: mergeAddRunProps(defAddProps, null),
            clearHighlight: shouldClearHighlight,
          },
          ...(after ? [{ text: after, templateRun: contextTemplateRun ?? undefined, clearHighlight: shouldClearHighlight }] : []),
        ];
      } else {
        const distributed = buildDistributedPartsAcrossRuns(
          paraRuns,
          matchStart,
          matchEnd,
          newStr,
          shouldClearHighlight,
        );
        if (distributed && distributed.length > 0) {
          replaceText = distributed;
        } else if (shouldClearHighlight || contextTemplateRun) {
          replaceText = [
            {
              text: newStr,
              templateRun: contextTemplateRun ?? undefined,
              clearHighlight: shouldClearHighlight,
            },
          ];
        }
      }
    }

    session.doc.smartEdit({ targetParagraphId: pid, findText: matchedOldStr, replaceText });
    manager.markEdited(session);

    const beforeText = paraText.trim();
    const afterText = (session.doc.getParagraphTextById(pid) ?? '').trim();

    return ok(mergeSessionResolutionMetadata({
      success: true,
      session_id: session.sessionId,
      edit_count: session.editCount,
      target_paragraph_id: pid,
      replacements_made: 1,
      before_text: previewText(beforeText, RESULT_PREVIEW_CHARS),
      after_text: previewText(afterText, RESULT_PREVIEW_CHARS),
    }, metadata));
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return err('EDIT_ERROR', `Failed to edit document: ${msg}`, 'Use grep to find valid paragraph IDs and verify old_string exists.');
  }
}
