/**
 * Side-tagged comparison tree.
 *
 * The atomizer pipeline flattens OOXML into a flat atom list, runs LCS over it,
 * and reconstitutes a tree afterwards. The tree invariants that make a redline
 * valid do not survive that round trip, so they can only be *checked* after
 * serialization — which is why `pipeline.ts` produces several candidates and
 * keeps whichever one passes an accept/reject round trip.
 *
 * This module provides the representation that removes the need to search: a
 * single tree in which every node records which side(s) it belongs to, and two
 * projections that fold it back down to each input.
 *
 * **Scope.** What this establishes is *IR projection fidelity* — that each
 * projection reproduces its input side. Serializer correctness, accept/reject
 * semantics, and package/story assembly are three further layers, each with its
 * own evidence. An empty violation list says nothing about them, and the
 * runtime accept/reject checks in `pipeline.ts` are not made redundant by it.
 *
 * Correction (2026-08-16): this module began as additive Stage A evidence,
 * but the completed change now routes ordinary comparison through it by
 * default while retaining the legacy strategy as an explicit rollback. See
 * `openspec/changes/refactor-tagged-tree-redline-construction/`.
 */

import type { WmlElement } from '@usejunior/docx-core';
import { childElements } from '@usejunior/docx-core';

/** The two input documents a comparison projects back to. */
export type Side = 'original' | 'revised';

/**
 * OOXML property level a {@link PropertyDelta} describes.
 *
 * Property changes are not one kind of thing: a run-property change and a
 * paragraph-property change serialize to different revision elements, so a
 * delta that does not carry its own level cannot be serialized unambiguously.
 */
export type PropertyScope =
  | 'run'
  | 'paragraphMark'
  | 'paragraph'
  | 'tableRow'
  | 'tableCell'
  | 'section';

/** The direct property element each scope is carried by. */
export const PROPERTY_SCOPE_ELEMENT: Readonly<Record<PropertyScope, string>> = {
  run: 'w:rPr',
  paragraphMark: 'w:rPr',
  paragraph: 'w:pPr',
  tableRow: 'w:trPr',
  tableCell: 'w:tcPr',
  section: 'w:sectPr',
};

/**
 * A formatting difference between the two representatives of a `both` node.
 *
 * Snapshots are **direct** property elements (`w:rPr`, `w:pPr`, …) as they
 * appear in each input. Formatting resolved through the style chain or
 * `docDefaults` is deliberately not modeled: neither the format detector nor
 * the fidelity oracle resolves it, so a delta claiming to carry effective
 * formatting could not be checked against anything.
 */
export interface PropertyDelta {
  scope: PropertyScope;
  /** Direct property element on the original side, or null when absent. */
  original: WmlElement | null;
  /** Direct property element on the revised side, or null when absent. */
  revised: WmlElement | null;
  /** Names of the properties that differ, for reporting. */
  changedProperties: string[];
}

/** Metadata retained from an input revision wrapper rather than flattened into text. */
export interface RevisionProvenance {
  kind: 'w:ins' | 'w:del' | 'w:moveFrom' | 'w:moveTo';
  id: string | null;
  author: string | null;
  date: string | null;
}

const REVISION_WRAPPER_TAGS = new Set<RevisionProvenance['kind']>([
  'w:ins',
  'w:del',
  'w:moveFrom',
  'w:moveTo',
]);

/**
 * Return the enclosing input revision wrappers from outermost to innermost.
 *
 * This is construction metadata: serializers decide how a comparison revision
 * nests inside it, while projections continue to use the side representative.
 */
export function revisionProvenance(element: WmlElement): RevisionProvenance[] {
  const wrappers: RevisionProvenance[] = [];
  let current: Element | null = element;
  while (current) {
    if (REVISION_WRAPPER_TAGS.has(current.tagName as RevisionProvenance['kind'])) {
      wrappers.unshift({
        kind: current.tagName as RevisionProvenance['kind'],
        id: current.getAttribute('w:id'),
        author: current.getAttribute('w:author'),
        date: current.getAttribute('w:date'),
      });
    }
    current = current.parentElement;
  }
  return wrappers;
}

/**
 * First safe ID for comparison revisions after examining both preserved inputs.
 * Existing IDs are never reused, even when the two documents contain different
 * authors or revision kinds with the same decimal identifier.
 */
export function nextRevisionId(originalRoot: WmlElement, revisedRoot: WmlElement): number {
  const used = new Set<string>();
  for (const root of [originalRoot, revisedRoot]) {
    const elements = [root, ...Array.from(root.getElementsByTagName('*'))];
    for (const element of elements) {
      const rawId = element.getAttribute('w:id');
      if (rawId === null || !/^[+-]?\d+$/.test(rawId.trim())) continue;
      try {
        used.add(BigInt(rawId.trim()).toString());
      } catch {
        // Ignore values outside BigInt's grammar, matching the live allocator.
      }
    }
  }
  let next = 1;
  while (used.has(String(next))) next++;
  return next;
}

/**
 * Fields shared by every tagged node.
 *
 * `opaque` marks a subtree the IR deliberately does not model: the element is
 * carried whole and `children` stays empty. It has to be explicit, because an
 * empty `children` array is also what an *incomplete* construction looks like.
 * A representation that cannot tell "I chose not to model this" from "I forgot
 * to model this" will certify the second as the first.
 */
interface TaggedNodeBase {
  children: TaggedNode[];
  opaque?: true;
  /** Markdoc operation IDs whose exact emitted revision range includes this node. */
  operationProvenance?: readonly string[];
}

/**
 * A node present on both sides.
 *
 * It carries **two** element representatives because matched is not the same as
 * identical: the same text can appear under different run properties, and the
 * same paragraph under a different `w:pPr`. A single-element `both` node cannot
 * say which side's attributes each projection should emit, which is what forces
 * formatting differences into delete+insert pairs in the flat-atom pipeline.
 */
export interface BothNode extends TaggedNodeBase {
  tag: 'both';
  original: WmlElement;
  revised: WmlElement;
  propertyDelta?: PropertyDelta;
}

/** A node present only in the original document — a deletion. */
export interface OriginalNode extends TaggedNodeBase {
  tag: 'original';
  node: WmlElement;
}

/** A node present only in the revised document — an insertion. */
export interface RevisedNode extends TaggedNodeBase {
  tag: 'revised';
  node: WmlElement;
}

export type TaggedNode = BothNode | OriginalNode | RevisedNode;

/** A complete side-tagged comparison tree. */
export type TaggedTree = TaggedNode;

/**
 * A logical move connects two side-only subtrees without pretending their
 * document positions are a `both` match.  Range identifiers are distinct per
 * direction, while the non-empty name is the source/destination pairing key.
 */
export interface TaggedMoveRelation {
  source: OriginalNode;
  destination: RevisedNode;
  name: string;
  sourceRangeId: number;
  destinationRangeId: number;
}

export interface MoveRelationViolation {
  relation: number;
  detail: string;
}

/**
 * Certify the construction-time portion of the live tracked-move contract.
 *
 * One relation is exactly one source range and one destination range. Unique
 * non-negative integer IDs make markers pairable, and unique names make the
 * two directions one-to-one. The serializer remains responsible for proving
 * tree membership, non-crossing placement, and exactly one balanced start/end
 * pair for each recorded direction.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.24
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.27
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.28
 * @see #814
 */
export function verifyMoveRelations(
  relations: readonly TaggedMoveRelation[],
  tree?: TaggedNode,
): MoveRelationViolation[] {
  const violations: MoveRelationViolation[] = [];
  const names = new Set<string>();
  const rangeIds = new Set<number>();
  const members = new Set<TaggedNode>();
  if (tree) {
    const visit = (node: TaggedNode): void => {
      members.add(node);
      node.children.forEach(visit);
    };
    visit(tree);
  }
  relations.forEach((relation, index) => {
    if (relation.source.tag !== 'original' || relation.destination.tag !== 'revised') {
      violations.push({ relation: index, detail: 'move endpoints must be original and revised subtrees' });
    }
    if (tree && (!members.has(relation.source) || !members.has(relation.destination))) {
      violations.push({ relation: index, detail: 'move endpoints must belong to the certified tagged tree' });
    }
    if (relation.name.trim().length === 0 || names.has(relation.name)) {
      violations.push({ relation: index, detail: 'move name must be non-empty and one-to-one' });
    }
    names.add(relation.name);
    for (const [direction, id] of [
      ['source', relation.sourceRangeId],
      ['destination', relation.destinationRangeId],
    ] as const) {
      if (!Number.isSafeInteger(id) || id < 0 || rangeIds.has(id)) {
        violations.push({ relation: index, detail: `${direction} range id must be a unique non-negative integer` });
      }
      rangeIds.add(id);
    }
  });
  return violations;
}

/** True when `node` contributes to the projection of `side`. */
export function appearsOn(node: TaggedNode, side: Side): boolean {
  return node.tag === 'both' || node.tag === side;
}

/** The element `node` contributes to the projection of `side`. */
export function representative(node: TaggedNode, side: Side): WmlElement | undefined {
  if (node.tag === 'both') return side === 'original' ? node.original : node.revised;
  return node.tag === side ? node.node : undefined;
}

/**
 * A projected tree: the shape one side of the comparison takes when the tagged
 * tree is folded down to it.
 */
export interface ProjectedNode {
  element: WmlElement;
  children: ProjectedNode[];
  /** Carried through so the verifier can tell modeled from unmodeled nodes. */
  opaque: boolean;
}

/**
 * Fold a tagged tree down to one side.
 *
 * Total by construction: every node either contributes its representative for
 * `side` or is dropped, and no case is left unhandled.
 */
export function project(node: TaggedNode, side: Side): ProjectedNode | undefined {
  const element = representative(node, side);
  if (element === undefined) return undefined;
  const children: ProjectedNode[] = [];
  for (const child of node.children) {
    const projected = project(child, side);
    if (projected !== undefined) children.push(projected);
  }
  return { element, children, opaque: node.opaque === true };
}

/** Fold a forest of tagged nodes down to one side. */
export function projectAll(nodes: TaggedNode[], side: Side): ProjectedNode[] {
  const out: ProjectedNode[] = [];
  for (const node of nodes) {
    const projected = project(node, side);
    if (projected !== undefined) out.push(projected);
  }
  return out;
}

// =============================================================================
// Projection isomorphism
// =============================================================================

/**
 * The obligations an aligner must satisfy for a projection to reproduce its
 * input side.
 *
 * Coverage alone is not enough, and the gap is not academic. An obligation
 * stating only that each input node appears exactly once admits
 * `original = [A, B]`, `revised = [B, A]`, tree `[both(B), both(A)]`: every
 * input node appears once, yet the original projection is `[B, A]`. P2 is what
 * excludes it. OOXML text extraction is order-sensitive, so an order-blind
 * obligation would certify a redline that reads back wrong.
 */
export type ProjectionObligation =
  /** Every input-side element corresponds to exactly one projected node. */
  | 'P1-bijection'
  /** Sibling order in the projection equals sibling order in the input. */
  | 'P2-order'
  /** Parent/child relationships are preserved. */
  | 'P3-containment'
  /** Side-specific namespace, name, attributes and text are the side's own. */
  | 'P4-content'
  /** An explicitly opaque subtree is carried through equivalent to its input. */
  | 'P5-opaque-payload';

export interface ProjectionViolation {
  obligation: ProjectionObligation;
  side: Side;
  /** Document-order path to the offending node, e.g. `w:body/w:p[2]/w:r[1]`. */
  path: string;
  detail: string;
}

/**
 * Separator between sibling signatures.
 *
 * U+0001 is not a legal XML 1.0 character, so it cannot occur in document data
 * and cannot be forged by content. Named and explicit because a signature is
 * only meaningful if every producer uses the same one: an earlier revision
 * joined on a stray NUL in one of two places, which made identical subtrees
 * compare unequal and silently disabled the ordering check that depends on them.
 */
const SIGNATURE_SEPARATOR = '\u0001';

/**
 * Structural signature of an element's own identity.
 *
 * Identity is namespace URI plus local name, never the lexical `tagName`:
 * prefixes are aliasable, so two elements in different namespaces can share a
 * `tagName` and two elements in the same namespace can differ in it.
 *
 * Attributes and text are encoded with `JSON.stringify` rather than
 * concatenated around delimiters. Delimiter-joined encoding is not injective —
 * `a="x b=y"` and `a="x" b="y"` collapse to the same string — and a false
 * equality here silently passes a wrong projection.
 */
export function elementSignature(element: WmlElement): string {
  const attrs: Array<[string, string, string]> = [];
  const attributes = element.attributes;
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes.item(i);
    if (!attr) continue;
    // Namespace declarations describe the serialization rather than the
    // content, and the writer re-emits them; comparing them would report a
    // difference where the projected content is the same.
    if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue;
    attrs.push([attr.namespaceURI ?? '', attr.localName ?? attr.name, attr.value]);
  }
  attrs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  let ownText = '';
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i]!;
    if (child.nodeType === 3 /* TEXT_NODE */ || child.nodeType === 4 /* CDATA */) {
      ownText += child.nodeValue ?? '';
    }
  }

  return JSON.stringify([
    element.namespaceURI ?? '',
    element.localName ?? element.tagName,
    attrs,
    ownText,
  ]);
}

/**
 * Signature of a whole input subtree.
 *
 * This is the **canonical equivalence** P5 is defined against, and it is
 * deliberately not byte equality: attribute order is normalized, adjacent text
 * nodes are concatenated, CDATA and text are treated alike, and comments and
 * processing instructions do not participate. Content that depends on those
 * distinctions surviving must not be modeled as opaque payload here.
 */
export function subtreeSignature(element: WmlElement): string {
  const parts: string[] = [elementSignature(element)];
  for (const child of childElements(element)) {
    parts.push(subtreeSignature(child));
  }
  return parts.join(SIGNATURE_SEPARATOR);
}

/** Signature of a projected subtree, mirroring {@link subtreeSignature}. */
function projectedSubtreeSignature(node: ProjectedNode): string {
  if (node.opaque) return subtreeSignature(node.element);
  const parts: string[] = [elementSignature(node.element)];
  for (const child of node.children) {
    parts.push(projectedSubtreeSignature(child));
  }
  return parts.join(SIGNATURE_SEPARATOR);
}

function childPath(path: string, element: WmlElement, ordinal: number): string {
  return `${path}/${element.tagName}[${ordinal}]`;
}

/**
 * Verify that `projected` is isomorphic to `input` under P1-P5.
 *
 * Runs against the tree without serializing it, in time linear in the size of
 * the input side. Establishes IR projection fidelity only — see this module's
 * header for the three layers it does not speak to.
 */
export function verifyProjection(
  input: WmlElement,
  projected: ProjectedNode | undefined,
  side: Side,
  path = input.tagName,
): ProjectionViolation[] {
  const violations: ProjectionViolation[] = [];

  if (projected === undefined) {
    violations.push({
      obligation: 'P1-bijection',
      side,
      path,
      detail: `input node <${input.tagName}> has no counterpart in the ${side} projection`,
    });
    return violations;
  }

  if (elementSignature(projected.element) !== elementSignature(input)) {
    violations.push({
      obligation: 'P4-content',
      side,
      path,
      detail:
        `projected <${projected.element.tagName}> does not carry the ${side} ` +
        `side's own namespace, name, attributes or text`,
    });
  }

  const inputChildren = childElements(input);

  // An opaque node stands for its whole subtree by explicit declaration, so the
  // subtree is compared as a unit and its children are not separately accounted.
  if (projected.opaque) {
    if (subtreeSignature(projected.element) !== subtreeSignature(input)) {
      violations.push({
        obligation: 'P5-opaque-payload',
        side,
        path,
        detail:
          `opaque subtree under <${input.tagName}> is not equivalent to the ` +
          `${side} input subtree it stands for`,
      });
    }
    return violations;
  }

  // Not opaque: every input child must be accounted for. This is the case an
  // implicit "no children means opaque" convention silently certified — a tree
  // that forgot its descendants was indistinguishable from one that carried
  // them whole, and passed clean.
  if (projected.children.length !== inputChildren.length) {
    violations.push({
      obligation:
        inputChildren.length > projected.children.length ? 'P1-bijection' : 'P3-containment',
      side,
      path,
      detail:
        `<${input.tagName}> has ${inputChildren.length} child element(s) on the ` +
        `${side} side but ${projected.children.length} in the projection; a subtree ` +
        `that is deliberately unmodeled must be marked opaque`,
    });
  }

  // Reordering is diagnosed at this level, before recursing. The children a
  // projection must reproduce are a *sequence*, so when the same set comes back
  // in a different order the defect is the order — recursing first would report
  // it as a pile of content mismatches deeper down and name the wrong thing.
  const inputSignatures = inputChildren.map(subtreeSignature);
  const projectedSignatures = projected.children.map(projectedSubtreeSignature);
  const sameSequence =
    inputSignatures.length === projectedSignatures.length &&
    inputSignatures.every((sig, i) => sig === projectedSignatures[i]);

  if (!sameSequence) {
    const isPermutation =
      inputSignatures.length === projectedSignatures.length &&
      [...inputSignatures].sort().join(SIGNATURE_SEPARATOR) ===
        [...projectedSignatures].sort().join(SIGNATURE_SEPARATOR);

    if (isPermutation) {
      const firstDiff = inputSignatures.findIndex((sig, i) => sig !== projectedSignatures[i]);
      const offending = inputChildren[firstDiff]!;
      violations.push({
        obligation: 'P2-order',
        side,
        path: childPath(path, offending, firstDiff + 1),
        detail:
          `children of <${input.tagName}> are reordered in the ${side} projection: ` +
          `position ${firstDiff + 1} holds <${offending.tagName}> on the ${side} side ` +
          `but a different sibling in the projection`,
      });
      return violations;
    }
  }

  const shared = Math.min(projected.children.length, inputChildren.length);
  for (let i = 0; i < shared; i++) {
    const inputChild = inputChildren[i]!;
    const projectedChild = projected.children[i]!;
    violations.push(
      ...verifyProjection(inputChild, projectedChild, side, childPath(path, inputChild, i + 1)),
    );
  }

  for (let i = shared; i < inputChildren.length; i++) {
    const inputChild = inputChildren[i]!;
    violations.push({
      obligation: 'P1-bijection',
      side,
      path: childPath(path, inputChild, i + 1),
      detail: `input node <${inputChild.tagName}> has no counterpart in the ${side} projection`,
    });
  }

  return violations;
}

/**
 * Check that a property delta is internally consistent: its snapshots are the
 * element its scope names, and it records something on at least one side.
 *
 * Whether the snapshots agree with the node's representatives is the aligner's
 * obligation, and stage A has no aligner — so it is deliberately not checked.
 */
export function verifyPropertyDelta(delta: PropertyDelta, path: string): ProjectionViolation[] {
  const violations: ProjectionViolation[] = [];
  const expected = PROPERTY_SCOPE_ELEMENT[delta.scope];

  for (const side of ['original', 'revised'] as const) {
    const snapshot = delta[side];
    if (snapshot !== null && snapshot.tagName !== expected) {
      violations.push({
        obligation: 'P4-content',
        side,
        path,
        detail:
          `property delta at ${delta.scope} scope carries <${snapshot.tagName}> on the ` +
          `${side} side, but ${delta.scope} scope is carried by <${expected}>`,
      });
    }
  }

  if (delta.original === null && delta.revised === null) {
    violations.push({
      obligation: 'P4-content',
      side: 'original',
      path,
      detail: `property delta at ${delta.scope} scope records no snapshot on either side`,
    });
  }

  return violations;
}

/** Walk the tree and verify every property delta it carries. */
function verifyDeltas(node: TaggedNode, path: string): ProjectionViolation[] {
  const violations: ProjectionViolation[] = [];
  if (node.tag === 'both' && node.propertyDelta) {
    violations.push(...verifyPropertyDelta(node.propertyDelta, path));
  }
  node.children.forEach((child, i) => {
    const element = child.tag === 'both' ? child.original : child.node;
    violations.push(...verifyDeltas(child, childPath(path, element, i + 1)));
  });
  return violations;
}

/**
 * Verify both projections of a tagged tree against the documents it was built
 * from, plus the internal consistency of any property deltas.
 *
 * An empty result establishes **IR projection fidelity**: each projection
 * reproduces its input side. It does not establish serializer correctness,
 * accept/reject semantics, or package assembly — those are separate layers, and
 * the runtime round-trip checks covering them today are not made redundant by
 * this.
 */
export function verifyTaggedTree(
  originalRoot: WmlElement,
  revisedRoot: WmlElement,
  tree: TaggedNode,
): ProjectionViolation[] {
  return [
    ...verifyProjection(originalRoot, project(tree, 'original'), 'original'),
    ...verifyProjection(revisedRoot, project(tree, 'revised'), 'revised'),
    ...verifyDeltas(tree, originalRoot.tagName),
  ];
}

/** Formats violations for an error message or a divergence report. */
export function describeViolations(violations: ProjectionViolation[]): string {
  return violations.map((v) => `${v.obligation} [${v.side}] at ${v.path}: ${v.detail}`).join('\n');
}

/**
 * Error raised when a constructed tree fails its projection obligations.
 *
 * A violation is an engine defect, not something a downstream pass repairs —
 * the pipeline this replaces reacts to a failed check by trying a different
 * atomization, which is what lets an incomplete checker ship a wrong redline.
 */
export class ProjectionContractError extends Error {
  readonly violations: ProjectionViolation[];

  constructor(violations: ProjectionViolation[]) {
    super(`tagged tree violates its projection contract:\n${describeViolations(violations)}`);
    this.name = 'ProjectionContractError';
    this.violations = violations;
  }
}

/** Throws {@link ProjectionContractError} unless both projections are isomorphic. */
export function assertTaggedTree(
  originalRoot: WmlElement,
  revisedRoot: WmlElement,
  tree: TaggedNode,
): void {
  const violations = verifyTaggedTree(originalRoot, revisedRoot, tree);
  if (violations.length > 0) throw new ProjectionContractError(violations);
}
