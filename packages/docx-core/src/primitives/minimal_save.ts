/**
 * minimal_save — restore untouched top-level body blocks from the original
 * document.xml at save time.
 *
 * The in-memory session DOM is normalized at open (`mergeRuns` +
 * `simplifyRedlines`) because text addressing, bookmarks, and comparison
 * baselines all assume the normalized shape. Serializing that DOM wholesale
 * persists the normalization for every paragraph, so a one-paragraph edit
 * rewrites the whole document on disk (proofErr stripped, runs merged) and
 * downstream diffs lie about the edit's blast radius.
 *
 * This module reconciles at save time instead: any body block (w:p, w:tbl,
 * w:sectPr, ...) whose serialization equals the corresponding block of a
 * freshly-normalized re-parse of the original XML was, by construction,
 * untouched by edits — so it is replaced with the pristine original block.
 * Edited blocks that are tables are descended into (rows → cells →
 * paragraphs) so a one-cell edit doesn't churn the rest of the table.
 * Edited or inserted leaves have no equal counterpart and are kept as-is.
 * The output contract is element-for-element preservation of untouched
 * blocks (the XML still passes through the serializer, so byte-identity
 * with the original file is not guaranteed).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/408
 */

import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { childElements } from './dom-helpers.js';
import { mergeRuns } from './merge_runs.js';
import { simplifyRedlines } from './simplify_redlines.js';

/**
 * Containers whose ELEMENT-CHILD structure normalization provably preserves
 * (mergeRuns/simplifyRedlines mutate inside paragraphs only): an edited
 * table can be descended into so its untouched rows/cells/paragraphs still
 * restore. Paragraphs are deliberately absent — normalization adds/removes
 * their children, so the original↔normalized index lockstep breaks there.
 */
const RECURSABLE_CONTAINER_LOCALS = new Set<string>([W.tbl, W.tr, W.tc]);

function bodyElement(doc: Document): Element | null {
  return doc.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0) as Element | null;
}

/**
 * DP cell budget (~16 MB of Int32). Edits touch few blocks, so the common
 * prefix/suffix trim below collapses the DP to roughly the edited span;
 * only a document with massive scattered edits exceeds this, and those
 * blocks then simply stay normalized (conservative, never wrong).
 */
const MAX_LCS_DP_CELLS = 4_000_000;

/**
 * Order-preserving alignment of two sequences by longest common subsequence,
 * returning matched index pairs `[i, j]` with `a[i] === b[j]`.
 *
 * An LCS (rather than a serialization-keyed FIFO map) is required for
 * correctness when two blocks normalize to identical serializations: if the
 * earlier duplicate is edited, a FIFO would hand the untouched later block
 * the earlier block's original (swapping rsid/paraId provenance). The
 * backtrack below matches from the tail, so untouched trailing duplicates
 * pair with their own originals.
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  if (a.length === 0 || b.length === 0) return [];

  // Identical leading/trailing runs are LCS matches by construction; pairing
  // them up front shrinks the DP to the edited middle span.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < start; k++) pairs.push([k, k]);

  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_LCS_DP_CELLS) {
    // Intern strings to integers so DP comparisons don't re-compare long XML.
    const ids = new Map<string, number>();
    const intern = (s: string): number => {
      let id = ids.get(s);
      if (id === undefined) {
        id = ids.size;
        ids.set(s, id);
      }
      return id;
    };
    const ai = a.slice(start, endA).map(intern);
    const bi = b.slice(start, endB).map(intern);

    // dp[(i, j)] = LCS length of ai[0..i) and bi[0..j), row-major stride m+1.
    const stride = m + 1;
    const dp = new Int32Array((n + 1) * stride);
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i * stride + j] =
          ai[i - 1] === bi[j - 1]
            ? dp[(i - 1) * stride + (j - 1)]! + 1
            : Math.max(dp[(i - 1) * stride + j]!, dp[i * stride + (j - 1)]!);
      }
    }

    const middle: Array<[number, number]> = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      if (
        ai[i - 1] === bi[j - 1] &&
        dp[i * stride + j] === dp[(i - 1) * stride + (j - 1)]! + 1
      ) {
        middle.push([start + i - 1, start + j - 1]);
        i--;
        j--;
      } else if (dp[(i - 1) * stride + j]! >= dp[i * stride + (j - 1)]!) {
        i--;
      } else {
        j--;
      }
    }
    pairs.push(...middle.reverse());
  }

  for (let k = 0; endA + k < a.length; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

const serializer = new XMLSerializer();

function sameQualifiedName(a: Element, b: Element): boolean {
  return a.namespaceURI === b.namespaceURI && a.localName === b.localName;
}

/**
 * Reconcile the element children of one container: LCS-matched (untouched)
 * children of `cur` are replaced with the corresponding pristine `orig`
 * child; unmatched (edited) children that pair 1:1 with a same-named
 * recursable container across an LCS gap are descended into, so e.g. the
 * untouched cells and paragraphs of an edited table still restore.
 *
 * `orig` and `norm` children are index-lockstep (norm is orig with
 * normalization applied, which never adds/removes container children);
 * a count mismatch abandons this subtree.
 */
function reconcileChildren(
  orig: Element,
  norm: Element,
  cur: Element,
  ownerDoc: Document,
): number {
  const origChildren = childElements(orig);
  const normChildren = childElements(norm);
  const curChildren = childElements(cur);
  if (origChildren.length !== normChildren.length) return 0;
  if (origChildren.length === 0 || curChildren.length === 0) return 0;

  const normKeys = normChildren.map((el) => serializer.serializeToString(el));
  const curKeys = curChildren.map((el) => serializer.serializeToString(el));
  const pairs = lcsPairs(normKeys, curKeys);

  let restored = 0;
  for (const [i, j] of pairs) {
    const pristine = ownerDoc.importNode(origChildren[i]!, true);
    cur.replaceChild(pristine, curChildren[j]!);
    restored++;
  }

  // Between consecutive LCS anchors, the leftovers on each side are the
  // edited children. When they pair 1:1 in order and both sides are the
  // same recursable container, descend — only serialization-equal
  // descendants will restore, so a mispairing cannot corrupt content.
  let prevI = -1;
  let prevJ = -1;
  for (const [ai, aj] of [...pairs, [normChildren.length, curChildren.length] as [number, number]]) {
    const gapLen = ai - prevI - 1;
    if (gapLen > 0 && gapLen === aj - prevJ - 1) {
      for (let k = 1; k <= gapLen; k++) {
        const normEl = normChildren[prevI + k]!;
        const curEl = curChildren[prevJ + k]!;
        if (
          sameQualifiedName(normEl, curEl) &&
          normEl.namespaceURI === OOXML.W_NS &&
          RECURSABLE_CONTAINER_LOCALS.has(normEl.localName)
        ) {
          restored += reconcileChildren(origChildren[prevI + k]!, normEl, curEl, ownerDoc);
        }
      }
    }
    prevI = ai;
    prevJ = aj;
  }
  return restored;
}

/**
 * Replace every block of `currentDoc` that is untouched — i.e.
 * serialization-equal to the same block of the original document.xml after
 * open-time normalization — with the pristine original block, descending
 * into edited tables so their untouched rows/cells/paragraphs restore too.
 *
 * `currentDoc` must already have internal bookmarks removed (untouched
 * blocks otherwise never match the bookmark-free reference). Returns the
 * number of elements restored; 0 means the document is fully edited or the
 * reference could not be aligned (output then matches today's full
 * re-serialization, never anything worse).
 */
export function restoreUntouchedBlocks(
  currentDoc: Document,
  originalXmlText: string,
): number {
  const original = parseXml(originalXmlText);
  const normRef = parseXml(originalXmlText);
  // Mirror DocxDocument.normalize()'s document.xml steps, in order.
  mergeRuns(normRef);
  simplifyRedlines(normRef);

  const originalBody = bodyElement(original);
  const normRefBody = bodyElement(normRef);
  const currentBody = bodyElement(currentDoc);
  if (!originalBody || !normRefBody || !currentBody) return 0;

  return reconcileChildren(originalBody, normRefBody, currentBody, currentDoc);
}
