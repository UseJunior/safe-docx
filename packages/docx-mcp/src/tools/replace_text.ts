import { SessionManager, type Session } from '../session/manager.js';
import { errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { ERROR_PREVIEW_CHARS, RESULT_PREVIEW_CHARS, previewText } from './preview.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import {
  OOXML,
  W,
  findUniqueSubstringMatch,
  getParagraphRuns,
  hasHighlightTags,
  hasHyperlinkTags,
  stripHyperlinkTags,
  stripAllInlineTags,
  type ReplacementPart,
} from '@usejunior/docx-core';
import {
  splitTaggedText,
  segmentAddRunProps,
  hasAnyMarkupTags,
  hasHeaderTags,
} from './tag_parser.js';

function mergeAddRunProps(
  a: NonNullable<ReplacementPart['addRunProps']> | null | undefined,
  b: NonNullable<ReplacementPart['addRunProps']> | null | undefined,
): NonNullable<ReplacementPart['addRunProps']> | undefined {
  const out: NonNullable<ReplacementPart['addRunProps']> = { ...a };
  if (b) {
    if (b.bold !== undefined) out.bold = b.bold;
    if (b.italic !== undefined) out.italic = b.italic;
    if (b.underline !== undefined) out.underline = b.underline;
    if (b.highlight !== undefined) out.highlight = b.highlight;
    if (b.fontSize !== undefined) out.fontSize = b.fontSize;
    if (b.fontName !== undefined) out.fontName = b.fontName;
    if (b.color !== undefined) out.color = b.color;
  }
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

export function stripSearchTags(text: string): string {
  return stripAllInlineTags(text);
}

function runHasHighlight(r: Element): boolean {
  return r.getElementsByTagNameNS(OOXML.W_NS, W.highlight).length > 0;
}

function chooseContextTemplateRun(
  runs: Array<{ r: Element; text: string }>,
  matchStart: number,
  matchEnd: number,
): { templateRun: Element | null; allOverlappedRunsHighlighted: boolean } {
  const overlaps: Array<{ run: Element; overlap: number }> = [];
  let pos = 0;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    const overlap = Math.max(0, Math.min(matchEnd, runEnd) - Math.max(matchStart, runStart));
    if (overlap > 0) overlaps.push({ run: run.r, overlap });
    pos = runEnd;
  }

  if (overlaps.length === 0) return { templateRun: null, allOverlappedRunsHighlighted: false };

  let allHl = true;
  for (const o of overlaps) {
    if (!runHasHighlight(o.run)) {
      allHl = false;
      break;
    }
  }

  let best = -1;
  let template: Element | null = null;
  for (const o of overlaps) {
    if (o.overlap > best) {
      best = o.overlap;
      template = o.run;
    }
  }

  return { templateRun: template, allOverlappedRunsHighlighted: allHl };
}

function buildDistributedPartsAcrossRuns(
  runs: Array<{ r: Element; text: string }>,
  matchStart: number,
  matchEnd: number,
  newStr: string,
  shouldClearHighlight: boolean,
): ReplacementPart[] | null {
  const overlaps: Array<{ r: Element; text: string; start: number; end: number }> = [];
  let pos = 0;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    const overlap = Math.max(0, Math.min(matchEnd, runEnd) - Math.max(matchStart, runStart));
    if (overlap > 0) {
      overlaps.push({
        r: run.r,
        text: run.text,
        start: Math.max(0, matchStart - runStart),
        end: Math.min(run.text.length, matchEnd - runStart),
      });
    }
    pos = runEnd;
  }

  if (overlaps.length <= 1) return null;

  const totalOldLen = overlaps.reduce((sum, o) => sum + (o.end - o.start), 0);
  if (totalOldLen === 0) return null;

  const parts: ReplacementPart[] = [];
  let distributedLen = 0;
  for (let i = 0; i < overlaps.length; i++) {
    const o = overlaps[i]!;
    const oldPartLen = o.end - o.start;
    const ratio = oldPartLen / totalOldLen;
    let newPartLen = Math.round(ratio * newStr.length);
    if (i === overlaps.length - 1) newPartLen = newStr.length - distributedLen;

    const text = newStr.slice(distributedLen, distributedLen + newPartLen);
    distributedLen += newPartLen;

    if (text) {
      parts.push({
        text,
        templateRun: o.r,
        clearHighlight: shouldClearHighlight,
      });
    }
  }

  return parts;
}

function isLikelyFieldPlaceholder(text: string): boolean {
  const t = text.trim();
  return (t.startsWith('[') && t.endsWith(']')) || (t.startsWith('«') && t.endsWith('»'));
}

export async function replaceText(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    target_paragraph_id: string;
    old_string: string;
    new_string: string;
    instruction: string;
    normalize_first?: boolean;
    clean_match?: boolean;
    clear_highlight?: boolean;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean | string;
    highlight?: boolean | string;
    font_size?: number;
    font_name?: string;
    color?: string;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'replace_text' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    if (params.normalize_first) {
      session.doc.mergeRunsOnly();
    }

    const { target_paragraph_id: pid } = params;
    const oldStr = stripSearchTags(params.old_string);
    let newStr = params.new_string;
    if (hasHyperlinkTags(newStr)) newStr = stripHyperlinkTags(newStr);

    const beforeTextRaw = session.doc.getParagraphTextById(pid);
    if (beforeTextRaw === null) {
      return err('ANCHOR_NOT_FOUND', `Paragraph ID ${pid} not found in document`);
    }

    const paraText = beforeTextRaw;
    const findMode = params.clean_match ? 'clean' : 'default';
    const textMatch = findUniqueSubstringMatch(paraText, oldStr, { mode: findMode });
    if (textMatch.status === 'not_found') {
      return err('TEXT_NOT_FOUND', `Text '${previewText(oldStr, ERROR_PREVIEW_CHARS)}' not found in paragraph ${pid}`);
    }

    if (textMatch.status === 'multiple') {
      return err('MULTIPLE_MATCHES', `Found ${textMatch.matchCount} matches for '${previewText(oldStr, ERROR_PREVIEW_CHARS)}' in paragraph. Need unique match.`);
    }

    const pEl = session.doc.getParagraphElementById(pid);
    if (!pEl) {
      return err('ANCHOR_NOT_FOUND', `Paragraph ID ${pid} not found in document`);
    }

    const matchedOldStr = textMatch.matchedText;
    const matchStart = textMatch.start;
    const matchEnd = textMatch.end;
    const paraRuns = getParagraphRuns(pEl);
    const { templateRun: contextTemplateRun, allOverlappedRunsHighlighted } = chooseContextTemplateRun(paraRuns, matchStart, matchEnd);
    
    const explicitAddProps: NonNullable<ReplacementPart['addRunProps']> = {};
    if (params.bold !== undefined) explicitAddProps.bold = params.bold;
    if (params.italic !== undefined) explicitAddProps.italic = params.italic;
    if (params.underline !== undefined) explicitAddProps.underline = params.underline;
    if (params.highlight !== undefined) explicitAddProps.highlight = params.highlight;
    if (params.font_size !== undefined) explicitAddProps.fontSize = params.font_size * 2;
    if (params.font_name !== undefined) explicitAddProps.fontName = params.font_name;
    if (params.color !== undefined) explicitAddProps.color = params.color;
    
    const shouldClearHighlight = params.clear_highlight || (allOverlappedRunsHighlighted && !hasHighlightTags(newStr) && isLikelyFieldPlaceholder(oldStr));

    let replaceText: string | ReplacementPart[] = newStr;
    const hasMarkup = hasAnyMarkupTags(newStr);
    
    if (hasMarkup) {
      let segs: ReturnType<typeof splitTaggedText>;
      try {
        segs = splitTaggedText(newStr);
      } catch (e: unknown) {
        return err(errorMessage(e), `Tag parse error in new_string: ${errorMessage(e)}`);
      }
      const headerAddProps = segs.some((s) => s.header) ? findHeaderRoleModelAddRunProps(session, pid) : null;

      const parts: ReplacementPart[] = [];
      for (const s of segs) {
        if (!s.text) continue;
        const segAddProps = mergeAddRunProps(mergeAddRunProps(segmentAddRunProps(s), explicitAddProps), s.header ? headerAddProps : null);
        const clearHighlight = shouldClearHighlight && !s.highlighting;
        parts.push({ text: s.text, templateRun: contextTemplateRun ?? undefined, addRunProps: segAddProps, clearHighlight });
      }
      replaceText = parts;
    } else {
      const distributed = buildDistributedPartsAcrossRuns(paraRuns, matchStart, matchEnd, newStr, shouldClearHighlight);
      if (distributed && distributed.length > 0) {
        replaceText = distributed.map(d => ({ ...d, addRunProps: mergeAddRunProps(d.addRunProps, explicitAddProps) }));
      } else if (shouldClearHighlight || contextTemplateRun || Object.keys(explicitAddProps).length > 0) {
        replaceText = [{ text: newStr, templateRun: contextTemplateRun ?? undefined, addRunProps: explicitAddProps, clearHighlight: shouldClearHighlight }];
      }
    }

    session.doc.replaceText({ targetParagraphId: pid, findText: matchedOldStr, replaceText });
    manager.markEdited(session);

    return ok(mergeSessionResolutionMetadata({
      success: true,
      session_id: session.sessionId,
      edit_count: session.editCount,
      target_paragraph_id: pid,
      replacements_made: 1,
      before_text: previewText(paraText.trim(), RESULT_PREVIEW_CHARS),
      after_text: previewText((session.doc.getParagraphTextById(pid) ?? '').trim(), RESULT_PREVIEW_CHARS),
    }, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('EDIT_ERROR', `Failed to edit document: ${msg}`);
  }
}
