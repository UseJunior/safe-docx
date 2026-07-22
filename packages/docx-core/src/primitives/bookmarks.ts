import { createHash } from 'node:crypto';
import { OOXML, W } from './namespaces.js';
import { getParagraphText } from './text.js';

export type ParagraphBookmark = {
  name: string; // _bk_{hex12}
  numericId: number; // w:id
};

const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

function sha12(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function ancestorSignature(p: Element): string {
  const parts: string[] = [];
  let cur: Element | null = p.parentElement;
  while (cur) {
    parts.push(cur.localName ?? cur.nodeName);
    // Body/document boundary is enough context.
    if (cur.namespaceURI === OOXML.W_NS && (cur.localName === W.body || cur.localName === W.document)) break;
    cur = cur.parentElement;
  }
  return parts.join('/');
}

function getW14ParaId(p: Element): string | null {
  const namespaced = p.getAttributeNS(W14_NS, 'paraId');
  if (namespaced) return namespaced.toLowerCase();

  // Fallbacks for XML libraries that may not expose namespaced attributes consistently.
  const prefixed = p.getAttribute('w14:paraId');
  if (prefixed) return prefixed.toLowerCase();
  const plain = p.getAttribute('paraId');
  if (plain) return plain.toLowerCase();
  return null;
}

function buildParagraphSeed(params: {
  paragraph: Element;
  prevText: string;
  nextText: string;
}): string {
  const { paragraph, prevText, nextText } = params;
  const intrinsic = getW14ParaId(paragraph);
  if (intrinsic) return `intrinsic:w14:${intrinsic}`;

  const text = normalizeText(getParagraphText(paragraph));
  const prev = normalizeText(prevText);
  const next = normalizeText(nextText);
  const ancestors = ancestorSignature(paragraph);
  return `fallback:text=${text}|prev=${prev}|next=${next}|ancestors=${ancestors}`;
}

function deriveDeterministicJrParaName(params: {
  paragraph: Element;
  prevText: string;
  nextText: string;
  usedNames: Set<string>;
}): string {
  const seed = buildParagraphSeed({
    paragraph: params.paragraph,
    prevText: params.prevText,
    nextText: params.nextText,
  });
  let attempt = 0;
  while (attempt < 10_000) {
    const salt = attempt === 0 ? '' : `|salt:${attempt}`;
    const candidate = `_bk_${sha12(`${seed}${salt}`)}`;
    if (!params.usedNames.has(candidate)) {
      params.usedNames.add(candidate);
      return candidate;
    }
    attempt += 1;
  }
  throw new Error('Unable to allocate deterministic _bk_ bookmark name');
}

function collectUsedJrParaNames(doc: Document): Set<string> {
  const used = new Set<string>();
  const starts = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart));
  for (const s of starts) {
    const name = getAttr(s, 'name');
    if (name && name.startsWith('_bk_')) used.add(name);
  }
  return used;
}

function getAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

function prevElementSibling(node: Node | null): Element | null {
  let cur: Node | null = node?.previousSibling ?? null;
  while (cur) {
    if (cur.nodeType === 1) return cur as Element;
    cur = cur.previousSibling;
  }
  return null;
}

function nextElementSibling(node: Node | null): Element | null {
  let cur: Node | null = node?.nextSibling ?? null;
  while (cur) {
    if (cur.nodeType === 1) return cur as Element;
    cur = cur.nextSibling;
  }
  return null;
}

function isBookmarkStart(el: Element): boolean {
  return el.namespaceURI === OOXML.W_NS && el.localName === W.bookmarkStart;
}

function isBookmarkEnd(el: Element): boolean {
  return el.namespaceURI === OOXML.W_NS && el.localName === W.bookmarkEnd;
}

function isParagraph(el: Element): boolean {
  return el.namespaceURI === OOXML.W_NS && el.localName === W.p;
}

/**
 * Document-order [enter, exit] span for every node, by pre-order walk.
 *
 * Lets us ask whether a bookmark's start..end range intersects a paragraph's
 * subtree without relying on `compareDocumentPosition` (not dependable across
 * the DOM implementations this package runs on).
 */
function buildDocumentOrderSpans(doc: Document): Map<Node, [number, number]> {
  const spans = new Map<Node, [number, number]>();
  let counter = 0;
  const walk = (node: Node): void => {
    const enter = counter++;
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children.item(i);
      if (child) walk(child);
    }
    spans.set(node, [enter, counter - 1]);
  };
  if (doc.documentElement) walk(doc.documentElement);
  return spans;
}

/**
 * Paragraphs covered by the `w:id`-paired bookmark range named `name`.
 *
 * ECMA-376 Part 1 §17.13.6.2: a bookmark is a `w:bookmarkStart`/`w:bookmarkEnd`
 * pair correlated by `w:id` — NOT by adjacency. Pairing by position is what lets
 * a zero-length "point" bookmark sitting just before a paragraph, or a heading
 * bookmark spanning several paragraphs, masquerade as that paragraph's anchor.
 * We resolve the real range and report exactly which paragraphs it intersects.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 */
function paragraphsCoveredByBookmarkName(doc: Document, name: string): Element[] {
  const starts = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart)).filter(
    (el) => getAttr(el, 'name') === name,
  );
  // A well-formed document names a bookmark once. Two starts sharing a name is
  // ambiguous; refuse to guess which one the caller meant.
  const start = starts.length === 1 ? starts[0] : undefined;
  if (!start) return [];
  const id = getAttr(start, 'id');
  if (!id) return [];

  // The same w:id must not be opened twice — pairing would be ambiguous.
  const startsWithId = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart)).filter(
    (el) => getAttr(el, 'id') === id,
  );
  if (startsWithId.length !== 1) return [];

  const ends = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkEnd)).filter(
    (el) => getAttr(el, 'id') === id,
  );
  const end = ends.length === 1 ? ends[0] : undefined;
  if (!end) return [];

  const spans = buildDocumentOrderSpans(doc);
  const startSpan = spans.get(start);
  const endSpan = spans.get(end);
  if (!startSpan || !endSpan) return [];

  // Measure the CONTENT strictly between the markers, not the markers themselves.
  // Using marker positions would let a zero-length "point" bookmark — whose start
  // and end are adjacent — intersect whatever paragraph encloses or follows it,
  // and that paragraph is not marked by the bookmark at all.
  const contentFirst = startSpan[1] + 1;
  const contentLast = endSpan[0] - 1;
  // Empty interval => a point bookmark (marks no content). Also rejects an end
  // that precedes its start, which is malformed rather than a covering range.
  if (contentFirst > contentLast) return [];

  const covered: Element[] = [];
  const paragraphs = doc.getElementsByTagNameNS(OOXML.W_NS, W.p);
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs.item(i);
    if (!p || !isParagraph(p)) continue;
    const pSpan = spans.get(p);
    if (!pSpan) continue;
    // Intersect against the paragraph's CHILDREN (pSpan[0] + 1 …), not its own
    // element position. A bookmark that closes at the very start of a paragraph
    // (start before it, end as its first child) otherwise covers only the `w:p`
    // boundary itself — no content — and would still claim the paragraph.
    if (contentFirst <= pSpan[1] && contentLast >= pSpan[0] + 1) covered.push(p);
  }
  return covered;
}

/**
 * Collect every bookmark name attached to a paragraph, in discovery order.
 *
 * Supports both attachment styles:
 *   1) sibling: `<w:bookmarkStart/> <w:p/> <w:bookmarkEnd/>`
 *   2) inside:  `<w:p><w:bookmarkStart/> ... </w:p>`
 *
 * NOTE: this is a *reporting* helper — it answers "what names sit around/inside
 * this paragraph", by adjacency. It deliberately does NOT pair start/end by
 * `w:id`, so it can include a neighbouring point bookmark or one end of a
 * multi-paragraph range. Do not use it to resolve a caller-supplied anchor;
 * `findParagraphByBookmarkId` does the id-paired, exactly-one-paragraph check.
 */
export function getParagraphBookmarkNames(p: Element): string[] {
  const names: string[] = [];

  // 1) Sibling style. Scan backward across adjacent bookmark nodes until we hit
  // another paragraph, so stacked bookmarks around one paragraph are all seen.
  const prev = prevElementSibling(p);
  const next = nextElementSibling(p);
  if (prev && next && isBookmarkEnd(next)) {
    let cur: Element | null = prev;
    while (cur) {
      if (isParagraph(cur)) break;
      if (isBookmarkStart(cur)) {
        const name = getAttr(cur, 'name');
        if (name) names.push(name);
      }
      cur = prevElementSibling(cur);
    }
  }

  // 2) Inside paragraph lookup (best-effort).
  const starts = p.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart);
  for (let i = 0; i < starts.length; i++) {
    const el = starts.item(i);
    const name = el ? getAttr(el, 'name') : null;
    if (name) names.push(name);
  }

  return names;
}

/**
 * The paragraph's canonical safe-docx id (`_bk_*`), or null when it has none.
 *
 * This intentionally stays `_bk_`-only: it is the id we *report* for a paragraph.
 * To *resolve* an anchor the caller supplied, use `findParagraphByBookmarkId`,
 * which accepts any bookmark name on the paragraph.
 */
export function getParagraphBookmarkId(p: Element): string | null {
  for (const name of getParagraphBookmarkNames(p)) {
    if (name.startsWith('_bk_')) return name;
  }
  return null;
}

export function cleanupInternalBookmarks(doc: Document): number {
  // Remove paragraph bookmarks (_bk_*) and edit span bookmarks (edit-*).
  const starts = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart));
  const ends = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkEnd));

  const idsToRemove = new Set<string>();
  for (const s of starts) {
    const name = getAttr(s, 'name') ?? '';
    if (name.startsWith('_bk_') || name.startsWith('edit-')) {
      const id = getAttr(s, 'id') ?? '';
      if (id) idsToRemove.add(id);
      s.parentNode?.removeChild(s);
    }
  }

  for (const e of ends) {
    const id = getAttr(e, 'id') ?? '';
    if (id && idsToRemove.has(id)) {
      e.parentNode?.removeChild(e);
    }
  }

  return idsToRemove.size;
}

export function insertParagraphBookmarks(doc: Document, _attachmentId: string): { indexedParagraphs: number } {
  // Insert _bk_* bookmarks around ALL paragraphs (including empty), using sibling style.
  // This avoids moving paragraphs out of tables by inserting into the paragraph's parent.

  const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.p));
  if (paragraphs.length === 0) return { indexedParagraphs: 0 };
  const usedNames = collectUsedJrParaNames(doc);

  let maxNumeric = 0;
  const existingStarts = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart));
  for (const s of existingStarts) {
    const n = getAttr(s, 'id');
    const val = n ? Number.parseInt(n, 10) : NaN;
    if (!Number.isNaN(val)) maxNumeric = Math.max(maxNumeric, val);
  }

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]!;
    if (!isParagraph(p)) continue;
    const existingName = getParagraphBookmarkId(p);
    if (existingName) {
      usedNames.add(existingName);
      continue;
    }

    const parent = p.parentNode;
    if (!parent) continue;

    const numericId = ++maxNumeric;
    const prevText = i > 0 ? getParagraphText(paragraphs[i - 1]!) : '';
    const nextText = i + 1 < paragraphs.length ? getParagraphText(paragraphs[i + 1]!) : '';
    const name = deriveDeterministicJrParaName({
      paragraph: p,
      prevText,
      nextText,
      usedNames,
    });

    const start = doc.createElementNS(OOXML.W_NS, 'w:bookmarkStart');
    start.setAttributeNS(OOXML.W_NS, 'w:id', String(numericId));
    start.setAttributeNS(OOXML.W_NS, 'w:name', name);

    const end = doc.createElementNS(OOXML.W_NS, 'w:bookmarkEnd');
    end.setAttributeNS(OOXML.W_NS, 'w:id', String(numericId));

    parent.insertBefore(start, p);
    parent.insertBefore(end, p.nextSibling);
  }

  return { indexedParagraphs: paragraphs.length };
}

export function insertSingleParagraphBookmark(doc: Document, p: Element): string {
  const parent = p.parentNode;
  if (!parent) throw new Error('Paragraph has no parent');
  const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.p));
  const idx = paragraphs.indexOf(p);
  const prevText = idx > 0 ? getParagraphText(paragraphs[idx - 1]!) : '';
  const nextText = idx >= 0 && idx + 1 < paragraphs.length ? getParagraphText(paragraphs[idx + 1]!) : '';
  const usedNames = collectUsedJrParaNames(doc);

  let maxNumeric = 0;
  const existingStarts = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart));
  for (const s of existingStarts) {
    const n = getAttr(s, 'id');
    const val = n ? Number.parseInt(n, 10) : NaN;
    if (!Number.isNaN(val)) maxNumeric = Math.max(maxNumeric, val);
  }

  const numericId = maxNumeric + 1;
  const name = deriveDeterministicJrParaName({
    paragraph: p,
    prevText,
    nextText,
    usedNames,
  });

  const start = doc.createElementNS(OOXML.W_NS, 'w:bookmarkStart');
  start.setAttributeNS(OOXML.W_NS, 'w:id', String(numericId));
  start.setAttributeNS(OOXML.W_NS, 'w:name', name);

  const end = doc.createElementNS(OOXML.W_NS, 'w:bookmarkEnd');
  end.setAttributeNS(OOXML.W_NS, 'w:id', String(numericId));

  parent.insertBefore(start, p);
  parent.insertBefore(end, p.nextSibling);

  return name;
}

/**
 * Resolve a caller-supplied anchor to its paragraph.
 *
 * Two strictly separated paths:
 *
 * 1. **Canonical `_bk_*`** — unchanged from before foreign anchors existed:
 *    the first paragraph whose reported id equals `bookmarkId`. A `_bk_*` anchor
 *    NEVER falls through to the foreign path, so widening cannot move an
 *    existing lookup (a paragraph can carry several `_bk_*` names; only the
 *    reported one may resolve it).
 *
 * 2. **Foreign name** (a host application's own stable paragraph bookmark, or a
 *    Word `_Toc*`/`_Ref*`) — accepted ONLY when the `w:id`-paired bookmark range
 *    covers exactly one paragraph. This rejects a zero-length point bookmark
 *    adjacent to a paragraph (covers none) and a heading/TOC bookmark spanning
 *    several (covers many). Both would otherwise resolve to a paragraph the
 *    bookmark does not actually mark — i.e. edit the wrong clause.
 *
 * Anything ambiguous returns null so the caller can fall back rather than guess.
 * Matching is exact on the bookmark name.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 */
export function findParagraphByBookmarkId(doc: Document, bookmarkId: string): Element | null {
  const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, W.p));

  // 1) Canonical path — byte-for-byte the pre-existing behavior.
  for (const p of paragraphs) {
    if (!isParagraph(p)) continue;
    if (getParagraphBookmarkId(p) === bookmarkId) return p;
  }
  if (bookmarkId.startsWith('_bk_')) return null;

  // 2) Foreign path — qualified by the real, id-paired range.
  const covered = paragraphsCoveredByBookmarkName(doc, bookmarkId);
  return covered.length === 1 ? (covered[0] ?? null) : null;
}
