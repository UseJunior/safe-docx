/**
 * In-Place AST Modifier
 *
 * Modifies the revised document's AST in-place to add track changes markup.
 * This replaces the reconstruction-based approach with direct tree manipulation.
 */

import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { childElements, findChildByTagName } from '@usejunior/docx-core';
import { parseXml } from '@usejunior/docx-core';
import {
  allocateRevisionId,
  type RevisionIdState,
} from './revisionMarkup.js';

export {
  allocateRevisionId,
  createRevisionIdState,
  formatDate,
  seedRevisionIdsFromMarkup,
} from './revisionMarkup.js';
export type { RevisionIdState } from './revisionMarkup.js';

export const SYNTHETIC_DOC = parseXml('<root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Create a namespaced OOXML element with optional attributes.
 * Uses SYNTHETIC_DOC so elements can be adopted by any document tree.
 */
export function createEl(tag: string, attrs?: Record<string, string>): Element {
  const el = SYNTHETIC_DOC.createElementNS(W_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function findAncestorByTag(atom: ComparisonUnitAtom, tagName: string): Element | undefined {
  for (let i = atom.ancestorElements.length - 1; i >= 0; i--) {
    const el = atom.ancestorElements[i]!;
    if (el.tagName === tagName) return el;
  }
  return undefined;
}

export function attachSourceElementPointers(atoms: ComparisonUnitAtom[]): void {
  for (const atom of atoms) {
    atom.sourceRunElement = findAncestorByTag(atom, 'w:r');
    atom.sourceParagraphElement = findAncestorByTag(atom, 'w:p');
  }
}

/**
 * Get or allocate move range IDs for a move name.
 */
export function getMoveRangeIds(
  state: RevisionIdState,
  moveName: string
): { sourceRangeId: number; destRangeId: number } {
  let ids = state.moveRangeIds.get(moveName);
  if (!ids) {
    ids = {
      sourceRangeId: allocateRevisionId(state),
      destRangeId: allocateRevisionId(state),
    };
    state.moveRangeIds.set(moveName, ids);
  }
  return ids;
}

/**
 * Convert w:t elements to w:delText within an element tree.
 *
 * @param element - The element to process
 */
export function convertToDelText(element: Element): void {
  if (element.tagName === 'w:t' || element.tagName === 'w:instrText') {
    const newTag = element.tagName === 'w:t' ? 'w:delText' : 'w:delInstrText';
    const newEl = createEl(newTag);
    // Copy text content
    while (element.firstChild) newEl.appendChild(element.firstChild);
    // Copy attributes
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i]!;
      newEl.setAttribute(attr.name, attr.value);
    }
    element.parentNode?.replaceChild(newEl, element);
    return;
  }
  for (const child of childElements(element)) {
    convertToDelText(child);
  }
}

export function parentElement(node: Element): Element | null {
  const p = node.parentNode;
  return p && p.nodeType === 1 ? (p as Element) : null;
}

export function findTreeRoot(node: Element): Element {
  let current: Element = node;
  let parent = parentElement(current);
  while (parent) {
    current = parent;
    parent = parentElement(current);
  }
  return current;
}

export function findAncestor(node: Element | undefined, tagName: string): Element | undefined {
  let current: Element | null = node ?? null;
  while (current) {
    if (current.tagName === tagName) return current;
    current = parentElement(current);
  }
  return undefined;
}

export function hasAncestorTag(node: Element | undefined, tagNames: ReadonlySet<string>): boolean {
  let current: Element | null = node ? parentElement(node) : null;
  while (current) {
    if (tagNames.has(current.tagName)) {
      return true;
    }
    current = parentElement(current);
  }
  return false;
}

export function paragraphHasParaInsMarker(paragraph: Element | undefined): boolean {
  if (!paragraph || paragraph.tagName !== 'w:p') {
    return false;
  }
  const pPr = findChildByTagName(paragraph, 'w:pPr');
  if (!pPr) {
    return false;
  }
  return Array.from(pPr.getElementsByTagName('w:ins')).length > 0;
}
