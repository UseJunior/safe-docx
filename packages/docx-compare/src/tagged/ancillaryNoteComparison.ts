import { XMLSerializer } from '@xmldom/xmldom';
import {
  type FormatDetectionSettings,
  parseXml,
} from '@usejunior/docx-core';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { buildTaggedTreePublication } from './taggedTreeShadow.js';
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

/**
 * Compare one corresponding footnote definition as an independent Word story.
 * Tagged construction and publication are reused so paragraphs, runs, fields,
 * and formatting receive the same structural treatment as the main story
 * while matches cannot leak across definition boundaries.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/763
 */
export function compareFootnoteDefinitions(
  originalEntry: Element,
  revisedEntry: Element,
  options: NoteDefinitionComparisonOptions,
): Element[] {
  const originalXml = prepareDefinition(originalEntry);
  const revisedXml = prepareDefinition(revisedEntry);
  if (
    extractRoundTripComparisonText(originalXml) === extractRoundTripComparisonText(revisedXml) &&
    compareSourceProjectedFormattingFidelity(originalXml, revisedXml, revisedXml).reject.score === 1
  ) {
    const unchangedBody = parseXml(revisedXml).getElementsByTagName('w:body').item(0);
    if (!unchangedBody) throw new Error('Footnote comparison emitted no story body');
    return Array.from(unchangedBody.childNodes)
      .filter((node): node is Element => node.nodeType === 1);
  }
  const comparedXml = buildTaggedTreePublication({
    originalXml,
    revisedXml,
    author: options.author,
    date: options.date,
    detectFormatChanges: options.formatDetection?.detectFormatChanges ?? true,
    detectMoves: false,
  }).xml;
  const expectedAccepted = extractRoundTripComparisonText(
    acceptAllChanges(revisedXml),
  );
  const expectedRejected = extractRoundTripComparisonText(
    rejectAllChanges(originalXml),
  );
  const actualAccepted = extractRoundTripComparisonText(acceptAllChanges(comparedXml));
  const actualRejected = extractRoundTripComparisonText(rejectAllChanges(comparedXml));
  if (actualAccepted !== expectedAccepted || actualRejected !== expectedRejected) {
    throw new Error('Footnote definition comparison failed accept/reject projection safety');
  }
  const comparedBody = parseXml(comparedXml).getElementsByTagName('w:body').item(0);
  if (!comparedBody) throw new Error('Footnote comparison emitted no story body');
  return Array.from(comparedBody.childNodes)
    .filter((node): node is Element => node.nodeType === 1);
}

export interface CorrespondingFootnotePair {
  originalId: string;
  revisedId: string;
}

function hasAncestor(element: Element, tagName: string): boolean {
  let current: Node | null = element.parentNode;
  while (current?.nodeType === 1) {
    if ((current as Element).tagName === tagName) return true;
    current = current.parentNode;
  }
  return false;
}

/**
 * Reconcile only collision-renumbered references that final tagged markup puts
 * in the same paragraph as one delete/insert pair. This keeps arbitrary same-ID
 * definitions from independently authored documents collision-safe without a
 * dependency on the legacy merged-atom stream.
 */
export function findCorrespondingFootnotePairs(
  documentXml: string,
  renumberings: readonly { label: string; fromId: string; toId: string }[],
): CorrespondingFootnotePair[] {
  const document = parseXml(documentXml);
  const candidates: CorrespondingFootnotePair[] = [];
  for (const { label, fromId, toId } of renumberings) {
    if (label !== 'footnote') continue;
    for (const paragraph of Array.from(document.getElementsByTagName('w:p'))) {
      const references = Array.from(paragraph.getElementsByTagName('w:footnoteReference'));
      if (references.length !== 2) continue;
      const deleted = references.filter((reference) =>
        reference.getAttribute('w:id') === fromId && hasAncestor(reference, 'w:del'));
      const inserted = references.filter((reference) =>
        reference.getAttribute('w:id') === toId && hasAncestor(reference, 'w:ins'));
      if (deleted.length === 1 && inserted.length === 1) {
        candidates.push({ originalId: fromId, revisedId: toId });
      }
    }
  }
  return candidates;
}
