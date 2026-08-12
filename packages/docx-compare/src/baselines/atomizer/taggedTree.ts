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
 * single tree in which every node records which side(s) it belongs to. The two
 * projections are then folds over that tree, and their fidelity to the inputs
 * is a property that can be established before anything is serialized.
 *
 * Stage A (this module) is additive and has no production caller. See
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

/**
 * A node present on both sides.
 *
 * It carries **two** element representatives because matched is not the same as
 * identical: the same text can appear under different run properties, and the
 * same paragraph under a different `w:pPr`. A single-element `both` node cannot
 * say which side's attributes each projection should emit, which is what forces
 * formatting differences into delete+insert pairs in the flat-atom pipeline.
 */
export interface BothNode {
  tag: 'both';
  original: WmlElement;
  revised: WmlElement;
  propertyDelta?: PropertyDelta;
  children: TaggedNode[];
}

/** A node present only in the original document — a deletion. */
export interface OriginalNode {
  tag: 'original';
  node: WmlElement;
  children: TaggedNode[];
}

/** A node present only in the revised document — an insertion. */
export interface RevisedNode {
  tag: 'revised';
  node: WmlElement;
  children: TaggedNode[];
}

export type TaggedNode = BothNode | OriginalNode | RevisedNode;

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
}

/**
 * Fold a tagged tree down to one side.
 *
 * Total by construction: every node either contributes its representative for
 * `side` or is dropped, and no case is left unhandled. `accept` corresponds to
 * `project(tree, 'revised')` and `reject` to `project(tree, 'original')`.
 */
export function project(node: TaggedNode, side: Side): ProjectedNode | undefined {
  const element = representative(node, side);
  if (element === undefined) return undefined;
  const children: ProjectedNode[] = [];
  for (const child of node.children) {
    const projected = project(child, side);
    if (projected !== undefined) children.push(projected);
  }
  return { element, children };
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
  /** Every input-side node corresponds to exactly one projected node. */
  | 'P1-bijection'
  /** Sibling order in the projection equals sibling order in the input. */
  | 'P2-order'
  /** Parent/child relationships are preserved. */
  | 'P3-containment'
  /** Side-specific text, attributes and properties are the side's own. */
  | 'P4-content'
  /** Unmodeled subtrees are reproduced verbatim. */
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
 * Explicit and named because a signature is only meaningful if every producer
 * uses the same one: a mismatch here makes two identical subtrees compare
 * unequal and silently disables the ordering check that depends on them.
 */
const SIGNATURE_SEPARATOR = '\u0001';

/**
 * Structural signature of an element's own identity — tag name, attributes, and
 * its immediate text, excluding descendants (which are compared separately as
 * their own nodes).
 */
function elementSignature(element: WmlElement): string {
  const attrs: string[] = [];
  const attributes = element.attributes;
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes.item(i);
    if (attr) attrs.push(`${attr.name}=${attr.value}`);
  }
  attrs.sort();

  let ownText = '';
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i]!;
    if (child.nodeType === 3 /* TEXT_NODE */ || child.nodeType === 4 /* CDATA */) {
      ownText += child.nodeValue ?? '';
    }
  }

  return `${element.tagName}|${attrs.join(' ')}|${ownText}`;
}

/** Serialized form of a subtree, for the P5 verbatim comparison. */
function subtreeSignature(element: WmlElement): string {
  const parts: string[] = [elementSignature(element)];
  for (const child of childElements(element)) {
    parts.push(subtreeSignature(child));
  }
  return parts.join(SIGNATURE_SEPARATOR);
}

/**
 * Serialized form of a projected subtree.
 *
 * A projected node with no children stands for its whole element, so it signs
 * as the full input subtree would — that is what lets an unmodeled (opaque)
 * subtree compare equal to the input it was carried from.
 */
function projectedSubtreeSignature(node: ProjectedNode): string {
  if (node.children.length === 0) return subtreeSignature(node.element);
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
 * the input side.
 *
 * Scope: this establishes **IR projection fidelity** only. Serializer
 * correctness, accept/reject semantics, and package/story assembly are separate
 * layers with their own evidence, and a clean result here does not speak to
 * them.
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
        `side's own name, attributes or text`,
    });
  }

  const inputChildren = childElements(input);

  // A tree node with no children stands for the whole input subtree, so the
  // subtree must survive verbatim rather than being silently dropped.
  if (projected.children.length === 0 && inputChildren.length > 0) {
    if (subtreeSignature(projected.element) !== subtreeSignature(input)) {
      violations.push({
        obligation: 'P5-opaque-payload',
        side,
        path,
        detail:
          `unmodeled subtree under <${input.tagName}> is not reproduced ` +
          `verbatim in the ${side} projection`,
      });
    }
    return violations;
  }

  if (projected.children.length !== inputChildren.length) {
    violations.push({
      obligation: 'P3-containment',
      side,
      path,
      detail:
        `<${input.tagName}> has ${inputChildren.length} child element(s) on the ` +
        `${side} side but ${projected.children.length} in the projection`,
    });
  }

  // Reordering is diagnosed at this level, before recursing. The children a
  // projection must reproduce are a *sequence*, so when the same set comes back
  // in a different order the defect is the order — recursing first would report
  // it as a pile of content mismatches deeper down and name the wrong thing.
  // This is the case that a coverage-only obligation cannot see at all:
  // original [A, B] against revised [B, A], tagged [both(B), both(A)], has every
  // input node present exactly once and is still wrong.
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
    const here = childPath(path, inputChild, i + 1);
    violations.push(...verifyProjection(inputChild, projectedChild, side, here));
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
 * Verify both projections of a tagged tree against the documents it was built
 * from.
 *
 * This is the whole obligation of the aligner. When it returns empty, the
 * round-trip property holds by construction of the tree rather than by
 * inspecting serialized output.
 */
export function verifyTaggedTree(
  originalRoot: WmlElement,
  revisedRoot: WmlElement,
  tree: TaggedNode,
): ProjectionViolation[] {
  return [
    ...verifyProjection(originalRoot, project(tree, 'original'), 'original'),
    ...verifyProjection(revisedRoot, project(tree, 'revised'), 'revised'),
  ];
}

/** Formats violations for an error message or a divergence report. */
export function describeViolations(violations: ProjectionViolation[]): string {
  return violations
    .map((v) => `${v.obligation} [${v.side}] at ${v.path}: ${v.detail}`)
    .join('\n');
}

/**
 * Error raised when a constructed tree fails its projection obligations.
 *
 * A violation is an engine defect, not something a downstream pass repairs —
 * the pipeline it replaces reacts to a failed check by trying a different
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
