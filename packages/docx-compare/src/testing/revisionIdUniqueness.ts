/**
 * Revision-identifier uniqueness checks for comparison output.
 *
 * Every revision carries "a unique revision identifier (used to uniquely
 * identify revisions)" (ECMA-376 Part 1 §17.13.5), and the shared `w:id`
 * attribute "specifies a unique identifier for an annotation within a
 * WordprocessingML document". The scope is therefore the whole document: the
 * main story, headers, footers, footnotes, endnotes and comments together.
 * Revisions form their own identifier space; bookmarks (§17.13.6),
 * comments (§17.13.4) and range permissions (§17.13.7) are separate kinds of
 * annotation, as Word's own output reuses their numbers alongside revisions.
 *
 * A cross-structure range is one annotation written as two markers, so a
 * `*RangeEnd` repeats its `*RangeStart` identifier and is not counted again.
 *
 * Content inside `mc:Fallback` is skipped: a consumer processes either the
 * `mc:Choice` or the fallback copy of the same content (Part 3 §9.3), so the
 * two copies are not duplicates.
 *
 * Implemented over the DOM, not with a regex.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.24
 * @see https://github.com/UseJunior/safe-docx/issues/1466
 */

import { DocxArchive, parseXml } from '@usejunior/docx-core';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** Elements that each carry one revision identifier (§17.13.5.1–§17.13.5.37). */
export const REVISION_ANNOTATION_NAMES: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'moveFromRangeStart',
  'moveToRangeStart',
  'customXmlInsRangeStart',
  'customXmlDelRangeStart',
  'customXmlMoveFromRangeStart',
  'customXmlMoveToRangeStart',
  'cellIns',
  'cellDel',
  'cellMerge',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'tblPrExChange',
  'tblGridChange',
  'trPrChange',
  'tcPrChange',
  'numberingChange',
]);

const STORY_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

export interface RevisionIdOccurrence {
  part: string;
  name: string;
  id: string;
}

/** Every revision annotation in one part, in document order. */
export function revisionIdOccurrences(xml: string, part = 'word/document.xml'): RevisionIdOccurrence[] {
  const document = parseXml(xml);
  const out: RevisionIdOccurrence[] = [];
  const visit = (element: Element): void => {
    if (element.namespaceURI === MC_NS && element.localName === 'Fallback') return;
    const name = element.localName ?? '';
    if (element.namespaceURI === W_NS && REVISION_ANNOTATION_NAMES.has(name)) {
      const raw = element.getAttributeNS(W_NS, 'id') ?? '';
      out.push({ part, name, id: /^[+-]?\d+$/.test(raw.trim()) ? BigInt(raw.trim()).toString() : raw });
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  visit(document.documentElement);
  return out;
}

/** `id: name@part, name@part` for each identifier held by more than one revision. */
export function duplicateRevisionIds(occurrences: readonly RevisionIdOccurrence[]): string[] {
  const byId = new Map<string, RevisionIdOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = byId.get(occurrence.id) ?? [];
    list.push(occurrence);
    byId.set(occurrence.id, list);
  }
  return [...byId.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([id, list]) => `${id}: ${list.map((item) => `${item.name}@${item.part}`).join(', ')}`);
}

/** Duplicate revision identifiers within one part. */
export function duplicateRevisionIdsInXml(xml: string, part?: string): string[] {
  return duplicateRevisionIds(revisionIdOccurrences(xml, part));
}

/**
 * Duplicate revision identifiers across every story part of a package
 * (document scope). Empty when the package is conformant.
 */
export async function duplicateRevisionIdsInPackage(buffer: Buffer): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const occurrences: RevisionIdOccurrence[] = [];
  for (const part of archive.listFiles().filter((path) => STORY_PART.test(path)).sort()) {
    const xml = await archive.getFile(part);
    if (xml) occurrences.push(...revisionIdOccurrences(xml, part));
  }
  return duplicateRevisionIds(occurrences);
}
