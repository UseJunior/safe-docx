import { DOMParser, type Document as XmlDocument, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom';
import type { Projection } from './types.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OMIT_ON_ACCEPT = new Set(['del', 'moveFrom']);
const OMIT_ON_REJECT = new Set(['ins', 'moveTo']);
const REVISION_WRAPPERS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

function isWord(element: XmlElement, localName: string): boolean {
  return element.namespaceURI === W_NS && element.localName === localName;
}

function wordText(element: XmlElement): string {
  const value = element.textContent ?? '';
  const space = element.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space') ?? element.getAttribute('xml:space');
  return space === 'preserve' ? value : value.replace(/^[\u0009\u000a\u000d\u0020]+|[\u0009\u000a\u000d\u0020]+$/gu, '');
}

function textFrom(element: XmlElement, mode: 'accept' | 'reject', skipNestedParagraphs = false): string {
  const localName = element.localName ?? '';
  const wordRevision = element.namespaceURI === W_NS;
  if (wordRevision && ((mode === 'accept' && OMIT_ON_ACCEPT.has(localName)) || (mode === 'reject' && OMIT_ON_REJECT.has(localName)))) return '';
  if (isWord(element, 'tab')) return '\t';
  if (isWord(element, 'br') || isWord(element, 'cr')) return '\n';
  if (isWord(element, 't')) return wordText(element);
  if (isWord(element, 'delText')) return mode === 'reject' ? wordText(element) : '';
  let text = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) {
      const childElement = child as XmlElement;
      if (skipNestedParagraphs && isWord(childElement, 'p')) continue;
      text += textFrom(childElement, mode, skipNestedParagraphs);
    }
  }
  return text;
}

function parse(xml: string): XmlDocument {
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: (level, message) => { if (level !== 'warning') errors.push(message); } }).parseFromString(xml, 'application/xml');
  if (errors.length || doc.getElementsByTagName('parsererror').length) throw new Error(`Invalid word/document.xml: ${errors[0] ?? 'parser error'}`);
  return doc;
}

function directWordChild(element: XmlElement, localName: string): XmlElement | null {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1 && isWord(child as XmlElement, localName)) return child as XmlElement;
  }
  return null;
}

/**
 * Whether this physical paragraph's own mark disappears in the selected view.
 * The paragraph mark is tracked as a revision of the mark's run properties:
 * a deleted mark or a move-source mark disappears on accept, and an inserted
 * mark or a move-destination mark disappears on reject. Only the paragraph's
 * direct `w:pPr/w:rPr` is consulted, so nested text-box paragraphs never
 * contribute a mark revision to their host paragraph.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.21
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.26
 */
function paragraphMarkRemoved(paragraph: XmlElement, mode: 'accept' | 'reject'): boolean {
  const paragraphProperties = directWordChild(paragraph, 'pPr');
  const markRunProperties = paragraphProperties && directWordChild(paragraphProperties, 'rPr');
  if (!markRunProperties) return false;
  const removed = mode === 'accept' ? OMIT_ON_ACCEPT : OMIT_ON_REJECT;
  return Array.from(markRunProperties.childNodes).some((child) => child.nodeType === 1
    && (child as XmlElement).namespaceURI === W_NS && removed.has((child as XmlElement).localName ?? ''));
}

/** Block containers that terminate a paragraph-mark merge scan conservatively. */
const MERGE_SCAN_BLOCKERS = new Set(['tbl', 'sdt', 'customXml', 'altChunk']);

/**
 * The paragraph a removed paragraph mark merges into: the next `w:p` sibling
 * inside the same flow (body, table cell, or text-box content). Marker
 * siblings such as bookmarks and proofing anchors are skipped; block
 * containers stop the scan so content never merges across a table or
 * structured document tag, and the final paragraph of a flow keeps its mark.
 */
function followingParagraphInFlow(paragraph: XmlElement): XmlElement | null {
  for (let node = paragraph.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const element = node as XmlElement;
    if (isWord(element, 'p')) return element;
    if (element.namespaceURI === W_NS && MERGE_SCAN_BLOCKERS.has(element.localName ?? '')) return null;
  }
  return null;
}

/**
 * Range-markup siblings that are transparent when looking for the block
 * elements surrounding a paragraph; `w:sectPr` is included because a
 * trailing body sectPr is not a block element.
 */
const BLOCK_SIBLING_MARKERS = new Set([
  'bookmarkStart', 'bookmarkEnd',
  'commentRangeStart', 'commentRangeEnd',
  'moveFromRangeStart', 'moveFromRangeEnd',
  'moveToRangeStart', 'moveToRangeEnd',
  'customXmlInsRangeStart', 'customXmlInsRangeEnd',
  'customXmlDelRangeStart', 'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
  'permStart', 'permEnd',
  'proofErr', 'sectPr',
]);

function blockSibling(start: XmlNode | null, direction: 'previousSibling' | 'nextSibling'): XmlElement | null {
  for (let node = start; node; node = node[direction]) {
    if (node.nodeType !== 1) continue;
    const element = node as XmlElement;
    if (element.namespaceURI === W_NS && BLOCK_SIBLING_MARKERS.has(element.localName ?? '')) continue;
    return element;
  }
  return null;
}

/** Non-text run content that keeps an emptied paragraph logically present (e.g. an anchored drawing or embedded object). */
const VISIBLE_OBJECT_LOCALS = new Set(['drawing', 'pict', 'object']);

/** Whether the paragraph retains non-text visible content in the selected view. Nested text-box paragraphs are the box's own logical paragraphs and are not consulted. */
function hasVisibleObjects(element: XmlElement, mode: 'accept' | 'reject'): boolean {
  const localName = element.localName ?? '';
  if (element.namespaceURI === W_NS) {
    if ((mode === 'accept' && OMIT_ON_ACCEPT.has(localName)) || (mode === 'reject' && OMIT_ON_REJECT.has(localName))) return false;
    if (VISIBLE_OBJECT_LOCALS.has(localName)) return true;
  }
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType !== 1) continue;
    const childElement = child as XmlElement;
    if (isWord(childElement, 'p')) continue;
    if (hasVisibleObjects(childElement, mode)) return true;
  }
  return false;
}

/**
 * True iff dropping an emptied removed-mark chain keeps its parent flow
 * structurally valid for Word: the parent must retain at least one block
 * element, must not end on a `w:tbl` (a trailing table needs a following
 * paragraph), and two tables must not become adjacent. The previous block is
 * taken at the chain's first paragraph and the next block at its last, so
 * the whole chain is evaluated as the single logical paragraph it projects.
 */
function chainRemovalKeepsFlowValid(chainStart: XmlElement, chainEnd: XmlElement): boolean {
  const previous = blockSibling(chainStart.previousSibling, 'previousSibling');
  const next = blockSibling(chainEnd.nextSibling, 'nextSibling');
  if (!previous && !next) return false;
  if (previous && isWord(previous, 'tbl') && !next) return false;
  if (previous && next && isWord(previous, 'tbl') && isWord(next, 'tbl')) return false;
  return true;
}

/**
 * Projects the logical accept-all/reject-all paragraph sequence. Every
 * physical paragraph contributes its visible text, and a paragraph whose own
 * mark is removed in the selected view merges that text into the following
 * paragraph of the same flow instead of ending a logical paragraph. Merged
 * chains emit exactly one logical paragraph at the chain's first physical
 * position, so empty physical paragraphs survive only when their mark
 * survives in the selected view. A removed mark with no merge target (end of
 * flow, or blocked by a table or other block container) still dissolves its
 * paragraph when the chain has no surviving text or objects and removal
 * keeps the flow structurally valid; content-bearing chains are always kept.
 */
export function projectDocumentXml(xml: string, mode: 'accept' | 'reject'): Projection {
  const document = parse(xml);
  const physical = Array.from(document.getElementsByTagNameNS(W_NS, 'p'));
  const slotOf = new Map<XmlElement, number>();
  const logical = new Map<number, string>();
  const objectSlots = new Set<number>();
  physical.forEach((paragraph, index) => {
    const slot = slotOf.get(paragraph) ?? index;
    const text = (logical.get(slot) ?? '') + textFrom(paragraph, mode, true);
    logical.set(slot, text);
    if (text === '' && !objectSlots.has(slot) && hasVisibleObjects(paragraph, mode)) objectSlots.add(slot);
    if (!paragraphMarkRemoved(paragraph, mode)) return;
    const target = followingParagraphInFlow(paragraph);
    if (target) {
      slotOf.set(target, slot);
      return;
    }
    if (text === '' && !objectSlots.has(slot) && chainRemovalKeepsFlowValid(physical[slot]!, paragraph)) logical.delete(slot);
  });
  const paragraphs = [...logical.entries()].sort(([left], [right]) => left - right).map(([, text]) => text);
  return { paragraphs, text: paragraphs.join('\n') };
}

export interface TrackedParagraphView {
  index: number;
  acceptText: string;
  rejectText: string;
  /** Text-node boundaries are retained so revision wrappers cannot coalesce whitespace. */
  ordinaryTextNodes: string[];
}

function ordinaryTextNodes(element: XmlElement): string[] {
  const result: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current !== '') result.push(current);
    current = '';
  };
  const visit = (node: XmlElement): void => {
    if (node.namespaceURI === W_NS && REVISION_WRAPPERS.has(node.localName ?? '')) {
      // Empty/property-only revision wrappers do not separate visible text and
      // must not fragment an otherwise ordinary token or whitespace run.
      if (textFrom(node, 'accept', true) !== '' || textFrom(node, 'reject', true) !== '') flush();
      return;
    }
    if (node !== element && isWord(node, 'p')) return;
    if (isWord(node, 'tab')) current += '\t';
    else if (isWord(node, 'br') || isWord(node, 'cr')) current += '\n';
    else if (isWord(node, 't')) current += wordText(node);
    else {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 1) visit(child as XmlElement);
      }
    }
  };
  visit(element);
  flush();
  return result;
}

export function trackedParagraphViews(xml: string): TrackedParagraphView[] {
  const document = parse(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'p')).map((paragraph, index) => ({
    index,
    acceptText: textFrom(paragraph, 'accept', true),
    rejectText: textFrom(paragraph, 'reject', true),
    ordinaryTextNodes: ordinaryTextNodes(paragraph),
  }));
}

export function commentIds(xml: string, localName: string): string[] {
  const document = parse(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, localName)).map((element) => element.getAttributeNS(W_NS, 'id') ?? element.getAttribute('w:id') ?? '');
}
