/**
 * ODF tracked-changes emitter: paragraph-granularity (Slice 1) + intra-paragraph modify pairs
 * (issue #356).
 *
 * Mutates the REVISED `content.xml` DOM in place, adding a `text:tracked-changes` container (first
 * child of `office:text`) plus the lightweight in-body markers that reference it. The exact markup
 * shapes were confirmed by driving LibreOffice to author each change and inspecting its output
 * (see the `add-odf-compare` and `add-odf-intra-paragraph-compare` design notes):
 *
 *  - Insertion: `text:change-start` / `text:change-end` brackets the inserted run, referencing a
 *    `text:insertion` region; inserted content stays inline. Forward (a following kept paragraph
 *    exists): start at the inserted run's first paragraph, end at the following paragraph's start.
 *    End-of-document: start at the preceding paragraph's end, end at the inserted run's last
 *    paragraph's end — UNLESS the preceding paragraph lives inside a table cell, where the
 *    bracket stays within the inserted run (start at its first paragraph's start). A span from a
 *    table-cell paragraph into a body paragraph encodes a paragraph-break merge LibreOffice
 *    cannot perform across a table boundary, so rejecting it strands an empty body paragraph
 *    (issue #380).
 *  - Deletion (paragraph-break merge): the deleted paragraphs live out-of-line in a `text:deletion`
 *    region; an inline `text:change` point marker sits in the nearest SURVIVING paragraph — at the
 *    start of the following one (forward) or the end of the preceding one (backward, for a run
 *    reaching end-of-document). A run whose following paragraph belongs to an inserted run that
 *    itself reaches end-of-document (a dissimilar whole-paragraph replacement of the LAST
 *    paragraph) also anchors BACKWARD: the insertion's bracket is end-anchored there, so a forward
 *    marker would sit inside the insertion span and rejecting the insertion would remove the
 *    deletion's restore point (issue #367). When that composition's backward anchor would be a
 *    table-cell paragraph, the insertion bracket stays within the inserted run instead (see
 *    above), so the deletion anchors at the inserted run's first paragraph's START — before the
 *    co-located `text:change-start`, hence still outside the insertion span — and its region
 *    stores NO merge-artifact paragraph: rejecting the content-only insertion leaves one
 *    residual empty paragraph behind, and that residual paragraph is the merge slot the
 *    artifact normally provides (issue #380). Consecutive deletions coalesce into ONE region with
 *    all deleted paragraphs plus one empty merge-artifact paragraph (artifact last for forward,
 *    first for backward). `text:change` is inline and is never a direct block child of
 *    `office:text`.
 *  - Modify pair (intra-paragraph): the revised paragraph stays in place. An inserted span keeps
 *    its content inline bracketed by `text:change-start`/`text:change-end`; a deleted span leaves
 *    one `text:change` point marker and its content is stored out-of-line in a `text:deletion`
 *    region holding ONE block mirroring the host (`text:p`/`text:h` + style/outline-level) — no
 *    merge-artifact paragraph (no paragraph break died). A replace orders the insertion bracket
 *    first and the deletion point after its `text:change-end` (LibreOffice's authored order); at
 *    one offset the document order is `change-end`, `change`, `change-start`. A pair whose spans
 *    cannot be mapped degrades to the Slice-1 whole-paragraph delete+insert, decided before any
 *    markup is written.
 *  - A run with no surviving paragraph to anchor to (every paragraph deleted) fails closed.
 *
 * All element creation/matching is by `namespaceURI` + `localName` (ODF prefixes are not guaranteed).
 */

import { ODF_NS } from '../shared/odf/namespaces.js';
import { buildSegments } from '../shared/odf/text_segments.js';
import type { EditOp } from './diff.js';
import { diffInline, type SpanOp } from './inline_diff.js';
import { OdfMapError, extractVisibleRange, resolveOffset } from './inline_map.js';

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

/** Per-emission accounting so reported stats always match the emitted markup. */
export type EmitResult = {
  /** Modify pairs that survived as inline markup. */
  modifications: number;
  /** Modify pairs that fell back to whole-paragraph delete+insert. */
  degradedModifications: number;
  /** Inserted spans inside surviving modify pairs (one `text:insertion` region each). */
  inlineInsertions: number;
  /** Deleted spans inside surviving modify pairs (one `text:deletion` region each). */
  inlineDeletions: number;
};

type InsertRun = { a: number; b: number; id: string };
type DeleteRun = { originalIndices: number[]; revisedCursor: number; id: string };

/** One in-body marker to place inside a modify pair's revised paragraph. */
type MarkerPlacement = { offset: number; type: 'change' | 'change-start' | 'change-end'; id: string };
/** One changed-region a modify pair contributes (delete regions carry their stored content). */
type InlineRegion =
  | { kind: 'insert'; id: string }
  | { kind: 'delete'; id: string; content: Node[] };

type ModifyPlan = {
  revisedIndex: number;
  originalIndex: number;
  placements: MarkerPlacement[];
  regions: InlineRegion[];
};

/** Pre-id draft: the pure planning result for one modify pair (extraction already executed). */
type ModifyDraft = {
  spans: SpanOp[];
  deleteContents: Map<number, Node[]>; // span index -> extracted nodes
};

/** Apply the tracked-changes markup for `ops` to `revisedDoc`. */
export function emitTrackedChanges(params: EmitParams): EmitResult {
  const { revisedDoc, revisedBlocks, originalBlocks, ops, author, date } = params;
  const m = revisedBlocks.length;

  const officeText = firstElementNS(revisedDoc, ODF_NS.OFFICE, 'text');
  if (!officeText) throw new OdfEmitError('No office:text element in revised content.xml.');

  // --- Lane 2/3 pre-pass: plan every modify pair PURELY (diff + content extraction, no DOM
  // mutation of the body). A pair that cannot be planned degrades to whole-paragraph
  // delete+insert here, BEFORE any markup exists — no partial inline state is possible. The
  // mutating half of placement (`resolveOffset`) is deferred to the marker phase: it is total
  // for in-range offsets, and every placement offset comes from `diffInline` over the same
  // visible string it will be resolved against.
  const drafts = new Map<number, ModifyDraft>();
  const degraded = new Set<number>();
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]!;
    if (op.kind !== 'modify') continue;
    try {
      const originalBlock = originalBlocks[op.originalIndex];
      const revisedBlock = revisedBlocks[op.revisedIndex];
      // Out-of-range indices are an engine bug, not a mapping limitation: fail closed (degrading
      // would just crash later when lane 1 dereferences the same missing block).
      if (!originalBlock || !revisedBlock) throw new OdfEmitError(`modify pair indices out of range at op ${k}`);
      const origVisible = buildSegments(originalBlock).visible;
      const revVisible = buildSegments(revisedBlock).visible;
      const spans = diffInline(origVisible, revVisible);
      const deleteContents = new Map<number, Node[]>();
      let changed = 0;
      for (let s = 0; s < spans.length; s++) {
        const span = spans[s]!;
        if (span.kind === 'equal') continue;
        changed++;
        if (span.kind === 'delete') {
          deleteContents.set(s, extractVisibleRange(originalBlock, span.origStart, span.origEnd, revisedDoc));
        }
      }
      // A pair with identical visible text gets no draft: nothing to mark up, nothing to count.
      if (changed > 0) drafts.set(k, { spans, deleteContents });
    } catch (err) {
      if (err instanceof OdfMapError) {
        degraded.add(k);
      } else {
        throw err;
      }
    }
  }

  // --- Lane 1: group whole-paragraph ops into runs, allocating ids in document order. A modify
  // paragraph is a SURVIVOR for anchoring: it advances the revised cursor exactly like `equal`
  // (so a preceding delete run anchors its point marker at the modified paragraph's start) and
  // terminates any open run. Degraded pairs re-route here as a delete run + insert run at the
  // same slot (the Slice-1 replacement shape).
  const alloc = makeIdAllocator(revisedDoc);
  const insertRuns: InsertRun[] = [];
  const deleteRuns: DeleteRun[] = [];
  const modifyPlans: ModifyPlan[] = [];
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
    } else if (op.kind === 'delete') {
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
    } else if (op.kind === 'modify') {
      if (degraded.has(k)) {
        if (m === 0) {
          throw new OdfEmitError(
            'Cannot emit a deletion when the revised document has no paragraphs to anchor the change marker to.',
          );
        }
        deleteRuns.push({ originalIndices: [op.originalIndex], revisedCursor, id: alloc() });
        insertRuns.push({ a: op.revisedIndex, b: op.revisedIndex, id: alloc() });
      } else if (drafts.has(k)) {
        modifyPlans.push(finalizeModifyPlan(op.originalIndex, op.revisedIndex, drafts.get(k)!, alloc));
      }
      // No-op pairs (identical visible text) emit nothing.
      revisedCursor = op.revisedIndex + 1;
      k++;
    } else {
      throw new OdfEmitError(`Unknown edit op kind at index ${k}.`);
    }
  }

  const result: EmitResult = {
    modifications: modifyPlans.length,
    degradedModifications: degraded.size,
    inlineInsertions: modifyPlans.reduce((n, p) => n + p.regions.filter((r) => r.kind === 'insert').length, 0),
    inlineDeletions: modifyPlans.reduce((n, p) => n + p.regions.filter((r) => r.kind === 'delete').length, 0),
  };

  // Identical documents: emit nothing (no empty container).
  if (insertRuns.length === 0 && deleteRuns.length === 0 && modifyPlans.length === 0) return result;

  // --- Create the changed-region definitions, in ascending id (document) order.
  const tracked = ensureTrackedChanges(revisedDoc, officeText);
  const allRegions: Array<{ id: string; build: () => Element }> = [
    ...insertRuns.map((run) => ({ id: run.id, build: () => makeInsertionRegion(revisedDoc, run.id, author, date) })),
    ...deleteRuns.map((dr) => ({
      id: dr.id,
      build: () => {
        const mode = deletionAnchorMode(dr, insertRuns, revisedBlocks, m);
        const deletedPs = dr.originalIndices.map((i) => revisedDoc.importNode(originalBlocks[i]!, true) as Element);
        // 'insertion-start' stores no merge artifact: the residual empty paragraph left by
        // rejecting the co-located content-only insertion is the merge slot (issue #380).
        const stored =
          mode === 'insertion-start'
            ? deletedPs
            : mode === 'forward'
              ? [...deletedPs, makeEmptyParagraph(revisedDoc, originalBlocks[dr.originalIndices[0]!]!)]
              : [makeEmptyParagraph(revisedDoc, originalBlocks[dr.originalIndices[0]!]!), ...deletedPs];
        return makeDeletionRegion(revisedDoc, dr.id, author, date, stored);
      },
    })),
    ...modifyPlans.flatMap((plan) =>
      plan.regions.map((region) => ({
        id: region.id,
        build: () =>
          region.kind === 'insert'
            ? makeInsertionRegion(revisedDoc, region.id, author, date)
            : makeDeletionRegion(revisedDoc, region.id, author, date, [
                makeBlockMirror(revisedDoc, originalBlocks[plan.originalIndex]!, region.content),
              ]),
      })),
    ),
  ].sort((x, y) => idNum(x.id) - idNum(y.id));
  for (const entry of allRegions) tracked.appendChild(entry.build());

  // --- Place intra-paragraph markers FIRST: whole-paragraph markers are prepended afterwards, so
  // at a shared paragraph start the whole-paragraph `text:change` serializes BEFORE intra markers.
  for (const plan of modifyPlans) {
    placeModifyMarkers(revisedDoc, revisedBlocks[plan.revisedIndex]!, plan.placements);
  }
  // --- Place whole-paragraph insertion markers (before deletion markers, as in Slice 1, so a
  // co-located deletion marker can be prepended before them).
  for (const run of insertRuns) {
    placeInsertionMarkers(revisedDoc, revisedBlocks, run, m);
  }
  // --- Place whole-paragraph deletion point markers.
  for (const run of deleteRuns) {
    const marker = makeMarker(revisedDoc, 'change', run.id);
    if (deletionAnchorMode(run, insertRuns, revisedBlocks, m) === 'backward') {
      appendOutsideInsertionStart(revisedBlocks[Math.min(run.revisedCursor, m) - 1]!, marker);
    } else {
      // 'forward' and 'insertion-start' both prepend at the cursor block. For 'insertion-start'
      // the co-located insertion's `change-start` was prepended first (insertion markers are
      // placed before deletion markers), so this prepend lands the marker BEFORE it — outside
      // the insertion span, satisfying the issue #367 invariant.
      prepend(revisedBlocks[run.revisedCursor]!, marker);
    }
  }
  return result;
}

/**
 * Turn a draft into a concrete plan: allocate one region id per changed span in offset order and
 * compute marker placements. A delete span anchors at its revised offset; when it is immediately
 * followed by an insert span (a replacement — both sit at the same revised offset), the point
 * marker bumps past the insertion to its `change-end` offset, matching LibreOffice's authored
 * replace shape (insertion bracket first, deletion point after).
 */
function finalizeModifyPlan(
  originalIndex: number,
  revisedIndex: number,
  draft: ModifyDraft,
  alloc: () => string,
): ModifyPlan {
  const placements: MarkerPlacement[] = [];
  const regions: InlineRegion[] = [];
  for (let s = 0; s < draft.spans.length; s++) {
    const span = draft.spans[s]!;
    if (span.kind === 'equal') continue;
    const id = alloc();
    if (span.kind === 'insert') {
      regions.push({ kind: 'insert', id });
      placements.push({ offset: span.revStart, type: 'change-start', id });
      placements.push({ offset: span.revEnd, type: 'change-end', id });
    } else {
      regions.push({ kind: 'delete', id, content: draft.deleteContents.get(s)! });
      const next = draft.spans[s + 1];
      const anchor = next && next.kind === 'insert' ? next.revEnd : span.revStart;
      placements.push({ offset: anchor, type: 'change', id });
    }
  }
  return { originalIndex, revisedIndex, placements, regions };
}

/** Document order of co-located markers: `change-end`, then `change`, then `change-start`. */
const MARKER_RANK: Record<MarkerPlacement['type'], number> = { 'change-end': 0, change: 1, 'change-start': 2 };

/**
 * Insert a modify pair's markers into its revised paragraph. Offset groups are processed in
 * DESCENDING offset order — marker insertion is zero visible width and `resolveOffset`
 * re-segments per call, so placements at lower offsets stay valid across splits made at higher
 * ones. Each offset group is resolved once and its markers inserted sequentially at that point.
 */
function placeModifyMarkers(doc: Document, block: Element, placements: MarkerPlacement[]): void {
  const groups = new Map<number, MarkerPlacement[]>();
  for (const p of placements) {
    const group = groups.get(p.offset) ?? [];
    group.push(p);
    groups.set(p.offset, group);
  }
  const offsets = [...groups.keys()].sort((a, b) => b - a);
  for (const offset of offsets) {
    const group = groups.get(offset)!.sort((a, b) => MARKER_RANK[a.type] - MARKER_RANK[b.type]);
    const point = resolveOffset(block, offset);
    for (const p of group) {
      point.parent.insertBefore(makeMarker(doc, p.type, p.id), point.before);
    }
  }
}

/**
 * How a deletion run anchors its point marker:
 *  - `forward`: start of the following surviving paragraph (the default).
 *  - `backward`: end of the preceding surviving paragraph. Chosen when the run reaches
 *    end-of-document, and ALSO when its forward anchor would be the first paragraph of an insert
 *    run that itself reaches end-of-document: that insertion's bracket is end-anchored
 *    (`text:change-start` at the end of the preceding kept paragraph), so a forward marker would
 *    sit INSIDE the insertion span and rejecting the insertion would remove the deletion's
 *    restore point (issue #367). With no preceding paragraph (`revisedCursor` 0) there is
 *    nothing to anchor backward to, so the forward placement stands.
 *  - `insertion-start`: start of the end-of-document insert run's first paragraph, before its
 *    `text:change-start`. Chosen instead of `backward` when the backward anchor would be a
 *    table-cell paragraph: there the insertion bracket stays within the inserted run (see
 *    `placeInsertionMarkers`), so the paragraph start is outside the insertion span, and the
 *    deletion's region stores no merge-artifact paragraph (issue #380).
 */
type DeletionAnchorMode = 'forward' | 'backward' | 'insertion-start';

function deletionAnchorMode(
  run: DeleteRun,
  insertRuns: InsertRun[],
  revisedBlocks: Element[],
  m: number,
): DeletionAnchorMode {
  if (run.revisedCursor >= m) return 'backward';
  if (run.revisedCursor === 0) return 'forward';
  if (!insertRuns.some((ins) => ins.a === run.revisedCursor && ins.b === m - 1)) return 'forward';
  return isInsideTableCell(revisedBlocks[run.revisedCursor - 1]!) ? 'insertion-start' : 'backward';
}

/** Whether a block lives inside a `table:table-cell` (its paragraph break cannot merge outward). */
function isInsideTableCell(block: Element): boolean {
  for (let node: Node | null = block.parentNode; node && node.nodeType === 1; node = node.parentNode) {
    const el = node as Element;
    if (el.namespaceURI === ODF_NS.TABLE && el.localName === 'table-cell') return true;
  }
  return false;
}

/**
 * Append `marker` at the end of `anchor`, but BEFORE a co-located end-of-document insertion
 * `text:change-start` (insertion markers are placed first), keeping the deletion marker outside
 * the insertion span.
 */
function appendOutsideInsertionStart(anchor: Element, marker: Element): void {
  const last = anchor.lastChild;
  const ref =
    last && last.nodeType === 1 && (last as Element).namespaceURI === ODF_NS.TEXT && (last as Element).localName === 'change-start'
      ? last
      : null;
  anchor.insertBefore(marker, ref);
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
  } else if (hasPreceding && !isInsideTableCell(revisedBlocks[run.a - 1]!)) {
    // End-of-document: end of preceding paragraph … end of inserted run.
    revisedBlocks[run.a - 1]!.appendChild(start);
    revisedBlocks[run.b]!.appendChild(end);
  } else if (hasPreceding) {
    // End-of-document after a table: the preceding paragraph is a table-cell paragraph, and a
    // span from a cell into the body encodes a paragraph-break merge LibreOffice cannot perform
    // across the table boundary — rejecting it strands an empty body paragraph (issue #380).
    // Keep the bracket within the inserted run instead.
    prepend(revisedBlocks[run.a]!, start);
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

/**
 * The storage block for an inline deletion: mirrors the host block's element name and identity
 * attributes (`text:style-name`; `text:outline-level` for headings — the LibreOffice-authored
 * O10 shape), holding the extracted deleted content.
 */
function makeBlockMirror(doc: Document, hostBlock: Element, content: Node[]): Element {
  const local = hostBlock.localName === 'h' ? 'text:h' : 'text:p';
  const block = doc.createElementNS(ODF_NS.TEXT, local);
  const style = hostBlock.getAttributeNS(ODF_NS.TEXT, 'style-name') ?? hostBlock.getAttribute('text:style-name');
  if (style) block.setAttributeNS(ODF_NS.TEXT, 'text:style-name', style);
  const outline =
    hostBlock.getAttributeNS(ODF_NS.TEXT, 'outline-level') ?? hostBlock.getAttribute('text:outline-level');
  if (outline) block.setAttributeNS(ODF_NS.TEXT, 'text:outline-level', outline);
  for (const n of content) block.appendChild(n);
  return block;
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
