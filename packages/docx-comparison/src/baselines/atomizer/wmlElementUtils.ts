/**
 * WmlElement Manipulation Utilities
 *
 * AST-based utilities for manipulating WmlElement trees.
 * Replaces fragile regex-based XML manipulation.
 */

import type { WmlElement } from '../../core-types.js';

/**
 * Create a new WmlElement node.
 */
export function createElement(
  tagName: string,
  attributes: Record<string, string> = {},
  children?: WmlElement[],
  textContent?: string
): WmlElement {
  const el: WmlElement = { tagName, attributes: { ...attributes } };
  if (textContent !== undefined) el.textContent = textContent;
  if (children) {
    el.children = children;
    for (const c of children) c.parent = el;
  }
  return el;
}

/**
 * Remove a child element from its parent.
 *
 * @param parent - The parent element
 * @param child - The child to remove
 * @returns true if the child was found and removed, false otherwise
 */
export function removeChild(parent: WmlElement, child: WmlElement): boolean {
  if (!parent.children) {
    return false;
  }

  const index = parent.children.indexOf(child);
  if (index === -1) {
    return false;
  }

  parent.children.splice(index, 1);
  child.parent = undefined;
  return true;
}

/**
 * Remove all descendant elements matching a tag name.
 *
 * Recursively traverses the tree and removes all elements with the specified tag.
 * Children of removed elements are also removed (not preserved).
 *
 * @param root - The root element to search from
 * @param tagName - The tag name to match
 * @returns The number of elements removed
 */
export function removeAllByTagName(root: WmlElement, tagName: string): number {
  let count = 0;

  // Collect elements to remove first (avoid modifying while iterating)
  const toRemove = findAllByTagName(root, tagName);

  for (const element of toRemove) {
    if (element.parent) {
      if (removeChild(element.parent, element)) {
        count++;
      }
    }
  }

  return count;
}

/**
 * Unwrap an element - replace it with its children in the parent.
 *
 * The element is removed and its children take its place in the parent's children array.
 *
 * @param element - The element to unwrap
 * @returns true if the element was unwrapped, false if it has no parent
 */
export function unwrapElement(element: WmlElement): boolean {
  const parent = element.parent;
  if (!parent || !parent.children) {
    return false;
  }

  const index = parent.children.indexOf(element);
  if (index === -1) {
    return false;
  }

  // Get the children to insert (default to empty array)
  const childrenToInsert = element.children ?? [];

  // Update parent references for children
  for (const child of childrenToInsert) {
    child.parent = parent;
  }

  // Replace the element with its children
  parent.children.splice(index, 1, ...childrenToInsert);

  // Clear the removed element's parent reference
  element.parent = undefined;

  return true;
}

/**
 * Unwrap all elements matching a tag name throughout the tree.
 *
 * Each matched element is replaced with its children in place.
 * This is done from deepest to shallowest to handle nested elements correctly.
 *
 * @param root - The root element to search from
 * @param tagName - The tag name to match
 * @returns The number of elements unwrapped
 */
export function unwrapAllByTagName(root: WmlElement, tagName: string): number {
  let count = 0;

  // Find all matching elements
  const elements = findAllByTagName(root, tagName);

  // Sort by depth (deepest first) to handle nesting correctly
  // Deeper elements have longer ancestor chains
  const sorted = elements.sort((a, b) => {
    const depthA = getDepth(a);
    const depthB = getDepth(b);
    return depthB - depthA; // Deepest first
  });

  for (const element of sorted) {
    if (unwrapElement(element)) {
      count++;
    }
  }

  return count;
}

/**
 * Rename an element's tag.
 *
 * @param element - The element to rename
 * @param newTagName - The new tag name
 */
export function renameElement(element: WmlElement, newTagName: string): void {
  element.tagName = newTagName;
}

/**
 * Find all elements matching a tag name.
 *
 * @param root - The root element to search from
 * @param tagName - The tag name to find
 * @returns Array of matching elements
 */
export function findAllByTagName(
  root: WmlElement,
  tagName: string
): WmlElement[] {
  const results: WmlElement[] = [];

  function traverse(node: WmlElement): void {
    if (node.tagName === tagName) {
      results.push(node);
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return results;
}

/**
 * Find the first element matching a tag name.
 *
 * @param root - The root element to search from
 * @param tagName - The tag name to find
 * @returns The first matching element, or undefined
 */
export function findByTagName(
  root: WmlElement,
  tagName: string
): WmlElement | undefined {
  if (root.tagName === tagName) {
    return root;
  }

  if (root.children) {
    for (const child of root.children) {
      const found = findByTagName(child, tagName);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

/**
 * Clear all children from an element.
 *
 * @param element - The element to clear
 */
export function clearChildren(element: WmlElement): void {
  if (element.children) {
    for (const child of element.children) {
      child.parent = undefined;
    }
    element.children = [];
  }
}

/**
 * Append a child element to a parent.
 *
 * @param parent - The parent element
 * @param child - The child to append
 */
export function appendChild(parent: WmlElement, child: WmlElement): void {
  if (!parent.children) {
    parent.children = [];
  }
  child.parent = parent;
  parent.children.push(child);
}

/**
 * Prepend a child element to a parent.
 */
export function prependChild(parent: WmlElement, child: WmlElement): void {
  if (!parent.children) parent.children = [];
  child.parent = parent;
  parent.children.unshift(child);
}

/**
 * Insert a child element at a specific index.
 *
 * @param parent - The parent element
 * @param child - The child to insert
 * @param index - The index to insert at
 */
export function insertChildAt(
  parent: WmlElement,
  child: WmlElement,
  index: number
): void {
  if (!parent.children) {
    parent.children = [];
  }
  child.parent = parent;
  parent.children.splice(index, 0, child);
}

/**
 * Insert a sibling before a reference element.
 */
export function insertBeforeElement(
  reference: WmlElement,
  newElement: WmlElement
): boolean {
  const parent = reference.parent;
  if (!parent || !parent.children) return false;
  const idx = parent.children.indexOf(reference);
  if (idx === -1) return false;
  newElement.parent = parent;
  parent.children.splice(idx, 0, newElement);
  return true;
}

/**
 * Insert a sibling after a reference element.
 */
export function insertAfterElement(
  reference: WmlElement,
  newElement: WmlElement
): boolean {
  const parent = reference.parent;
  if (!parent || !parent.children) return false;
  const idx = parent.children.indexOf(reference);
  if (idx === -1) return false;
  newElement.parent = parent;
  parent.children.splice(idx + 1, 0, newElement);
  return true;
}

/**
 * Wrap an element in a wrapper element (as a sibling replacement).
 *
 * Returns false if the target has no parent.
 */
export function wrapElement(target: WmlElement, wrapper: WmlElement): boolean {
  const parent = target.parent;
  if (!parent || !parent.children) return false;
  const idx = parent.children.indexOf(target);
  if (idx === -1) return false;

  wrapper.parent = parent;
  wrapper.children = [target];
  target.parent = wrapper;
  parent.children[idx] = wrapper;
  return true;
}

/**
 * Get the depth of an element in the tree.
 *
 * @param element - The element to measure
 * @returns The depth (0 for root)
 */
function getDepth(element: WmlElement): number {
  let depth = 0;
  let current = element.parent;
  while (current) {
    depth++;
    current = current.parent;
  }
  return depth;
}

/**
 * Find a direct child element by tag name.
 *
 * @param parent - The parent element
 * @param tagName - The tag name to find
 * @returns The first matching child, or undefined
 */
export function findChildByTagName(
  parent: WmlElement,
  tagName: string
): WmlElement | undefined {
  return parent.children?.find((child) => child.tagName === tagName);
}

/**
 * Get all direct children with a specific tag name.
 *
 * @param parent - The parent element
 * @param tagName - The tag name to filter by
 * @returns Array of matching children
 */
export function getChildrenByTagName(
  parent: WmlElement,
  tagName: string
): WmlElement[] {
  return parent.children?.filter((child) => child.tagName === tagName) ?? [];
}

/**
 * Replace an element with another element in place.
 *
 * @param oldElement - The element to replace
 * @param newElement - The replacement element
 * @returns true if replaced, false if oldElement has no parent
 */
export function replaceElement(
  oldElement: WmlElement,
  newElement: WmlElement
): boolean {
  const parent = oldElement.parent;
  if (!parent || !parent.children) {
    return false;
  }

  const index = parent.children.indexOf(oldElement);
  if (index === -1) {
    return false;
  }

  newElement.parent = parent;
  oldElement.parent = undefined;
  parent.children[index] = newElement;

  return true;
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

/**
 * Backfill parent references in a cloned tree.
 *
 * @param element - The root element
 * @param parent - The parent element (undefined for root)
 */
export function backfillParentReferences(
  element: WmlElement,
  parent?: WmlElement
): void {
  element.parent = parent;
  if (element.children) {
    for (const child of element.children) {
      backfillParentReferences(child, element);
    }
  }
}
