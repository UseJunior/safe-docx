import {
  getParagraphRuns,
  hasHyperlinkTags,
  stripHyperlinkTags,
  stripAllInlineTags,
  type ReplacementPart,
} from '@usejunior/docx-core';
import { SessionManager, type Session } from '../session/manager.js';
import { errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { RESULT_PREVIEW_CHARS, previewText } from './preview.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import {
  splitTaggedText,
  segmentAddRunProps,
  type ParsedReplacementSegment,
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

function buildReplacementPartsForInsert(
  segments: ParsedReplacementSegment[],
  templateRun: Element | null,
  headerAddProps: NonNullable<ReplacementPart['addRunProps']> | null,
): ReplacementPart[] | null {
  const parts: ReplacementPart[] = [];

  for (const seg of segments) {
    if (!seg.text) continue;
    const segAdd = mergeAddRunProps(
      segmentAddRunProps(seg),
      seg.header ? headerAddProps : null,
    );

    parts.push({
      text: seg.text,
      templateRun: templateRun ?? undefined,
      addRunProps: segAdd,
    });
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
    target_style?: string;
  },
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'insert_paragraph' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const positionUpper = (params.position ?? 'AFTER').toUpperCase();
    if (positionUpper !== 'BEFORE' && positionUpper !== 'AFTER') {
      return err('INVALID_POSITION', `Invalid position: ${params.position}. Must be 'BEFORE' or 'AFTER'.`);
    }

    const anchorText = session.doc.getParagraphTextById(params.positional_anchor_node_id);
    if (anchorText === null) {
      return err('ANCHOR_NOT_FOUND', `Paragraph ID ${params.positional_anchor_node_id} not found in document`);
    }

    let styleSourceId = params.style_source_id;
    if (!styleSourceId && params.target_style) {
      const { nodes } = session.doc.buildDocumentView({ includeSemanticTags: false });
      const anchorIdx = nodes.findIndex((n) => n.id === params.positional_anchor_node_id);
      if (anchorIdx >= 0) {
        let bestDist = Infinity;
        let bestId: string | null = null;
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i]!.style === params.target_style) {
            const dist = Math.abs(i - anchorIdx);
            if (dist < bestDist) {
              bestDist = dist;
              bestId = nodes[i]!.id;
            }
          }
        }
        if (bestId) styleSourceId = bestId;
      }
    }

    let inputText = params.new_string;
    if (hasHyperlinkTags(inputText)) inputText = stripHyperlinkTags(inputText);

    const paragraphInputs = inputText.replace(/\r\n/g, '\n').split(/\n{2,}/);
    let parsedParagraphs: ReturnType<typeof splitTaggedText>[];
    try {
      parsedParagraphs = paragraphInputs.map((p) => splitTaggedText(p));
    } catch (e: unknown) {
      return err(errorMessage(e), `Tag parse error in new_string: ${errorMessage(e)}`);
    }
    const plainParagraphs = paragraphInputs.map((p) => stripAllInlineTags(p));

    const res = session.doc.insertParagraph({
      positionalAnchorNodeId: params.positional_anchor_node_id,
      relativePosition: positionUpper as 'BEFORE' | 'AFTER',
      newText: plainParagraphs.join('\n\n'),
      styleSourceId: styleSourceId,
    });

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
      const templateRun = chooseRunByOverlap(runs, 0, Math.max(plainText.length, 1)) ?? runs[0]?.r ?? null;

      const replacementParts = buildReplacementPartsForInsert(segs, templateRun, headerAddProps);
      if (!replacementParts || replacementParts.length === 0) continue;
      session.doc.replaceText({ targetParagraphId: newPid, findText: plainText, replaceText: replacementParts });
    }

    manager.markEdited(session);

    return ok(mergeSessionResolutionMetadata({
      success: true,
      session_id: session.sessionId,
      edit_count: session.editCount,
      anchor_paragraph_id: params.positional_anchor_node_id,
      new_paragraph_id: res.newParagraphId,
      new_paragraph_ids: res.newParagraphIds,
      position: positionUpper,
      inserted_text: previewText(plainParagraphs.join('\n\n'), RESULT_PREVIEW_CHARS),
    }, metadata));
  } catch (e: unknown) {
    return err('INSERT_ERROR', `Failed to insert paragraph: ${errorMessage(e)}`);
  }
}
