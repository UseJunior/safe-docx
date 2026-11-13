/**
 * The `on_empty_numbered_paragraph` policy shared by `replace_text` and
 * `batch_edit` (issue #1047): what to do when an edit leaves the paragraph it
 * touched numbered but empty, so Word shows a bare list label such as `(b)`.
 *
 * The check is scoped to the touched paragraph and fires only when that
 * paragraph had visible content before the edit and has none after it, so an
 * empty numbered paragraph the input already had is never reported.
 */
import {
  OOXML,
  SafeDocxError,
  canSafelyRemoveEmptyParagraph,
  computeParagraphListLabels,
  getParagraphText,
  isEmptyNumberedParagraph,
  paragraphHasVisibleContent,
  replaceParagraphTextRange,
  type DocxDocument,
  type RevisionContext,
} from '@usejunior/docx-core';
import { previewText, RESULT_PREVIEW_CHARS } from './preview.js';

export const EMPTY_NUMBERED_PARAGRAPH_POLICIES = ['warn', 'error', 'remove_paragraph', 'ignore'] as const;
export type EmptyNumberedParagraphPolicy = (typeof EMPTY_NUMBERED_PARAGRAPH_POLICIES)[number];
export const DEFAULT_EMPTY_NUMBERED_PARAGRAPH_POLICY: EmptyNumberedParagraphPolicy = 'warn';
export const EMPTY_NUMBERED_PARAGRAPH_ERROR_CODE = 'EMPTY_NUMBERED_PARAGRAPH';

/** The policy a caller passed, the default when omitted, or null when the value is not one of the four. */
export function parseEmptyNumberedParagraphPolicy(value: unknown): EmptyNumberedParagraphPolicy | null {
  if (value === undefined || value === null) return DEFAULT_EMPTY_NUMBERED_PARAGRAPH_POLICY;
  return (EMPTY_NUMBERED_PARAGRAPH_POLICIES as readonly unknown[]).includes(value)
    ? (value as EmptyNumberedParagraphPolicy)
    : null;
}

export function invalidEmptyNumberedParagraphPolicyMessage(value: unknown): string {
  return `on_empty_numbered_paragraph must be one of ${EMPTY_NUMBERED_PARAGRAPH_POLICIES.map((p) => `"${p}"`).join(', ')}; got ${JSON.stringify(value)}.`;
}

/** True when the paragraph is still in the document and is now an empty numbered paragraph. */
export function isNowEmptyNumberedParagraph(doc: DocxDocument, paragraph: Element): boolean {
  if (!paragraph.parentNode || paragraphHasVisibleContent(paragraph)) return false;
  return isEmptyNumberedParagraph(paragraph, doc.getStylesModel(), doc.getNumberingModel());
}

function listLabelOf(doc: DocxDocument, paragraph: Element): string | null {
  const numbering = doc.getNumberingModel();
  if (!numbering) return null;
  const label = computeParagraphListLabels(doc.getParagraphs(), numbering, doc.getStylesModel()).get(paragraph)?.label;
  return label ? label : null;
}

function isW(el: Element, localName: string): boolean {
  return el.namespaceURI === OOXML.W_NS && el.localName === localName;
}

function wAttr(el: Element, name: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, name) ?? el.getAttribute(`w:${name}`);
}

/**
 * What still holds an empty paragraph in place, as short clauses: the
 * constructs the blanking rules keep a paragraph for. Paragraph ids
 * (`_bk_*`) sit beside the paragraph, not in it, so they never appear here.
 */
function describeParagraphHolders(paragraph: Element): string[] {
  const holders: string[] = [];
  const bookmarks = new Set<string>();
  let comment = false;
  let field = false;
  let sectionProperties = false;
  const visit = (el: Element): void => {
    if (isW(el, 'sectPr')) sectionProperties = true;
    else if (isW(el, 'bookmarkStart')) {
      const name = wAttr(el, 'name');
      if (name && !name.startsWith('_bk_')) bookmarks.add(name);
    } else if (isW(el, 'commentRangeStart') || isW(el, 'commentRangeEnd') || isW(el, 'commentReference')) comment = true;
    else if (isW(el, 'fldChar') || isW(el, 'fldSimple')) field = true;
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) visit(n as Element);
  };
  for (let n = paragraph.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) visit(n as Element);
  if (sectionProperties) holders.push('it carries section properties (w:sectPr)');
  for (const name of bookmarks) holders.push(`it holds bookmark "${name}"`);
  if (comment) holders.push('it holds a comment anchor');
  if (field) holders.push('it holds a field with no visible result');
  if (!canSafelyRemoveEmptyParagraph(paragraph)) holders.push('the document needs a paragraph there (for example a table cell\'s only paragraph)');
  return holders;
}

function emptyNumberedDescription(doc: DocxDocument, paragraphId: string, paragraph: Element, beforeText: string): string {
  const label = listLabelOf(doc, paragraph);
  const labelPart = label ? ` "${label}"` : '';
  return `Paragraph ${paragraphId} is now an empty numbered paragraph: Word shows its list label${labelPart} with nothing after it. `
    + `Before the edit it read "${previewText(beforeText.trim(), RESULT_PREVIEW_CHARS)}".`;
}

function keptBecause(holders: string[]): string {
  if (holders.length === 0) return ' The paragraph still holds markup that paragraph deletion keeps; inspect it before deleting the list item.';
  return ` The paragraph is kept because ${holders.join(' and ')}; inspect it before deleting the list item.`;
}

function emptyNumberedRemedy(paragraph: Element): string {
  const holders = describeParagraphHolders(paragraph);
  if (holders.length > 0) return keptBecause(holders);
  const remaining = getParagraphText(paragraph);
  const textHint = remaining.length > 0
    ? ` To delete the list item, replace its remaining whitespace (${JSON.stringify(remaining)}) with an empty new_string,`
    : ' To delete the list item,';
  return `${textHint} or repeat the edit with on_empty_numbered_paragraph: "remove_paragraph".`;
}

export type EmptyNumberedParagraphOutcome =
  | { kind: 'none' }
  | { kind: 'warning'; message: string }
  | { kind: 'removed'; message: string };

/**
 * Remove an empty numbered paragraph by finishing the blank: its remaining
 * whitespace text is deleted through the same primitive and rules as a
 * full-text blank, so an untracked edit removes the paragraph and a tracked
 * edit deletes the text and the paragraph mark (accept-all removes the
 * paragraph, reject-all restores it). A paragraph the blanking rules keep
 * (section properties, a bookmark or comment anchor, a field, or a table
 * cell's only paragraph) stays; the caller reports it.
 */
function removeEmptyNumberedParagraph(doc: DocxDocument, paragraph: Element, ctx: RevisionContext | undefined): boolean {
  const remaining = getParagraphText(paragraph);
  if (remaining.length > 0) {
    replaceParagraphTextRange(paragraph, 0, remaining.length, '', ctx);
    doc.markMutated();
  }
  return !isNowEmptyNumberedParagraph(doc, paragraph);
}

/**
 * Apply the policy to the touched paragraph after an edit. `hadContentBefore`
 * is `paragraphHasVisibleContent` of the paragraph before the edit. Throws a
 * `SafeDocxError` with code `EMPTY_NUMBERED_PARAGRAPH` under `error`, so the
 * caller's mutation is abandoned and the document is unchanged.
 */
export function applyEmptyNumberedParagraphPolicy(params: {
  doc: DocxDocument;
  paragraphId: string;
  paragraph: Element;
  hadContentBefore: boolean;
  beforeText: string;
  policy: EmptyNumberedParagraphPolicy;
  ctx: RevisionContext | undefined;
}): EmptyNumberedParagraphOutcome {
  const { doc, paragraphId, paragraph, hadContentBefore, beforeText, policy, ctx } = params;
  if (policy === 'ignore' || !hadContentBefore) return { kind: 'none' };
  if (!isNowEmptyNumberedParagraph(doc, paragraph)) return { kind: 'none' };

  const description = emptyNumberedDescription(doc, paragraphId, paragraph, beforeText);
  if (policy === 'error') {
    throw new SafeDocxError(
      EMPTY_NUMBERED_PARAGRAPH_ERROR_CODE,
      `${description} The edit was not applied because on_empty_numbered_paragraph is "error".`,
      'Delete the whole list item (its complete text with an empty new_string), keep some text in it, or choose another on_empty_numbered_paragraph policy.',
    );
  }
  if (policy === 'remove_paragraph') {
    if (removeEmptyNumberedParagraph(doc, paragraph, ctx)) {
      return {
        kind: 'removed',
        message: ctx
          ? `Paragraph ${paragraphId} was left as an empty numbered paragraph, so its remaining text and paragraph mark were deleted as a tracked change (on_empty_numbered_paragraph: "remove_paragraph"); accepting the deletion removes the list item.`
          : `Paragraph ${paragraphId} was left as an empty numbered paragraph and was removed (on_empty_numbered_paragraph: "remove_paragraph"); the list numbering continues without it.`,
      };
    }
    return {
      kind: 'warning',
      message: `${description} on_empty_numbered_paragraph is "remove_paragraph", but the paragraph was not removed.`
        + keptBecause(describeParagraphHolders(paragraph)),
    };
  }
  return { kind: 'warning', message: `${description}${emptyNumberedRemedy(paragraph)}` };
}
