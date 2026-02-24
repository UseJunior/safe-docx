/**
 * DOM Test Helpers
 *
 * Utilities for creating real DOM Element objects in tests.
 * Replaces the old WmlElement POJO pattern with actual xmldom Elements.
 */

import { DOMParser } from '@xmldom/xmldom';
import { childElements } from '../primitives/index.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Shared Document instance for creating elements in tests.
 * Using a single document avoids cross-document adoption issues.
 */
export const testDoc = new DOMParser().parseFromString(
  '<root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
  'application/xml',
);

/**
 * Create a DOM Element for testing.
 *
 * Replaces the old WmlElement POJO pattern:
 *   { tagName: 'w:t', attributes: { 'xml:space': 'preserve' }, textContent: 'hello' }
 *
 * With:
 *   el('w:t', { 'xml:space': 'preserve' }, undefined, 'hello')
 *
 * @param tagName - Full qualified tag name (e.g., 'w:t', 'w:r', 'w:p')
 * @param attrs - Attributes to set (default: {})
 * @param children - Child elements to append
 * @param textContent - Text content to set (creates a text node)
 * @returns A real DOM Element
 */
export function el(
  tagName: string,
  attrs: Record<string, string> = {},
  children?: Element[],
  textContent?: string,
): Element {
  const element = testDoc.createElementNS(W_NS, tagName);
  for (const [k, v] of Object.entries(attrs)) {
    element.setAttribute(k, v);
  }
  if (textContent !== undefined) {
    element.appendChild(testDoc.createTextNode(textContent));
  }
  if (children) {
    for (const child of children) {
      element.appendChild(child);
    }
  }
  return element;
}

/**
 * Build a tree from nested el() calls and return the root.
 * Alias for el() — use for readability when creating tree roots.
 */
export const tree = el;

/**
 * Get element children count (convenience for tests replacing .children.length).
 */
export function childCount(element: Element): number {
  return childElements(element).length;
}
