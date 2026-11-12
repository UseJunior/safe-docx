import { canonicalNode } from './opaquePassthrough.js';
import type { MarkupCompatibilityGroup } from '../markupCompatibility.js';

const VML_NS = 'urn:schemas-microsoft-com:vml';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WORDPROCESSING_DRAWING_NS =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

/** One visual text box in a body, described for cross-document pairing. */
export interface TextBoxPairingCandidate {
  /** Every stored copy of the box, in document order. */
  copies: Element[];
  /**
   * The anchor identity of the box, or `undefined` when the box carries no
   * identity or its identity is not unique in either document.
   */
  identity: string | undefined;
  /** Canonical form of every stored copy, used to pair anonymous boxes. */
  content: string;
  /** How the box is stored: copy count, `mc:AlternateContent` twinning, balance. */
  storage: string;
}

export interface TextBoxGroupPairing {
  /** Index pairs into the original and revised candidate lists, in order. */
  pairs: Array<[original: number, revised: number]>;
  /**
   * Set when anonymous boxes in the same anchor gap disagree about how they
   * are stored, so they can be neither paired nor told apart (#1383).
   */
  ambiguousStorage?: { original: number; revised: number };
}

/**
 * The anchor identifiers of one stored copy: the hosting VML shape's `id`
 * and the DrawingML `wp:docPr/@id` of the enclosing inline or anchored
 * drawing object. These are identifiers the authoring application assigns to
 * the drawing object; the comparison reads them as object identity, not as a
 * conformance claim about their uniqueness, so duplicates are discarded below.
 */
export function copyIdentityTokens(copy: Element): string[] {
  const tokens: string[] = [];
  let sawVmlHost = false;
  for (let node = copy.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const element = node as Element;
    if (
      !sawVmlHost &&
      element.namespaceURI === VML_NS &&
      element.localName === 'textbox'
    ) {
      sawVmlHost = true;
      const host = element.parentNode as Element | null;
      const id = host?.nodeType === 1 && host.namespaceURI === VML_NS
        ? host.getAttribute('id')
        : null;
      if (id) tokens.push(`vml:${id}`);
    }
    if (
      element.namespaceURI === WORDPROCESSING_DRAWING_NS &&
      (element.localName === 'inline' || element.localName === 'anchor')
    ) {
      for (let child = element.firstChild; child; child = child.nextSibling) {
        const childElement = child as Element;
        if (
          child.nodeType === 1 &&
          childElement.namespaceURI === WORDPROCESSING_DRAWING_NS &&
          childElement.localName === 'docPr'
        ) {
          const id = childElement.getAttribute('id');
          if (id) tokens.push(`dml:${id}`);
        }
      }
      break;
    }
    // A text box nested in another box takes its identity from its own host,
    // never from the outer box's drawing object.
    if (element.localName === 'txbxContent') break;
  }
  return tokens;
}

function hasAlternateContentAncestor(element: Element): boolean {
  for (let node = element.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const ancestor = node as Element;
    if (ancestor.namespaceURI === MC_NS && ancestor.localName === 'AlternateContent') {
      return true;
    }
  }
  return false;
}

/**
 * Describe each visual text box for pairing. `rawIndex` orders a group's
 * stored copies by document position, which is how the two documents' copies
 * of one box correspond.
 */
export function textBoxPairingCandidates(
  groups: readonly MarkupCompatibilityGroup[],
  rawIndex: ReadonlyMap<Element, number>,
): TextBoxPairingCandidate[] {
  return groups.map((group) => {
    const copies = [group.selected, ...group.unselected].sort(
      (left, right) => (rawIndex.get(left) ?? 0) - (rawIndex.get(right) ?? 0),
    );
    const tokens = [...new Set(copies.flatMap(copyIdentityTokens))].sort();
    return {
      copies,
      identity: tokens.length > 0 ? tokens.join('|') : undefined,
      content: copies.map(canonicalNode).join('\u0000'),
      storage: [
        copies.length,
        copies.some(hasAlternateContentAncestor) ? 'twinned' : 'plain',
        group.unbalanced ? 'unbalanced' : 'balanced',
      ].join(':'),
    };
  });
}

function duplicatedIdentities(candidates: readonly TextBoxPairingCandidate[]): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const { identity } of candidates) {
    if (identity === undefined) continue;
    if (seen.has(identity)) duplicated.add(identity);
    seen.add(identity);
  }
  return duplicated;
}

function longestCommonSubsequence<T>(
  original: readonly T[],
  revised: readonly T[],
  equal: (left: T, right: T) => boolean,
): Array<[number, number]> {
  const lengths = Array.from(
    { length: original.length + 1 },
    () => new Array<number>(revised.length + 1).fill(0),
  );
  for (let i = original.length - 1; i >= 0; i -= 1) {
    for (let j = revised.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] = equal(original[i]!, revised[j]!)
        ? lengths[i + 1]![j + 1]! + 1
        : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    if (equal(original[i]!, revised[j]!) && lengths[i]![j] === lengths[i + 1]![j + 1]! + 1) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * Pair the text boxes of two document bodies by anchor identity.
 *
 * A box is identified by its anchor: the VML shape `id` and the DrawingML
 * `wp:docPr/@id`, which Word keeps stable for an object across edits. The two
 * spellings of one box inside `mc:AlternateContent` form one candidate, so
 * their identifiers combine into one identity. Boxes are aligned by an
 * order-preserving longest common subsequence: identified boxes match on
 * identity, unidentified boxes match on identical content. A box with an
 * identity never pairs with a box carrying a different one, so two boxes that
 * swap places pair with themselves or not at all — never with each other.
 *
 * Boxes without a usable identity fall back to anchor position: inside one gap
 * between aligned boxes, equal numbers of unidentified boxes pair in order,
 * which is how every box was paired before identities were read. Unequal
 * numbers stay unpaired, and the outer comparison tracks them as inserted or
 * deleted objects. Anonymous boxes in one gap that disagree about their
 * storage shape are reported as ambiguous instead of guessed at.
 *
 * Unpaired boxes are not an error: the caller leaves them in the outer
 * comparison, which tracks their anchor runs.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1031
 */
export function pairTextBoxCandidates(
  original: readonly TextBoxPairingCandidate[],
  revised: readonly TextBoxPairingCandidate[],
): TextBoxGroupPairing {
  const ambiguous = new Set([
    ...duplicatedIdentities(original),
    ...duplicatedIdentities(revised),
  ]);
  const identity = (candidate: TextBoxPairingCandidate): string | undefined =>
    candidate.identity !== undefined && !ambiguous.has(candidate.identity)
      ? candidate.identity
      : undefined;

  const anchors = longestCommonSubsequence(original, revised, (left, right) => {
    const leftIdentity = identity(left);
    const rightIdentity = identity(right);
    if (leftIdentity !== undefined || rightIdentity !== undefined) {
      return leftIdentity === rightIdentity;
    }
    return left.content === right.content;
  });

  const pairs: Array<[number, number]> = [];
  let ambiguousStorage: TextBoxGroupPairing['ambiguousStorage'];
  let originalStart = 0;
  let revisedStart = 0;
  for (const anchor of [...anchors, [original.length, revised.length] as [number, number]]) {
    const originalGap: number[] = [];
    const revisedGap: number[] = [];
    for (let index = originalStart; index < anchor[0]; index += 1) {
      if (identity(original[index]!) === undefined) originalGap.push(index);
    }
    for (let index = revisedStart; index < anchor[1]; index += 1) {
      if (identity(revised[index]!) === undefined) revisedGap.push(index);
    }
    if (originalGap.length > 0 && originalGap.length === revisedGap.length) {
      for (const [offset, originalIndex] of originalGap.entries()) {
        pairs.push([originalIndex, revisedGap[offset]!]);
      }
    } else if (
      ambiguousStorage === undefined &&
      originalGap.length > 0 &&
      revisedGap.length > 0 &&
      new Set([...originalGap.map((index) => original[index]!.storage),
        ...revisedGap.map((index) => revised[index]!.storage)]).size > 1
    ) {
      ambiguousStorage = { original: originalGap[0]!, revised: revisedGap[0]! };
    }
    if (anchor[0] < original.length) pairs.push(anchor);
    originalStart = anchor[0] + 1;
    revisedStart = anchor[1] + 1;
  }
  pairs.sort((left, right) => left[1] - right[1]);
  return ambiguousStorage ? { pairs, ambiguousStorage } : { pairs };
}
