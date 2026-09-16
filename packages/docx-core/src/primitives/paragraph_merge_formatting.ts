import { OOXML } from './namespaces.js';

const W = OOXML.W_NS;
const children = (node: Element): Element[] => Array.from(node.childNodes)
  .filter((child): child is Element => child.nodeType === 1);
const properties = (paragraph: Element): Element | undefined => children(paragraph)
  .find(child => child.namespaceURI === W && child.localName === 'pPr');

/** Formatting-only test; never use this to decide whether to remove a paragraph. */
export function isEmptyParagraphFormattingRun(element: Element): boolean {
  return element.namespaceURI === W && element.localName === 'r' && children(element).every(child =>
    child.namespaceURI === W && (child.localName === 'rPr' || (child.localName === 't' && !child.textContent)));
}

/**
 * Transfer the leading paragraph's base formatting when its content owns the
 * merged paragraph. Break removal and formatting selection are separate:
 * delimiter removal alone does not imply that the following style wins.
 * Paragraph-mark run formatting follows the same owner; the surviving mark
 * retains its revision markers and section boundary.
 *
 * The formatting-selection callers are characterized against LibreOffice;
 * the cited section governs property ordering, not a claim of Word evidence.
 *
 * @internal
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.26
 * @see openspec/changes/repair-paragraph-merge-formatting/design.md
 */
export function retainLeadingParagraphFormatting(leading: Element, following: Element): void {
  const source = properties(leading);
  const target = properties(following);
  // Do not extend the formatting rule across a leading section boundary.
  if (source && children(source).some(child => child.namespaceURI === W && child.localName === 'sectPr')) return;
  const result = following.ownerDocument!.createElementNS(W, 'w:pPr');
  const base = source ? children(source).filter(child =>
    child.namespaceURI !== W || !['rPr', 'sectPr', 'pPrChange'].includes(child.localName)) : [];
  for (const child of base) result.appendChild(child.cloneNode(true));
  const sourceMark = source && children(source).find(child => child.namespaceURI === W && child.localName === 'rPr');
  const targetMark = target && children(target).find(child => child.namespaceURI === W && child.localName === 'rPr');
  const mark = following.ownerDocument!.createElementNS(W, 'w:rPr');
  const revisions = new Set(['ins', 'del', 'moveFrom', 'moveTo']);
  // CT_ParaRPr requires the surviving revision sequence BEFORE glyph properties.
  for (const child of targetMark ? children(targetMark) : []) {
    if (child.namespaceURI === W && revisions.has(child.localName)) mark.appendChild(child.cloneNode(true));
  }
  for (const child of sourceMark ? children(sourceMark) : []) {
    if (child.namespaceURI !== W || (!revisions.has(child.localName) && child.localName !== 'rPrChange')) mark.appendChild(child.cloneNode(true));
  }
  // A formatting transfer must not silently resolve another author's pending
  // history. Prefer the chosen owner's record; otherwise retain the survivor's.
  const markHistory = [sourceMark, targetMark].flatMap(node => node ? children(node) : [])
    .find(child => child.namespaceURI === W && child.localName === 'rPrChange');
  if (markHistory) mark.appendChild(markHistory.cloneNode(true));
  if (mark.childNodes.length) result.appendChild(mark);
  const boundary = target && children(target).find(child => child.namespaceURI === W && child.localName === 'sectPr');
  if (boundary) result.appendChild(boundary.cloneNode(true));
  const history = [source, target].flatMap(node => node ? children(node) : [])
    .find(child => child.namespaceURI === W && child.localName === 'pPrChange');
  if (history) result.appendChild(history.cloneNode(true));
  if (target) following.removeChild(target);
  if (result.childNodes.length) following.insertBefore(result, following.firstChild);
}
