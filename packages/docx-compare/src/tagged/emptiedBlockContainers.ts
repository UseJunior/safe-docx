/**
 * The block container shell a whole inserted or deleted `w:sdt` or
 * `w:customXml` leaves behind. No revision particle can wrap a block
 * container, so the projection that removes its content keeps the container,
 * emptied, with one placeholder paragraph; the comparison reports it as a
 * `contentControl` unrepresented change. Publication checks that measure
 * paragraphs recognise that placeholder through these helpers.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1386
 * @see https://github.com/UseJunior/safe-docx/issues/1102
 */

import { childElements, findChildByTagName } from '@usejunior/docx-core';
import { isBlockContainer } from './blockContainer.js';
import { parseDocumentXml, serializeToXml } from './xmlToWmlElement.js';

/**
 * Marker stamped (on a measurement copy only) onto each block container whose
 * whole content the candidate tracks as one revision kind, so the projection
 * that removes that content can recognise the container shell it leaves behind.
 */
export const EMPTIED_CONTAINER_MARKER = 'data-sdx-emptied-by';

/** Whether a paragraph's mark (`w:pPr/w:rPr`) carries a tracked `w:ins`/`w:del`. */
function hasParagraphMarkRevision(paragraph: Element, revision: 'w:ins' | 'w:del'): boolean {
  const pPr = findChildByTagName(paragraph, 'w:pPr');
  const rPr = pPr ? findChildByTagName(pPr, 'w:rPr') : undefined;
  return Boolean(rPr && findChildByTagName(rPr, revision));
}

/**
 * Whether a paragraph sits in a table row, inside `container`, whose row
 * revision marker (`w:trPr/w:ins` or `w:trPr/w:del`) removes the row with the
 * projection. The final paragraph of a deleted cell keeps an unmarked
 * paragraph mark, so the row marker is what tracks it.
 */
function inTrackedRow(paragraph: Element, container: Element, revision: 'w:ins' | 'w:del'): boolean {
  for (let node = paragraph.parentNode as Element | null; node && node !== container; node = node.parentNode as Element | null) {
    if (node.tagName !== 'w:tr') continue;
    const trPr = findChildByTagName(node, 'w:trPr');
    if (trPr && findChildByTagName(trPr, revision)) return true;
  }
  return false;
}

/**
 * Stamp every block `w:sdt`/`w:customXml` of a tracked candidate whose
 * paragraphs all carry a `revision` paragraph mark, or sit in a row tracked
 * with that revision: the whole inserted (or deleted) container of #1386.
 * Reject All (or Accept All) removes its content but keeps the container,
 * emptied, with one placeholder paragraph.
 */
export function markWholeTrackedContainers(candidateXml: string, revision: 'w:ins' | 'w:del'): string {
  const root = parseDocumentXml(candidateXml);
  const containers = [
    ...Array.from(root.getElementsByTagName('w:sdt')),
    ...Array.from(root.getElementsByTagName('w:customXml')),
  ];
  let marked = false;
  for (const container of containers) {
    if (!isBlockContainer(container)) continue;
    const paragraphs = Array.from(container.getElementsByTagName('w:p'));
    if (paragraphs.length === 0) continue;
    if (!paragraphs.every((paragraph) => hasParagraphMarkRevision(paragraph, revision)
      || inTrackedRow(paragraph, container, revision))) continue;
    container.setAttribute(EMPTIED_CONTAINER_MARKER, revision);
    marked = true;
  }
  return marked ? serializeToXml(root) : candidateXml;
}

/**
 * The sole paragraph of a block container the candidate inserted or deleted
 * whole, as the projection removing its content leaves it (#1386). Only a
 * container stamped by `markWholeTrackedContainers` qualifies, so an empty
 * control both documents hold keeps its formatting measured.
 */
export function isEmptiedContainerPlaceholder(paragraph: Element): boolean {
  const parent = paragraph.parentNode as Element | null;
  if (!parent || !['w:sdtContent', 'w:customXml'].includes(parent.tagName)) return false;
  const container = parent.tagName === 'w:sdtContent' ? parent.parentNode as Element | null : parent;
  if (!container?.getAttribute(EMPTIED_CONTAINER_MARKER)) return false;
  return childElements(parent).filter((sibling) => sibling.tagName !== 'w:customXmlPr').length === 1;
}
