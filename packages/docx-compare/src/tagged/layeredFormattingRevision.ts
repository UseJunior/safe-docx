import { XMLSerializer } from '@xmldom/xmldom';
import { childElements, type WmlElement } from '@usejunior/docx-core';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

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
 * The comparison splits text word by word wherever a word also changes, so
 * one original run reaches this point as many adjacent runs. Each maximal
 * sequence of adjacent sibling runs with identical original and revised
 * properties becomes one deleted copy and one inserted copy holding the
 * sequence's whole content, rather than one pair per word; the changed word
 * between two such sequences stays the ordinary deletion and insertion the
 * comparison already made. Runs holding distinct pending records (different
 * IDs) are never joined, so each prior revision keeps its own record.
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
 * @see https://github.com/UseJunior/safe-docx/issues/1488
 */
export function splitLayeredRunFormatting(
  root: WmlElement,
  options: {
    isComparisonRecord: (record: WmlElement) => boolean;
    nextRevisionId: () => number;
    wrap: (run: WmlElement, kind: 'ins' | 'del') => WmlElement;
  },
): void {
  const splits: LayeredRunSplit[] = [];
  const records = (Array.from(root.getElementsByTagNameNS(W_NS, 'rPrChange')) as WmlElement[])
    .filter((record) => options.isComparisonRecord(record));
  for (const record of records) {
    const properties = record.parentNode as WmlElement | null;
    const run = properties?.parentNode as WmlElement | null;
    if (!properties || !run || !isW(properties, 'rPr') || !isW(run, 'r')) continue;
    const snapshot = childElements(record).find((child) => isW(child, 'rPr'))!;
    const originalRecord = childElements(snapshot).find((child) => isW(child, 'rPrChange'));
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
    splits.push({ run, record, snapshot, signature: layeredRunSignature(run, record, snapshot) });
  }

  // Coalesce each maximal sequence of adjacent sibling runs whose original
  // and revised properties are identical, so the layer is one deleted copy and
  // one inserted copy per span rather than one pair per compared word.
  const spans: LayeredRunSplit[][] = [];
  for (const split of splits) {
    const span = spans[spans.length - 1];
    const previous = span?.[span.length - 1];
    if (previous && previous.run.nextSibling === split.run && previous.signature === split.signature) span!.push(split);
    else spans.push([split]);
  }

  for (const span of spans) {
    const [{ run, record, snapshot }] = span as [LayeredRunSplit, ...LayeredRunSplit[]];
    const parent = run.parentNode as WmlElement;
    const revisedRun = coalescedRunCopy(span);
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
    const originalRun = coalescedRunCopy(span);
    const originalProperties = childElements(originalRun).find((child) => isW(child, 'rPr'))!;
    if (childElements(snapshot).length > 0) {
      const restored = originalRun.ownerDocument!.createElementNS(W_NS, 'w:rPr') as WmlElement;
      for (const child of childElements(snapshot)) restored.appendChild(child.cloneNode(true));
      originalRun.replaceChild(restored, originalProperties);
    } else {
      originalRun.removeChild(originalProperties);
    }
    parent.insertBefore(options.wrap(originalRun, 'del'), run);
    parent.insertBefore(options.wrap(revisedRun, 'ins'), run);
    for (const { run: member } of span) parent.removeChild(member);
  }
}

interface LayeredRunSplit {
  run: WmlElement;
  /** This comparison's `w:rPrChange` on the run. */
  record: WmlElement;
  /** The record's old-value `w:rPr`: the original run's properties, its own record included. */
  snapshot: WmlElement;
  /** Equal for runs whose deleted and inserted copies may be one run each. */
  signature: string;
}

const serializer = new XMLSerializer();

/**
 * The run's attributes, original properties (the comparison record's
 * snapshot) and revised properties (without the comparison record, whose ID
 * differs per run). Pending records keep their IDs in the signature, so runs
 * holding distinct prior revisions are never merged into one.
 */
function layeredRunSignature(run: WmlElement, record: WmlElement, snapshot: WmlElement): string {
  const attributes = Array.from(run.attributes)
    .filter((attribute) => !(attribute.localName ?? '').startsWith('rsid'))
    .map((attribute) => `${attribute.name}=${attribute.value}`).sort().join(' ');
  const properties = record.parentNode as WmlElement;
  const revised = childElements(properties).filter((child) => child !== record)
    .map((child) => serializer.serializeToString(child)).join('');
  return `${attributes}|${serializer.serializeToString(snapshot)}|${revised}`;
}

/**
 * One run holding the first run's attributes and properties and every run's
 * content in order, adjacent text elements joined into one.
 */
function coalescedRunCopy(span: readonly LayeredRunSplit[]): WmlElement {
  const copy = span[0]!.run.cloneNode(true) as WmlElement;
  for (const { run } of span.slice(1)) {
    for (const child of childElements(run)) {
      if (!isW(child, 'rPr')) copy.appendChild(child.cloneNode(true));
    }
  }
  let previous: WmlElement | undefined;
  for (const child of childElements(copy)) {
    if (isW(child, 't') && previous && isW(previous, 't')) {
      previous.textContent = (previous.textContent ?? '') + (child.textContent ?? '');
      copy.removeChild(child);
      continue;
    }
    previous = child;
  }
  for (const text of childElements(copy).filter((child) => isW(child, 't'))) {
    const value = text.textContent ?? '';
    if (/^\s|\s$/.test(value)) text.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  }
  return copy;
}
