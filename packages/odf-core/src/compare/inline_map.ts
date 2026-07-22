/**
 * Visible-offset → DOM mapping for the intra-paragraph compare emitter (issue #356).
 *
 * `resolveOffset` turns a visible-text offset in a block into a concrete DOM insertion point,
 * splitting a `#text` node or a `text:s` run when the offset falls strictly inside one.
 * `extractVisibleRange` clones a visible range's inline content (preserving `text:span` /
 * hyperlink structure) for out-of-line storage in a `text:deletion` changed-region.
 *
 * Contract for callers that mutate: `resolveOffset` re-segments the block on every call and
 * never trusts a previously computed `Segment[]`. Marker insertion (zero visible width) at an
 * offset never changes the visible offsets BELOW it, so emitters processing offsets in
 * DESCENDING order stay correct across splits. `#text` splits are done manually (truncate
 * `.data` + insert a sibling) — `Text.splitText` is not assumed to exist in xmldom.
 */

import { ODF_NS } from '../shared/odf/namespaces.js';
import {
  ELEMENT_NODE,
  TEXT_NODE,
  buildSegments,
  isAnnotationSubtree,
  isTrackedChangesSubtree,
} from '../shared/odf/text_segments.js';

/** A visible offset could not be mapped onto the block's DOM. The emitter degrades the pair. */
export class OdfMapError extends Error {}

/** A DOM insertion point: `parent.insertBefore(node, before)`. */
export type DomPoint = { parent: Node; before: Node | null };

/** Read a `text:s` run length the way `buildSegments` does. */
function spaceCount(el: Element): number {
  const countRaw = el.getAttributeNS(ODF_NS.TEXT, 'c') ?? el.getAttribute('text:c');
  return Math.max(1, Number.parseInt(countRaw ?? '1', 10) || 1);
}

/** Set a `text:s` run length, omitting the attribute for the default count of 1. */
function setSpaceCount(el: Element, count: number): void {
  if (count === 1) {
    el.removeAttributeNS(ODF_NS.TEXT, 'c');
    el.removeAttribute('text:c');
  } else {
    el.setAttributeNS(ODF_NS.TEXT, 'text:c', String(count));
  }
}

/**
 * Resolve visible offset `vis` in `block` to a DOM insertion point at the offset's natural
 * nesting depth (inside a `text:span` when the offset is inside one — the LibreOffice-authored
 * placement). Offsets 0 and `visible.length` resolve to block-level prepend/append. An offset
 * strictly inside a `#text` node splits it; strictly inside a `text:s` run splits the run,
 * rebalancing `text:c`. Throws `OdfMapError` when `vis` is out of range.
 */
export function resolveOffset(block: Element, vis: number): DomPoint {
  const { segments, visible } = buildSegments(block);
  if (vis < 0 || vis > visible.length) {
    throw new OdfMapError(`offset ${vis} outside visible range 0..${visible.length}`);
  }
  if (vis === 0) return { parent: block, before: block.firstChild };
  if (vis === visible.length) return { parent: block, before: null };

  // A boundary between segments: insert before the segment that starts at `vis`, at its depth.
  const startingHere = segments.find((s) => s.visStart === vis);
  if (startingHere) {
    const host = startingHere.kind === 'text' ? (startingHere.node as unknown as Node) : startingHere.node;
    const parent = host.parentNode;
    if (!parent) throw new OdfMapError(`segment host at offset ${vis} has no parent`);
    return { parent, before: host };
  }

  const seg = segments.find((s) => s.visStart < vis && vis < s.visStart + s.length);
  if (!seg) throw new OdfMapError(`offset ${vis} maps to no segment`);
  const off = vis - seg.visStart;

  if (seg.kind === 'text') {
    const textNode = seg.node as unknown as { data: string } & Node;
    const parent = textNode.parentNode;
    const doc = (textNode as Node).ownerDocument;
    if (!parent || !doc) throw new OdfMapError(`text node at offset ${vis} is detached`);
    const tail = doc.createTextNode(textNode.data.slice(off));
    textNode.data = textNode.data.slice(0, off);
    parent.insertBefore(tail, textNode.nextSibling);
    return { parent, before: tail };
  }

  if (seg.virtual === 'space') {
    const run = seg.node;
    const parent = run.parentNode;
    const doc = run.ownerDocument;
    if (!parent || !doc) throw new OdfMapError(`text:s at offset ${vis} is detached`);
    const tail = doc.importNode(run, false) as Element;
    setSpaceCount(run, off);
    setSpaceCount(tail, seg.length - off);
    parent.insertBefore(tail, run.nextSibling);
    return { parent, before: tail };
  }

  // tab / line-break are length 1 — an offset strictly inside one cannot exist.
  throw new OdfMapError(`offset ${vis} falls inside an atomic ${seg.virtual} element`);
}

/**
 * Clone the inline content of `block`'s visible range [start, end) as nodes owned by
 * `targetDoc`, for storage inside a `text:deletion` changed-region. Ancestor inline elements
 * (`text:span`, hyperlinks) of covered content are shallow-cloned with their attributes;
 * `#text` is trimmed at the edges; a partially covered `text:s` is rebalanced to the covered
 * count; `text:tab` / `text:line-break` are copied whole (length 1 — never split). Pure with
 * respect to `block`. Throws `OdfMapError` on an empty or out-of-range span.
 */
export function extractVisibleRange(block: Element, start: number, end: number, targetDoc: Document): Node[] {
  const { visible } = buildSegments(block);
  if (!(start >= 0 && start < end && end <= visible.length)) {
    throw new OdfMapError(`range [${start}, ${end}) invalid for visible length ${visible.length}`);
  }

  let pos = 0;
  const out: Node[] = [];
  const walk = (node: Node, sink: Node[]): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        const data = (child as unknown as { data: string }).data ?? '';
        const from = Math.max(start, pos);
        const to = Math.min(end, pos + data.length);
        if (to > from) sink.push(targetDoc.createTextNode(data.slice(from - pos, to - pos)));
        pos += data.length;
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as Element;
      if (isAnnotationSubtree(el) || isTrackedChangesSubtree(el)) continue;
      if (el.namespaceURI === ODF_NS.TEXT && el.localName === 's') {
        const count = spaceCount(el);
        const covered = Math.min(end, pos + count) - Math.max(start, pos);
        if (covered > 0) {
          const clone = targetDoc.importNode(el, false) as Element;
          setSpaceCount(clone, covered);
          sink.push(clone);
        }
        pos += count;
        continue;
      }
      if (el.namespaceURI === ODF_NS.TEXT && (el.localName === 'tab' || el.localName === 'line-break')) {
        if (start <= pos && pos < end) sink.push(targetDoc.importNode(el, false));
        pos += 1;
        continue;
      }
      // Container element (text:span, text:a, …): recurse; shallow-clone it only when it
      // actually contributes covered content, so uncovered formatting never leaks into storage.
      const sub: Node[] = [];
      walk(el, sub);
      if (sub.length > 0) {
        const clone = targetDoc.importNode(el, false) as Element;
        for (const n of sub) clone.appendChild(n);
        sink.push(clone);
      }
    }
  };
  walk(block, out);
  return out;
}
