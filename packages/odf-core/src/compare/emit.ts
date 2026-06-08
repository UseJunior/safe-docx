/**
 * ODF tracked-changes emitter for paragraph-granularity comparison (Slice 1).
 *
 * Mutates the REVISED `content.xml` DOM in place, adding a `text:tracked-changes` container (first
 * child of `office:text`) plus the lightweight in-body markers that reference it. The exact markup
 * shapes were confirmed by driving LibreOffice to author each change and inspecting its output
 * (see the `add-odf-compare` design notes):
 *
 *  - Insertion: `text:change-start` / `text:change-end` brackets the inserted run, referencing a
 *    `text:insertion` region; inserted content stays inline. Forward (a following kept paragraph
 *    exists): start at the inserted run's first paragraph, end at the following paragraph's start.
 *    End-of-document: start at the preceding paragraph's end, end at the inserted run's last
 *    paragraph's end.
 *  - Deletion (paragraph-break merge): the deleted paragraphs live out-of-line in a `text:deletion`
 *    region; an inline `text:change` point marker sits in the nearest SURVIVING paragraph — at the
 *    start of the following one (forward) or the end of the preceding one (backward, for a run
 *    reaching end-of-document). Consecutive deletions coalesce into ONE region with all deleted
 *    paragraphs plus one empty merge-artifact paragraph (artifact last for forward, first for
 *    backward). `text:change` is inline and is never a direct block child of `office:text`.
 *  - A run with no surviving paragraph to anchor to (every paragraph deleted) fails closed.
 *
 * All element creation/matching is by `namespaceURI` + `localName` (ODF prefixes are not guaranteed).
 */

import { ODF_NS } from '../shared/odf/namespaces.js';
import type { EditOp } from './diff.js';

export type EmitParams = {
  /** The revised `content.xml` DOM; mutated in place. */
  revisedDoc: Document;
  /** Revised body paragraphs in document order (excludes `text:tracked-changes`). */
  revisedBlocks: Element[];
  /** Original body paragraphs in document order (source of deleted content). */
  originalBlocks: Element[];
  /** The edit script from `diffParagraphs(original, revised)`. */
  ops: EditOp[];
  /** Change author for `dc:creator`. */
  author: string;
  /** Change date for `dc:date` (ODF 8601, no fractional seconds). */
  date: string;
};

export class OdfEmitError extends Error {}

type InsertRun = { a: number; b: number; id: string };
type DeleteRun = { originalIndices: number[]; revisedCursor: number; id: string };

/** Apply the tracked-changes markup for `ops` to `revisedDoc`. */
export function emitTrackedChanges(params: EmitParams): void {
  const { revisedDoc, revisedBlocks, originalBlocks, ops, author, date } = params;
  const m = revisedBlocks.length;

  const officeText = firstElementNS(revisedDoc, ODF_NS.OFFICE, 'text');
  if (!officeText) throw new OdfEmitError('No office:text element in revised content.xml.');

  // --- Plan: group consecutive same-kind change ops into runs, allocating ids in document order.
  const alloc = makeIdAllocator(revisedDoc);
  const insertRuns: InsertRun[] = [];
  const deleteRuns: DeleteRun[] = [];
  let revisedCursor = 0;
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    if (op.kind === 'equal') {
      revisedCursor = op.revisedIndex + 1;
      k++;
    } else if (op.kind === 'insert') {
      const a = op.revisedIndex;
      let b = a;
      while (k + 1 < ops.length && ops[k + 1]!.kind === 'insert') {
        k++;
        b = (ops[k] as { revisedIndex: number }).revisedIndex;
      }
      insertRuns.push({ a, b, id: alloc() });
      revisedCursor = b + 1;
      k++;
    } else {
      const originalIndices = [op.originalIndex];
      while (k + 1 < ops.length && ops[k + 1]!.kind === 'delete') {
        k++;
        originalIndices.push((ops[k] as { originalIndex: number }).originalIndex);
      }
      // A deletion run with no surviving revised paragraph anywhere cannot be anchored inline.
      if (m === 0) {
        throw new OdfEmitError(
          'Cannot emit a deletion when the revised document has no paragraphs to anchor the change marker to.',
        );
      }
      deleteRuns.push({ originalIndices, revisedCursor, id: alloc() });
      k++;
    }
  }

  // Identical documents: emit nothing (no empty container).
  if (insertRuns.length === 0 && deleteRuns.length === 0) return;

  // --- Create the changed-region definitions, in ascending id (document) order.
  const tracked = ensureTrackedChanges(revisedDoc, officeText);
  const allRuns: Array<{ kind: 'insert' | 'delete'; id: string; run: InsertRun | DeleteRun }> = [
    ...insertRuns.map((run) => ({ kind: 'insert' as const, id: run.id, run })),
    ...deleteRuns.map((run) => ({ kind: 'delete' as const, id: run.id, run })),
  ].sort((x, y) => idNum(x.id) - idNum(y.id));
  for (const entry of allRuns) {
    if (entry.kind === 'insert') {
      tracked.appendChild(makeInsertionRegion(revisedDoc, entry.id, author, date));
    } else {
      const dr = entry.run as DeleteRun;
      const forward = dr.revisedCursor < m;
      const deletedPs = dr.originalIndices.map((i) => revisedDoc.importNode(originalBlocks[i]!, true) as Element);
      const artifact = makeEmptyParagraph(revisedDoc, originalBlocks[dr.originalIndices[0]!]!);
      const stored = forward ? [...deletedPs, artifact] : [artifact, ...deletedPs];
      tracked.appendChild(makeDeletionRegion(revisedDoc, entry.id, author, date, stored));
    }
  }

  // --- Place insertion markers FIRST so a co-located deletion marker can be prepended before them.
  for (const run of insertRuns) {
    placeInsertionMarkers(revisedDoc, revisedBlocks, run, m);
  }
  // --- Place deletion point markers.
  for (const run of deleteRuns) {
    const forward = run.revisedCursor < m;
    const marker = makeMarker(revisedDoc, 'change', run.id);
    if (forward) {
      prepend(revisedBlocks[run.revisedCursor]!, marker);
    } else {
      revisedBlocks[m - 1]!.appendChild(marker);
    }
  }
}

function placeInsertionMarkers(doc: Document, revisedBlocks: Element[], run: InsertRun, m: number): void {
  const start = makeMarker(doc, 'change-start', run.id);
  const end = makeMarker(doc, 'change-end', run.id);
  const hasFollowing = run.b + 1 < m;
  const hasPreceding = run.a - 1 >= 0;
  if (hasFollowing) {
    // Forward bracket: start of inserted run … start of following paragraph.
    prepend(revisedBlocks[run.a]!, start);
    prepend(revisedBlocks[run.b + 1]!, end);
  } else if (hasPreceding) {
    // End-of-document: end of preceding paragraph … end of inserted run.
    revisedBlocks[run.a - 1]!.appendChild(start);
    revisedBlocks[run.b]!.appendChild(end);
  } else {
    // Entire revised document is inserted: bracket from the first paragraph's start to the last's end.
    prepend(revisedBlocks[run.a]!, start);
    revisedBlocks[run.b]!.appendChild(end);
  }
}

// --- DOM helpers -------------------------------------------------------------------------------

function firstElementNS(doc: Document, ns: string, local: string): Element | null {
  const els = doc.getElementsByTagNameNS(ns, local);
  return (els.item(0) as Element | null) ?? null;
}

function prepend(block: Element, node: Node): void {
  block.insertBefore(node, block.firstChild);
}

/** Get the `text:tracked-changes` first child of `officeText`, creating it if absent. */
function ensureTrackedChanges(doc: Document, officeText: Element): Element {
  for (let child = officeText.firstChild; child; child = child.nextSibling) {
    if (
      child.nodeType === 1 &&
      (child as Element).namespaceURI === ODF_NS.TEXT &&
      (child as Element).localName === 'tracked-changes'
    ) {
      return child as Element;
    }
  }
  const tracked = doc.createElementNS(ODF_NS.TEXT, 'text:tracked-changes');
  officeText.insertBefore(tracked, officeText.firstChild);
  return tracked;
}

function makeChangeInfo(doc: Document, author: string, date: string): Element {
  const info = doc.createElementNS(ODF_NS.OFFICE, 'office:change-info');
  const creator = doc.createElementNS(ODF_NS.DC, 'dc:creator');
  creator.appendChild(doc.createTextNode(author));
  info.appendChild(creator);
  const d = doc.createElementNS(ODF_NS.DC, 'dc:date');
  d.appendChild(doc.createTextNode(date));
  info.appendChild(d);
  return info;
}

function makeChangedRegion(doc: Document, id: string): Element {
  const region = doc.createElementNS(ODF_NS.TEXT, 'text:changed-region');
  region.setAttributeNS(ODF_NS.XML, 'xml:id', id);
  region.setAttributeNS(ODF_NS.TEXT, 'text:id', id);
  return region;
}

function makeInsertionRegion(doc: Document, id: string, author: string, date: string): Element {
  const region = makeChangedRegion(doc, id);
  const insertion = doc.createElementNS(ODF_NS.TEXT, 'text:insertion');
  insertion.appendChild(makeChangeInfo(doc, author, date));
  region.appendChild(insertion);
  return region;
}

function makeDeletionRegion(doc: Document, id: string, author: string, date: string, stored: Element[]): Element {
  const region = makeChangedRegion(doc, id);
  const deletion = doc.createElementNS(ODF_NS.TEXT, 'text:deletion');
  deletion.appendChild(makeChangeInfo(doc, author, date));
  for (const p of stored) deletion.appendChild(p);
  region.appendChild(deletion);
  return region;
}

/** An empty `text:p` merge artifact, inheriting the deleted paragraph's style when present. */
function makeEmptyParagraph(doc: Document, modelBlock: Element): Element {
  const p = doc.createElementNS(ODF_NS.TEXT, 'text:p');
  const style = modelBlock.getAttributeNS(ODF_NS.TEXT, 'style-name') ?? modelBlock.getAttribute('text:style-name');
  if (style) p.setAttributeNS(ODF_NS.TEXT, 'text:style-name', style);
  return p;
}

function makeMarker(doc: Document, local: 'change' | 'change-start' | 'change-end', id: string): Element {
  const el = doc.createElementNS(ODF_NS.TEXT, `text:${local}`);
  el.setAttributeNS(ODF_NS.TEXT, 'text:change-id', id);
  return el;
}

const CT_ID_RE = /^ct(\d+)$/;
function idNum(id: string): number {
  const m = CT_ID_RE.exec(id);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

/**
 * Allocate fresh `ct<n>` change ids that collide with no existing `xml:id` / `text:id` on the
 * revised document's `text:changed-region`s (so reused/pre-existing tracked-changes are preserved).
 */
function makeIdAllocator(doc: Document): () => string {
  const used = new Set<string>();
  const regions = doc.getElementsByTagNameNS(ODF_NS.TEXT, 'changed-region');
  let max = 0;
  for (let i = 0; i < regions.length; i++) {
    const r = regions.item(i) as Element;
    for (const id of [
      r.getAttributeNS(ODF_NS.XML, 'id') ?? r.getAttribute('xml:id'),
      r.getAttributeNS(ODF_NS.TEXT, 'id') ?? r.getAttribute('text:id'),
    ]) {
      if (!id) continue;
      used.add(id);
      const mm = CT_ID_RE.exec(id);
      if (mm) max = Math.max(max, Number.parseInt(mm[1]!, 10));
    }
  }
  let next = max + 1;
  return () => {
    let id = `ct${next++}`;
    while (used.has(id)) id = `ct${next++}`;
    used.add(id);
    return id;
  };
}
