/**
 * XML to WmlElement Parser
 *
 * Parses document.xml into a WmlElement tree structure suitable for atomization.
 * Uses fast-xml-parser with preserveOrder to maintain document order.
 */

import { XMLParser } from 'fast-xml-parser';
import type { WmlElement } from '../../core-types.js';

/** Parser options for fast-xml-parser */
const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  textNodeName: '#text',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
};

/**
 * Parse document.xml string into a WmlElement tree.
 *
 * @param xml - The raw document.xml content
 * @returns Root WmlElement representing the document
 */
export function parseDocumentXml(xml: string): WmlElement {
  const parser = new XMLParser(PARSER_OPTIONS);
  const parsed = parser.parse(xml);

  // Convert the fast-xml-parser output to WmlElement tree
  const root = convertToWmlElement(parsed);

  // Backfill parent references
  backfillParentReferences(root);

  return root;
}

/**
 * Convert fast-xml-parser output (preserveOrder format) to WmlElement.
 *
 * The preserveOrder format produces arrays of objects where each object
 * has a single key (the tag name) and optionally :@ for attributes.
 */
function convertToWmlElement(node: unknown): WmlElement {
  if (Array.isArray(node)) {
    // Create a root wrapper for the array
    return {
      tagName: '#document',
      attributes: {},
      children: node.map((item) => convertToWmlElement(item)).filter(Boolean),
    };
  }

  if (!node || typeof node !== 'object') {
    return { tagName: '#unknown', attributes: {} };
  }

  const nodeObj = node as Record<string, unknown>;

  // Find the tag name (the key that's not :@ or #text or @_prefixed)
  let tagName = '#unknown';
  let content: unknown = null;

  for (const key of Object.keys(nodeObj)) {
    if (!key.startsWith('@_') && key !== '#text' && key !== ':@') {
      tagName = key;
      content = nodeObj[key];
      break;
    }
  }

  // Extract attributes from :@
  const attributes: Record<string, string> = {};
  const attrsObj = nodeObj[':@'] as Record<string, unknown> | undefined;
  if (attrsObj) {
    for (const [key, value] of Object.entries(attrsObj)) {
      if (key.startsWith('@_')) {
        attributes[key.slice(2)] = String(value);
      }
    }
  }

  // Process children and text content
  const children: WmlElement[] = [];
  let textContent: string | undefined;

  if (Array.isArray(content)) {
    for (const child of content) {
      if (child && typeof child === 'object') {
        const childObj = child as Record<string, unknown>;
        if ('#text' in childObj) {
          // Text node
          textContent = String(childObj['#text']);
        } else {
          // Child element
          children.push(convertToWmlElement(child));
        }
      }
    }
  } else if (content && typeof content === 'object') {
    const contentObj = content as Record<string, unknown>;
    if ('#text' in contentObj) {
      textContent = String(contentObj['#text']);
    }
  }

  const element: WmlElement = {
    tagName,
    attributes,
  };

  if (children.length > 0) {
    element.children = children;
  }

  if (textContent !== undefined) {
    element.textContent = textContent;
  }

  return element;
}

/**
 * Backfill parent references in a WmlElement tree.
 *
 * @param node - The current node
 * @param parent - The parent node (undefined for root)
 */
export function backfillParentReferences(
  node: WmlElement,
  parent?: WmlElement
): void {
  node.parent = parent;
  if (node.children) {
    for (const child of node.children) {
      backfillParentReferences(child, node);
    }
  }
}

/**
 * Find the w:body element in the document tree.
 *
 * @param root - The document root element
 * @returns The w:body element, or undefined if not found
 */
export function findBody(root: WmlElement): WmlElement | undefined {
  return findElement(root, 'w:body');
}

/**
 * Find the w:document element in the document tree.
 *
 * @param root - The document root element
 * @returns The w:document element, or undefined if not found
 */
export function findDocument(root: WmlElement): WmlElement | undefined {
  return findElement(root, 'w:document');
}

/**
 * Find an element by tag name in the tree.
 *
 * @param node - The node to search from
 * @param tagName - The tag name to find
 * @returns The found element, or undefined
 */
export function findElement(
  node: WmlElement,
  tagName: string
): WmlElement | undefined {
  if (node.tagName === tagName) {
    return node;
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findElement(child, tagName);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

/**
 * Find all elements with a specific tag name.
 *
 * @param node - The node to search from
 * @param tagName - The tag name to find
 * @returns Array of matching elements
 */
export function findAllElements(
  node: WmlElement,
  tagName: string
): WmlElement[] {
  const results: WmlElement[] = [];

  if (node.tagName === tagName) {
    results.push(node);
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...findAllElements(child, tagName));
    }
  }

  return results;
}

/**
 * Serialize a WmlElement back to XML string.
 *
 * @param element - The element to serialize
 * @param indent - Current indentation level (for pretty printing)
 * @returns XML string
 */
export function serializeToXml(element: WmlElement, indent = ''): string {
  if (element.tagName === '#document') {
    // Root wrapper - just serialize children
    return element.children?.map((c) => serializeToXml(c, indent)).join('') ?? '';
  }

  if (element.tagName === '#unknown') {
    return '';
  }

  // Handle XML processing instructions (e.g., <?xml version="1.0"?>)
  if (element.tagName.startsWith('?')) {
    const piName = element.tagName.slice(1); // Remove leading ?
    const attrs = Object.entries(element.attributes)
      .map(([key, value]) => `${key}="${escapeXml(value)}"`)
      .join(' ');
    return attrs ? `<?${piName} ${attrs}?>` : `<?${piName}?>`;
  }

  // Build opening tag with attributes
  const attrs = Object.entries(element.attributes)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ');

  const openTag = attrs ? `<${element.tagName} ${attrs}>` : `<${element.tagName}>`;
  const closeTag = `</${element.tagName}>`;

  // Self-closing for elements with no content
  if (!element.children?.length && element.textContent === undefined) {
    return attrs
      ? `<${element.tagName} ${attrs}/>`
      : `<${element.tagName}/>`;
  }

  // Build content
  let content = '';

  if (element.textContent !== undefined) {
    content = escapeXml(element.textContent);
  }

  if (element.children?.length) {
    content = element.children.map((c) => serializeToXml(c, '')).join('');
  }

  return `${openTag}${content}${closeTag}`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Clone a WmlElement tree (deep copy without parent references).
 *
 * @param element - The element to clone
 * @returns A deep copy of the element
 */
export function cloneElement(element: WmlElement): WmlElement {
  const clone: WmlElement = {
    tagName: element.tagName,
    attributes: { ...element.attributes },
  };

  if (element.textContent !== undefined) {
    clone.textContent = element.textContent;
  }

  if (element.children) {
    clone.children = element.children.map((c) => cloneElement(c));
  }

  return clone;
}
