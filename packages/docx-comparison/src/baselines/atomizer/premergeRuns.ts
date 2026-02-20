/**
 * Pre-Compare Run Pre-Merge
 *
 * Optional normalization step to merge adjacent <w:r> siblings with identical
 * formatting before atomization.
 *
 * Motivation:
 * - Some documents are heavily fragmented into multiple runs even when the
 *   formatting is identical. This can cause overly-granular diffs.
 * - For `reconstructionMode: 'inplace'`, we intentionally disable atom-level
 *   cross-run text merging to keep atoms anchored to real runs. Pre-merging runs
 *   is a safer way to reduce fragmentation without creating atoms that span
 *   multiple runs.
 *
 * This step is intentionally conservative:
 * - Only merges immediately-adjacent <w:r> siblings under the same parent.
 * - Requires identical run attributes and identical <w:rPr> formatting subtree.
 * - Only merges runs that contain a small, "safe" subset of child elements.
 */

import { createHash } from 'crypto';
import type { WmlElement } from '../../core-types.js';
import { removeChild } from './wmlElementUtils.js';

const SAFE_RUN_CHILD_TAGS = new Set([
  'w:rPr',
  'w:t',
  'w:tab',
  'w:br',
  'w:cr',
  // Deleted text can appear if input already has revisions.
  'w:delText',
]);

function sha1(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

function hashElementDeep(element: WmlElement): string {
  const parts: string[] = [element.tagName];

  const sortedAttrs = Object.entries(element.attributes).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of sortedAttrs) {
    parts.push(`${key}=${value}`);
  }

  if (element.textContent !== undefined) {
    parts.push(element.textContent);
  }

  if (element.children) {
    for (const child of element.children) {
      parts.push(hashElementDeep(child));
    }
  }

  return sha1(parts.join('|'));
}

function attrsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  aKeys.sort();
  bKeys.sort();
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i]!;
    if (k !== bKeys[i]) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function findChild(parent: WmlElement, tagName: string): WmlElement | undefined {
  return parent.children?.find((c) => c.tagName === tagName);
}

function runPropertiesEqual(aRun: WmlElement, bRun: WmlElement): boolean {
  const aRPr = findChild(aRun, 'w:rPr');
  const bRPr = findChild(bRun, 'w:rPr');

  if (!aRPr && !bRPr) return true;
  if (!aRPr || !bRPr) return false;
  return hashElementDeep(aRPr) === hashElementDeep(bRPr);
}

function runIsSafeToMerge(run: WmlElement): boolean {
  if (run.tagName !== 'w:r') return false;
  if (run.textContent !== undefined) return false;

  for (const child of run.children ?? []) {
    if (!SAFE_RUN_CHILD_TAGS.has(child.tagName)) return false;
    // Be conservative: disallow nested elements under non-rPr children.
    if (child.tagName !== 'w:rPr' && (child.children?.length ?? 0) > 0) return false;
  }

  return true;
}

function mergeRunInto(target: WmlElement, source: WmlElement): void {
  if (!target.children) target.children = [];
  const sourceChildren = source.children ?? [];

  for (const child of sourceChildren) {
    if (child.tagName === 'w:rPr') continue;
    child.parent = target;
    target.children.push(child);
  }
}

function canMergeRuns(a: WmlElement, b: WmlElement): boolean {
  if (!runIsSafeToMerge(a) || !runIsSafeToMerge(b)) return false;
  if (!attrsEqual(a.attributes, b.attributes)) return false;
  if (!runPropertiesEqual(a, b)) return false;
  return true;
}

function mergeAdjacentRunsInChildren(parent: WmlElement): number {
  if (!parent.children || parent.children.length < 2) return 0;
  let merges = 0;

  for (let i = 0; i < parent.children.length - 1; ) {
    const a = parent.children[i]!;
    const b = parent.children[i + 1]!;

    if (a.tagName === 'w:r' && b.tagName === 'w:r' && canMergeRuns(a, b)) {
      mergeRunInto(a, b);
      removeChild(parent, b);
      merges++;
      // Keep i the same to allow cascading merges into `a`.
      continue;
    }

    i++;
  }

  return merges;
}

/**
 * Merge adjacent runs throughout a WmlElement subtree.
 *
 * @returns The number of merges performed.
 */
export function premergeAdjacentRuns(root: WmlElement): number {
  let merges = 0;

  function traverse(node: WmlElement): void {
    merges += mergeAdjacentRunsInChildren(node);
    for (const child of node.children ?? []) {
      traverse(child);
    }
  }

  traverse(root);
  return merges;
}
