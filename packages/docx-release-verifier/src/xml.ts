import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';
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

function textFrom(element: XmlElement, mode: 'accept' | 'reject'): string {
  const localName = element.localName ?? '';
  if ((mode === 'accept' && OMIT_ON_ACCEPT.has(localName)) || (mode === 'reject' && OMIT_ON_REJECT.has(localName))) return '';
  if (isWord(element, 'tab')) return '\t';
  if (isWord(element, 'br') || isWord(element, 'cr')) return '\n';
  if (isWord(element, 't')) return wordText(element);
  if (isWord(element, 'delText')) return mode === 'reject' ? wordText(element) : '';
  let text = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) text += textFrom(child as XmlElement, mode);
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
      if (textFrom(node, 'accept') !== '' || textFrom(node, 'reject') !== '') flush();
      return;
    }
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
    acceptText: textFrom(paragraph, 'accept'),
    rejectText: textFrom(paragraph, 'reject'),
    ordinaryTextNodes: ordinaryTextNodes(paragraph),
  }));
}

export function commentIds(xml: string, localName: string): string[] {
  const document = parse(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, localName)).map((element) => element.getAttributeNS(W_NS, 'id') ?? element.getAttribute('w:id') ?? '');
}
