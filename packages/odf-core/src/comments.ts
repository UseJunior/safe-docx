/**
 * ODF comment (`office:annotation`) read/write over a parsed `content.xml` DOM.
 *
 * ODF comments are inline: an `office:annotation` (carrying `dc:creator`, `dc:date`, and a
 * `text:p` body) marks the anchor point, and a paired `office:annotation-end` (same
 * `office:name`) closes a ranged comment. There is no separate comments part.
 *
 * Two insertion paths (a deliberate split — see the `add-odf-comments` design notes):
 *  - whole-paragraph: structural (annotation as the block's first inline child, end after its
 *    last), independent of text segmentation — robust to spans/spaces/tabs/multiple text nodes;
 *  - ranged: split a single host `#text` node at the visible `[start,end)` offsets; a match that
 *    crosses node boundaries returns `MATCH_SPANS_MULTIPLE_NODES`.
 *
 * All element matching is by `namespaceURI` + `localName` (ODF prefixes are not guaranteed).
 */

import { ODF_NS } from './shared/odf/namespaces.js';
import { ELEMENT_NODE, buildSegments } from './shared/odf/text_segments.js';

/** A comment read back from the document. */
export type OdfComment = {
  id: number;
  author: string;
  date: string | null;
  initials: string;
  text: string;
  anchoredParagraphId: string | null;
};

export type AddAnnotationParams = {
  /** Visible offset of the range start; omit (with `end`) to bracket the whole paragraph. */
  start?: number;
  /** Visible offset of the range end (exclusive). */
  end?: number;
  author: string;
  text: string;
  initials?: string;
};

export type AddAnnotationResult =
  | { ok: true; commentId: number; name: string }
  | { ok: false; code: 'MATCH_SPANS_MULTIPLE_NODES' | 'INVALID_RANGE'; message: string };

const ANNOT_NAME_RE = /^__Annot__(\d+)$/;

function attrNS(el: Element, ns: string, local: string, prefixed: string): string | null {
  return el.getAttributeNS(ns, local) ?? el.getAttribute(prefixed);
}

/** ODF `dc:date` value: ISO 8601 local-ish, no fractional seconds or trailing `Z`. */
function nowOdfDate(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

/** Collect every existing `office:name` value (on annotations and annotation-ends) in the doc. */
function existingAnnotationNames(doc: Document): Set<string> {
  const names = new Set<string>();
  for (const local of ['annotation', 'annotation-end']) {
    const els = doc.getElementsByTagNameNS(ODF_NS.OFFICE, local);
    for (let i = 0; i < els.length; i++) {
      const name = attrNS(els[i] as Element, ODF_NS.OFFICE, 'name', 'office:name');
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Allocate `{ id, name }` for a new annotation, in the SAME id space `readAnnotations` derives.
 * `readAnnotations` assigns parsed `__Annot__<n>` suffixes, then hands every annotation whose name
 * does NOT match that pattern a synthetic id starting at `maxParsed + 1`. So the next free id must
 * clear both: `maxParsed + (count of non-matching annotation elements) + 1`. Still guard against a
 * literal `office:name` collision. This keeps the returned `commentId` from coinciding with the
 * synthetic id a custom-named (e.g. LibreOffice) annotation would otherwise receive.
 */
function allocateName(doc: Document): { id: number; name: string } {
  const names = existingAnnotationNames(doc);
  let maxParsed = 0;
  let nonMatching = 0;
  const annots = doc.getElementsByTagNameNS(ODF_NS.OFFICE, 'annotation');
  for (let i = 0; i < annots.length; i++) {
    const name = attrNS(annots[i] as Element, ODF_NS.OFFICE, 'name', 'office:name');
    const m = name ? ANNOT_NAME_RE.exec(name) : null;
    if (m) maxParsed = Math.max(maxParsed, Number.parseInt(m[1]!, 10));
    else nonMatching += 1;
  }
  let id = maxParsed + nonMatching + 1;
  while (names.has(`__Annot__${id}`)) id += 1;
  return { id, name: `__Annot__${id}` };
}

function makeAnnotation(doc: Document, name: string, params: AddAnnotationParams): Element {
  const annot = doc.createElementNS(ODF_NS.OFFICE, 'office:annotation');
  annot.setAttributeNS(ODF_NS.OFFICE, 'office:name', name);
  const creator = doc.createElementNS(ODF_NS.DC, 'dc:creator');
  creator.appendChild(doc.createTextNode(params.author));
  annot.appendChild(creator);
  const date = doc.createElementNS(ODF_NS.DC, 'dc:date');
  date.appendChild(doc.createTextNode(nowOdfDate()));
  annot.appendChild(date);
  // Body: blank lines split into separate `text:p`; single newlines become `text:line-break`
  // (parity with insertParagraph). A literal `\n` in one text node would otherwise render as a
  // space in LibreOffice and round-trip lossily through getComments.
  const blockTexts = params.text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const blockText of blockTexts) {
    const body = doc.createElementNS(ODF_NS.TEXT, 'text:p');
    blockText.split('\n').forEach((line, i) => {
      if (i > 0) body.appendChild(doc.createElementNS(ODF_NS.TEXT, 'text:line-break'));
      if (line.length > 0) body.appendChild(doc.createTextNode(line));
    });
    annot.appendChild(body);
  }
  return annot;
}

function makeAnnotationEnd(doc: Document, name: string): Element {
  const end = doc.createElementNS(ODF_NS.OFFICE, 'office:annotation-end');
  end.setAttributeNS(ODF_NS.OFFICE, 'office:name', name);
  return end;
}

/**
 * Insert an annotation on `block`. With no `start`/`end` the whole paragraph is bracketed; with a
 * range, a single host `#text` node is split. Returns the allocated comment id, or
 * `MATCH_SPANS_MULTIPLE_NODES` if a ranged match crosses node boundaries.
 */
export function addAnnotation(doc: Document, block: Element, params: AddAnnotationParams): AddAnnotationResult {
  const hasStart = params.start != null;
  const hasEnd = params.end != null;
  // A range is all-or-nothing; a one-sided range is a caller error, not a whole-paragraph comment.
  if (hasStart !== hasEnd) {
    return {
      ok: false,
      code: 'INVALID_RANGE',
      message: 'A ranged comment requires both start and end; provide neither for a whole-paragraph comment.',
    };
  }
  const ranged = hasStart && hasEnd;

  if (!ranged) {
    // Whole-paragraph: structural bracket, independent of text segmentation.
    const { id, name } = allocateName(doc);
    const annot = makeAnnotation(doc, name, params);
    if (!block.firstChild) {
      // Empty paragraph → a single point annotation (no end marker).
      block.appendChild(annot);
    } else {
      block.insertBefore(annot, block.firstChild);
      block.appendChild(makeAnnotationEnd(doc, name));
    }
    return { ok: true, commentId: id, name };
  }

  const start = params.start!;
  const end = params.end!;
  const { segments, visible } = buildSegments(block);
  // Fail closed on a malformed range before mutating the DOM (reversed/oob ranges duplicate text).
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > visible.length) {
    return {
      ok: false,
      code: 'INVALID_RANGE',
      message: `Invalid annotation range [${start}, ${end}) for a paragraph of visible length ${visible.length}.`,
    };
  }
  const { id, name } = allocateName(doc);
  const annot = makeAnnotation(doc, name, params);
  const host = segments.find(
    (seg) => seg.kind === 'text' && start >= seg.visStart && end <= seg.visStart + seg.length,
  );
  if (!host || host.kind !== 'text') {
    return {
      ok: false,
      code: 'MATCH_SPANS_MULTIPLE_NODES',
      message:
        `Annotation range [${start}, ${end}) in this paragraph crosses node boundaries ` +
        `(spans, spaces, or tabs). Ranged comments must lie within a single text run.`,
    };
  }

  // `host.node` is the live DOM text node (typed loosely by buildSegments).
  const textNode = host.node as unknown as Node & { data: string };
  const parent = textNode.parentNode!;
  const next = textNode.nextSibling;
  const localStart = start - host.visStart;
  const localEnd = end - host.visStart;
  const data = textNode.data;
  const mid = data.slice(localStart, localEnd);
  const after = data.slice(localEnd);

  // Keep the leading slice in the original node; insert annotation, middle text, end, trailing text.
  textNode.data = data.slice(0, localStart);
  parent.insertBefore(annot, next);
  if (mid.length > 0) parent.insertBefore(doc.createTextNode(mid), next);
  parent.insertBefore(makeAnnotationEnd(doc, name), next);
  if (after.length > 0) parent.insertBefore(doc.createTextNode(after), next);

  return { ok: true, commentId: id, name };
}

/**
 * Visible text of an annotation body (its child `text:p` elements, joined by newlines). Uses
 * `buildSegments` rather than `textContent` so `text:line-break` → `\n` and `text:s` → spaces are
 * preserved (a LibreOffice multi-line comment round-trips instead of collapsing to one line).
 */
function annotationBodyText(annot: Element): string {
  const parts: string[] = [];
  for (let child = annot.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    const el = child as Element;
    if (el.namespaceURI === ODF_NS.TEXT && el.localName === 'p') {
      parts.push(buildSegments(el).visible);
    }
  }
  return parts.join('\n');
}

function childText(el: Element, ns: string, local: string): string | null {
  for (let child = el.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    const c = child as Element;
    if (c.namespaceURI === ns && c.localName === local) return c.textContent ?? '';
  }
  return null;
}

/**
 * Read every `office:annotation` across `blocks` (document order) into structured comments.
 * Numeric ids are parsed from `__Annot__<n>` names; annotations whose names don't match the
 * convention are assigned ids sequentially after the max parsed value (a documented limitation).
 */
export function readAnnotations(blocks: Element[]): OdfComment[] {
  type Raw = { parsedId: number | null; author: string; date: string | null; text: string; anchor: string };
  const raw: Raw[] = [];
  let maxParsed = 0;

  blocks.forEach((block, i) => {
    const annots = block.getElementsByTagNameNS(ODF_NS.OFFICE, 'annotation');
    for (let a = 0; a < annots.length; a++) {
      const annot = annots[a] as Element;
      const name = attrNS(annot, ODF_NS.OFFICE, 'name', 'office:name');
      const m = name ? ANNOT_NAME_RE.exec(name) : null;
      const parsedId = m ? Number.parseInt(m[1]!, 10) : null;
      if (parsedId != null) maxParsed = Math.max(maxParsed, parsedId);
      raw.push({
        parsedId,
        author: childText(annot, ODF_NS.DC, 'creator') ?? '',
        date: childText(annot, ODF_NS.DC, 'date'),
        text: annotationBodyText(annot),
        anchor: `p${i}`,
      });
    }
  });

  let next = maxParsed + 1;
  return raw.map((r) => ({
    id: r.parsedId ?? next++,
    author: r.author,
    date: r.date,
    initials: '',
    text: r.text,
    anchoredParagraphId: r.anchor,
  }));
}
