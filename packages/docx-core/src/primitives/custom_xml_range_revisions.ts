/**
 * custom_xml_range_revisions — resolve the custom XML markup revision ranges
 * (`w:customXmlInsRangeStart`/`End`, `w:customXmlDelRangeStart`/`End` and the
 * move-source/move-destination variants) during Accept All / Reject All.
 *
 * A range records that the start and end tags of the custom XML markup it
 * surrounds were inserted or deleted with revisions enabled. [MS-OE376] notes on
 * Part 4 §2.13.5.5(a) and §2.13.5.7(b) record that Word uses the same ranges for
 * content controls (`w:sdt`), so both containers are resolved here.
 *
 * Resolution, per range:
 * - Accepting a deletion (or move source) and rejecting an insertion (or move
 *   destination) unwrap every enclosed `w:customXml`/`w:sdt`, keeping content.
 * - Accepting an insertion (or move destination) and rejecting a deletion (or
 *   move source) keep the wrappers.
 * - Either way the range markers are dropped.
 *
 * A container counts as enclosed only when both its start and end tags lie
 * inside the range. A range that encloses no container, or that holds only one
 * tag of some container (the spec's "cross structure" case, where unwrapping
 * would need to split the container), is left untouched with its markers.
 * Ranges are scoped per story: a range does not cross a `w:txbxContent`
 * boundary. Selective (filtered) accept/reject leaves every range untouched.
 */

import { OOXML } from './namespaces.js';

const W_NS = OOXML.W_NS;

type RangeKind = 'Ins' | 'Del' | 'MoveFrom' | 'MoveTo';
const RANGE_KINDS: readonly RangeKind[] = ['Ins', 'Del', 'MoveFrom', 'MoveTo'];
const CONTAINER_LOCALS = new Set(['customXml', 'sdt']);

export type CustomXmlRangeResolution = {
  insertions: number;
  deletions: number;
  moves: number;
};

type OpenRange = { kind: RangeKind; id: string; start: Element };
type ContainerSpan = { el: Element; openAtStart: Set<OpenRange> };
type RangeRecord = {
  kind: RangeKind;
  start: Element;
  end: Element | null;
  enclosed: Element[];
  partial: boolean;
};

function rangeKindOf(el: Element, suffix: 'Start' | 'End'): RangeKind | null {
  if (el.namespaceURI !== W_NS) return null;
  for (const kind of RANGE_KINDS) {
    if (el.localName === `customXml${kind}Range${suffix}`) return kind;
  }
  return null;
}

/** Walk `root` in document order and pair every range with what it encloses. */
function collectRanges(root: Element): RangeRecord[] {
  const records = new Map<OpenRange, RangeRecord>();
  const open: OpenRange[] = [];

  const visit = (el: Element): void => {
    const startKind = rangeKindOf(el, 'Start');
    if (startKind) {
      const range: OpenRange = { kind: startKind, id: el.getAttributeNS(W_NS, 'id') ?? '', start: el };
      open.push(range);
      records.set(range, { kind: startKind, start: el, end: null, enclosed: [], partial: false });
      return;
    }
    const endKind = rangeKindOf(el, 'End');
    if (endKind) {
      const id = el.getAttributeNS(W_NS, 'id') ?? '';
      for (let i = open.length - 1; i >= 0; i--) {
        const range = open[i]!;
        if (range.kind === endKind && range.id === id) {
          records.get(range)!.end = el;
          open.splice(i, 1);
          break;
        }
      }
      return;
    }

    if (el.namespaceURI === W_NS && el.localName === 'txbxContent') {
      // A text box is its own story: an enclosing range does not reach into it,
      // and a range inside it does not leak out.
      const outer = open.splice(0, open.length);
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) visit(child as Element);
      }
      open.splice(0, open.length, ...outer);
      return;
    }

    const isContainer = el.namespaceURI === W_NS && CONTAINER_LOCALS.has(el.localName ?? '');
    const span: ContainerSpan | null = isContainer ? { el, openAtStart: new Set(open) } : null;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
    if (!span) return;
    const openAtEnd = new Set(open);
    for (const range of span.openAtStart) {
      if (openAtEnd.has(range)) records.get(range)!.enclosed.push(el);
      else records.get(range)!.partial = true; // start tag inside, end tag outside
    }
    for (const range of openAtEnd) {
      if (!span.openAtStart.has(range)) records.get(range)!.partial = true; // end tag inside only
    }
  };

  visit(root);
  return [...records.values()];
}

/** Replace a container with its content, dropping its property elements. */
function unwrapContainer(container: Element): void {
  const parent = container.parentNode;
  if (!parent) return;
  let contentHost: Element = container;
  if (container.localName === 'sdt') {
    let sdtContent: Element | null = null;
    for (let c = container.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && (c as Element).namespaceURI === W_NS && (c as Element).localName === 'sdtContent') {
        sdtContent = c as Element;
        break;
      }
    }
    if (!sdtContent) {
      parent.removeChild(container);
      return;
    }
    contentHost = sdtContent;
  }
  for (let c = contentHost.firstChild; c; ) {
    const next = c.nextSibling;
    const isProps = c.nodeType === 1 && (c as Element).namespaceURI === W_NS &&
      (c as Element).localName === 'customXmlPr';
    if (!isProps) parent.insertBefore(c, container);
    c = next;
  }
  parent.removeChild(container);
}

/**
 * Resolve custom XML markup revision ranges under `root`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.7
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.8
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.9
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.10
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.11
 * @see #1485
 */
export function resolveCustomXmlRangeRevisions(
  root: Element,
  mode: 'accept' | 'reject',
  selective: boolean,
): CustomXmlRangeResolution {
  const result: CustomXmlRangeResolution = { insertions: 0, deletions: 0, moves: 0 };
  // Selective engines (acceptAIEdits/rejectAIEdits) neither select these
  // ranges nor guard properties an unwrap would discard, so they leave the
  // ranges untouched rather than risk dropping a foreign revision.
  if (selective) return result;
  const unwrap = new Set<Element>();
  const markers: Element[] = [];

  for (const range of collectRanges(root)) {
    if (!range.end || range.partial || range.enclosed.length === 0) continue;
    const removesMarkup = mode === 'accept'
      ? range.kind === 'Del' || range.kind === 'MoveFrom'
      : range.kind === 'Ins' || range.kind === 'MoveTo';
    if (removesMarkup) for (const el of range.enclosed) unwrap.add(el);
    markers.push(range.start, range.end);
    if (range.kind === 'Ins') result.insertions++;
    else if (range.kind === 'Del') result.deletions++;
    else result.moves++;
  }

  for (const marker of markers) marker.parentNode?.removeChild(marker);
  for (const el of unwrap) unwrapContainer(el);
  return result;
}
