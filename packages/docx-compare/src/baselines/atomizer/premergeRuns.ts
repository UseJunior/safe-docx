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
 *   Revision-save identifiers (OOXML w:rsidR, w:rsidRPr, w:rsidDel, ...) are
 *   excluded from that comparison: they record which editing session last
 *   touched a run — bookkeeping with no rendering or semantic effect — so they
 *   must not keep two otherwise-identical runs fragmented (issue #675).
 * - Only merges runs that contain a small, "safe" subset of child elements.
 */

import { createHash } from 'crypto';
import { getLeafText, childElements } from '@usejunior/docx-core';

const SAFE_RUN_CHILD_TAGS = new Set([
  'w:rPr',
  'w:t',
  'w:tab',
  'w:br',
  'w:cr',
  // Deleted text can appear if input already has revisions.
  'w:delText',
  // Rendering hint — records where the last page break was rendered.
  // No semantic significance; safe to keep in a merged run.
  'w:lastRenderedPageBreak',
]);

function sha1(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

function hashElementDeep(element: Element): string {
  const parts: string[] = [element.tagName];

  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i]!;
    parts.push(`${attr.name}=${attr.value}`);
  }
  // Sort for determinism
  parts.sort();
  // Re-add tagName at front after sort
  const tagName = parts.shift()!;

  const leafText = getLeafText(element);
  if (leafText !== undefined) {
    parts.push(leafText);
  }

  for (const child of childElements(element)) {
    parts.push(hashElementDeep(child));
  }

  return sha1([tagName, ...parts].join('|'));
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Whether an attribute is an OOXML revision-save identifier (w:rsidR,
 * w:rsidRPr, w:rsidDel, ...).
 *
 * Attributes on elements parsed from a document carry namespace metadata, so
 * the primary check is w-namespace + localName. Attributes created without it
 * (e.g. via `setAttribute('w:rsidR', ...)` in fixtures) expose the qualified
 * name only, so fall back to the `w:`-prefixed name.
 */
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

/**
 * Compare run attributes, ignoring rsid revision-save identifiers on both
 * sides. Equal filtered counts plus a value check of every remaining `a`
 * attribute against `b` gives symmetric equality over the non-rsid sets.
 */
function attrsEqual(a: Element, b: Element): boolean {
  const aAttrs = nonRsidAttributes(a);
  const bAttrs = nonRsidAttributes(b);
  if (aAttrs.length !== bAttrs.length) return false;
  for (const aAttr of aAttrs) {
    if (b.getAttribute(aAttr.name) !== aAttr.value) return false;
  }
  return true;
}

function findChild(parent: Element, tagName: string): Element | undefined {
  for (const child of childElements(parent)) {
    if (child.tagName === tagName) return child;
  }
  return undefined;
}

function runPropertiesEqual(aRun: Element, bRun: Element): boolean {
  const aRPr = findChild(aRun, 'w:rPr');
  const bRPr = findChild(bRun, 'w:rPr');

  if (!aRPr && !bRPr) return true;
  if (!aRPr || !bRPr) return false;
  return hashElementDeep(aRPr) === hashElementDeep(bRPr);
}

function runIsSafeToMerge(run: Element): boolean {
  if (run.tagName !== 'w:r') return false;
  // Direct text under <w:r> is meaningless in OOXML (significant text lives in
  // <w:t>), but pretty-printed documents put indentation text nodes inside
  // every run. Treating those as content made premerge a no-op on one side of
  // a comparison whenever only that side was pretty-printed, which
  // desynchronised run boundaries between the two documents and produced
  // phantom delete+insert pairs at every shared fragment boundary (issue #675).
  // Only non-whitespace direct text marks a run unsafe.
  const leafText = getLeafText(run);
  if (leafText !== undefined && leafText.trim() !== '') return false;

  for (const child of childElements(run)) {
    if (!SAFE_RUN_CHILD_TAGS.has(child.tagName)) return false;
    // Be conservative: disallow nested elements under non-rPr children.
    if (child.tagName !== 'w:rPr' && childElements(child).length > 0) return false;
  }

  return true;
}

function mergeRunInto(target: Element, source: Element): void {
  for (const child of childElements(source)) {
    if (child.tagName === 'w:rPr') continue;
    target.appendChild(child);
  }
}

function canMergeRuns(a: Element, b: Element): boolean {
  if (!runIsSafeToMerge(a) || !runIsSafeToMerge(b)) return false;
  if (!attrsEqual(a, b)) return false;
  if (!runPropertiesEqual(a, b)) return false;
  return true;
}

function mergeAdjacentRunsInChildren(parent: Element): number {
  const children = childElements(parent);
  if (children.length < 2) return 0;
  let merges = 0;

  // Re-scan after each merge since DOM is live
  let keepGoing = true;
  while (keepGoing) {
    keepGoing = false;
    const kids = childElements(parent);
    for (let i = 0; i < kids.length - 1; i++) {
      const a = kids[i]!;
      const b = kids[i + 1]!;

      if (a.tagName === 'w:r' && b.tagName === 'w:r' && canMergeRuns(a, b)) {
        mergeRunInto(a, b);
        parent.removeChild(b);
        merges++;
        keepGoing = true;
        break; // restart scan
      }
    }
  }

  return merges;
}

/**
 * Merge adjacent runs throughout a DOM Element subtree.
 *
 * @returns The number of merges performed.
 */
export function premergeAdjacentRuns(root: Element): number {
  let merges = 0;

  function traverse(node: Element): void {
    merges += mergeAdjacentRunsInChildren(node);
    for (const child of childElements(node)) {
      traverse(child);
    }
  }

  traverse(root);
  return merges;
}
