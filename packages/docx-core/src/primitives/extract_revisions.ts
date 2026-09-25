/**
 * extract_revisions — walk tracked-change markup in a document body and
 * return structured per-paragraph revision records with before/after text.
 *
 * Algorithm:
 * 1. Clone DOM twice → acceptChanges() on one, rejectChanges() on the other
 * 2. Walk the *original* tracked DOM in document order, visiting every w:tr
 *    and every w:p (including inside w:tc table cells)
 * 3. For each table row whose w:trPr carries a row-level marker (w:ins, w:del,
 *    w:trPrChange), emit one `scope: 'row'` record keyed by the row's first
 *    paragraph, with the whole-row text before/after
 * 4. For each paragraph with revision wrappers, look up before_text (rejected clone)
 *    and after_text (accepted clone) by _bk_* bookmark ID
 * 5. Collect individual revision entries with type, text, author, and the
 *    markup's w:id / w:date when present
 * 6. Join comments by anchoredParagraphId
 * 7. Apply offset/limit pagination
 */

import { OOXML } from './namespaces.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import { getParagraphText } from './text.js';
import { getParagraphBookmarkId, findParagraphByBookmarkId } from './bookmarks.js';
import type { Comment } from './comments.js';

const W_NS = OOXML.W_NS;

// ── Types ───────────────────────────────────────────────────────────

export type RevisionType =
  | 'INSERTION'
  | 'DELETION'
  | 'MOVE_FROM'
  | 'MOVE_TO'
  | 'FORMAT_CHANGE'
  | 'ROW_INSERTION'
  | 'ROW_DELETION';

export type RevisionEntry = {
  type: RevisionType;
  text: string;
  author: string;
  /** `w:id` of the revision element, when the markup carries one. */
  id?: string;
  /** `w:date` of the revision element (ISO 8601), when the markup carries one. */
  date?: string;
};

export type RevisionComment = {
  author: string;
  text: string;
  date: string | null;
  replies?: RevisionComment[];
};

export type ParagraphRevision = {
  para_id: string;
  /**
   * Present only on table-row records: the record describes the whole `w:tr`
   * (a row inserted or deleted as a unit, or a row property change) rather
   * than one paragraph. `para_id` is then the row's first paragraph, and
   * `before_text` / `after_text` are the row's cell texts joined by tabs
   * (paragraphs within a cell joined by newlines). Paragraph records omit it.
   */
  scope?: 'row';
  before_text: string;
  after_text: string;
  revisions: RevisionEntry[];
  comments: RevisionComment[];
};

export type ExtractRevisionsResult = {
  changes: ParagraphRevision[];
  total_changes: number;
  has_more: boolean;
};

// ── Internal helpers ────────────────────────────────────────────────

function isW(node: Node, localName: string): node is Element {
  return (
    node.nodeType === 1 &&
    (node as Element).namespaceURI === W_NS &&
    (node as Element).localName === localName
  );
}

// Revision wrapper local names
const REVISION_WRAPPER_LOCALS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

// Property change local names
const PR_CHANGE_LOCALS = new Set([
  'rPrChange', 'pPrChange', 'sectPrChange',
  'tblPrChange', 'trPrChange', 'tcPrChange',
]);

/**
 * Check if a paragraph is entirely inserted (all content is inside w:ins).
 * Such paragraphs have no "before" state — they didn't exist before the edit.
 */
function paragraphIsEntirelyInserted(p: Element): boolean {
  // Check for paragraph-level insertion marker: w:pPr > w:rPr > w:ins
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i]!;
    if (!isW(child, 'pPr')) continue;
    for (let j = 0; j < child.childNodes.length; j++) {
      if (!isW(child.childNodes[j]!, 'rPr')) continue;
      for (let k = 0; k < child.childNodes[j]!.childNodes.length; k++) {
        if (isW(child.childNodes[j]!.childNodes[k]!, 'ins')) return true;
      }
    }
  }
  // Check if all content-bearing children are inside w:ins
  let hasContent = false;
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI !== W_NS) continue;
    const local = el.localName;
    if (local === 'pPr' || local === 'bookmarkStart' || local === 'bookmarkEnd') continue;
    if (local === 'ins' || local === 'moveTo') { hasContent = true; continue; }
    // Any content outside ins/moveTo means not entirely inserted
    if (local === 'r' || local === 'del' || local === 'moveFrom') return false;
  }
  return hasContent;
}

/**
 * Check if a paragraph is entirely deleted (all content is inside w:del).
 * Such paragraphs have no "after" state — they were fully removed.
 */
function paragraphIsEntirelyDeleted(p: Element): boolean {
  // Check for paragraph-level deletion marker: w:pPr > w:rPr > w:del
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i]!;
    if (!isW(child, 'pPr')) continue;
    for (let j = 0; j < child.childNodes.length; j++) {
      if (!isW(child.childNodes[j]!, 'rPr')) continue;
      for (let k = 0; k < child.childNodes[j]!.childNodes.length; k++) {
        if (isW(child.childNodes[j]!.childNodes[k]!, 'del')) return true;
      }
    }
  }
  // Check if all content-bearing children are inside w:del
  let hasContent = false;
  for (let i = 0; i < p.childNodes.length; i++) {
    const child = p.childNodes[i]!;
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI !== W_NS) continue;
    const local = el.localName;
    if (local === 'pPr' || local === 'bookmarkStart' || local === 'bookmarkEnd') continue;
    if (local === 'del' || local === 'moveFrom') { hasContent = true; continue; }
    // Any content outside del/moveFrom means not entirely deleted
    if (local === 'r' || local === 'ins' || local === 'moveTo') return false;
  }
  return hasContent;
}

/**
 * Check if a paragraph contains any revision wrappers or property change records.
 */
function paragraphHasRevisions(p: Element): boolean {
  // Check for revision wrappers (w:ins, w:del, w:moveFrom, w:moveTo)
  for (const local of REVISION_WRAPPER_LOCALS) {
    if (p.getElementsByTagNameNS(W_NS, local).length > 0) return true;
  }
  // Check for property change records
  for (const local of PR_CHANGE_LOCALS) {
    if (p.getElementsByTagNameNS(W_NS, local).length > 0) return true;
  }
  return false;
}

/**
 * Extract text content from an element's w:t and w:delText children (recursive through runs).
 */
function getRevisionText(el: Element): string {
  const parts: string[] = [];
  const ts = el.getElementsByTagNameNS(W_NS, 't');
  for (let i = 0; i < ts.length; i++) {
    parts.push(ts[i]!.textContent ?? '');
  }
  const delTs = el.getElementsByTagNameNS(W_NS, 'delText');
  for (let i = 0; i < delTs.length; i++) {
    parts.push(delTs[i]!.textContent ?? '');
  }
  return parts.join('');
}

function getAttr(el: Element, localName: string): string {
  return el.getAttributeNS(W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? '';
}

/**
 * Build one revision entry from a revision element, carrying its `w:id` and
 * `w:date` when the markup has them (both are optional in the schema, and
 * comparison output from some engines omits them).
 */
function makeEntry(el: Element, type: RevisionType, text: string): RevisionEntry {
  const entry: RevisionEntry = { type, text, author: getAttr(el, 'author') };
  const id = getAttr(el, 'id');
  if (id) entry.id = id;
  const date = getAttr(el, 'date');
  if (date) entry.date = date;
  return entry;
}

/**
 * Collect individual revision entries from a paragraph's revision wrappers.
 */
function collectRevisionEntries(p: Element): RevisionEntry[] {
  const entries: RevisionEntry[] = [];

  // Collect from w:ins wrappers
  const insEls = p.getElementsByTagNameNS(W_NS, 'ins');
  for (let i = 0; i < insEls.length; i++) {
    const ins = insEls[i]!;
    // Skip paragraph-level markers (inside pPr/rPr)
    if (isInsidePPrOrRPr(ins, p)) continue;
    entries.push(makeEntry(ins, 'INSERTION', getRevisionText(ins)));
  }

  // Collect from w:del wrappers
  const delEls = p.getElementsByTagNameNS(W_NS, 'del');
  for (let i = 0; i < delEls.length; i++) {
    const del = delEls[i]!;
    if (isInsidePPrOrRPr(del, p)) continue;
    entries.push(makeEntry(del, 'DELETION', getRevisionText(del)));
  }

  // Collect from w:moveFrom wrappers
  const moveFromEls = p.getElementsByTagNameNS(W_NS, 'moveFrom');
  for (let i = 0; i < moveFromEls.length; i++) {
    const mf = moveFromEls[i]!;
    entries.push(makeEntry(mf, 'MOVE_FROM', getRevisionText(mf)));
  }

  // Collect from w:moveTo wrappers
  const moveToEls = p.getElementsByTagNameNS(W_NS, 'moveTo');
  for (let i = 0; i < moveToEls.length; i++) {
    const mt = moveToEls[i]!;
    entries.push(makeEntry(mt, 'MOVE_TO', getRevisionText(mt)));
  }

  // Collect FORMAT_CHANGE from *PrChange records
  for (const localName of PR_CHANGE_LOCALS) {
    const changes = p.getElementsByTagNameNS(W_NS, localName);
    for (let i = 0; i < changes.length; i++) {
      entries.push(makeEntry(changes[i]!, 'FORMAT_CHANGE', ''));
    }
  }

  return entries;
}

// ── Table-row revisions ─────────────────────────────────────────────

function directChildren(el: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]!;
    if (isW(child, localName)) out.push(child);
  }
  return out;
}

/**
 * The row-level revision markers of a `w:tr`: direct children of its `w:trPr`
 * that revise the row itself rather than wrapping a span of content.
 *
 * An empty `w:del` under `w:trPr` marks the enclosing row as a tracked
 * deletion, an empty `w:ins` marks it as a tracked insertion, and
 * `w:trPrChange` records a revision to the row's properties. None of them
 * imply a revision state for the row's cell content, which is revision-marked
 * independently and reported by the per-paragraph walk.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.37
 * @see https://github.com/UseJunior/safe-docx/issues/868
 */
function rowRevisionMarkers(tr: Element): Element[] {
  const markers: Element[] = [];
  for (const trPr of directChildren(tr, 'trPr')) {
    for (let i = 0; i < trPr.childNodes.length; i++) {
      const child = trPr.childNodes[i]!;
      if (isW(child, 'ins') || isW(child, 'del') || isW(child, 'trPrChange')) {
        markers.push(child);
      }
    }
  }
  return markers;
}

/**
 * Children of `el` with the given local name, looking through the structured
 * document tag and custom XML wrappers the schema allows at that level
 * (`w:sdt > w:sdtContent > …`, `w:customXml > …`), but never into a nested
 * table: `w:tbl` is not a wrapper, and its cells belong to another row.
 */
function ownChildrenThroughWrappers(el: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]!;
    if (isW(child, localName)) {
      out.push(child);
    } else if (isW(child, 'sdt')) {
      for (const content of directChildren(child, 'sdtContent')) {
        out.push(...ownChildrenThroughWrappers(content, localName));
      }
    } else if (isW(child, 'customXml')) {
      out.push(...ownChildrenThroughWrappers(child, localName));
    }
  }
  return out;
}

/** The row's own cells, including cells wrapped in `w:sdt` / `w:customXml`. */
function rowCells(tr: Element): Element[] {
  return ownChildrenThroughWrappers(tr, 'tc');
}

/** The cell's own paragraphs, including ones wrapped in `w:sdt` / `w:customXml`; paragraphs of a nested table are excluded. */
function cellParagraphs(tc: Element): Element[] {
  return ownChildrenThroughWrappers(tc, 'p');
}

/**
 * The first paragraph in the row's own cells (not one inside a nested table),
 * falling back to the first descendant paragraph when the row has none of its
 * own. `trDepth` is how many `w:tr` ancestors (counting `tr` itself) sit
 * between that paragraph and the row, so the row can be recovered from the
 * paragraph in a clone even when the fallback landed inside a nested table.
 */
function firstRowParagraph(tr: Element): { p: Element; trDepth: number } | null {
  for (const tc of rowCells(tr)) {
    const p = cellParagraphs(tc)[0];
    if (p) return { p, trDepth: 1 };
  }
  const p = tr.getElementsByTagNameNS(W_NS, 'p').item(0);
  if (!p) return null;
  let trDepth = 0;
  for (let cur: Node | null = p; cur; cur = cur.parentNode) {
    if (isW(cur, 'tr')) trDepth++;
    if (cur === tr) break;
  }
  return { p, trDepth };
}

/**
 * Whole-row text: each of the row's own cells' own paragraphs joined by
 * newlines, cells joined by tabs. Uses the same visible-text rule as
 * paragraph records. Content of a nested table is not part of the row text.
 */
function getRowText(tr: Element): string {
  return rowCells(tr)
    .map((tc) => cellParagraphs(tc).map(getParagraphText).join('\n'))
    .join('\t');
}

/**
 * Locate the row in a clone (accepted or rejected) by the bookmark of the
 * paragraph `firstRowParagraph` chose, climbing `trDepth` row ancestors so a
 * fallback paragraph inside a nested table still resolves to the outer row.
 * Empty when the row no longer exists in that clone.
 */
function getRowTextByBookmarkId(doc: Document, paraId: string, trDepth: number): string {
  let cur: Node | null = findParagraphByBookmarkId(doc, paraId);
  let remaining = trDepth;
  while (cur) {
    if (isW(cur, 'tr') && --remaining === 0) break;
    cur = cur.parentNode;
  }
  return cur ? getRowText(cur as Element) : '';
}

/**
 * Check if an element is nested inside w:pPr or w:rPr within the given paragraph.
 * These are paragraph-level revision markers, not content revisions.
 */
function isInsidePPrOrRPr(el: Element, paragraph: Element): boolean {
  let cur: Node | null = el.parentNode;
  while (cur && cur !== paragraph) {
    if (cur.nodeType === 1) {
      const cel = cur as Element;
      if (cel.namespaceURI === W_NS && cel.localName === 'pPr') return true;
      const parent = cel.parentNode as Element | null;
      if (cel.namespaceURI === W_NS && cel.localName === 'rPr' &&
          parent && parent.namespaceURI === W_NS && parent.localName === 'pPr') {
        return true;
      }
    }
    cur = cur.parentNode;
  }
  return false;
}

/**
 * Convert a Comment (from getComments()) to a RevisionComment.
 */
function commentToRevisionComment(c: Comment): RevisionComment {
  const rc: RevisionComment = {
    author: c.author,
    text: c.text,
    date: c.date || null,
  };
  if (c.replies.length > 0) {
    rc.replies = c.replies.map(commentToRevisionComment);
  }
  return rc;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Extract structured revision data from a document with tracked changes.
 *
 * @param doc - The original document DOM with tracked changes
 * @param comments - Comments from getComments() (with anchoredParagraphId resolved)
 * @param opts - Pagination options: offset (0-based) and limit
 */
export function extractRevisions(
  doc: Document,
  comments: Comment[],
  opts?: { offset?: number; limit?: number },
): ExtractRevisionsResult {
  const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0);
  if (!body) {
    return { changes: [], total_changes: 0, has_more: false };
  }

  // Clone DOM twice and apply accept/reject
  const acceptedDoc = doc.cloneNode(true) as Document;
  const rejectedDoc = doc.cloneNode(true) as Document;
  acceptChanges(acceptedDoc);
  rejectChanges(rejectedDoc);

  // Build comment lookup by anchoredParagraphId
  const commentsByParaId = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.anchoredParagraphId) {
      const existing = commentsByParaId.get(c.anchoredParagraphId);
      if (existing) {
        existing.push(c);
      } else {
        commentsByParaId.set(c.anchoredParagraphId, [c]);
      }
    }
  }

  const changedParagraphs: ParagraphRevision[] = [];

  // A row inserted or deleted as a whole, or a row property change, lives in
  // w:tr > w:trPr and is invisible to a per-paragraph walk. Report it as one
  // record for the row, keyed by the row's first paragraph, in document order
  // (the w:tr precedes its paragraphs, so the row record precedes theirs).
  const visitRow = (tr: Element): void => {
    const markers = rowRevisionMarkers(tr);
    if (markers.length === 0) return;

    const first = firstRowParagraph(tr);
    const paraId = first ? getParagraphBookmarkId(first.p) : null;
    if (!first || !paraId) return;

    const isInserted = markers.some((m) => m.localName === 'ins');
    const isDeleted = markers.some((m) => m.localName === 'del');
    const rowText = getRowText(tr);

    // An inserted row does not exist once rejected; a deleted row does not
    // exist once accepted. Do not look those up: the row's bookmarks leave
    // with it, so a lookup could only hit some other paragraph.
    const beforeText = isInserted ? '' : getRowTextByBookmarkId(rejectedDoc, paraId, first.trDepth);
    const afterText = isDeleted ? '' : getRowTextByBookmarkId(acceptedDoc, paraId, first.trDepth);

    const revisions = markers.map((marker) => {
      if (marker.localName === 'ins') return makeEntry(marker, 'ROW_INSERTION', rowText);
      if (marker.localName === 'del') return makeEntry(marker, 'ROW_DELETION', rowText);
      return makeEntry(marker, 'FORMAT_CHANGE', '');
    });

    // Comments are anchored to paragraphs, not rows; they stay on the
    // paragraph record so they are never reported twice.
    changedParagraphs.push({
      para_id: paraId,
      scope: 'row',
      before_text: beforeText,
      after_text: afterText,
      revisions,
      comments: [],
    });
  };

  const visitParagraph = (p: Element): void => {
    if (!paragraphHasRevisions(p)) return;

    const paraId = getParagraphBookmarkId(p);
    if (!paraId) return; // All paragraphs should have bookmarks from session resolution

    // Detect entirely-inserted/deleted paragraphs to avoid stale bookmark lookups.
    // When rejectChanges() removes an inserted paragraph, it relocates bookmarks
    // to adjacent paragraphs, which would give the wrong before_text.
    const isFullyInserted = paragraphIsEntirelyInserted(p);
    const isFullyDeleted = paragraphIsEntirelyDeleted(p);

    // Look up before_text in rejected clone by bookmark
    let beforeText: string;
    if (isFullyInserted) {
      beforeText = ''; // Didn't exist before
    } else {
      const rejectedP = findParagraphByBookmarkId(rejectedDoc, paraId);
      beforeText = rejectedP ? getParagraphText(rejectedP) : '';
    }

    // Look up after_text in accepted clone by bookmark
    let afterText: string;
    if (isFullyDeleted) {
      afterText = ''; // Doesn't exist after
    } else {
      const acceptedP = findParagraphByBookmarkId(acceptedDoc, paraId);
      afterText = acceptedP ? getParagraphText(acceptedP) : '';
    }

    // Collect revision entries
    const revisions = collectRevisionEntries(p);

    // Skip structurally-empty paragraphs with only paragraph-level markers
    // (e.g. empty inserted paragraphs from comparison engines with pPr/rPr/ins only)
    if (revisions.length === 0 && beforeText === '' && afterText === '') return;

    // Associate comments
    const paraComments = commentsByParaId.get(paraId) ?? [];
    const revisionComments = paraComments.map(commentToRevisionComment);

    changedParagraphs.push({
      para_id: paraId,
      before_text: beforeText,
      after_text: afterText,
      revisions,
      comments: revisionComments,
    });
  };

  // Pre-order walk of the original tracked DOM. This visits the same w:p
  // elements in the same order as getElementsByTagNameNS('p') did (including
  // paragraphs nested in text boxes), and additionally sees every w:tr.
  const walk = (el: Element): void => {
    if (isW(el, 'tr')) visitRow(el);
    else if (isW(el, 'p')) visitParagraph(el);
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i]!;
      if (child.nodeType === 1) walk(child as Element);
    }
  };
  walk(body);

  // Apply pagination
  const totalChanges = changedParagraphs.length;
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? totalChanges;
  const page = changedParagraphs.slice(offset, offset + limit);
  const hasMore = offset + limit < totalChanges;

  return {
    changes: page,
    total_changes: totalChanges,
    has_more: hasMore,
  };
}
