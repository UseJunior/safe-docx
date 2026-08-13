import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';
import type { Projection } from './types.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OMIT_ON_ACCEPT = new Set(['del', 'moveFrom']);
const OMIT_ON_REJECT = new Set(['ins', 'moveTo']);
const REVISION_WRAPPERS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

function isWord(element: XmlElement, localName: string): boolean {
  return element.namespaceURI === W_NS && element.localName === localName;
}

function textFrom(element: XmlElement, mode: 'accept' | 'reject'): string {
  const localName = element.localName ?? '';
  if ((mode === 'accept' && OMIT_ON_ACCEPT.has(localName)) || (mode === 'reject' && OMIT_ON_REJECT.has(localName))) return '';
  if (isWord(element, 'tab')) return '\t';
  if (isWord(element, 'br') || isWord(element, 'cr')) return '\n';
  let text = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue ?? '';
    else if (child.nodeType === 1) text += textFrom(child as XmlElement, mode);
  }
  return text;
}

function parse(xml: string): XmlDocument {
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: (level, message) => { if (level !== 'warning') errors.push(message); } }).parseFromString(xml, 'application/xml');
  if (errors.length || doc.getElementsByTagName('parsererror').length) throw new Error(`Invalid word/document.xml: ${errors[0] ?? 'parser error'}`);
  return doc;
}

export function projectDocumentXml(xml: string, mode: 'accept' | 'reject'): Projection {
  const document = parse(xml);
  const paragraphs = Array.from(document.getElementsByTagNameNS(W_NS, 'p')).map((paragraph) => textFrom(paragraph, mode));
  return { paragraphs, text: paragraphs.join('\n') };
}

export interface TrackedParagraphView {
  index: number;
  acceptText: string;
  rejectText: string;
  /** Text-node boundaries are retained so revision wrappers cannot coalesce whitespace. */
  ordinaryTextNodes: string[];
}

function ordinaryTextNodes(element: XmlElement, insideRevision = false): string[] {
  const revision = insideRevision || (element.namespaceURI === W_NS && REVISION_WRAPPERS.has(element.localName ?? ''));
  if (revision) return [];
  if (isWord(element, 'tab')) return ['\t'];
  if (isWord(element, 'br') || isWord(element, 'cr')) return ['\n'];
  if (isWord(element, 't')) return [element.textContent ?? ''];
  const result: string[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) result.push(...ordinaryTextNodes(child as XmlElement, revision));
  }
  return result;
}

export function trackedParagraphViews(xml: string): TrackedParagraphView[] {
  const document = parse(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'p')).map((paragraph, index) => ({
    index,
    acceptText: textFrom(paragraph, 'accept'),
    rejectText: textFrom(paragraph, 'reject'),
    ordinaryTextNodes: ordinaryTextNodes(paragraph),
  }));
}

export function commentIds(xml: string, localName: string): string[] {
  const document = parse(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, localName)).map((element) => element.getAttributeNS(W_NS, 'id') ?? element.getAttribute('w:id') ?? '');
}
