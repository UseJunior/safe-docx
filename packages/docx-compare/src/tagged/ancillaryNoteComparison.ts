import { XMLSerializer } from '@xmldom/xmldom';
import {
  type FormatDetectionSettings,
  parseXml,
} from '@usejunior/docx-core';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { buildTaggedTreePublication } from './taggedTreeShadow.js';
import { refuseUnreportedBlockContainer } from './unrepresentedChanges.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';
import { premergeAdjacentRuns } from './premergeRuns.js';
import {
  backfillParentReferences,
  findBody,
  parseDocumentXml,
} from './xmlToWmlElement.js';

const serializer = new XMLSerializer();
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface NoteDefinitionComparisonOptions {
  author: string;
  date: Date;
  formatDetection?: FormatDetectionSettings;
}

function namespaceAttributes(entry: Element): string {
  const declarations = new Map<string, string>();
  let current: Element | null = entry;
  while (current) {
    for (let i = 0; i < current.attributes.length; i++) {
      const attr = current.attributes.item(i)!;
      if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) {
        if (!declarations.has(attr.name)) declarations.set(attr.name, attr.value);
      }
    }
    current = current.parentNode?.nodeType === 1 ? current.parentNode as Element : null;
  }
  if (!declarations.has('xmlns:w')) declarations.set('xmlns:w', W_NS);
  return [...declarations]
    .map(([name, value]) => ` ${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`)
    .join('');
}

function wrapDefinition(entry: Element): string {
  let content = '';
  for (let child = entry.firstChild; child; child = child.nextSibling) {
    content += serializer.serializeToString(child);
  }
  return `<w:document${namespaceAttributes(entry)}><w:body>${content}</w:body></w:document>`;
}

function prepareDefinition(entry: Element): string {
  const root = parseDocumentXml(wrapDefinition(entry));
  backfillParentReferences(root);
  const body = findBody(root);
  if (!body) throw new Error('Could not create note comparison story');
  premergeAdjacentRuns(body);
  return serializer.serializeToString(root);
}

const INLINE_REFERENCE_CONTAINERS = new Set(['hyperlink', 'fldSimple']);
const INLINE_REFERENCE_MARKERS = new Set([
  'fldChar',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
]);

/**
 * Hyperlinks, field structure and comment anchors placed among the
 * definition's text and other run content, in document order. Text and
 * formatting alone cannot show a retargeted, unlinked or moved hyperlink, a
 * changed or moved field, or a re-anchored comment, so an unchanged-looking
 * definition is passed through only when these agree as well. Adjacent text and adjacent field instruction
 * fragments merge, so run splits alone do not count as a difference.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1389
 */
function inlineReferenceSignature(xml: string): string {
  const tokens: string[] = [];
  const attributesOf = (element: Element): string[] => Array.from(element.attributes)
    .filter((attribute) => !attribute.name.startsWith('xmlns'))
    .map((attribute) => `${attribute.namespaceURI ?? ''}:${attribute.localName}=${attribute.value}`)
    .sort();
  // Adjacent text, and adjacent instruction fragments, merge.
  const pushMerged = (prefix: 'T:' | 'I:', text: string): void => {
    const last = tokens.length - 1;
    if (last >= 0 && tokens[last]!.startsWith(prefix)) tokens[last] += text;
    else tokens.push(`${prefix}${text}`);
  };
  const visit = (element: Element): void => {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const node = child as Element;
      const name = node.namespaceURI === W_NS ? node.localName : '';
      const parentName = element.namespaceURI === W_NS ? element.localName : '';
      if (name === 't' || name === 'delText') {
        pushMerged('T:', node.textContent ?? '');
      } else if (name === 'instrText' || name === 'delInstrText') {
        pushMerged('I:', node.textContent ?? '');
      } else if (INLINE_REFERENCE_MARKERS.has(name)) {
        tokens.push(JSON.stringify([name, attributesOf(node)]));
      } else if (parentName === 'r' && name !== 'rPr') {
        // Other run content (a break, tab or symbol) also sits inside or
        // outside a hyperlink or comment range.
        tokens.push(JSON.stringify(['atom', name, attributesOf(node)]));
      } else if (INLINE_REFERENCE_CONTAINERS.has(name)) {
        tokens.push(JSON.stringify(['open', name, attributesOf(node)]));
        visit(node);
        tokens.push(JSON.stringify(['close', name]));
      } else {
        if (name === 'p') tokens.push('P');
        visit(node);
      }
    }
  };
  const root = parseXml(xml).documentElement;
  if (root) visit(root);
  return JSON.stringify(tokens);
}

/**
 * Compare one corresponding footnote or endnote definition as an independent
 * Word story.
 * Tagged construction and publication are reused so paragraphs, runs, fields,
 * and formatting receive the same structural treatment as the main story
 * while matches cannot leak across definition boundaries.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/763
 * @see https://github.com/UseJunior/safe-docx/issues/996
 */
export function compareNoteDefinitions(
  originalEntry: Element,
  revisedEntry: Element,
  options: NoteDefinitionComparisonOptions,
): Element[] {
  const originalXml = prepareDefinition(originalEntry);
  const revisedXml = prepareDefinition(revisedEntry);
  if (
    extractRoundTripComparisonText(originalXml) === extractRoundTripComparisonText(revisedXml) &&
    inlineReferenceSignature(originalXml) === inlineReferenceSignature(revisedXml) &&
    compareSourceProjectedFormattingFidelity(originalXml, revisedXml, revisedXml).reject.score === 1
  ) {
    const unchangedBody = parseXml(revisedXml).getElementsByTagName('w:body').item(0);
    if (!unchangedBody) throw new Error('Note definition comparison emitted no story body');
    return Array.from(unchangedBody.childNodes)
      .filter((node): node is Element => node.nodeType === 1);
  }
  const publication = buildTaggedTreePublication({
    originalXml,
    revisedXml,
    author: options.author,
    date: options.date,
    detectFormatChanges: options.formatDetection?.detectFormatChanges ?? true,
    detectMoves: false,
  });
  refuseUnreportedBlockContainer(
    publication.unrepresentedChanges,
    revisedEntry.localName === 'endnote' ? 'word/endnotes.xml' : 'word/footnotes.xml',
  );
  const comparedXml = publication.xml;
  const expectedAccepted = extractRoundTripComparisonText(
    acceptAllChanges(revisedXml),
  );
  const expectedRejected = extractRoundTripComparisonText(
    rejectAllChanges(originalXml),
  );
  const actualAccepted = extractRoundTripComparisonText(acceptAllChanges(comparedXml));
  const actualRejected = extractRoundTripComparisonText(rejectAllChanges(comparedXml));
  if (actualAccepted !== expectedAccepted || actualRejected !== expectedRejected) {
    throw new Error('Note definition comparison failed accept/reject projection safety');
  }
  const comparedBody = parseXml(comparedXml).getElementsByTagName('w:body').item(0);
  if (!comparedBody) throw new Error('Note definition comparison emitted no story body');
  return Array.from(comparedBody.childNodes)
    .filter((node): node is Element => node.nodeType === 1);
}

export interface CorrespondingNotePair {
  originalId: string;
  revisedId: string;
  /** Zero-based position of the pair among the paragraph's anchors of the kind. */
  ordinal: number;
  /** The paragraph's anchor IDs of the kind after Reject, in document order. */
  originalSequence: string[];
  /** The paragraph's anchor IDs of the kind after Accept, in document order. */
  revisedSequence: string[];
}

function hasAncestor(element: Element, tagName: string): boolean {
  let current: Node | null = element.parentNode;
  while (current?.nodeType === 1) {
    if ((current as Element).tagName === tagName) return true;
    current = current.parentNode;
  }
  return false;
}

function nearestParagraph(element: Element): Element | null {
  let current: Node | null = element.parentNode;
  while (current?.nodeType === 1) {
    if ((current as Element).tagName === 'w:p') return current as Element;
    current = current.parentNode;
  }
  return null;
}

/**
 * Pair the deleted and inserted note references of one kind that final tagged
 * markup leaves in the same paragraph, by ordinal. A paragraph qualifies only
 * when its Reject and Accept anchor sequences have equal length and every
 * position is either one live reference or a deleted reference opposite an
 * inserted one; added, removed, moved or doubly wrapped anchors decline the
 * whole paragraph. Each paired identifier must occur exactly once in the
 * emitted story, so a copied or repeated reference is never treated as one
 * aligned note. Collision-renumbered and pre-distinct identifiers pair alike;
 * callers still verify both source paragraphs and the definition shapes.
 * Footnote and endnote identifiers are separate spaces, so references of the
 * other kind never take part in a pairing.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.7
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 * @see https://github.com/UseJunior/safe-docx/issues/852
 * @see https://github.com/UseJunior/safe-docx/issues/996
 */
export function findCorrespondingNotePairs(
  documentXml: string,
  kind: 'footnote' | 'endnote',
): CorrespondingNotePair[] {
  const document = parseXml(documentXml);
  const references = Array.from(document.getElementsByTagName(`w:${kind}Reference`));
  const occurrences = new Map<string, number>();
  const paragraphs = new Map<Element | null, Element[]>();
  for (const reference of references) {
    const id = reference.getAttribute('w:id') ?? '';
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    const paragraph = nearestParagraph(reference);
    if (!paragraphs.has(paragraph)) paragraphs.set(paragraph, []);
    paragraphs.get(paragraph)!.push(reference);
  }
  const candidates: CorrespondingNotePair[] = [];
  for (const [paragraph, anchors] of paragraphs) {
    if (!paragraph) continue;
    const states = anchors.map((reference) => {
      const deleted = hasAncestor(reference, 'w:del');
      const inserted = hasAncestor(reference, 'w:ins');
      if (hasAncestor(reference, 'w:moveFrom') || hasAncestor(reference, 'w:moveTo') || (deleted && inserted)) {
        return 'other';
      }
      return deleted ? 'del' : inserted ? 'ins' : 'live';
    });
    if (states.includes('other')) continue;
    const rejected = anchors.filter((_, index) => states[index] !== 'ins');
    const accepted = anchors.filter((_, index) => states[index] !== 'del');
    if (rejected.length !== accepted.length) continue;
    const originalSequence = rejected.map((reference) => reference.getAttribute('w:id') ?? '');
    const revisedSequence = accepted.map((reference) => reference.getAttribute('w:id') ?? '');
    const pairs: CorrespondingNotePair[] = [];
    let aligned = true;
    for (let ordinal = 0; ordinal < rejected.length; ordinal++) {
      const deleted = rejected[ordinal]!;
      const inserted = accepted[ordinal]!;
      if (deleted === inserted) continue;
      const originalId = originalSequence[ordinal]!;
      const revisedId = revisedSequence[ordinal]!;
      if (
        states[anchors.indexOf(deleted)] !== 'del' ||
        states[anchors.indexOf(inserted)] !== 'ins' ||
        originalId === revisedId ||
        occurrences.get(originalId) !== 1 ||
        occurrences.get(revisedId) !== 1
      ) {
        aligned = false;
        break;
      }
      pairs.push({ originalId, revisedId, ordinal, originalSequence, revisedSequence });
    }
    if (aligned) candidates.push(...pairs);
  }
  return candidates;
}
