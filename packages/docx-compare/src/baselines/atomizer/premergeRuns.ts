/**
 * Conservative run normalization for comparison stories.
 *
 * Adjacent runs with the same formatting may be merged before comparison so
 * source fragmentation does not create artificial change boundaries. Revision
 * save identifiers are bookkeeping and therefore do not prevent a merge.
 */

import { createHash } from 'node:crypto';
import { getLeafText, childElements, NODE_TYPE } from '@usejunior/docx-core';

const SAFE_RUN_CHILD_TAGS = new Set([
  'w:rPr',
  'w:t',
  'w:tab',
  'w:br',
  'w:cr',
  'w:delText',
  'w:lastRenderedPageBreak',
]);
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function sha1(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

function hashElementDeep(element: Element): string {
  const parts: string[] = [element.tagName];
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i]!;
    parts.push(`${attr.name}=${attr.value}`);
  }
  parts.sort();
  const tagName = parts.shift()!;
  const leafText = getLeafText(element);
  if (leafText !== undefined) parts.push(leafText);
  for (const child of childElements(element)) parts.push(hashElementDeep(child));
  return sha1([tagName, ...parts].join('|'));
}

function isRsidAttribute(attr: Attr): boolean {
  if (attr.namespaceURI) {
    return attr.namespaceURI === W_NS && (attr.localName ?? '').startsWith('rsid');
  }
  return attr.name.startsWith('w:rsid');
}

function nonRsidAttributes(element: Element): Attr[] {
  const attrs: Attr[] = [];
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i]!;
    if (!isRsidAttribute(attr)) attrs.push(attr);
  }
  return attrs;
}

function attrsEqual(a: Element, b: Element): boolean {
  const aAttrs = nonRsidAttributes(a);
  const bAttrs = nonRsidAttributes(b);
  if (aAttrs.length !== bAttrs.length) return false;
  return aAttrs.every((attribute) => b.getAttribute(attribute.name) === attribute.value);
}

function findChild(parent: Element, tagName: string): Element | undefined {
  return childElements(parent).find((child) => child.tagName === tagName);
}

function runPropertiesEqual(aRun: Element, bRun: Element): boolean {
  const aRPr = findChild(aRun, 'w:rPr');
  const bRPr = findChild(bRun, 'w:rPr');
  if (!aRPr && !bRPr) return true;
  if (!aRPr || !bRPr) return false;
  return hashElementDeep(aRPr) === hashElementDeep(bRPr);
}

function hasNonWhitespaceDirectText(element: Element): boolean {
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i]!;
    if (child.nodeType === NODE_TYPE.TEXT && (child.nodeValue ?? '').trim() !== '') return true;
  }
  return false;
}

function runIsSafeToMerge(run: Element): boolean {
  if (run.tagName !== 'w:r' || hasNonWhitespaceDirectText(run)) return false;
  for (const child of childElements(run)) {
    if (!SAFE_RUN_CHILD_TAGS.has(child.tagName)) return false;
    if (child.tagName !== 'w:rPr' && childElements(child).length > 0) return false;
  }
  return true;
}

function canMergeRuns(a: Element, b: Element): boolean {
  return runIsSafeToMerge(a) && runIsSafeToMerge(b) &&
    attrsEqual(a, b) && runPropertiesEqual(a, b);
}

function mergeRunInto(target: Element, source: Element): void {
  for (const child of childElements(source)) {
    if (child.tagName !== 'w:rPr') target.appendChild(child);
  }
}

function mergeAdjacentRunsInChildren(parent: Element): number {
  if (childElements(parent).length < 2) return 0;
  let merges = 0;
  let keepGoing = true;
  while (keepGoing) {
    keepGoing = false;
    const children = childElements(parent);
    for (let index = 0; index < children.length - 1; index++) {
      const left = children[index]!;
      const right = children[index + 1]!;
      if (left.tagName !== 'w:r' || right.tagName !== 'w:r' || !canMergeRuns(left, right)) continue;
      mergeRunInto(left, right);
      parent.removeChild(right);
      merges++;
      keepGoing = true;
      break;
    }
  }
  return merges;
}

/** Merge safely compatible adjacent runs throughout one comparison story. */
export function premergeAdjacentRuns(root: Element): number {
  let merges = 0;
  const traverse = (node: Element): void => {
    merges += mergeAdjacentRunsInChildren(node);
    for (const child of childElements(node)) traverse(child);
  };
  traverse(root);
  return merges;
}
