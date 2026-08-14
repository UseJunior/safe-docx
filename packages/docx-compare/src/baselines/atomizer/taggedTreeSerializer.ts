import { XMLSerializer } from '@xmldom/xmldom';
import type { WmlElement } from '@usejunior/docx-core';
import { childElements, parseXml } from '@usejunior/docx-core';
import {
  nextRevisionId,
  PROPERTY_SCOPE_ELEMENT,
  representative,
  revisionProvenance,
  type RevisionProvenance,
  type Side,
  type TaggedMoveRelation,
  type TaggedNode,
} from './taggedTree.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DIRECT_PROPERTY_BY_CONTAINER: Readonly<Record<string, string>> = {
  p: 'w:pPr',
  r: 'w:rPr',
  tr: 'w:trPr',
  tc: 'w:tcPr',
};
const RANGE_BOUNDARY_LOCALS = new Set([
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd',
  'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd',
]);

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
  const represented = new Set<Element>();
  const indexRepresentatives = (node: TaggedNode): void => {
    const original = representative(node, 'original');
    const revised = representative(node, 'revised');
    if (original) represented.add(original);
    if (revised) represented.add(revised);
    node.children.forEach(indexRepresentatives);
  };
  indexRepresentatives(tree);
  const externalStack = (element: WmlElement): RevisionProvenance[] => {
    const stack = revisionProvenance(element);
    let representedWrapperCount = 0;
    let current: Element | null = element;
    while (current) {
      if (represented.has(current) && ['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'].includes(current.tagName)) {
        representedWrapperCount++;
      }
      current = current.parentElement;
    }
    return representedWrapperCount === 0 ? stack : stack.slice(representedWrapperCount);
  };
  const visit = (node: TaggedNode): void => {
    const original = representative(node, 'original');
    const revised = representative(node, 'revised');
    entries.set(node, {
      node,
      originalStack: original ? externalStack(original) : [],
      revisedStack: revised ? externalStack(revised) : [],
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
    if (/\s/u.test(text.textContent ?? '')) {
      replacement.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    }
    while (text.firstChild) replacement.appendChild(text.firstChild);
    text.parentNode?.replaceChild(replacement, text);
  }
}

function wrapRevision(node: WmlElement, kind: 'ins' | 'del' | 'moveFrom' | 'moveTo', revision: ComparisonRevision): WmlElement {
  const wrapper = node.ownerDocument!.createElementNS(W_NS, `w:${kind}`) as WmlElement;
  wrapper.setAttributeNS(W_NS, 'w:id', String(revision.id));
  wrapper.setAttributeNS(W_NS, 'w:author', revision.author);
  wrapper.setAttributeNS(W_NS, 'w:date', revision.date);
  if (kind === 'del' || kind === 'moveFrom') convertDeletedText(node);
  wrapper.appendChild(node);
  return wrapper;
}

/** ECMA-376 bars field-character runs from w:del. Keep those zero-width
 * structural controls live and split the deletion around them, matching the
 * established hardened deletion path. */
function hoistFieldCharactersFromDeletions(root: WmlElement): void {
  const deletions = Array.from(root.getElementsByTagNameNS(W_NS, 'del')) as WmlElement[];
  for (const deletion of deletions) {
    const parent = deletion.parentNode;
    if (!parent) continue;
    const children = childElements(deletion);
    if (!children.some((child) => child.getElementsByTagNameNS(W_NS, 'fldChar').length > 0)) continue;
    const replacement: WmlElement[] = [];
    let wrapper: WmlElement | undefined;
    const flush = (): void => {
      if (wrapper?.firstChild) replacement.push(wrapper);
      wrapper = undefined;
    };
    for (const child of children) {
      if (child.getElementsByTagNameNS(W_NS, 'fldChar').length > 0) {
        flush();
        replacement.push(child);
      } else {
        if (!wrapper) {
          wrapper = deletion.cloneNode(false) as WmlElement;
        }
        wrapper.appendChild(child);
      }
    }
    flush();
    for (const item of replacement) parent.insertBefore(item, deletion);
    parent.removeChild(deletion);
  }
}

function markWholeParagraph(
  paragraph: WmlElement,
  kind: 'ins' | 'del',
  revision: ComparisonRevision,
  contentRevision: ComparisonRevision,
): WmlElement {
  let pPr = childElements(paragraph).find((child) => child.localName === 'pPr');
  if (!pPr) {
    pPr = paragraph.ownerDocument!.createElementNS(W_NS, 'w:pPr') as WmlElement;
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }
  let paraRPr = childElements(pPr).find((child) => child.localName === 'rPr');
  if (!paraRPr) {
    paraRPr = paragraph.ownerDocument!.createElementNS(W_NS, 'w:rPr') as WmlElement;
    const boundary = childElements(pPr).find((child) => ['sectPr', 'pPrChange'].includes(child.localName));
    pPr.insertBefore(paraRPr, boundary ?? null);
  }
  const marker = paragraph.ownerDocument!.createElementNS(W_NS, `w:${kind}`) as WmlElement;
  marker.setAttributeNS(W_NS, 'w:id', String(revision.id));
  marker.setAttributeNS(W_NS, 'w:author', revision.author);
  marker.setAttributeNS(W_NS, 'w:date', revision.date);
  paraRPr.appendChild(marker);

  const content = childElements(paragraph).filter((child) => child !== pPr);
  for (const child of content) paragraph.removeChild(child);
  let wrapper: WmlElement | undefined;
  const flush = (): void => {
    if (wrapper?.firstChild) paragraph.appendChild(wrapper);
    wrapper = undefined;
  };
  for (const child of content) {
    // Deleted paragraphs keep range boundaries live so Reject All restores
    // their authored topology. Inserted paragraphs must carry boundaries
    // inside the insertion; otherwise Reject All leaves zero-width markers
    // from a paragraph that did not exist on the original side.
    if (RANGE_BOUNDARY_LOCALS.has(child.localName)) {
      flush();
      paragraph.appendChild(
        kind === 'del' ? child : wrapRevision(child, 'ins', contentRevision),
      );
      continue;
    }
    if (!wrapper) {
      wrapper = paragraph.ownerDocument!.createElementNS(W_NS, `w:${kind}`) as WmlElement;
      wrapper.setAttributeNS(W_NS, 'w:id', String(contentRevision.id));
      wrapper.setAttributeNS(W_NS, 'w:author', revision.author);
      wrapper.setAttributeNS(W_NS, 'w:date', revision.date);
    }
    if (kind === 'del') convertDeletedText(child);
    wrapper.appendChild(child);
  }
  flush();
  return paragraph;
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
  if (delta.scope === 'paragraph') {
    applyParagraphPropertyDelta(node, delta.original, delta.revised, revision);
    return;
  }
  if (delta.scope === 'section') {
    const revised = delta.revised ? cloneElement(delta.revised) : undefined;
    const original = delta.original ? cloneElement(delta.original) : undefined;
    while (node.firstChild) node.removeChild(node.firstChild);
    if (revised) {
      for (const child of childElements(revised)) {
        if (child.localName !== 'sectPrChange') node.appendChild(cloneElement(child));
      }
    }
    const change = node.ownerDocument!.createElementNS(W_NS, 'w:sectPrChange') as WmlElement;
    appendChangeMetadata(change, revision);
    const snapshot = node.ownerDocument!.createElementNS(W_NS, 'w:sectPr') as WmlElement;
    if (original) {
      for (const child of childElements(original)) {
        if (child.localName !== 'sectPrChange') snapshot.appendChild(cloneElement(child));
      }
    }
    change.appendChild(snapshot);
    node.appendChild(change);
    return;
  }
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
  // A property addition still needs a typed, empty old-value snapshot.  A
  // self-closing *PrChange element is ambiguous to consumers (and gives the
  // reject projector nothing to restore), whereas OOXML represents the
  // absent original value as an empty container of the corresponding type.
  change.appendChild(
    original ?? property.ownerDocument!.createElementNS(property.namespaceURI, property.tagName),
  );
  property.appendChild(change);
}

function appendChangeMetadata(change: WmlElement, revision: ComparisonRevision): void {
  change.setAttributeNS(W_NS, 'w:id', String(revision.id));
  change.setAttributeNS(W_NS, 'w:author', revision.author);
  change.setAttributeNS(W_NS, 'w:date', revision.date);
}

function applyParagraphPropertyDelta(
  paragraph: WmlElement,
  original: WmlElement | null,
  revised: WmlElement | null,
  revision: ComparisonRevision,
): void {
  const live = revised ? cloneElement(revised) : paragraph.ownerDocument!.createElementNS(W_NS, 'w:pPr') as WmlElement;
  for (const stale of childElements(live).filter((child) => child.localName === 'pPrChange')) live.removeChild(stale);
  const liveMark = childElements(live).find((child) => child.localName === 'rPr');
  const originalMark = original && childElements(original).find((child) => child.localName === 'rPr');
  const liveSection = childElements(live).find((child) => child.localName === 'sectPr');
  const originalSection = original && childElements(original).find((child) => child.localName === 'sectPr');
  if ((liveMark ? new XMLSerializer().serializeToString(liveMark) : '') !==
      (originalMark ? new XMLSerializer().serializeToString(originalMark) : '')) {
    const mark = liveMark ?? paragraph.ownerDocument!.createElementNS(W_NS, 'w:rPr') as WmlElement;
    if (!liveMark) {
      const boundary = childElements(live).find((child) => ['sectPr', 'pPrChange'].includes(child.localName));
      live.insertBefore(mark, boundary ?? null);
    }
    const markChange = paragraph.ownerDocument!.createElementNS(W_NS, 'w:rPrChange') as WmlElement;
    appendChangeMetadata(markChange, revision);
    const snapshot = paragraph.ownerDocument!.createElementNS(W_NS, 'w:rPr') as WmlElement;
    if (originalMark) {
      for (const child of childElements(originalMark)) {
        if (child.localName !== 'rPrChange') snapshot.appendChild(cloneElement(child));
      }
    }
    markChange.appendChild(snapshot);
    mark.appendChild(markChange);
  }
  const serialize = (element: WmlElement | null | undefined): string =>
    element ? new XMLSerializer().serializeToString(element) : '';
  if (serialize(liveSection) !== serialize(originalSection)) {
    const section = liveSection ?? paragraph.ownerDocument!.createElementNS(W_NS, 'w:sectPr') as WmlElement;
    if (!liveSection) live.appendChild(section);
    for (const stale of childElements(section).filter((child) => child.localName === 'sectPrChange')) {
      section.removeChild(stale);
    }
    const change = paragraph.ownerDocument!.createElementNS(W_NS, 'w:sectPrChange') as WmlElement;
    appendChangeMetadata(change, revision);
    const snapshot = paragraph.ownerDocument!.createElementNS(W_NS, 'w:sectPr') as WmlElement;
    if (originalSection) {
      for (const child of childElements(originalSection)) {
        if (child.localName !== 'sectPrChange') snapshot.appendChild(cloneElement(child));
      }
    }
    change.appendChild(snapshot);
    section.appendChild(change);
  }
  const pPrChange = paragraph.ownerDocument!.createElementNS(W_NS, 'w:pPrChange') as WmlElement;
  appendChangeMetadata(pPrChange, revision);
  const snapshot = paragraph.ownerDocument!.createElementNS(W_NS, 'w:pPr') as WmlElement;
  if (original) {
    for (const child of childElements(original)) {
      if (!['rPr', 'sectPr', 'pPrChange'].includes(child.localName)) snapshot.appendChild(cloneElement(child));
    }
  }
  pPrChange.appendChild(snapshot);
  live.appendChild(pPrChange);
  const current = childElements(paragraph).find((child) => child.localName === 'pPr');
  if (current) paragraph.replaceChild(live, current);
  else paragraph.insertBefore(live, paragraph.firstChild);
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

function moveFor(node: TaggedNode, moves: readonly TaggedMoveRelation[]): TaggedMoveRelation | undefined {
  return moves.find((move) => move.source === node || move.destination === node);
}

function refineRunReplacement(
  originalNode: TaggedNode,
  revisedNode: TaggedNode,
  allocateRevision: () => ComparisonRevision,
): WmlElement[] | undefined {
  const original = representative(originalNode, 'original');
  const revised = representative(revisedNode, 'revised');
  if (original?.localName !== 'r' || revised?.localName !== 'r') return undefined;
  // A retained prefix is live in both projections, so it can only be shared
  // when its direct formatting is also shared. Otherwise Accept All and Reject
  // All need distinct runs to recover the revised and original rPr snapshots.
  const originalProperties = childElements(original).find((child) => child.localName === 'rPr');
  const revisedProperties = childElements(revised).find((child) => child.localName === 'rPr');
  if (
    (originalProperties === undefined) !== (revisedProperties === undefined) ||
    (originalProperties && revisedProperties &&
      new XMLSerializer().serializeToString(originalProperties) !==
        new XMLSerializer().serializeToString(revisedProperties))
  ) return undefined;
  const originalContent = childElements(original).filter((child) => child.localName !== 'rPr');
  const revisedContent = childElements(revised).filter((child) => child.localName !== 'rPr');
  if (
    originalContent.length > 1 &&
    originalContent.length === revisedContent.length &&
    originalContent.every((child, index) => child.localName === revisedContent[index]!.localName)
  ) {
    const emitted: WmlElement[] = [];
    const fragmentRun = (source: WmlElement, content: WmlElement): WmlElement => {
      const run = cloneElement(source);
      for (const child of childElements(run)) {
        if (child.localName !== 'rPr') run.removeChild(child);
      }
      run.appendChild(cloneElement(content));
      return run;
    };
    for (let index = 0; index < originalContent.length; index++) {
      const beforeChild = originalContent[index]!;
      const afterChild = revisedContent[index]!;
      if (new XMLSerializer().serializeToString(beforeChild) === new XMLSerializer().serializeToString(afterChild)) {
        emitted.push(fragmentRun(revised, afterChild));
      } else {
        emitted.push(wrapRevision(fragmentRun(original, beforeChild), 'del', allocateRevision()));
        emitted.push(wrapRevision(fragmentRun(revised, afterChild), 'ins', allocateRevision()));
      }
    }
    return emitted;
  }
  const originalTexts = Array.from(original.getElementsByTagNameNS(W_NS, 't'));
  const revisedTexts = Array.from(revised.getElementsByTagNameNS(W_NS, 't'));
  if (originalTexts.length !== 1 || revisedTexts.length !== 1) return undefined;
  const before = originalTexts[0]!.textContent ?? '';
  const after = revisedTexts[0]!.textContent ?? '';
  let prefixLength = 0;
  while (prefixLength < before.length && prefixLength < after.length && before[prefixLength] === after[prefixLength]) prefixLength++;
  while (prefixLength > 0 && /[\p{L}\p{N}_]/u.test(before[prefixLength - 1] ?? '') &&
    /[\p{L}\p{N}_]/u.test(before[prefixLength] ?? after[prefixLength] ?? '')) prefixLength--;
  if (prefixLength === 0) return undefined;
  const emitted: WmlElement[] = [];
  const common = cloneElement(revised);
  common.getElementsByTagNameNS(W_NS, 't')[0]!.textContent = after.slice(0, prefixLength);
  emitted.push(common);
  const deletedText = before.slice(prefixLength);
  if (deletedText) {
    const deletionRun = cloneElement(original);
    deletionRun.getElementsByTagNameNS(W_NS, 't')[0]!.textContent = deletedText;
    emitted.push(wrapRevision(deletionRun, 'del', allocateRevision()));
  }
  const insertedText = after.slice(prefixLength);
  if (insertedText) {
    const insertionRun = cloneElement(revised);
    insertionRun.getElementsByTagNameNS(W_NS, 't')[0]!.textContent = insertedText;
    emitted.push(wrapRevision(insertionRun, 'ins', allocateRevision()));
  }
  return emitted;
}

function moveMarker(
  owner: Document,
  relation: TaggedMoveRelation,
  direction: 'From' | 'To',
  boundary: 'Start' | 'End',
): WmlElement {
  const marker = owner.createElementNS(W_NS, `w:move${direction}Range${boundary}`) as WmlElement;
  const id = direction === 'From' ? relation.sourceRangeId : relation.destinationRangeId;
  marker.setAttributeNS(W_NS, 'w:id', String(id));
  marker.setAttributeNS(W_NS, 'w:name', relation.name);
  return marker;
}

function renumberBookmarkRanges(root: WmlElement, allocateBookmarkId: () => number): void {
  const replacements = new Map<string, string>();
  for (const start of Array.from(root.getElementsByTagNameNS(W_NS, 'bookmarkStart'))) {
    const id = start.getAttributeNS(W_NS, 'id');
    if (!id) continue;
    const replacement = replacements.get(id) ?? String(allocateBookmarkId());
    replacements.set(id, replacement);
    start.setAttributeNS(W_NS, 'w:id', replacement);
  }
  for (const end of Array.from(root.getElementsByTagNameNS(W_NS, 'bookmarkEnd'))) {
    const id = end.getAttributeNS(W_NS, 'id');
    const replacement = id ? replacements.get(id) : undefined;
    if (replacement) end.setAttributeNS(W_NS, 'w:id', replacement);
  }
}

function emitNode(
  node: TaggedNode,
  plan: PreservePlan,
  bothSide: Side = 'revised',
  moves: readonly TaggedMoveRelation[] = [],
  allocateRevision: () => ComparisonRevision,
  allocateBookmarkId: () => number,
): WmlElement {
  const nodeRevision = allocateRevision();
  const base = cloneElement(representative(node, node.tag === 'original' ? 'original' : node.tag === 'revised' ? 'revised' : bothSide)!);
  if (!node.opaque && node.children.length > 0) {
    const directPropertyTag = DIRECT_PROPERTY_BY_CONTAINER[base.localName];
    const retainedProperty = directPropertyTag
      ? childElements(base).find((child) => child.tagName === directPropertyTag)
      : undefined;
    const emitted: WmlElement[] = retainedProperty ? [retainedProperty] : [];
    const propertyTag = node.tag === 'both' && node.propertyDelta
      ? PROPERTY_SCOPE_ELEMENT[node.propertyDelta.scope]
      : directPropertyTag;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index]!;
      const childElement = representative(child, child.tag === 'original' ? 'original' : 'revised');
      if (propertyTag && childElement?.tagName === propertyTag) {
        continue;
      }
      const next = node.children[index + 1];
      if (child.tag === 'original' && next?.tag === 'revised' &&
          !moveFor(child, moves) && !moveFor(next, moves)) {
        const refined = refineRunReplacement(child, next, allocateRevision);
        if (refined) {
          emitted.push(...refined);
          index++;
          continue;
        }
      }
      const relation = moveFor(child, moves);
      if (relation) {
        const direction = relation.source === child ? 'From' : 'To';
        emitted.push(moveMarker(base.ownerDocument!, relation, direction, 'Start'));
        emitted.push(emitNode(child, plan, 'revised', moves, allocateRevision, allocateBookmarkId));
        emitted.push(moveMarker(base.ownerDocument!, relation, direction, 'End'));
      } else emitted.push(emitNode(child, plan, 'revised', moves, allocateRevision, allocateBookmarkId));
    }
    replaceElementChildren(base, emitted);
  }
  applyPropertyDelta(base, node, nodeRevision);
  const entry = plan.entries.get(node)!;
  if (node.tag === 'original') {
    const relation = moveFor(node, moves);
    if (relation) renumberBookmarkRanges(base, allocateBookmarkId);
    const revision = relation ? { ...plan.comparison, id: relation.sourceRangeId } : nodeRevision;
    if (!relation && base.namespaceURI === W_NS && base.localName === 'p') {
      return wrapPreserved(markWholeParagraph(base, 'del', revision, allocateRevision()), entry.originalStack);
    }
    return wrapPreserved(wrapRevision(base, relation ? 'moveFrom' : 'del', revision), entry.originalStack);
  }
  if (node.tag === 'revised') {
    const relation = moveFor(node, moves);
    const revision = relation ? { ...plan.comparison, id: relation.destinationRangeId } : nodeRevision;
    if (!relation && base.namespaceURI === W_NS && base.localName === 'p') {
      return wrapPreserved(markWholeParagraph(base, 'ins', revision, allocateRevision()), entry.revisedStack);
    }
    return wrapPreserved(wrapRevision(base, relation ? 'moveTo' : 'ins', revision), entry.revisedStack);
  }
  const stack = entry.revisedStack.length > 0 ? entry.revisedStack : entry.originalStack;
  return wrapPreserved(base, stack);
}

/** Serialize a tagged tree to shadow-only OOXML tracked markup. */
export interface TaggedTreeSerializerOptions {
  /** Package/story skeleton. Tracked content still projects to both sides. */
  baseSide?: Side;
  moves?: readonly TaggedMoveRelation[];
}

export function serializeTaggedTree(
  tree: TaggedNode,
  plan: PreservePlan,
  options: TaggedTreeSerializerOptions = {},
): string {
  if (!plan.entries.has(tree)) throw new Error('PreservePlan does not belong to this TaggedTree');
  let nextId = Math.max(
    plan.comparison.id,
    ...((options.moves ?? []).flatMap((move) => [move.sourceRangeId, move.destinationRangeId])),
  ) + 1;
  const allocateRevision = (): ComparisonRevision => ({ ...plan.comparison, id: nextId++ });
  const representatives = tree.tag === 'both' ? [tree.original, tree.revised] : [tree.node];
  const usedBookmarkIds = representatives.flatMap((root) => [
    ...Array.from(root.getElementsByTagNameNS(W_NS, 'bookmarkStart')),
    ...Array.from(root.getElementsByTagNameNS(W_NS, 'bookmarkEnd')),
  ]).map((element) => Number(element.getAttributeNS(W_NS, 'id')))
    .filter((id) => Number.isSafeInteger(id) && id >= 0);
  let nextBookmarkId = Math.max(-1, ...usedBookmarkIds) + 1;
  const emitted = emitNode(
    tree,
    plan,
    options.baseSide ?? 'revised',
    options.moves ?? [],
    allocateRevision,
    () => nextBookmarkId++,
  );
  hoistFieldCharactersFromDeletions(emitted);
  return new XMLSerializer().serializeToString(emitted);
}

/**
 * Compose independently aligned text-box or ancillary stories as IR subtrees.
 * The input parent is not mutated, keeping story recursion additive in Stage A.
 */
export function composeTaggedStories(parent: TaggedNode, stories: readonly TaggedNode[]): TaggedNode {
  return { ...parent, children: [...parent.children, ...stories] } as TaggedNode;
}

/** Certify exactly one balanced range in each direction for every logical move. */
export function verifySerializedMoveRanges(
  xml: string,
  relations: readonly TaggedMoveRelation[],
): string[] {
  const document = parseXml(xml);
  const violations: string[] = [];
  const stacks: Record<'From' | 'To', string[]> = { From: [], To: [] };
  const elements = Array.from(document.getElementsByTagName('*'));
  for (const element of elements) {
    const match = /^move(From|To)Range(Start|End)$/.exec(element.localName ?? '');
    if (!match) continue;
    const direction = match[1] as 'From' | 'To';
    const boundary = match[2] as 'Start' | 'End';
    const name = element.getAttributeNS(W_NS, 'name') ?? '';
    if (boundary === 'Start') stacks[direction].push(name);
    else if (stacks[direction].pop() !== name) violations.push(`${direction.toLowerCase()} move ranges cross or close out of order`);
  }
  for (const direction of ['From', 'To'] as const) {
    if (stacks[direction].length > 0) violations.push(`${direction.toLowerCase()} move ranges are unbalanced`);
  }
  for (const relation of relations) {
    for (const [direction, id] of [
      ['From', relation.sourceRangeId],
      ['To', relation.destinationRangeId],
    ] as const) {
      for (const boundary of ['Start', 'End'] as const) {
        const matches = Array.from(document.getElementsByTagNameNS(W_NS, `move${direction}Range${boundary}`))
          .filter((element) => element.getAttributeNS(W_NS, 'id') === String(id) &&
            element.getAttributeNS(W_NS, 'name') === relation.name);
        if (matches.length !== 1) {
          violations.push(`${relation.name} ${direction.toLowerCase()} range ${boundary.toLowerCase()} count is ${matches.length}`);
        }
      }
      const wrappers = Array.from(document.getElementsByTagNameNS(W_NS, `move${direction}`))
        .filter((element) => element.getAttributeNS(W_NS, 'id') === String(id));
      if (wrappers.length !== 1) violations.push(`${relation.name} ${direction.toLowerCase()} wrapper count is ${wrappers.length}`);
    }
  }
  return violations;
}

/** Return the side representative stack retained by the plan. */
export function preservedStack(plan: PreservePlan, node: TaggedNode, side: Side): readonly RevisionProvenance[] {
  const entry = plan.entries.get(node);
  if (!entry) throw new Error('TaggedNode is absent from PreservePlan');
  return side === 'original' ? entry.originalStack : entry.revisedStack;
}
