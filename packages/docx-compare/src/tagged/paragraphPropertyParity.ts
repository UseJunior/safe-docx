/**
 * Paragraph-property parity between a projection and the source it must
 * reproduce.
 *
 * A text-only round trip cannot see which paragraph mark survives a merge:
 * when Accept All removes a deleted paragraph mark, the paragraph's content
 * joins the following paragraph and takes the properties of the mark that
 * survives (ECMA-376 Part 1 § 17.13.5.15). A redline that deletes the wrong
 * mark keeps every character in place and still loses a page break, an
 * alignment or an indent. This module compares each surviving paragraph's
 * `w:pPr` instead.
 *
 * The comparison is over a canonical signature of `w:pPr`:
 * - `w:rPr` (the paragraph mark's run properties, including the `w:ins` /
 *   `w:del` mark revision markers themselves) is not a paragraph property
 *   and is left out;
 * - `w:pPrChange` is left out: each projection has already resolved it
 *   (Reject All restores the recorded properties, Accept All drops the record),
 *   so any residue is a revision record rather than a property;
 * - `w:sectPr` is left out: section breaks have their own gates;
 * - `w:rsid*` attributes are left out, and child order does not matter.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/1493
 */

import { childElements } from '@usejunior/docx-core';
import { findFollowingSiblingParagraph } from './trackChangesAcceptorAst.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** `w:pPr` children that are not compared (see the module comment). */
const EXCLUDED_PROPERTY_CHILDREN = new Set(['rPr', 'pPrChange', 'sectPr']);

function canonicalElement(element: Element): string {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => !attribute.name.startsWith('xmlns') &&
      !/^rsid/u.test(attribute.localName ?? attribute.name))
    .map((attribute) => `${attribute.namespaceURI ?? ''}:${attribute.localName ?? attribute.name}=${attribute.value}`)
    .sort();
  const children = childElements(element as never)
    .map((child) => canonicalElement(child as unknown as Element))
    .sort();
  const text = children.length === 0 ? (element.textContent ?? '').trim() : '';
  return `<${element.namespaceURI ?? ''}:${element.localName}[${attributes.join(',')}]${text}{${children.join('')}}>`;
}

/**
 * The canonical signature of a paragraph's own properties; the empty string
 * when it has no `w:pPr` or only excluded children.
 */
export function paragraphPropertySignature(paragraph: Element): string {
  const pPr = childElements(paragraph as never)
    .find((child) => (child as unknown as Element).namespaceURI === W_NS &&
      (child as unknown as Element).localName === 'pPr') as unknown as Element | undefined;
  if (!pPr) return '';
  return childElements(pPr as never)
    .map((child) => child as unknown as Element)
    .filter((child) => !(child.namespaceURI === W_NS && EXCLUDED_PROPERTY_CHILDREN.has(child.localName)))
    .map(canonicalElement)
    .sort()
    .join('');
}

/** Where a projection's paragraph properties first depart from the source's. */
export interface ParagraphPropertyMismatch {
  /** Index into the paragraph-topology projection. */
  paragraphIndex: number;
  /** The paragraph's projected text, to locate it. */
  paragraphText: string;
  expectedProperties: string;
  actualProperties: string;
  /** How many paragraphs differ in all. */
  mismatchedParagraphCount: number;
}

/**
 * Compare paragraph properties index by index. Only meaningful when the two
 * projections have the same paragraph topology; a paragraph-count difference
 * is the topology check's finding, so the shorter projection bounds the walk
 * (a trailing terminal-mark residue paragraph is ignored the same way).
 */
export function compareParagraphProperties(
  expected: readonly string[],
  actual: readonly string[],
  actualTexts: readonly string[],
): ParagraphPropertyMismatch | undefined {
  const length = Math.min(expected.length, actual.length);
  let first = -1;
  let count = 0;
  for (let index = 0; index < length; index++) {
    if (expected[index] === actual[index]) continue;
    if (first < 0) first = index;
    count++;
  }
  if (first < 0) return undefined;
  return {
    paragraphIndex: first,
    paragraphText: actualTexts[first] ?? '',
    expectedProperties: expected[first]!,
    actualProperties: actual[first]!,
    mismatchedParagraphCount: count,
  };
}

/** Paragraph-mark revisions each projection resolves by removing the mark. */
const MARK_REMOVED_BY: Record<'accept' | 'reject', ReadonlySet<string>> = {
  accept: new Set(['del', 'moveFrom']),
  reject: new Set(['ins', 'moveTo']),
};

function directChild(element: Element, localName: string): Element | undefined {
  return (childElements(element as never) as unknown as Element[])
    .find((child) => child.namespaceURI === W_NS && child.localName === localName);
}

/**
 * Give every paragraph whose mark `projection` removes the properties of the
 * mark that survives the merge: the next sibling paragraph's (after its own
 * stamping, so chains of removed marks resolve to the last survivor). Only
 * `w:pPr` children other than `w:rPr` are replaced, so the mark revision that
 * drives the merge stays in place.
 *
 * The tagged acceptor keeps the first paragraph's properties when it merges,
 * as LibreOffice does; the spec text and Aspose.Words keep the
 * surviving mark's. Measuring on a stamped copy makes the parity check hold
 * only when both readings agree, which is the only redline that is safe to
 * publish (#1493).
 *
 * Returns whether any paragraph was stamped.
 */
export function stampSurvivingMarkProperties(
  root: Element,
  projection: 'accept' | 'reject',
): boolean {
  const removed = MARK_REMOVED_BY[projection];
  let stamped = false;
  const paragraphs = Array.from(root.getElementsByTagNameNS(W_NS, 'p')).reverse();
  for (const paragraph of paragraphs) {
    const pPr = directChild(paragraph, 'pPr');
    const markProperties = pPr && directChild(pPr, 'rPr');
    if (!pPr || !markProperties) continue;
    const resolvesAway = (childElements(markProperties as never) as unknown as Element[])
      .some((child) => child.namespaceURI === W_NS && removed.has(child.localName));
    if (!resolvesAway) continue;
    // The acceptor's own merge-target lookup, which skips block-level range
    // markers between the paragraphs.
    const successor = findFollowingSiblingParagraph(paragraph);
    if (!successor) continue;
    const successorProperties = directChild(successor, 'pPr');
    for (const child of Array.from(pPr.childNodes)) {
      if (child !== markProperties) pPr.removeChild(child);
    }
    if (successorProperties) {
      for (const child of Array.from(successorProperties.childNodes)) {
        if (child.nodeType === 1 && (child as Element).namespaceURI === W_NS &&
            (child as Element).localName === 'rPr') continue;
        pPr.insertBefore(child.cloneNode(true), markProperties);
      }
    }
    stamped = true;
  }
  return stamped;
}
