/**
 * Table-level property elements in a comparison redline.
 *
 * `w:tblPr` and `w:tblGrid` (children of `w:tbl`) and `w:tblPrEx` (child of
 * `w:tr`) admit no `w:ins`/`w:del` among their children. A difference in one of
 * them is recorded by publishing the revised element whole and appending its
 * own revision record, whose single child is the complete prior state:
 * `w:tblPrChange` (§17.13.5.34), `w:tblGridChange` (§17.13.5.33) or
 * `w:tblPrExChange` (§17.13.5.35).
 *
 * The prior state a record must hold is the original document's reject
 * projection: the original's own pending record snapshot when it carries one,
 * otherwise its live properties. The live state is the revised document's
 * accept projection, so a pending record that only the revised document
 * carries is not this comparison's to keep (as for `w:sectPrChange`, #1100).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.33
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.35
 * @see https://github.com/UseJunior/safe-docx/issues/1399
 */

import type { WmlElement } from '@usejunior/docx-core';
import { childElements } from '@usejunior/docx-core';
import { subtreeSignature } from './taggedTree.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Table-level property element local name to its revision record's local name. */
export const TABLE_LEVEL_PROPERTY_CHANGE: Readonly<Record<TableLevelProperty, string>> = {
  tblPr: 'tblPrChange',
  tblGrid: 'tblGridChange',
  tblPrEx: 'tblPrExChange',
};

export type TableLevelProperty = 'tblPr' | 'tblGrid' | 'tblPrEx';

const TABLE_LEVEL_PROPERTY_OWNER: Readonly<Record<TableLevelProperty, string>> = {
  tblPr: 'tbl',
  tblGrid: 'tbl',
  tblPrEx: 'tr',
};

/** True for `w:tblPr`/`w:tblGrid` directly under `w:tbl` and `w:tblPrEx` directly under `w:tr`. */
export function isTableLevelPropertyElement(element: Element | null | undefined): boolean {
  if (!element || element.namespaceURI !== W_NS) return false;
  const owner = TABLE_LEVEL_PROPERTY_OWNER[element.localName as TableLevelProperty];
  const parent = element.parentNode as Element | null;
  return !!owner && !!parent && parent.nodeType === 1 &&
    parent.namespaceURI === W_NS && parent.localName === owner;
}

/** The direct `localName` property child of a `w:tbl` or `w:tr`, or null. */
export function tableLevelPropertyOf(container: Element, localName: TableLevelProperty): WmlElement | null {
  return (childElements(container).find((child) =>
    child.namespaceURI === W_NS && child.localName === localName) ?? null) as WmlElement | null;
}

function changeRecordOf(property: Element | null, localName: TableLevelProperty): WmlElement | null {
  if (!property) return null;
  return (childElements(property).find((child) =>
    child.namespaceURI === W_NS && child.localName === TABLE_LEVEL_PROPERTY_CHANGE[localName]) ?? null) as
    WmlElement | null;
}

/** Element children of `property` without its revision record. */
function liveChildren(property: Element | null, localName: TableLevelProperty): WmlElement[] {
  if (!property) return [];
  return childElements(property).filter((child) =>
    !(child.namespaceURI === W_NS && child.localName === TABLE_LEVEL_PROPERTY_CHANGE[localName])) as WmlElement[];
}

/** The prior-state children a revision record holds, or null when it has no snapshot. */
function snapshotChildren(change: Element | null, localName: TableLevelProperty): WmlElement[] | null {
  if (!change) return null;
  const snapshot = childElements(change).find((child) =>
    child.namespaceURI === W_NS && child.localName === localName);
  return snapshot ? childElements(snapshot) as WmlElement[] : null;
}

function signature(children: readonly WmlElement[]): string {
  return children.map((child) => subtreeSignature(child)).join('\u0002');
}

/**
 * The original side's reject projection of a table-level property: the
 * snapshot of its pending record when it has one, otherwise its live children.
 */
function originalPriorState(original: Element | null, localName: TableLevelProperty): WmlElement[] {
  return snapshotChildren(changeRecordOf(original, localName), localName) ?? liveChildren(original, localName);
}

export interface TableLevelPropertyResolution {
  /** The element to publish, or null when neither side needs one. */
  element: WmlElement | null;
  /** Which revision record, if any, the published element carries. */
  record: 'none' | 'preserved' | 'comparison';
}

export interface TableLevelRecordFactory {
  /** A new comparison revision record (`w:id`, author, date already set). */
  comparison(localName: string, document: Document): WmlElement;
  /** A fresh revision ID for a preserved record cloned out of the original side. */
  freshId(): number;
}

/**
 * Publish one table-level property of an aligned table or row.
 *
 * The published element holds the revised live state. A revision record is
 * appended only when the original's reject projection differs from it:
 *
 * - a record both inputs carry unchanged, over the same live state, is
 *   published as the revised side has it;
 * - the original's own pending record is kept (with a fresh ID) when the two
 *   live states agree, so a prior reviewer's revision keeps its attribution;
 * - otherwise a comparison record holds the original's reject projection,
 *   when `allowComparisonRecord` is set (the construction recorded a property
 *   delta, i.e. format detection is on); without it the revised live state is
 *   published as is, like every other unrecorded property difference.
 *
 * `w:tblPr` and `w:tblGrid` are required children of `w:tbl`, so they are
 * always published; an optional `w:tblPrEx` is published only when it has
 * live content or a record to carry.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.33
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.35
 * @see https://github.com/UseJunior/safe-docx/issues/1399
 */
export function resolveTableLevelProperty(
  original: WmlElement | null,
  revised: WmlElement | null,
  localName: TableLevelProperty,
  document: Document,
  records: TableLevelRecordFactory,
  allowComparisonRecord: boolean,
): TableLevelPropertyResolution {
  const template = revised ?? original;
  if (!template) return { element: null, record: 'none' };
  const published = (revised
    ? revised.cloneNode(true)
    : document.createElementNS(W_NS, template.tagName)) as WmlElement;
  for (const stale of childElements(published).filter((child) =>
    child.namespaceURI === W_NS && child.localName === TABLE_LEVEL_PROPERTY_CHANGE[localName])) {
    published.removeChild(stale);
  }
  const live = liveChildren(published, localName);
  const originalRecord = changeRecordOf(original, localName);
  const revisedRecord = changeRecordOf(revised, localName);
  const sameLiveState = signature(liveChildren(original, localName)) === signature(live);
  if (sameLiveState && originalRecord && revisedRecord &&
      subtreeSignature(revisedRecord) === subtreeSignature(originalRecord)) {
    // Both inputs carry the same pending revision over the same live state:
    // publish the revised element unchanged, record included.
    return { element: revised!.cloneNode(true) as WmlElement, record: 'preserved' };
  }
  const prior = originalPriorState(original, localName);
  if (signature(prior) === signature(live)) {
    if (localName === 'tblPrEx' && live.length === 0 && !revised) return { element: null, record: 'none' };
    return { element: published, record: 'none' };
  }
  let record: WmlElement;
  let kind: TableLevelPropertyResolution['record'];
  if (originalRecord && sameLiveState) {
    // The only difference is the original's pending revision: keep it, with a
    // fresh ID, since revised content published beside it may use the same one.
    record = originalRecord.cloneNode(true) as WmlElement;
    record.setAttributeNS(W_NS, 'w:id', String(records.freshId()));
    kind = 'preserved';
  } else if (!allowComparisonRecord) {
    if (localName === 'tblPrEx' && live.length === 0 && !revised) return { element: null, record: 'none' };
    return { element: published, record: 'none' };
  } else {
    record = records.comparison(TABLE_LEVEL_PROPERTY_CHANGE[localName], document);
    const snapshot = document.createElementNS(W_NS, template.tagName) as WmlElement;
    for (const child of prior) snapshot.appendChild(child.cloneNode(true));
    record.appendChild(snapshot);
    kind = 'comparison';
  }
  published.appendChild(record);
  return { element: published, record: kind };
}

/** Rows of `table`, looking through `w:sdt`/`w:customXml` row wrappers but not into nested tables. */
export function tableRowsOf(table: Element): WmlElement[] {
  const rows: WmlElement[] = [];
  const visit = (parent: Element): void => {
    for (const child of childElements(parent)) {
      if (child.namespaceURI !== W_NS) continue;
      if (child.localName === 'tr') rows.push(child as WmlElement);
      else if (['sdt', 'sdtContent', 'customXml'].includes(child.localName)) visit(child);
    }
  };
  visit(table);
  return rows;
}

/**
 * Give every row of a table whose `w:tblPr` carries a comparison
 * `w:tblPrChange` a row-level `w:tblPrExChange`, unless the row already
 * carries one.
 *
 * Word 16.114.3 for Mac recognises a table-property revision only through a
 * row-level `w:tblPrExChange`: a lone `w:tblPrChange` shows no revision and
 * is dropped on load, so the change would vanish from the redline. A row
 * whose exceptions did not change gets a record whose snapshot equals its
 * live exceptions, which leaves both projections of that row unchanged.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.35
 * @see https://github.com/UseJunior/safe-docx/issues/1395
 * @see https://github.com/UseJunior/safe-docx/issues/1399
 */
export function addRowExceptionRevisionCompanions(
  table: WmlElement,
  records: TableLevelRecordFactory,
): number {
  let added = 0;
  const document = table.ownerDocument!;
  for (const row of tableRowsOf(table)) {
    let exceptions = tableLevelPropertyOf(row, 'tblPrEx');
    if (exceptions && changeRecordOf(exceptions, 'tblPrEx')) continue;
    if (!exceptions) {
      exceptions = document.createElementNS(W_NS, 'w:tblPrEx') as WmlElement;
      // CT_Row opens with w:tblPrEx, ahead of w:trPr and the cells (§17.4.78).
      row.insertBefore(exceptions, childElements(row)[0] ?? null);
    }
    const record = records.comparison('tblPrExChange', document);
    const snapshot = document.createElementNS(W_NS, 'w:tblPrEx') as WmlElement;
    for (const child of liveChildren(exceptions, 'tblPrEx')) snapshot.appendChild(child.cloneNode(true));
    record.appendChild(snapshot);
    exceptions.appendChild(record);
    added++;
  }
  return added;
}
