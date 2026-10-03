import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { errorMessage } from "../error_utils.js";
import { err, ok, type ToolResponse } from './types.js';
import { ERROR_PREVIEW_CHARS, RESULT_PREVIEW_CHARS, previewText } from './preview.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';
import {
  OOXML,
  W,
  DocxDocument,
  SafeDocxError,
  findUniqueSubstringMatch,
  applyDocumentQuoteStyle,
  buildParagraphIndex,
  getParagraphRuns,
  hasHighlightTags,
  hasHyperlinkTags,
  replaceParagraphTextRange,
  stripHyperlinkTags,
  stripAllInlineTags,
  type IndexedField,
  type ReplacementPart,
  type RevisionContext,
} from '@usejunior/docx-core';
import {
  splitTaggedText,
  segmentAddRunProps,
  hasAnyMarkupTags,
  hasHeaderTags,
} from './tag_parser.js';

/**
 * Symbol characters (`w:sym`: a Wingdings checkbox, a bullet) that are not
 * inside a tracked deletion. They render as characters but contribute nothing
 * to the paragraph text the caller matched against, so a range that spans one
 * takes it out without the caller having seen it (issue #1044). The edit
 * reports the count it removed so the caller can review the checkbox or bullet
 * it could not see; under tracked changes the symbol sits in `w:del` with the
 * surrounding text and reject-all restores it.
 */
function countLiveSymbolCharacters(paragraph: Element): number {
  return Array.from(paragraph.getElementsByTagNameNS(OOXML.W_NS, 'sym')).filter((sym) => {
    for (let node: Node | null = sym.parentNode; node && node !== paragraph; node = node.parentNode) {
      if (node.nodeType === 1 && (node as Element).namespaceURI === OOXML.W_NS && (node as Element).localName === 'del') {
        return false;
      }
    }
    return true;
  }).length;
}

function symbolRemovalWarning(removed: number, tracked: boolean): string {
  const noun = removed === 1 ? 'symbol character' : 'symbol characters';
  const outcome = tracked
    ? 'deleted with the replaced text as a tracked change; reject the deletion to restore'
    : 'removed with the replaced text';
  return `The replaced range spanned ${removed} ${noun} (w:sym, such as a checkbox or bullet) ` +
    `not shown in the paragraph text; ${removed === 1 ? 'it was' : 'they were'} ${outcome}.`;
}

/**
 * Other constructs the paragraph text does not show and a range can take out
 * without the caller having seen them (issue #1097): a field with no result
 * (an `XE` index entry, a `TC` entry, a `PAGE` never updated: complex fields
 * with no `separate` marker) and a footnote or endnote reference. Each is
 * described once, in the order it is closed (a note reference where it sits,
 * a field at its `end` marker, so a nested field precedes the field around
 * it), and a before/after comparison names exactly what the edit removed.
 * Fields with a cached result are left out:
 * their result is in the paragraph text the caller matched, so the caller saw
 * what the range covers. An empty `w:fldSimple` is a zero-length marker the
 * replace primitive keeps in place, so it needs no count.
 *
 * Field state and note references come from docx-core's `buildParagraphIndex`,
 * the same traversal that defines the paragraph text the caller matched, built
 * with `skipTrackedDeletions`: a construct inside `w:del` is already gone from
 * the live document, so it is neither counted before the edit nor reported as
 * removed after a tracked edit moves it into `w:del`, and a deleted field
 * marker cannot pair with a live field. A field's instruction is the index's:
 * an `instrText` inside a nested field's result (as Word stores a nested
 * field's cached result within an outer instruction) is part of the outer
 * instruction.
 */
function collectLiveHiddenConstructs(paragraph: Element): string[] {
  const index = buildParagraphIndex(paragraph, { skipTrackedDeletions: true });
  const resultlessFieldsByEnd = new Map<Element, IndexedField>();
  for (const field of index.fields) {
    if (!field.hasResult && field.end) resultlessFieldsByEnd.set(field.end.element, field);
  }
  const labels: string[] = [];
  for (const node of index.nodes) {
    if (node.kind === 'footnote-reference' || node.kind === 'endnote-reference') {
      const id = node.element.getAttributeNS(OOXML.W_NS, 'id') ?? node.element.getAttribute('w:id') ?? '?';
      labels.push(`${node.kind === 'footnote-reference' ? 'footnote' : 'endnote'} reference (note id ${id})`);
      continue;
    }
    const field = resultlessFieldsByEnd.get(node.element);
    if (field) labels.push(`field with no result (instruction: ${field.instruction})`);
  }
  return labels;
}

/** Labels present before the edit and missing after it, as a multiset difference. */
function removedHiddenConstructs(before: string[], after: string[]): string[] {
  const remaining = new Map<string, number>();
  for (const label of after) remaining.set(label, (remaining.get(label) ?? 0) + 1);
  const removed: string[] = [];
  for (const label of before) {
    const count = remaining.get(label) ?? 0;
    if (count > 0) remaining.set(label, count - 1);
    else removed.push(label);
  }
  return removed;
}

function hiddenConstructRemovalWarning(label: string, tracked: boolean): string {
  const outcome = tracked
    ? 'deleted with the replaced text as a tracked change; reject the deletion to restore'
    : 'removed with the replaced text';
  const aftermath = !tracked && /^(?:footnote|endnote) reference/u.test(label)
    ? ' Its note body stays in the notes part, no longer referenced.'
    : '';
  const article = /^[aeiou]/iu.test(label) ? 'an' : 'a';
  return `The replaced range spanned ${article} ${label} not shown in the paragraph text; it was ${outcome}.${aftermath}`;
}

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
  doc: Pick<DocxDocument, 'buildDocumentView'>,
  anchorParagraphId: string,
): NonNullable<ReplacementPart['addRunProps']> | null {
  const { nodes } = doc.buildDocumentView({ includeSemanticTags: false });
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

/**
 * Count shared leading characters between two strings.
 */
export function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

/**
 * Count shared trailing characters between two strings,
 * non-overlapping with a known prefix of length `prefixLen`.
 */
export function commonSuffixLength(a: string, b: string, prefixLen: number): number {
  const maxSuffix = Math.min(a.length - prefixLen, b.length - prefixLen);
  let i = 0;
  while (i < maxSuffix && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function isLikelyFieldPlaceholder(text: string): boolean {
  const t = text.trim();
  return (t.startsWith('[') && t.endsWith(']')) || (t.startsWith('«') && t.endsWith('»'));
}

function invalidateDocumentCaches(doc: unknown): void {
  const mutableDoc = doc as { dirty?: boolean; documentViewCache?: unknown };
  mutableDoc.dirty = true;
  mutableDoc.documentViewCache = null;
}

export async function replaceText(
  manager: SessionManager,
  params: {
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
    /**
     * Internal (not exposed in the MCP tool schema): set by batch_edit, which
     * preflights the whole step sequence once instead of per step.
     */
    skip_ai_revision_preflight?: boolean;
  },
  ctx?: RevisionContext,
): Promise<ToolResponse> {
  try {
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'replace_text' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;
    const revisionCtx = ctx ?? await getRevisionContextForSession(session);

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

    const matchedOldStr = textMatch.matchedText;
    const matchStart = textMatch.start;
    const matchEnd = textMatch.end;
    
    const explicitAddProps: NonNullable<ReplacementPart['addRunProps']> = {};
    if (params.bold !== undefined) explicitAddProps.bold = params.bold;
    if (params.italic !== undefined) explicitAddProps.italic = params.italic;
    if (params.underline !== undefined) explicitAddProps.underline = params.underline;
    if (params.highlight !== undefined) explicitAddProps.highlight = params.highlight;
    if (params.font_size !== undefined) explicitAddProps.fontSize = params.font_size * 2;
    if (params.font_name !== undefined) explicitAddProps.fontName = params.font_name;
    if (params.color !== undefined) explicitAddProps.color = params.color;
    
    const hasMarkup = hasAnyMarkupTags(newStr);
    
    if (hasMarkup) {
      try {
        splitTaggedText(newStr);
      } catch (e: unknown) {
        return err(errorMessage(e), `Tag parse error in new_string: ${errorMessage(e)}`);
      }
    } else {
      // Fix 2: Transfer document quote style to new_string for non-exact matches.
      if (textMatch.mode !== 'exact' && textMatch.mode !== 'clean') {
        newStr = applyDocumentQuoteStyle(matchedOldStr, newStr);
      }

    }

    // Filled by the last run of `mutate` (the preflight preview runs it on a
    // copy first; the session run comes last and is the one reported).
    const editWarnings: string[] = [];

    const mutate = (doc: DocxDocument, activeCtx: RevisionContext | undefined): void => {
      editWarnings.length = 0;
      if (params.normalize_first) {
        doc.mergeRunsOnly();
      }

      const pEl = doc.getParagraphElementById(pid);
      if (!pEl) {
        throw new Error(`Paragraph ID ${pid} not found in document`);
      }
      const liveSymbolsBefore = countLiveSymbolCharacters(pEl);
      const hiddenBefore = collectLiveHiddenConstructs(pEl);
      const reportRemovedSymbols = (): void => {
        const removed = liveSymbolsBefore - countLiveSymbolCharacters(pEl);
        if (removed > 0) editWarnings.push(symbolRemovalWarning(removed, !!activeCtx));
        for (const label of removedHiddenConstructs(hiddenBefore, collectLiveHiddenConstructs(pEl))) {
          editWarnings.push(hiddenConstructRemovalWarning(label, !!activeCtx));
        }
      };

      const paraRuns = getParagraphRuns(pEl);
      const { templateRun: contextTemplateRun, allOverlappedRunsHighlighted } = chooseContextTemplateRun(paraRuns, matchStart, matchEnd);
      const localShouldClearHighlight = params.clear_highlight || (allOverlappedRunsHighlighted && !hasHighlightTags(newStr) && isLikelyFieldPlaceholder(oldStr));

      if (hasMarkup) {
        const segs = splitTaggedText(newStr);
        const headerAddProps = segs.some((s) => s.header) ? findHeaderRoleModelAddRunProps(doc, pid) : null;
        const parts: ReplacementPart[] = [];
        for (const s of segs) {
          if (!s.text) continue;
          const segAddProps = mergeAddRunProps(mergeAddRunProps(segmentAddRunProps(s), explicitAddProps), s.header ? headerAddProps : null);
          const clearHighlight = localShouldClearHighlight && !s.highlighting;
          parts.push({ text: s.text, templateRun: contextTemplateRun ?? undefined, addRunProps: segAddProps, clearHighlight });
        }
        if (activeCtx) {
          replaceParagraphTextRange(pEl, matchStart, matchEnd, parts, activeCtx);
          invalidateDocumentCaches(doc);
        } else {
          doc.replaceText({ targetParagraphId: pid, findText: matchedOldStr, replaceText: parts });
        }
        reportRemovedSymbols();
        return;
      }

      const prefixLen = commonPrefixLength(matchedOldStr, newStr);
      const suffixLen = commonSuffixLength(matchedOldStr, newStr, prefixLen);
      const trimmedNewStr = newStr.slice(prefixLen, newStr.length - suffixLen);
      const trimmedStart = matchStart + prefixLen;
      const trimmedEnd = matchEnd - suffixLen;

      if (trimmedStart >= trimmedEnd && trimmedNewStr.length === 0) return;

      let trimmedReplace: string | ReplacementPart[];
      if (localShouldClearHighlight || Object.keys(explicitAddProps).length > 0) {
        const { templateRun } = chooseContextTemplateRun(paraRuns, trimmedStart, trimmedEnd);
        trimmedReplace = [{
          text: trimmedNewStr,
          templateRun: templateRun ?? undefined,
          addRunProps: explicitAddProps,
          clearHighlight: localShouldClearHighlight,
        }];
      } else {
        trimmedReplace = trimmedNewStr;
      }

      if (activeCtx) {
        replaceParagraphTextRange(pEl, trimmedStart, trimmedEnd, trimmedReplace, activeCtx);
        invalidateDocumentCaches(doc);
      } else {
        doc.replaceTextAtRange({ targetParagraphId: pid, start: trimmedStart, end: trimmedEnd, replaceText: trimmedReplace });
      }
      reportRemovedSymbols();
      doc.mergeRunsOnly({ preserveRsidIdentity: true });
    };

    const revisionPreflight = params.skip_ai_revision_preflight
      ? null
      : await preflightAiRevisionMutation(session, revisionCtx, mutate, undefined, {
          // Formatting markup is not part of the construct match, so the gate
          // reads the plain text this edit inserts (issue #687).
          insertedText: stripAllInlineTags(newStr),
        });
    if (revisionPreflight?.blocked) return revisionPreflight.blocked;
    const preflightWarnings = revisionPreflight?.warnings ?? [];

    mutate(session.doc, revisionCtx);
    manager.markEdited(session);
    const warnings = [...preflightWarnings, ...editWarnings];

    return ok(mergeSessionResolutionMetadata({
      success: true,
      file_path: manager.normalizePath(session.originalPath),
      edit_count: session.editCount,
      target_paragraph_id: pid,
      replacements_made: 1,
      before_text: previewText(paraText.trim(), RESULT_PREVIEW_CHARS),
      after_text: previewText((session.doc.getParagraphTextById(pid) ?? '').trim(), RESULT_PREVIEW_CHARS),
      ...(warnings.length > 0 ? { warnings } : {}),
    }, metadata));
  } catch (e: unknown) {
    if (e instanceof SafeDocxError) {
      return err(e.code, e.message, e.hint);
    }
    const msg = errorMessage(e);
    return err('EDIT_ERROR', `Failed to edit document: ${msg}`);
  }
}
