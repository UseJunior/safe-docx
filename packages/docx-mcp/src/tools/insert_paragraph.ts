import {
  OOXML,
  W,
  findInlineDefinitionSpan,
  getParagraphRuns,
  hasDefinitionTags,
  hasHyperlinkTags,
  stripDefinitionTags,
  stripHyperlinkTags,
  type ReplacementPart,
} from '@usejunior/docx-core';
import { SessionManager, type Session } from '../session/manager.js';
import { errorCode, errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { RESULT_PREVIEW_CHARS, previewText } from './preview.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';

type ParsedSegmentState = {
  definition: boolean;
  header: boolean;
  highlighting: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
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

function statesEqual(a: ParsedSegmentState, b: ParsedSegmentState): boolean {
  return (
    a.definition === b.definition
    && a.header === b.header
    && a.highlighting === b.highlighting
    && a.bold === b.bold
    && a.italic === b.italic
    && a.underline === b.underline
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

function chooseRunByOverlap(
  runs: Array<{ r: Element; text: string }>,
  start: number,
  end: number,
): Element | null {
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

function headerFormattingToAddRunProps(formatting: unknown): NonNullable<ReplacementPart['addRunProps']> | null {
  if (!formatting || typeof formatting !== 'object') return null;
  const fmt = formatting as { bold?: unknown; italic?: unknown; underline?: unknown };
  const add: NonNullable<ReplacementPart['addRunProps']> = {};
  if (fmt.bold === true) add.bold = true;
  if (fmt.italic === true) add.italic = true;
  if (fmt.underline === true) add.underline = true;
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

function buildPlainTextFromSegments(
  segments: ParsedReplacementSegment[],
  legacyDefinitionTags: boolean,
): string {
  const chunks: string[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    if (legacyDefinitionTags && seg.definition) {
      const term = stripOuterQuotes(seg.text);
      chunks.push(`"${term}"`);
    } else {
      chunks.push(seg.text);
    }
  }
  return chunks.join('');
}

function buildReplacementPartsForInsert(
  segments: ParsedReplacementSegment[],
  plainText: string,
  templateRun: Element | null,
  legacyDefinitionTags: boolean,
  defAddProps: NonNullable<ReplacementPart['addRunProps']> | null,
  headerAddProps: NonNullable<ReplacementPart['addRunProps']> | null,
): ReplacementPart[] | null {
  const parts: ReplacementPart[] = [];
  const hasTaggedDefinition = legacyDefinitionTags && segments.some((s) => s.definition);
  const autoDefSpan = (!hasTaggedDefinition && defAddProps)
    ? findInlineDefinitionSpan(plainText)
    : null;
  let textOffset = 0;

  for (const seg of segments) {
    if (!seg.text) continue;
    const segAdd = mergeAddRunProps(
      segmentAddRunProps(seg),
      seg.header ? headerAddProps : null,
    );

    if (legacyDefinitionTags && seg.definition) {
      const term = stripOuterQuotes(seg.text);
      if (!term) continue;
      parts.push({ text: '"', templateRun: templateRun ?? undefined, addRunProps: segAdd });
      parts.push({
        text: term,
        templateRun: templateRun ?? undefined,
        addRunProps: mergeAddRunProps(defAddProps, segAdd),
      });
      parts.push({ text: '"', templateRun: templateRun ?? undefined, addRunProps: segAdd });
      textOffset += (`"${term}"`).length;
    } else {
      const segText = seg.text;
      const segStart = textOffset;
      const segEnd = segStart + segText.length;
      textOffset = segEnd;

      if (
        autoDefSpan
        && autoDefSpan.term_end > autoDefSpan.term_start
        && Math.min(segEnd, autoDefSpan.term_end) > Math.max(segStart, autoDefSpan.term_start)
      ) {
        const overlapStart = Math.max(segStart, autoDefSpan.term_start);
        const overlapEnd = Math.min(segEnd, autoDefSpan.term_end);
        const relStart = overlapStart - segStart;
        const relEnd = overlapEnd - segStart;
        const before = segText.slice(0, relStart);
        const term = segText.slice(relStart, relEnd);
        const after = segText.slice(relEnd);

        if (before) {
          parts.push({
            text: before,
            templateRun: templateRun ?? undefined,
            addRunProps: segAdd,
          });
        }
        if (term) {
          parts.push({
            text: term,
            templateRun: templateRun ?? undefined,
            addRunProps: mergeAddRunProps(segAdd, defAddProps),
          });
        }
        if (after) {
          parts.push({
            text: after,
            templateRun: templateRun ?? undefined,
            addRunProps: segAdd,
          });
        }
      } else {
        parts.push({
          text: segText,
          templateRun: templateRun ?? undefined,
          addRunProps: segAdd,
        });
      }
    }
  }

  return parts.some((p) => !!p.addRunProps) ? parts : null;
}

export async function insertParagraph(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    positional_anchor_node_id: string;
    new_string: string;
    instruction: string;
    position?: string; // BEFORE|AFTER
    style_source_id?: string;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'insert_paragraph' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const positionUpper = (params.position ?? 'AFTER').toUpperCase();
    if (positionUpper !== 'BEFORE' && positionUpper !== 'AFTER') {
      return err(
        'INVALID_POSITION',
        `Invalid position: ${params.position}. Must be 'BEFORE' or 'AFTER'.`,
        "Use 'BEFORE' to insert above the anchor, 'AFTER' to insert below.",
      );
    }

    // Ensure anchor exists.
    const anchorText = session.doc.getParagraphTextById(params.positional_anchor_node_id);
    if (anchorText === null) {
      return err(
        'ANCHOR_NOT_FOUND',
        `Paragraph ID ${params.positional_anchor_node_id} not found in document`,
        'Use grep or read_file to find valid paragraph IDs',
      );
    }

    const legacyDefinitionTags = useLegacyDefinitionTags();
    let inputText = params.new_string;
    if (!legacyDefinitionTags && hasDefinitionTags(inputText)) inputText = stripDefinitionTags(inputText);
    // Strip <a> tags — hyperlinks are read-only and cannot be created via insert_paragraph.
    if (hasHyperlinkTags(inputText)) inputText = stripHyperlinkTags(inputText);
    const normalizedInput = inputText;

    const paragraphInputs = normalizedInput.replace(/\r\n/g, '\n').split(/\n{2,}/);
    const parsedParagraphs = paragraphInputs.map((p) => {
      const segs = splitTaggedText(p, { allowDefinitionTags: legacyDefinitionTags });
      if (legacyDefinitionTags) absorbSurroundingQuotes(segs);
      return segs;
    });
    const plainParagraphs = parsedParagraphs.map((segs) => buildPlainTextFromSegments(segs, legacyDefinitionTags));

    const res = session.doc.insertParagraph({
      positionalAnchorNodeId: params.positional_anchor_node_id,
      relativePosition: positionUpper as 'BEFORE' | 'AFTER',
      newText: plainParagraphs.join('\n\n'),
      styleSourceId: params.style_source_id,
    });

    const defAddProps = findDefinitionRoleModelAddRunProps(session, params.positional_anchor_node_id);
    const needsHeaderRoleModel = parsedParagraphs.some((segs) => segs.some((s) => s.header));
    const headerAddProps = needsHeaderRoleModel
      ? findHeaderRoleModelAddRunProps(session, params.positional_anchor_node_id)
      : null;

    for (let i = 0; i < res.newParagraphIds.length; i++) {
      const newPid = res.newParagraphIds[i]!;
      const segs = parsedParagraphs[i] ?? [];
      const plainText = plainParagraphs[i] ?? '';
      const pEl = session.doc.getParagraphElementById(newPid);
      if (!pEl) continue;
      const runs = getParagraphRuns(pEl);
      const templateRun = chooseRunByOverlap(runs, 0, Math.max(plainText.length, 1))
        ?? runs[0]?.r
        ?? null;

      const replacementParts = buildReplacementPartsForInsert(
        segs,
        plainText,
        templateRun,
        legacyDefinitionTags,
        defAddProps,
        headerAddProps,
      );
      if (!replacementParts || replacementParts.length === 0) continue;
      session.doc.replaceText({
        targetParagraphId: newPid,
        findText: plainText,
        replaceText: replacementParts,
      });
    }

    manager.markEdited(session);

    const responseData: Record<string, unknown> = {
      success: true,
      session_id: session.sessionId,
      edit_count: session.editCount,
      anchor_paragraph_id: params.positional_anchor_node_id,
      new_paragraph_id: res.newParagraphId,
      new_paragraph_ids: res.newParagraphIds,
      position: positionUpper,
      inserted_text: previewText(plainParagraphs.join('\n\n'), RESULT_PREVIEW_CHARS),
    };
    if (res.styleSourceFallback) {
      responseData.style_source_warning = `style_source_id '${params.style_source_id}' not found; fell back to anchor paragraph formatting.`;
    }
    return ok(mergeSessionResolutionMetadata(responseData, metadata));
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return err('INSERT_ERROR', `Failed to insert paragraph: ${msg}`, 'Use grep or read_file to find valid anchor paragraph IDs.');
  }
}
