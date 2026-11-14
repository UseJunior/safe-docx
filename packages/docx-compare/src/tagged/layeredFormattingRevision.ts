import { childElements, type WmlElement } from '@usejunior/docx-core';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Run content that may be repeated in a deleted and an inserted copy of a
 * run: it carries no identity (drawing or note IDs, comment anchors, field
 * structure) that two copies would duplicate.
 */
const REPEATABLE_RUN_CONTENT = new Set([
  'rPr', 't', 'tab', 'br', 'cr', 'noBreakHyphen', 'softHyphen', 'sym', 'ptab', 'lastRenderedPageBreak',
]);

/** Containers whose content model admits `w:ins` / `w:del` beside a run (EG_PContent). */
const RUN_REVISION_PARENTS = new Set(['p', 'hyperlink', 'smartTag', 'customXml', 'sdtContent', 'dir', 'bdo']);

const isW = (element: Element | null | undefined, localName: string): boolean =>
  !!element && element.namespaceURI === W_NS && element.localName === localName;

/**
 * Collapse property revision records to the single record `CT_RPr`,
 * `CT_ParaRPr` and `CT_PPr` allow, keeping the original document's pending
 * record when it has one.
 *
 * `live` holds the revised properties and may still carry the revised
 * document's own record of `changeLocalName`; `originalRecord` is the original
 * document's record for the same properties; `comparisonRecord` builds this
 * comparison's record (its old-value snapshot is the original's current
 * properties) and is called only when no original record exists and
 * `changed` is true.
 *
 * The original's record already restores, on Reject All, the properties the
 * original document itself rejects to, so it stays as written (author, date,
 * ID and old-value snapshot): Reject All gives the original's rejected view
 * and Accept All the revised properties. A record nested inside another, or a
 * second sibling record, is schema-invalid (`CT_RPrOriginal` and
 * `CT_PPrBase` hold no change record; the change record occurs at most once).
 * This is the least-bad faithful single record: the original's current
 * properties, an intermediate state between the original's record and the
 * revision, have no record of their own, because a paragraph mark holds one
 * set of properties and one record. See {@link splitLayeredRunFormatting}
 * for runs, where a lossless representation exists.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.30
 * @see https://github.com/UseJunior/safe-docx/issues/1461
 */
export function placeSinglePropertyRevision(
  live: WmlElement,
  changeLocalName: 'rPrChange' | 'pPrChange',
  originalRecord: WmlElement | undefined,
  changed: boolean,
  comparisonRecord: () => WmlElement,
): void {
  for (const stale of childElements(live).filter((child) => isW(child, changeLocalName))) {
    live.removeChild(stale);
  }
  if (originalRecord) live.appendChild(originalRecord.cloneNode(true) as WmlElement);
  else if (changed) live.appendChild(comparisonRecord());
}

/**
 * Re-express a comparison formatting revision on a run that also carries a
 * pending `w:rPrChange` of its own (in the original, the revised document or
 * both). The property-delta emitter leaves such a run with the revised
 * properties live and this comparison's `w:rPrChange` holding the original
 * `w:rPr` whole, so its snapshot nests the original's record (or the live
 * properties hold the revised record beside it). Both shapes are
 * schema-invalid: `w:rPrChange` holds `CT_RPrOriginal`, which admits no
 * change record, and `CT_RPr` admits one `w:rPrChange`.
 *
 * One record cannot hold both layers losslessly: keeping the original's
 * record (whose old-value snapshot is the original's own rejected
 * formatting) and making the revised formatting live would make Reject All
 * correct but leave no revision that turns the revised formatting back into
 * the original's current formatting, and would attribute this comparison's
 * change to the original record's author. So the run is replaced by a
 * deleted copy carrying the original `w:rPr` exactly (pending record
 * included) and an inserted copy carrying the revised `w:rPr` (its own record
 * included): rejecting this comparison's revisions restores the original
 * run, accepting them gives the revised run, and Reject All / Accept All give
 * the original's rejected view and the revised's accepted view.
 *
 * A run whose content cannot be repeated (a field character or instruction,
 * a drawing, a note or comment reference) or that sits where a run revision
 * may not, keeps one record instead, as {@link placeSinglePropertyRevision}
 * describes.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/1461
 */
export function splitLayeredRunFormatting(
  root: WmlElement,
  options: {
    isComparisonRecord: (record: WmlElement) => boolean;
    nextRevisionId: () => number;
    wrap: (run: WmlElement, kind: 'ins' | 'del') => WmlElement;
  },
): void {
  const records = (Array.from(root.getElementsByTagNameNS(W_NS, 'rPrChange')) as WmlElement[])
    .filter((record) => options.isComparisonRecord(record));
  for (const record of records) {
    const properties = record.parentNode as WmlElement | null;
    const run = properties?.parentNode as WmlElement | null;
    if (!properties || !run || !isW(properties, 'rPr') || !isW(run, 'r')) continue;
    const snapshot = childElements(record).find((child) => isW(child, 'rPr'));
    const originalRecord = snapshot && childElements(snapshot).find((child) => isW(child, 'rPrChange'));
    const revisedRecords = childElements(properties).filter((child) => isW(child, 'rPrChange') && child !== record);
    if (!originalRecord && revisedRecords.length === 0) continue;
    const parent = run.parentNode as WmlElement | null;
    const repeatable = childElements(run).every((child) =>
      child.namespaceURI === W_NS && REPEATABLE_RUN_CONTENT.has(child.localName));
    if (!parent || !repeatable || !RUN_REVISION_PARENTS.has(parent.localName) || parent.namespaceURI !== W_NS) {
      // The original's record restores its rejected formatting; without one,
      // this comparison's record restores the original's current formatting.
      for (const stale of revisedRecords) properties.removeChild(stale);
      if (originalRecord) {
        properties.removeChild(record);
        properties.appendChild(originalRecord);
      }
      continue;
    }
    const revisedRun = run.cloneNode(true) as WmlElement;
    const revisedProperties = childElements(revisedRun).find((child) => isW(child, 'rPr'))!;
    for (const change of childElements(revisedProperties).filter((child) => isW(child, 'rPrChange'))) {
      if (change.getAttributeNS(W_NS, 'id') === record.getAttributeNS(W_NS, 'id')) {
        revisedProperties.removeChild(change);
      } else {
        // The original copy keeps the shared record's ID.
        change.setAttributeNS(W_NS, 'w:id', String(options.nextRevisionId()));
      }
    }
    if (childElements(revisedProperties).length === 0) revisedRun.removeChild(revisedProperties);
    const originalRun = run.cloneNode(true) as WmlElement;
    const originalProperties = childElements(originalRun).find((child) => isW(child, 'rPr'))!;
    if (childElements(snapshot!).length > 0) {
      const restored = originalRun.ownerDocument!.createElementNS(W_NS, 'w:rPr') as WmlElement;
      for (const child of childElements(snapshot!)) restored.appendChild(child.cloneNode(true));
      originalRun.replaceChild(restored, originalProperties);
    } else {
      originalRun.removeChild(originalProperties);
    }
    parent.insertBefore(options.wrap(originalRun, 'del'), run);
    parent.insertBefore(options.wrap(revisedRun, 'ins'), run);
    parent.removeChild(run);
  }
}
