/**
 * DOM shape checks for run-level revision wrappers in comparison output.
 *
 * A run-level `w:ins`/`w:del` (ECMA-376 Part 1 §17.13.5.18 / §17.13.5.14)
 * wraps inserted or deleted run content. One with no child element, written
 * either self-closing or as an open/close pair, records no change and is
 * noise in the redline. Markers of the same names inside a property container
 * (`w:rPr` paragraph marks, `w:trPr` rows, `w:tcPr` cells) are legitimately
 * empty and are not counted.
 *
 * Implemented over the DOM, not with a regex, so self-closing and paired
 * forms are treated alike.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/1281
 */

import { DOMParser } from '@xmldom/xmldom';
import { stripXmlLeadingNoise } from '@usejunior/docx-core';

const REVISION_WRAPPER_TAGS = ['w:ins', 'w:del'] as const;

function isPropertyContainer(tagName: string | undefined): boolean {
  return tagName !== undefined && /Pr$/.test(tagName);
}

/** `tag#id` for every run-level `w:ins`/`w:del` with no child element. */
export function emptyRevisionWrapperIds(documentXml: string): string[] {
  const document = new DOMParser().parseFromString(stripXmlLeadingNoise(documentXml), 'text/xml');
  const out: string[] = [];
  for (const tag of REVISION_WRAPPER_TAGS) {
    for (const wrapper of Array.from(document.getElementsByTagName(tag))) {
      const parent = wrapper.parentNode as { tagName?: string } | null;
      if (isPropertyContainer(parent?.tagName)) continue;
      const hasElementChild = Array.from(wrapper.childNodes).some((child) => child.nodeType === 1);
      if (!hasElementChild) out.push(`${tag}#${wrapper.getAttribute('w:id') ?? ''}`);
    }
  }
  return out;
}
