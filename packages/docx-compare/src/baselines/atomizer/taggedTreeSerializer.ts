import { XMLSerializer } from '@xmldom/xmldom';
import type { WmlElement } from '@usejunior/docx-core';
import {
  childElements,
  parseXml,
  REVISION_ID_ELEMENT_NAME_SET,
} from '@usejunior/docx-core';
import { alignComparisonSequences, tokenizeComparisonText } from '../../textAlignment.js';
import { placeParagraphMarkRevisionMarker } from './inPlaceModifier-wrappers.js';
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
/** Tracked-change markers `CT_ParaRPr` admits on a paragraph mark, at most one of. */
const PARAGRAPH_MARK_REVISION_LOCALS = new Set(['ins', 'del', 'moveFrom', 'moveTo']);

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

function convertDeletedText(root: WmlElement): WmlElement {
  const texts = Array.from(root.getElementsByTagNameNS(W_NS, 't'));
  if (root.namespaceURI === W_NS && root.localName === 't') texts.unshift(root);
  let convertedRoot = root;
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
    if (text === root && !text.parentNode) convertedRoot = replacement as WmlElement;
    else text.parentNode?.replaceChild(replacement, text);
  }
  return convertedRoot;
}

function wrapRevision(node: WmlElement, kind: 'ins' | 'del' | 'moveFrom' | 'moveTo', revision: ComparisonRevision): WmlElement {
  const wrapper = node.ownerDocument!.createElementNS(W_NS, `w:${kind}`) as WmlElement;
  wrapper.setAttributeNS(W_NS, 'w:id', String(revision.id));
  wrapper.setAttributeNS(W_NS, 'w:author', revision.author);
  wrapper.setAttributeNS(W_NS, 'w:date', revision.date);
  if (kind === 'del' || kind === 'moveFrom') node = convertDeletedText(node);
  wrapper.appendChild(node);
  return wrapper;
}

/**
 * Keep field-character controls live and split deletion content around them,
 * matching the established hardened deletion path.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.13
 */
function hoistFieldCharactersFromDeletions(root: WmlElement): void {
  const deletions = Array.from(root.getElementsByTagNameNS(W_NS, 'del')) as WmlElement[];
  for (const deletion of deletions) {
    const parent = deletion.parentNode;
    if (!parent) continue;
    const deletedFields = Array.from(deletion.getElementsByTagNameNS(W_NS, 'fldChar'));
    const deletedFieldTypes = deletedFields.map((field) =>
      field.getAttributeNS(W_NS, 'fldCharType') ?? field.getAttribute('w:fldCharType') ?? '');
    if (deletedFieldTypes.join('|') === 'begin|separate|end') continue;
    let nextElement = deletion.nextSibling;
    while (nextElement && nextElement.nodeType !== 1) nextElement = nextElement.nextSibling;
    if (nextElement && (nextElement as WmlElement).localName === 'ins') {
      const types = (element: WmlElement): string[] => Array.from(
        element.getElementsByTagNameNS(W_NS, 'fldChar'),
        (field) => field.getAttributeNS(W_NS, 'fldCharType') ?? field.getAttribute('w:fldCharType') ?? '',
      );
      const deletedTypes = types(deletion);
      const insertedTypes = types(nextElement as WmlElement);
      if (
        deletedTypes.join('|') === 'begin|separate|end' &&
        insertedTypes.join('|') === deletedTypes.join('|')
      ) continue;
    }
    if (deletedFields.length === 1 && nextElement && (nextElement as WmlElement).localName === 'ins') {
      const insertedFields = Array.from(
        (nextElement as WmlElement).getElementsByTagNameNS(W_NS, 'fldChar'),
      );
      const fieldType = (field: Element): string | null =>
        field.getAttributeNS(W_NS, 'fldCharType') ?? field.getAttribute('w:fldCharType');
      if (insertedFields.length === 1 && fieldType(deletedFields[0]!) === fieldType(insertedFields[0]!)) {
        continue;
      }
    }
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

/**
 * Keep literal replacement content outside a deleted complex-field
 * instruction. A live field skeleton may remain for consumer compatibility,
 * but Accept All must never see literal text between begin and separate when
 * the instruction itself exists only in Reject All.
 */
function hoistLiteralInsertionsFromDeletedFieldInstructions(root: WmlElement): void {
  const visit = (container: WmlElement): void => {
    for (const child of childElements(container)) visit(child);

    for (;;) {
      const siblings = childElements(container);
      const stack: Array<{ begin: WmlElement; instructionNodes: WmlElement[] }> = [];
      let changed = false;
      for (const sibling of siblings) {
        const fieldCharacters = Array.from(sibling.getElementsByTagNameNS(W_NS, 'fldChar'));
        const types = fieldCharacters.map((field) => field.getAttributeNS(W_NS, 'fldCharType'));
        if (types.includes('begin')) {
          stack.push({ begin: sibling, instructionNodes: [] });
          continue;
        }
        const active = stack[stack.length - 1];
        if (!active) continue;
        if (types.includes('separate')) {
          const deletedInstruction = active.instructionNodes.some((node) =>
            (node.localName === 'del' || node.getElementsByTagNameNS(W_NS, 'del').length > 0) &&
            (node.getElementsByTagNameNS(W_NS, 'instrText').length > 0 ||
              node.getElementsByTagNameNS(W_NS, 'delInstrText').length > 0),
          );
          if (deletedInstruction) {
            const literalInsertions = active.instructionNodes.filter((node) => {
              if (node.localName !== 'ins') return false;
              const runs = childElements(node);
              return runs.length > 0 && runs.every((run) =>
                run.localName === 'r' && childElements(run).every((content) =>
                  ['rPr', 't'].includes(content.localName),
                ),
              );
            });
            if (literalInsertions.length > 0) {
              for (const insertion of literalInsertions) {
                container.insertBefore(insertion, active.begin);
              }
              changed = true;
              break;
            }
          }
          continue;
        }
        if (types.includes('end')) {
          stack.pop();
          continue;
        }
        active.instructionNodes.push(sibling);
      }
      if (!changed) break;
    }
  };
  visit(root);
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
  placeParagraphMarkRevisionMarker(paraRPr, marker, `w:${kind}`);

  const content = childElements(paragraph).filter((child) => child !== pPr);
  for (const child of content) paragraph.removeChild(child);
  let wrapper: WmlElement | undefined;
  const flush = (): void => {
    if (wrapper?.firstChild) paragraph.appendChild(wrapper);
    wrapper = undefined;
  };
  for (const child of content) {
    // Boundaries follow the paragraph's source projection so original-only
    // markers continue to delimit the deleted text in the combined redline.
    // The paragraph-mark revision removes the entire paragraph on Accept All,
    // so keeping these zero-width markers live does not leak them into the
    // accepted projection.
    if (RANGE_BOUNDARY_LOCALS.has(child.localName)) {
      flush();
      paragraph.appendChild(child);
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

/**
 * Encode a deleted paragraph break on the preceding paragraph when one exists.
 *
 * A whole-paragraph deletion has two independent edits: delete the paragraph's
 * contents and delete the break immediately before those contents.  Keeping the
 * break marker on the deleted paragraph works for Safe DOCX's internal projector,
 * but LibreOffice cannot remove a terminal paragraph container that way and leaves
 * an empty final paragraph.  Moving the marker to the preceding paragraph lets
 * Accept All merge that survivor into the deleted container.  The deleted
 * container temporarily carries the survivor's properties so the merged paragraph
 * keeps its revised formatting; a conforming pPrChange snapshot restores the
 * deleted paragraph's original properties on Reject All.
 *
 * Relocation is deliberately conservative.  It never crosses a non-paragraph
 * block such as a table, because the paragraph before a table is not the
 * paragraph whose break precedes this content.  It never targets a predecessor
 * whose own paragraph mark already carries a tracked change, because
 * `CT_ParaRPr` admits at most one of `w:ins`/`w:del`/`w:moveFrom`/`w:moveTo`.
 * It never touches a section-bearing paragraph, because moving the mark across
 * a `w:sectPr` boundary makes LibreOffice resolve Reject All incorrectly.
 * Deletions outside that envelope keep the pre-existing topology, which stays
 * schema-valid and Word-correct even where LibreOffice still leaves an empty
 * terminal container.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @see https://github.com/UseJunior/safe-docx/issues/891
 */
function normalizeWholeParagraphDeletions(
  root: WmlElement,
  generatedRevisionIds: ReadonlySet<number>,
  allocateRevision: () => ComparisonRevision,
): void {
  const revisionElements = (scope: WmlElement): WmlElement[] => {
    const revisions: WmlElement[] = [];
    const collect = (element: WmlElement): void => {
      if (element.namespaceURI === W_NS && REVISION_ID_ELEMENT_NAME_SET.has(element.localName)) {
        revisions.push(element);
      }
      for (const child of childElements(element)) collect(child);
    };
    collect(scope);
    return revisions;
  };
  const revisionWasGenerated = (element: WmlElement): boolean => {
    const id = Number(element.getAttributeNS(W_NS, 'id'));
    return Number.isSafeInteger(id) && generatedRevisionIds.has(id);
  };
  const paragraphProperties = (paragraph: WmlElement): WmlElement | undefined =>
    childElements(paragraph).find((child) => child.localName === 'pPr');
  const carriesSection = (paragraph: WmlElement): boolean => {
    const properties = paragraphProperties(paragraph);
    return !!properties && childElements(properties).some((child) => child.localName === 'sectPr');
  };
  const carriesParagraphMarkRevision = (paragraph: WmlElement): boolean => {
    const properties = paragraphProperties(paragraph);
    const markProperties = properties && childElements(properties).find((child) => child.localName === 'rPr');
    return !!markProperties && childElements(markProperties).some((child) =>
      child.namespaceURI === W_NS && PARAGRAPH_MARK_REVISION_LOCALS.has(child.localName));
  };

  const relocate = (paragraph: WmlElement, predecessor: WmlElement | undefined): void => {
    if (!predecessor) return;
    // CT_ParaRPr admits at most one tracked-change marker; never add a second.
    if (carriesParagraphMarkRevision(predecessor)) return;
    // A w:sectPr boundary changes how the merged paragraph resolves on Reject All.
    if (carriesSection(paragraph) || carriesSection(predecessor)) return;
    const predecessorPropertiesBefore = paragraphProperties(predecessor);
    const predecessorRevisions = predecessorPropertiesBefore
      ? revisionElements(predecessorPropertiesBefore)
      : [];
    if (predecessorRevisions.some((element) => !revisionWasGenerated(element)) ||
        predecessorRevisions.some((element) => ['ins', 'moveFrom', 'moveTo'].includes(element.localName))) {
      return;
    }
    const pPr = childElements(paragraph).find((child) => child.localName === 'pPr');
    const markProperties = pPr && childElements(pPr).find((child) => child.localName === 'rPr');
    const marker = markProperties && childElements(markProperties).find((child) => {
      if (child.localName !== 'del') return false;
      const id = Number(child.getAttributeNS(W_NS, 'id'));
      return Number.isSafeInteger(id) && generatedRevisionIds.has(id);
    });
    const content = childElements(paragraph).filter((child) =>
      child !== pPr && !RANGE_BOUNDARY_LOCALS.has(child.localName));
    if (!pPr || !markProperties || !marker || content.length === 0 ||
        content.some((child) => child.namespaceURI !== W_NS || child.localName !== 'del')) return;
    if (revisionElements(pPr).some((element) => element !== marker)) return;

    const originalProperties = cloneElement(pPr);
    const originalMarkProperties = childElements(originalProperties).find((child) => child.localName === 'rPr');
    const originalMarker = originalMarkProperties && childElements(originalMarkProperties).find((child) =>
      child.localName === 'del' && child.getAttributeNS(W_NS, 'id') === marker.getAttributeNS(W_NS, 'id'));
    originalMarker?.parentNode?.removeChild(originalMarker);
    if (originalMarkProperties && childElements(originalMarkProperties).length === 0) {
      originalProperties.removeChild(originalMarkProperties);
    }

    let predecessorProperties = childElements(predecessor).find((child) => child.localName === 'pPr');
    const revisedProperties = predecessorProperties
      ? cloneElement(predecessorProperties)
      : predecessor.ownerDocument!.createElementNS(W_NS, 'w:pPr') as WmlElement;
    for (const stale of revisionElements(revisedProperties)) {
      stale.parentNode?.removeChild(stale);
    }
    if (!predecessorProperties) {
      predecessorProperties = predecessor.ownerDocument!.createElementNS(W_NS, 'w:pPr') as WmlElement;
      predecessor.insertBefore(predecessorProperties, predecessor.firstChild);
    }
    let predecessorMarkProperties = childElements(predecessorProperties).find((child) => child.localName === 'rPr');
    if (!predecessorMarkProperties) {
      predecessorMarkProperties = predecessor.ownerDocument!.createElementNS(W_NS, 'w:rPr') as WmlElement;
      const boundary = childElements(predecessorProperties).find((child) =>
        ['sectPr', 'pPrChange'].includes(child.localName));
      predecessorProperties.insertBefore(predecessorMarkProperties, boundary ?? null);
    }
    marker.parentNode!.removeChild(marker);
    placeParagraphMarkRevisionMarker(predecessorMarkProperties, marker, 'w:del');
    if (childElements(markProperties).length === 0) pPr.removeChild(markProperties);

    applyParagraphPropertyDelta(
      paragraph,
      originalProperties,
      revisedProperties,
      allocateRevision(),
    );
  };

  const visit = (container: WmlElement): void => {
    // Track the immediately preceding sibling paragraph in a single pass.  Any
    // intervening block clears the candidate, so a marker never crosses a table,
    // and the walk stays linear in the number of children.
    let predecessor: WmlElement | undefined;
    for (const child of childElements(container)) {
      if (child.namespaceURI !== W_NS || child.localName !== 'p') {
        visit(child);
        predecessor = undefined;
        continue;
      }
      relocate(child, predecessor);
      predecessor = child;
    }
  };
  visit(root);
}

function markWholeTableRow(
  row: WmlElement,
  kind: 'ins' | 'del',
  revision: ComparisonRevision,
): WmlElement {
  let trPr = childElements(row).find((child) => child.localName === 'trPr');
  if (!trPr) {
    trPr = row.ownerDocument!.createElementNS(W_NS, 'w:trPr') as WmlElement;
    row.insertBefore(trPr, row.firstChild);
  }
  const marker = row.ownerDocument!.createElementNS(W_NS, `w:${kind}`) as WmlElement;
  marker.setAttributeNS(W_NS, 'w:id', String(revision.id));
  marker.setAttributeNS(W_NS, 'w:author', revision.author);
  marker.setAttributeNS(W_NS, 'w:date', revision.date);
  const boundary = childElements(trPr).find((child) =>
    kind === 'ins'
      ? ['del', 'trPrChange'].includes(child.localName)
      : child.localName === 'trPrChange');
  trPr.insertBefore(marker, boundary ?? null);
  return row;
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
  if (
    originalContent.length !== 1 || revisedContent.length !== 1 ||
    originalContent[0]!.localName !== 't' || revisedContent[0]!.localName !== 't'
  ) return undefined;
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

function simpleTextRun(node: TaggedNode, side: Side): WmlElement | undefined {
  const run = representative(node, side);
  if (run?.localName !== 'r') return undefined;
  if (revisionProvenance(run).length > 0) return undefined;
  const content = childElements(run).filter((child) => child.localName !== 'rPr');
  return content.filter((child) => child.localName === 't').length === 1 &&
    content.every((child) => child.localName === 't' || child.localName === 'tab')
    ? run
    : undefined;
}

function runText(run: WmlElement): string {
  return run.getElementsByTagNameNS(W_NS, 't')[0]?.textContent ?? '';
}

const fragmentSource = new WeakMap<WmlElement, WmlElement>();

function runFragment(run: WmlElement, value: string): WmlElement {
  const fragment = cloneElement(run);
  fragmentSource.set(fragment, run);
  const text = fragment.getElementsByTagNameNS(W_NS, 't')[0]!;
  text.textContent = value;
  if (/^\s|\s$/u.test(value)) text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  else text.removeAttributeNS('http://www.w3.org/XML/1998/namespace', 'space');
  return fragment;
}

function runProperties(run: WmlElement): WmlElement | null {
  return childElements(run).find((child) => child.localName === 'rPr') ?? null;
}

function emitCommonRun(
  original: WmlElement,
  revised: WmlElement,
  value: string,
  allocateRevision: () => ComparisonRevision,
): WmlElement {
  const live = runFragment(revised, value);
  const before = runProperties(original);
  const after = runProperties(revised);
  const serialize = (property: WmlElement | null): string => property
    ? new XMLSerializer().serializeToString(property)
    : '';
  if (serialize(before) !== serialize(after)) {
    applyPropertyDelta(live, {
      tag: 'both', original, revised, children: [], opaque: true,
      propertyDelta: { scope: 'run', original: before, revised: after, changedProperties: ['directProperties'] },
    }, allocateRevision());
  }
  return live;
}

interface TextToken { value: string; run: WmlElement; start: number }

function appendCoalescedTextEmission(emitted: WmlElement[], next: WmlElement): void {
  const previous = emitted[emitted.length - 1];
  if (!previous || previous.localName !== next.localName) {
    emitted.push(next);
    return;
  }
  const previousRun = previous.localName === 'r'
    ? previous
    : childElements(previous).length === 1 && childElements(previous)[0]!.localName === 'r'
      ? childElements(previous)[0]!
      : undefined;
  const nextRun = next.localName === 'r'
    ? next
    : childElements(next).length === 1 && childElements(next)[0]!.localName === 'r'
      ? childElements(next)[0]!
      : undefined;
  if (!previousRun || !nextRun) {
    emitted.push(next);
    return;
  }
  if (fragmentSource.get(previousRun) !== fragmentSource.get(nextRun)) {
    emitted.push(next);
    return;
  }
  const signature = (run: WmlElement): string => {
    const properties = runProperties(run);
    return properties ? new XMLSerializer().serializeToString(properties) : '';
  };
  const previousText = childElements(previousRun).find((child) => ['t', 'delText'].includes(child.localName));
  const nextText = childElements(nextRun).find((child) => ['t', 'delText'].includes(child.localName));
  if (!previousText || !nextText || previousText.localName !== nextText.localName ||
      signature(previousRun) !== signature(nextRun)) {
    emitted.push(next);
    return;
  }
  previousText.textContent = (previousText.textContent ?? '') + (nextText.textContent ?? '');
  if (/^\s|\s$/u.test(previousText.textContent ?? '')) {
    previousText.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  }
}

function tokenizedRuns(runs: readonly WmlElement[], concatenate: boolean): TextToken[] {
  if (!concatenate) {
    let start = 0;
    return runs.flatMap((run) => {
      const tokens = tokenizeComparisonText(runText(run)).map((value) => {
        const token = { value, run, start };
        start += value.length;
        return token;
      });
      return tokens;
    });
  }
  const text = runs.map(runText).join('');
  let offset = 0;
  const ownerAt = (position: number): WmlElement => {
    let end = 0;
    for (const run of runs) {
      end += runText(run).length;
      if (position < end) return run;
    }
    return runs[runs.length - 1]!;
  };
  return tokenizeComparisonText(text).map((value) => {
    const token = { value, run: ownerAt(offset), start: offset };
    offset += value.length;
    return token;
  });
}

function emitCommonToken(
  originalToken: TextToken,
  revisedToken: TextToken,
  originals: readonly WmlElement[],
  revised: readonly WmlElement[],
  allocateRevision: () => ComparisonRevision,
): WmlElement[] {
  const relativeBoundaries = new Set<number>([0, originalToken.value.length]);
  const addBoundaries = (runs: readonly WmlElement[], tokenStart: number): void => {
    let boundary = 0;
    for (const run of runs) {
      boundary += runText(run).length;
      const relative = boundary - tokenStart;
      if (relative > 0 && relative < originalToken.value.length) relativeBoundaries.add(relative);
    }
  };
  addBoundaries(originals, originalToken.start);
  addBoundaries(revised, revisedToken.start);
  const ownerAt = (runs: readonly WmlElement[], position: number): WmlElement => {
    let end = 0;
    for (const run of runs) {
      end += runText(run).length;
      if (position < end) return run;
    }
    return runs[runs.length - 1]!;
  };
  const boundaries = [...relativeBoundaries].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => emitCommonRun(
    ownerAt(originals, originalToken.start + start),
    ownerAt(revised, revisedToken.start + start),
    originalToken.value.slice(start, boundaries[index + 1]),
    allocateRevision,
  ));
}

function refineSimpleRunGap(
  originals: readonly WmlElement[],
  revised: readonly WmlElement[],
  allocateRevision: () => ComparisonRevision,
): WmlElement[] | undefined {
  if (originals.length === 0 || revised.length === 0) return undefined;
  const before = originals.map(runText).join('');
  const after = revised.map(runText).join('');
  const hasAuxiliaryContent = [...originals, ...revised].some((run) =>
    childElements(run).some((child) => !['rPr', 't'].includes(child.localName)));
  if (before === after) {
    if (hasAuxiliaryContent) {
      const propertySignatures = new Set([...originals, ...revised].map((run) => {
        const property = runProperties(run);
        return property ? new XMLSerializer().serializeToString(property) : '';
      }));
      if (propertySignatures.size > 1) return undefined;
    }
    const boundaries = new Set<number>([0, before.length]);
    for (const runs of [originals, revised]) {
      let offset = 0;
      for (const run of runs) { offset += runText(run).length; boundaries.add(offset); }
    }
    const offsets = [...boundaries].sort((a, b) => a - b);
    const ownerAt = (runs: readonly WmlElement[], offset: number): WmlElement => {
      let end = 0;
      for (const run of runs) { end += runText(run).length; if (offset < end) return run; }
      return runs[runs.length - 1]!;
    };
    const emitted: WmlElement[] = [];
    offsets.slice(0, -1).forEach((start, index) => {
      const value = before.slice(start, offsets[index + 1]);
      if (value) appendCoalescedTextEmission(
        emitted,
        emitCommonRun(ownerAt(originals, start), ownerAt(revised, start), value, allocateRevision),
      );
    });
    return emitted;
  }
  if (hasAuxiliaryContent) return undefined;
  const directPropertySignatures = new Set([...originals, ...revised].map((run) => {
    const property = runProperties(run);
    return property ? new XMLSerializer().serializeToString(property) : '';
  }));
  const concatenate = directPropertySignatures.size === 1;
  const left = tokenizedRuns(originals, concatenate);
  const right = tokenizedRuns(revised, concatenate);
  const alignment = alignComparisonSequences(left, right, (a, b) => a.value === b.value);
  const matches = new Map(alignment.matches.map((match) => [match.originalIndex, match.revisedIndex]));
  const deleted = new Set(alignment.deletedIndices);
  const emitted: WmlElement[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && matches.get(i) === j) {
      for (const common of emitCommonToken(left[i]!, right[j]!, originals, revised, allocateRevision)) {
        appendCoalescedTextEmission(emitted, common);
      }
      i++; j++;
    } else if (i < left.length && deleted.has(i)) {
      appendCoalescedTextEmission(emitted, wrapRevision(runFragment(left[i]!.run, left[i]!.value), 'del', allocateRevision())); i++;
    } else {
      appendCoalescedTextEmission(emitted, wrapRevision(runFragment(right[j]!.run, right[j]!.value), 'ins', allocateRevision())); j++;
    }
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

function renumberOriginalBookmarkRanges(
  root: WmlElement,
  replacements: Map<string, string>,
  allocateBookmarkId: () => number,
): void {
  const boundaries = [
    ...(root.localName === 'bookmarkStart' || root.localName === 'bookmarkEnd' ? [root] : []),
    ...Array.from(root.getElementsByTagNameNS(W_NS, 'bookmarkStart')),
    ...Array.from(root.getElementsByTagNameNS(W_NS, 'bookmarkEnd')),
  ];
  for (const boundary of boundaries) {
    const id = boundary.getAttributeNS(W_NS, 'id');
    if (!id) continue;
    const replacement = replacements.get(id) ?? String(allocateBookmarkId());
    replacements.set(id, replacement);
    boundary.setAttributeNS(W_NS, 'w:id', replacement);
  }
}

function splitSharedBookmarkBoundaries(
  base: WmlElement,
  original: WmlElement,
  splitBookmarkIds: ReadonlySet<string>,
  originalBookmarkIds: Map<string, string>,
  allocateBookmarkId: () => number,
  allocateRevision: () => ComparisonRevision,
): void {
  for (const tag of ['bookmarkStart', 'bookmarkEnd'] as const) {
    const originalById = new Map(childElements(original)
      .filter((boundary) => boundary.namespaceURI === W_NS && boundary.localName === tag)
      .map((boundary) => [boundary.getAttributeNS(W_NS, 'id'), boundary] as const)
      .filter((entry): entry is [string, Element] => entry[0] !== null));
    for (const revisedBoundary of childElements(base)
      .filter((boundary) => boundary.namespaceURI === W_NS && boundary.localName === tag)) {
      const id = revisedBoundary.getAttributeNS(W_NS, 'id');
      const originalBoundary = id ? originalById.get(id) : undefined;
      if (!id || !splitBookmarkIds.has(id) || !originalBoundary || !revisedBoundary.parentNode) continue;
      const originalClone = cloneElement(originalBoundary as WmlElement);
      const revisedClone = cloneElement(revisedBoundary as WmlElement);
      renumberOriginalBookmarkRanges(originalClone, originalBookmarkIds, allocateBookmarkId);
      const parent = revisedBoundary.parentNode;
      parent.insertBefore(wrapRevision(originalClone, 'del', allocateRevision()), revisedBoundary);
      parent.replaceChild(wrapRevision(revisedClone, 'ins', allocateRevision()), revisedBoundary);
    }
  }
}

function splitCrossParagraphBookmarkCounterparts(
  root: WmlElement,
  originalBookmarkIds: ReadonlyMap<string, string>,
  allocateRevision: () => ComparisonRevision,
): void {
  const markers = (tag: 'bookmarkStart' | 'bookmarkEnd', id: string): Element[] => [
    ...(root.localName === tag && root.getAttributeNS(W_NS, 'id') === id ? [root] : []),
    ...Array.from(root.getElementsByTagNameNS(W_NS, tag))
      .filter((marker) => marker.getAttributeNS(W_NS, 'id') === id),
  ];
  const split = (marker: Element, replacementId: string): void => {
    const parent = marker.parentNode;
    if (!parent) return;
    const originalClone = cloneElement(marker as WmlElement);
    originalClone.setAttributeNS(W_NS, 'w:id', replacementId);
    const revisedClone = cloneElement(marker as WmlElement);
    parent.insertBefore(wrapRevision(originalClone, 'del', allocateRevision()), marker);
    parent.replaceChild(wrapRevision(revisedClone, 'ins', allocateRevision()), marker);
  };
  for (const [sourceId, replacementId] of originalBookmarkIds) {
    const replacementStarts = markers('bookmarkStart', replacementId);
    const replacementEnds = markers('bookmarkEnd', replacementId);
    if (replacementStarts.length === 0 && replacementEnds.length > 0) {
      const sharedStart = markers('bookmarkStart', sourceId)[0];
      if (sharedStart) split(sharedStart, replacementId);
    } else if (replacementEnds.length === 0 && replacementStarts.length > 0) {
      const sharedEnd = markers('bookmarkEnd', sourceId)[0];
      if (sharedEnd) split(sharedEnd, replacementId);
    }
  }
}

function emitAtomicRetargetedField(
  children: readonly TaggedNode[],
  start: number,
  plan: PreservePlan,
  allocateRevision: () => ComparisonRevision,
): { emitted: WmlElement[]; end: number } | undefined {
  const originals: WmlElement[] = [];
  const revised: WmlElement[] = [];
  const instructions = { original: [] as string[], revised: [] as string[] };
  const controls = { original: [] as string[], revised: [] as string[] };
  let depth = 0;
  let sawBegin = false;
  let sawSeparate = false;
  let sawEnd = false;
  let cursor = start;
  while (cursor < children.length) {
    const oldNode = children[cursor]!;
    const paired = oldNode.tag === 'both' ? oldNode : children[cursor + 1];
    if (oldNode.tag !== 'both' && (oldNode.tag !== 'original' || paired?.tag !== 'revised')) break;
    const oldRun = representative(oldNode, 'original');
    const newRun = representative(paired!, 'revised');
    if (
      plan.entries.get(oldNode)?.originalStack.length ||
      plan.entries.get(paired!)?.revisedStack.length
    ) break;
    if (!oldRun || !newRun || oldRun.localName !== 'r' || newRun.localName !== 'r') break;
    const fieldTypes = (run: WmlElement): string[] => Array.from(
      run.getElementsByTagNameNS(W_NS, 'fldChar'),
      (field) => field.getAttributeNS(W_NS, 'fldCharType') ?? field.getAttribute('w:fldCharType') ?? '',
    );
    const oldTypes = fieldTypes(oldRun);
    const newTypes = fieldTypes(newRun);
    if (oldTypes.join('|') !== newTypes.join('|')) break;
    if (cursor === start && oldTypes[0] !== 'begin') break;
    instructions.original.push(...Array.from(
      oldRun.getElementsByTagNameNS(W_NS, 'instrText'),
      (instruction) => instruction.textContent ?? '',
    ));
    instructions.revised.push(...Array.from(
      newRun.getElementsByTagNameNS(W_NS, 'instrText'),
      (instruction) => instruction.textContent ?? '',
    ));
    controls.original.push(...Array.from(
      oldRun.getElementsByTagNameNS(W_NS, 'fldChar'),
      (field) => new XMLSerializer().serializeToString(field),
    ));
    controls.revised.push(...Array.from(
      newRun.getElementsByTagNameNS(W_NS, 'fldChar'),
      (field) => new XMLSerializer().serializeToString(field),
    ));
    originals.push(oldRun);
    revised.push(newRun);
    for (const type of oldTypes) {
      if (type === 'begin') {
        depth++;
        sawBegin = true;
      } else if (type === 'separate' && depth === 1) {
        sawSeparate = true;
      } else if (type === 'end') {
        depth--;
        if (depth < 0) return undefined;
        if (depth === 0) sawEnd = true;
      }
    }
    cursor += oldNode.tag === 'both' ? 1 : 2;
    if (sawEnd) break;
  }
  if (!sawBegin || !sawSeparate || !sawEnd || depth !== 0) return undefined;
  const oldInstruction = instructions.original.join('').trim().replace(/\s+/gu, ' ');
  const newInstruction = instructions.revised.join('').trim().replace(/\s+/gu, ' ');
  const controlsDiffer = controls.original.join('|') !== controls.revised.join('|');
  if (!oldInstruction || !newInstruction || (oldInstruction === newInstruction && !controlsDiffer)) return undefined;

  const oldWrapper = wrapRevision(cloneElement(originals[0]!), 'del', allocateRevision());
  const newWrapper = wrapRevision(cloneElement(revised[0]!), 'ins', allocateRevision());
  for (const run of originals.slice(1)) oldWrapper.appendChild(cloneElement(run));
  for (const run of revised.slice(1)) newWrapper.appendChild(cloneElement(run));
  convertDeletedText(oldWrapper);
  return { emitted: [oldWrapper, newWrapper], end: cursor };
}

function emitAtomicSideOnlyField(
  children: readonly TaggedNode[],
  start: number,
  plan: PreservePlan,
  allocateRevision: () => ComparisonRevision,
): { emitted: WmlElement; end: number } | undefined {
  const side = children[start]?.tag;
  if (side !== 'original' && side !== 'revised') return undefined;
  const runs: WmlElement[] = [];
  let depth = 0;
  let sawBegin = false;
  let sawSeparate = false;
  let sawEnd = false;
  let cursor = start;
  for (; cursor < children.length && children[cursor]!.tag === side; cursor++) {
    const child = children[cursor]!;
    const entry = plan.entries.get(child);
    if ((side === 'original' ? entry?.originalStack : entry?.revisedStack)?.length) break;
    const run = representative(child, side);
    if (!run || run.localName !== 'r') break;
    const types = Array.from(
      run.getElementsByTagNameNS(W_NS, 'fldChar'),
      (field) => field.getAttributeNS(W_NS, 'fldCharType') ?? field.getAttribute('w:fldCharType') ?? '',
    );
    if (cursor === start && types[0] !== 'begin') break;
    runs.push(run);
    for (const type of types) {
      if (type === 'begin') { depth++; sawBegin = true; }
      else if (type === 'separate' && depth === 1) sawSeparate = true;
      else if (type === 'end') {
        depth--;
        if (depth < 0) return undefined;
        if (depth === 0) sawEnd = true;
      }
    }
    if (sawEnd) { cursor++; break; }
  }
  if (!sawBegin || !sawSeparate || !sawEnd || depth !== 0) return undefined;
  const wrapper = wrapRevision(
    cloneElement(runs[0]!),
    side === 'original' ? 'del' : 'ins',
    allocateRevision(),
  );
  for (const run of runs.slice(1)) wrapper.appendChild(cloneElement(run));
  if (side === 'original') convertDeletedText(wrapper);
  return { emitted: wrapper, end: cursor };
}

function emitNode(
  node: TaggedNode,
  plan: PreservePlan,
  bothSide: Side = 'revised',
  moves: readonly TaggedMoveRelation[] = [],
  allocateRevision: () => ComparisonRevision,
  allocateBookmarkId: () => number,
  originalBookmarkIds: Map<string, string>,
  splitBookmarkIds: ReadonlySet<string>,
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
      if (childElement?.namespaceURI === W_NS && childElement.localName === 'lastRenderedPageBreak') {
        // This pagination cache marker is not authored content and cannot be
        // nested in w:ins/w:del inside a run. Keep the revised marker live;
        // omitting an original-only marker is projection-semantically neutral.
        if (child.tag !== 'original') emitted.push(cloneElement(childElement));
        continue;
      }
      if (
        child.tag === 'both' &&
        (childElement?.localName === 'bookmarkStart' || childElement?.localName === 'bookmarkEnd')
      ) {
        const originalBoundary = representative(child, 'original')!;
        const revisedBoundary = representative(child, 'revised')!;
        const originalId = originalBoundary.getAttributeNS(W_NS, 'id');
        if (originalId && splitBookmarkIds.has(originalId)) {
          const originalClone = cloneElement(originalBoundary);
          renumberOriginalBookmarkRanges(originalClone, originalBookmarkIds, allocateBookmarkId);
          const entry = plan.entries.get(child)!;
          emitted.push(wrapPreserved(
            wrapRevision(originalClone, 'del', allocateRevision()),
            entry.originalStack,
          ));
          emitted.push(wrapPreserved(
            wrapRevision(cloneElement(revisedBoundary), 'ins', allocateRevision()),
            entry.revisedStack,
          ));
          continue;
        }
      }
      const atomicField = emitAtomicRetargetedField(node.children, index, plan, allocateRevision);
      if (atomicField) {
        emitted.push(...atomicField.emitted);
        index = atomicField.end - 1;
        continue;
      }
      const sideOnlyField = emitAtomicSideOnlyField(node.children, index, plan, allocateRevision);
      if (sideOnlyField) {
        emitted.push(sideOnlyField.emitted);
        index = sideOnlyField.end - 1;
        continue;
      }
      if (child.tag === 'original' || child.tag === 'revised') {
        let end = index;
        const originals: WmlElement[] = [];
        const revisions: WmlElement[] = [];
        while (end < node.children.length) {
          const candidate = node.children[end]!;
          if (candidate.tag === 'both' || moveFor(candidate, moves)) break;
          const run = simpleTextRun(candidate, candidate.tag);
          if (!run) break;
          (candidate.tag === 'original' ? originals : revisions).push(run);
          end++;
        }
        if (end > index + 1) {
          const refined = refineSimpleRunGap(originals, revisions, allocateRevision);
          if (refined) {
            emitted.push(...refined);
            index = end - 1;
            continue;
          }
        }
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
        emitted.push(emitNode(child, plan, 'revised', moves, allocateRevision, allocateBookmarkId, originalBookmarkIds, splitBookmarkIds));
        emitted.push(moveMarker(base.ownerDocument!, relation, direction, 'End'));
      } else emitted.push(emitNode(child, plan, 'revised', moves, allocateRevision, allocateBookmarkId, originalBookmarkIds, splitBookmarkIds));
    }
    replaceElementChildren(base, emitted);
  }
  if (node.tag === 'both') {
    splitSharedBookmarkBoundaries(
      base,
      node.original,
      splitBookmarkIds,
      originalBookmarkIds,
      allocateBookmarkId,
      allocateRevision,
    );
  }
  applyPropertyDelta(base, node, nodeRevision);
  const entry = plan.entries.get(node)!;
  if (node.tag === 'original') {
    const relation = moveFor(node, moves);
    // Original and revised packages allocate bookmark IDs independently. Give
    // every original-only boundary a serializer-wide namespace so aligned,
    // deleted, moved, and cross-paragraph ranges cannot collide in the combined
    // tracked document. Opaque subtrees are handled here; expanded subtrees
    // renumber their individual original nodes during recursive emission.
    if (node.opaque || base.localName === 'bookmarkStart' || base.localName === 'bookmarkEnd') {
      renumberOriginalBookmarkRanges(base, originalBookmarkIds, allocateBookmarkId);
    }
    const revision = relation ? { ...plan.comparison, id: relation.sourceRangeId } : nodeRevision;
    if (!relation && base.namespaceURI === W_NS && base.localName === 'p') {
      return wrapPreserved(markWholeParagraph(base, 'del', revision, allocateRevision()), entry.originalStack);
    }
    if (!relation && base.namespaceURI === W_NS && base.localName === 'tr') {
      return wrapPreserved(markWholeTableRow(base, 'del', revision), entry.originalStack);
    }
    return wrapPreserved(wrapRevision(base, relation ? 'moveFrom' : 'del', revision), entry.originalStack);
  }
  if (node.tag === 'revised') {
    const relation = moveFor(node, moves);
    const revision = relation ? { ...plan.comparison, id: relation.destinationRangeId } : nodeRevision;
    if (!relation && base.namespaceURI === W_NS && base.localName === 'p') {
      return wrapPreserved(markWholeParagraph(base, 'ins', revision, allocateRevision()), entry.revisedStack);
    }
    if (!relation && base.namespaceURI === W_NS && base.localName === 'tr') {
      return wrapPreserved(markWholeTableRow(base, 'ins', revision), entry.revisedStack);
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
  const representatives = tree.tag === 'both' ? [tree.original, tree.revised] : [tree.node];
  // getElementsByTagNameNS reports descendants only, so a representative that is
  // itself a revision wrapper would go uncounted and its authored ID could be
  // reissued to a generated revision. Include each root alongside its descendants.
  const usedRevisionIds = representatives.flatMap((root) => [
    root,
    ...[...REVISION_ID_ELEMENT_NAME_SET].flatMap((localName) =>
      Array.from(root.getElementsByTagNameNS(W_NS, localName))),
  ]).filter((element) =>
    element.namespaceURI === W_NS && REVISION_ID_ELEMENT_NAME_SET.has(element.localName))
    .map((element) => Number(element.getAttributeNS(W_NS, 'id')))
    .filter((id) => Number.isSafeInteger(id) && id >= 0);
  let nextId = Math.max(
    plan.comparison.id,
    ...((options.moves ?? []).flatMap((move) => [move.sourceRangeId, move.destinationRangeId])),
    ...usedRevisionIds,
  ) + 1;
  const generatedRevisionIds = new Set<number>();
  const allocateRevision = (): ComparisonRevision => {
    const revision = { ...plan.comparison, id: nextId++ };
    generatedRevisionIds.add(revision.id);
    return revision;
  };
  const usedBookmarkIds = representatives.flatMap((root) => [
    ...Array.from(root.getElementsByTagNameNS(W_NS, 'bookmarkStart')),
    ...Array.from(root.getElementsByTagNameNS(W_NS, 'bookmarkEnd')),
  ]).map((element) => Number(element.getAttributeNS(W_NS, 'id')))
    .filter((id) => Number.isSafeInteger(id) && id >= 0);
  let nextBookmarkId = Math.max(-1, ...usedBookmarkIds) + 1;
  const originalBookmarkIds = new Map<string, string>();
  // When one endpoint of an original range is side-only but its counterpart is
  // aligned on both sides, the aligned marker cannot remain unconditional: it
  // would pair with both the deleted original endpoint and the inserted revised
  // endpoint. Split that shared marker into del/ins alternatives atomically.
  const splitBookmarkIds = new Set<string>();
  const findSplitBookmarkIds = (node: TaggedNode): void => {
    if (node.tag === 'original') {
      const boundary = representative(node, 'original');
      if (boundary?.localName === 'bookmarkStart' || boundary?.localName === 'bookmarkEnd') {
        const id = boundary.getAttributeNS(W_NS, 'id');
        if (id) splitBookmarkIds.add(id);
      }
    }
    node.children.forEach(findSplitBookmarkIds);
  };
  findSplitBookmarkIds(tree);
  const emitted = emitNode(
    tree,
    plan,
    options.baseSide ?? 'revised',
    options.moves ?? [],
    allocateRevision,
    () => nextBookmarkId++,
    originalBookmarkIds,
    splitBookmarkIds,
  );
  splitCrossParagraphBookmarkCounterparts(emitted, originalBookmarkIds, allocateRevision);
  normalizeWholeParagraphDeletions(emitted, generatedRevisionIds, allocateRevision);
  hoistFieldCharactersFromDeletions(emitted);
  hoistLiteralInsertionsFromDeletedFieldInstructions(emitted);
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
