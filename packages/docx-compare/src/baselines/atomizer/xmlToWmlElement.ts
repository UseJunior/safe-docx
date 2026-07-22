/**
 * XML Parsing and Serialization
 *
 * Parses document.xml into a DOM tree using @xmldom/xmldom.
 * Replaces the former fast-xml-parser + WmlElement POJO approach.
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { OOXML, parseXml } from '@usejunior/docx-core';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

function cloneWithCanonicalWordPrefix(node: Node, target: Document): Node {
  if (node.nodeType !== 1) return node.cloneNode(false);

  const source = node as Element;
  const qualifiedName = source.namespaceURI === OOXML.W_NS
    ? `w:${source.localName}`
    : source.tagName;
  const copy = target.createElementNS(source.namespaceURI, qualifiedName);

  for (let index = 0; index < source.attributes.length; index++) {
    const attribute = source.attributes.item(index)!;
    if (attribute.namespaceURI === XMLNS_NS && attribute.localName === 'w') continue;
    const attributeName = attribute.namespaceURI === OOXML.W_NS
      ? `w:${attribute.localName}`
      : attribute.name;
    copy.setAttributeNS(attribute.namespaceURI, attributeName, attribute.value);
  }
  for (let child = source.firstChild; child; child = child.nextSibling) {
    copy.appendChild(cloneWithCanonicalWordPrefix(child, target));
  }
  return copy;
}

/**
 * Normalize namespace-equivalent WordprocessingML prefixes before the legacy
 * atomizer and reconstructors consume their preferred `w:` lexical spelling.
 */
export function canonicalizeWordprocessingPrefixes(xml: string): string {
  const doc = parseXml(xml);
  const wordElements = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, '*')) as Element[];
  const needsCanonicalPrefix = wordElements.some((element) =>
    element.prefix !== 'w' || Array.from(element.attributes).some(
      (attribute) => attribute.namespaceURI === OOXML.W_NS && attribute.prefix !== 'w',
    ),
  );
  if (!needsCanonicalPrefix) return xml;

  const replacement = cloneWithCanonicalWordPrefix(doc.documentElement, doc) as Element;
  replacement.setAttributeNS(XMLNS_NS, 'xmlns:w', OOXML.W_NS);
  doc.replaceChild(replacement, doc.documentElement);
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Parse document.xml string into a DOM Element tree.
 *
 * @param xml - The raw document.xml content
 * @returns Root element (the Document's documentElement)
 */
export function parseDocumentXml(xml: string): Element {
  const doc = parseXml(canonicalizeWordprocessingPrefixes(xml));
  return doc.documentElement;
}

/**
 * Find the w:body element in the document tree.
 *
 * @param root - The document root element
 * @returns The w:body element, or undefined if not found
 */
export function findBody(root: Element): Element | undefined {
  const bodies = root.getElementsByTagName('w:body');
  return bodies.length > 0 ? (bodies[0] as Element) : undefined;
}

/**
 * Find the w:document element in the document tree.
 *
 * @param root - The document root element
 * @returns The w:document element, or undefined if not found
 */
export function findDocument(root: Element): Element | undefined {
  if (root.tagName === 'w:document') return root;
  const docs = root.getElementsByTagName('w:document');
  return docs.length > 0 ? (docs[0] as Element) : undefined;
}

/**
 * Find an element by tag name in the tree.
 *
 * @param node - The node to search from
 * @param tagName - The tag name to find
 * @returns The found element, or undefined
 */
export function findElement(
  node: Element,
  tagName: string,
): Element | undefined {
  if (node.tagName === tagName) return node;
  const results = node.getElementsByTagName(tagName);
  return results.length > 0 ? (results[0] as Element) : undefined;
}

/**
 * Find all elements with a specific tag name.
 *
 * @param node - The node to search from
 * @param tagName - The tag name to find
 * @returns Array of matching elements
 */
export function findAllElements(
  node: Element,
  tagName: string,
): Element[] {
  const nodeList = node.getElementsByTagName(tagName);
  const result: Element[] = [];
  for (let i = 0; i < nodeList.length; i++) {
    result.push(nodeList[i] as Element);
  }
  return result;
}

/**
 * Serialize a DOM Element back to XML string.
 *
 * @param element - The element to serialize
 * @returns XML string
 */
export function serializeToXml(element: Element | Document): string {
  return new XMLSerializer().serializeToString(element);
}

/**
 * Clone a DOM Element tree (deep copy).
 *
 * @param element - The element to clone
 * @returns A deep copy of the element
 */
export function cloneElement(element: Element): Element {
  return element.cloneNode(true) as Element;
}

/**
 * Backfill parent references — NO-OP for DOM Elements.
 *
 * DOM Elements have native parentNode/parentElement. This function exists
 * only to ease migration; callers should remove it over time.
 */
export function backfillParentReferences(
  _node: Element,
  _parent?: Element,
): void {
  // No-op: DOM Elements have native parentNode
}
