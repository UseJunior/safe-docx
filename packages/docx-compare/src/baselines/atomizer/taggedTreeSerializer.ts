import { XMLSerializer } from '@xmldom/xmldom';
import type { WmlElement } from '@usejunior/docx-core';
import { childElements } from '@usejunior/docx-core';
import {
  nextRevisionId,
  representative,
  revisionProvenance,
  type RevisionProvenance,
  type Side,
  type TaggedNode,
} from './taggedTree.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface ComparisonRevision {
  id: number;
  author: string;
  date: string;
}

export interface PreservePlanEntry {
  node: TaggedNode;
  originalStack: readonly RevisionProvenance[];
  revisedStack: readonly RevisionProvenance[];
  /** Comparison markup is nested inside preserved wrappers, never around them. */
  comparisonNesting: 'inside-preserved';
}

/**
 * Pre-serializer proof object for PRESERVE behavior.
 *
 * The ordered stacks are captured before cloning severs parent links. The
 * comparison identifier is allocated after scanning both roots, so the
 * serializer cannot accidentally reuse an identifier owned by a prior author.
 */
export interface PreservePlan {
  comparison: ComparisonRevision;
  entries: ReadonlyMap<TaggedNode, PreservePlanEntry>;
}

export function createPreservePlan(
  originalRoot: WmlElement,
  revisedRoot: WmlElement,
  tree: TaggedNode,
  attribution: Omit<ComparisonRevision, 'id'>,
): PreservePlan {
  const entries = new Map<TaggedNode, PreservePlanEntry>();
  const visit = (node: TaggedNode): void => {
    const original = representative(node, 'original');
    const revised = representative(node, 'revised');
    entries.set(node, {
      node,
      originalStack: original ? revisionProvenance(original) : [],
      revisedStack: revised ? revisionProvenance(revised) : [],
      comparisonNesting: 'inside-preserved',
    });
    node.children.forEach(visit);
  };
  visit(tree);
  return {
    comparison: { id: nextRevisionId(originalRoot, revisedRoot), ...attribution },
    entries,
  };
}

function cloneElement(element: WmlElement): WmlElement {
  return element.cloneNode(true) as WmlElement;
}

function replaceElementChildren(target: WmlElement, children: readonly WmlElement[]): void {
  for (const child of childElements(target)) target.removeChild(child);
  for (const child of children) target.appendChild(child);
}

function convertDeletedText(root: WmlElement): void {
  const texts = Array.from(root.getElementsByTagNameNS(W_NS, 't'));
  if (root.namespaceURI === W_NS && root.localName === 't') texts.unshift(root);
  for (const text of texts) {
    const replacement = text.ownerDocument!.createElementNS(W_NS, 'w:delText');
    for (let i = 0; i < text.attributes.length; i++) {
      const attr = text.attributes.item(i);
      if (attr) replacement.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    while (text.firstChild) replacement.appendChild(text.firstChild);
    text.parentNode?.replaceChild(replacement, text);
  }
}

function wrapRevision(node: WmlElement, kind: 'ins' | 'del', revision: ComparisonRevision): WmlElement {
  const wrapper = node.ownerDocument!.createElementNS(W_NS, `w:${kind}`) as WmlElement;
  wrapper.setAttributeNS(W_NS, 'w:id', String(revision.id));
  wrapper.setAttributeNS(W_NS, 'w:author', revision.author);
  wrapper.setAttributeNS(W_NS, 'w:date', revision.date);
  if (kind === 'del') convertDeletedText(node);
  wrapper.appendChild(node);
  return wrapper;
}

const CHANGE_ELEMENT_BY_SCOPE = {
  run: 'w:rPrChange',
  paragraphMark: 'w:rPrChange',
  paragraph: 'w:pPrChange',
  tableRow: 'w:trPrChange',
  tableCell: 'w:tcPrChange',
  section: 'w:sectPrChange',
} as const;

function applyPropertyDelta(node: WmlElement, tagged: TaggedNode, revision: ComparisonRevision): void {
  if (tagged.tag !== 'both' || !tagged.propertyDelta) return;
  const delta = tagged.propertyDelta;
  const live = delta.revised ? cloneElement(delta.revised) : undefined;
  const original = delta.original ? cloneElement(delta.original) : undefined;
  const expectedLocalName = live?.localName ?? original?.localName;
  let property = childElements(node).find((child) => child.localName === expectedLocalName);
  if (!property && (live || original)) {
    property = live ?? node.ownerDocument!.createElementNS(
      original!.namespaceURI,
      original!.tagName,
    ) as WmlElement;
    node.insertBefore(property, node.firstChild);
  }
  if (!property) return;
  while (property.firstChild) property.removeChild(property.firstChild);
  if (live) {
    while (live.firstChild) property.appendChild(live.firstChild);
  }
  const change = property.ownerDocument!.createElementNS(
    W_NS,
    CHANGE_ELEMENT_BY_SCOPE[delta.scope],
  ) as WmlElement;
  change.setAttributeNS(W_NS, 'w:id', String(revision.id));
  change.setAttributeNS(W_NS, 'w:author', revision.author);
  change.setAttributeNS(W_NS, 'w:date', revision.date);
  if (original) change.appendChild(original);
  property.appendChild(change);
}

function wrapPreserved(node: WmlElement, stack: readonly RevisionProvenance[]): WmlElement {
  let current = node;
  for (let index = stack.length - 1; index >= 0; index--) {
    const prior = stack[index]!;
    // A wrapper represented as the node itself is already present in the clone.
    if (current.tagName === prior.kind) continue;
    const wrapper = current.ownerDocument!.createElementNS(W_NS, prior.kind) as WmlElement;
    if (prior.id !== null) wrapper.setAttributeNS(W_NS, 'w:id', prior.id);
    if (prior.author !== null) wrapper.setAttributeNS(W_NS, 'w:author', prior.author);
    if (prior.date !== null) wrapper.setAttributeNS(W_NS, 'w:date', prior.date);
    wrapper.appendChild(current);
    current = wrapper;
  }
  return current;
}

/**
 * Split content at an alignment boundary while retaining every enclosing prior
 * revision on every fragment. This is deliberately model-level: callers pass
 * detached fragment elements and receive detached, independently wrapped
 * fragments, so no source DOM is mutated.
 */
export function splitWithPreservedProvenance(
  source: WmlElement,
  fragments: readonly WmlElement[],
): WmlElement[] {
  const stack = revisionProvenance(source);
  return fragments.map((fragment) => wrapPreserved(cloneElement(fragment), stack));
}

function emitNode(node: TaggedNode, plan: PreservePlan, bothSide: Side = 'revised'): WmlElement {
  const base = cloneElement(representative(node, node.tag === 'original' ? 'original' : node.tag === 'revised' ? 'revised' : bothSide)!);
  if (!node.opaque && node.children.length > 0) {
    replaceElementChildren(base, node.children.map((child) => emitNode(child, plan)));
  }
  applyPropertyDelta(base, node, plan.comparison);
  const entry = plan.entries.get(node)!;
  if (node.tag === 'original') {
    return wrapPreserved(wrapRevision(base, 'del', plan.comparison), entry.originalStack);
  }
  if (node.tag === 'revised') {
    return wrapPreserved(wrapRevision(base, 'ins', plan.comparison), entry.revisedStack);
  }
  const stack = entry.revisedStack.length > 0 ? entry.revisedStack : entry.originalStack;
  return wrapPreserved(base, stack);
}

/** Serialize a tagged tree to shadow-only OOXML tracked markup. */
export interface TaggedTreeSerializerOptions {
  /** Package/story skeleton. Tracked content still projects to both sides. */
  baseSide?: Side;
}

export function serializeTaggedTree(
  tree: TaggedNode,
  plan: PreservePlan,
  options: TaggedTreeSerializerOptions = {},
): string {
  if (!plan.entries.has(tree)) throw new Error('PreservePlan does not belong to this TaggedTree');
  return new XMLSerializer().serializeToString(emitNode(tree, plan, options.baseSide ?? 'revised'));
}

/**
 * Compose independently aligned text-box or ancillary stories as IR subtrees.
 * The input parent is not mutated, keeping story recursion additive in Stage A.
 */
export function composeTaggedStories(parent: TaggedNode, stories: readonly TaggedNode[]): TaggedNode {
  return { ...parent, children: [...parent.children, ...stories] } as TaggedNode;
}

/** Return the side representative stack retained by the plan. */
export function preservedStack(plan: PreservePlan, node: TaggedNode, side: Side): readonly RevisionProvenance[] {
  const entry = plan.entries.get(node);
  if (!entry) throw new Error('TaggedNode is absent from PreservePlan');
  return side === 'original' ? entry.originalStack : entry.revisedStack;
}
