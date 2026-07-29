import { createHash } from 'node:crypto';
import { XMLSerializer } from '@xmldom/xmldom';
import {
  auditSectPr,
  DocxArchive,
  OOXML,
  parseXml,
  type SectPrBinding,
} from '@usejunior/docx-core';
import { canonicalNode } from './opaquePassthrough.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';
import { extractRoundTripComparisonText } from '../../fieldComparisonSemantics.js';
import { parseDocumentXml } from './xmlToWmlElement.js';

const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const VML_NS = 'urn:schemas-microsoft-com:vml';
const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const serializer = new XMLSerializer();

export interface TextBoxRevisionChange {
  index: number;
  partPath?: string;
  reason?: string;
  originalParagraphId?: string;
  revisedParagraphId?: string;
}

export class UnsupportedTextBoxRevisionError extends Error {
  readonly changes: TextBoxRevisionChange[];

  constructor(changes: TextBoxRevisionChange[]) {
    const locations = changes
      .map(({ index, partPath, reason, originalParagraphId, revisedParagraphId }) => {
        const paragraphIds = [...new Set(
          [originalParagraphId, revisedParagraphId].filter(
            (value): value is string => value !== undefined,
          ),
        )];
        const locator = `${partPath ?? 'word/document.xml'}#w:txbxContent[${index}]`;
        const paragraphSuffix = paragraphIds.length > 0
          ? ` (paragraph ${paragraphIds.join(' → ')})`
          : '';
        return `${locator}${paragraphSuffix}${reason ? `: ${reason}` : ''}`;
      })
      .join(', ');
    super(
      `The requested w:txbxContent change is outside the comparison engine's ` +
        `supported Word-readable story subset. Changed container(s): ${locations}`,
    );
    this.name = 'UnsupportedTextBoxRevisionError';
    this.changes = changes;
  }
}

export interface TextBoxStoryInput {
  index: number;
  partPath: string;
  original: Buffer;
  revised: Buffer;
}

export interface TextBoxStoryComparisonPlan {
  outerOriginal: Buffer;
  outerRevised: Buffer;
  originalDocumentXml: string;
  revisedDocumentXml: string;
  stories: TextBoxStoryInput[];
  validateAncillaryProjection: boolean;
}

function textBoxParagraphId(textBox: Element): string | undefined {
  const paragraph = textBox.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0) as Element | null;
  return paragraph?.getAttributeNS(WORD_2010_NS, 'paraId') || undefined;
}

function textBoxes(documentXml: string): Element[] {
  const root = parseDocumentXml(documentXml);
  return Array.from(
    root.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  ) as Element[];
}

function directChildElements(element: Element): Element[] {
  return Array.from(element.childNodes)
    .filter((child): child is Element => child.nodeType === 1);
}

function replaceChildren(target: Element, source: Element): void {
  while (target.firstChild) target.removeChild(target.firstChild);
  for (const child of Array.from(source.childNodes)) {
    target.appendChild(target.ownerDocument!.importNode(child, true));
  }
}

function createPlaceholder(textBox: Element, index: number): void {
  while (textBox.firstChild) textBox.removeChild(textBox.firstChild);
  const document = textBox.ownerDocument!;
  const paragraph = document.createElementNS(OOXML.W_NS, 'w:p');
  const run = document.createElementNS(OOXML.W_NS, 'w:r');
  const text = document.createElementNS(OOXML.W_NS, 'w:t');
  text.appendChild(
    document.createTextNode(`__safe_docx_text_box_story_${index}__`),
  );
  run.appendChild(text);
  paragraph.appendChild(run);
  textBox.appendChild(paragraph);
}

function nearestShape(textBox: Element): Element | undefined {
  let node: Node | null = textBox.parentNode;
  while (node?.nodeType === 1) {
    const element = node as Element;
    if (element.namespaceURI === VML_NS && element.localName === 'shape') {
      return element;
    }
    node = node.parentNode;
  }
  return undefined;
}

function scaffoldFingerprint(textBox: Element): string | undefined {
  const shape = nearestShape(textBox);
  if (!shape) return undefined;
  const clone = shape.cloneNode(true) as Element;
  for (const nested of Array.from(
    clone.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  )) {
    while (nested.firstChild) nested.removeChild(nested.firstChild);
  }
  return canonicalNode(clone);
}

function unsupportedStoryReason(textBox: Element): string | undefined {
  if (
    textBox.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').length > 0
  ) {
    return 'nested text boxes are not supported';
  }

  const unsupportedReferences = new Set([
    'commentReference',
    'endnoteReference',
    'footnoteReference',
    'object',
    'pict',
  ]);
  for (const element of Array.from(textBox.getElementsByTagName('*'))) {
    if (
      element.namespaceURI === OOXML.W_NS &&
      unsupportedReferences.has(element.localName)
    ) {
      return `nested ${element.tagName} is not supported in this story slice`;
    }
  }
  return undefined;
}

function relationshipTargets(
  relationshipsXml: string | null,
): ReadonlyMap<string, string> {
  if (!relationshipsXml) return new Map();
  const document = parseXml(relationshipsXml);
  const targets = new Map<string, string>();
  for (const relationship of Array.from(
    document.getElementsByTagName('Relationship'),
  )) {
    const id = relationship.getAttribute('Id');
    if (!id) continue;
    targets.set(
      id,
      [
        relationship.getAttribute('Type') ?? '',
        relationship.getAttribute('Target') ?? '',
        relationship.getAttribute('TargetMode') ?? '',
      ].join('|'),
    );
  }
  return targets;
}

function relationshipClosureFingerprint(
  textBox: Element,
  targets: ReadonlyMap<string, string>,
): string | undefined {
  const references: string[] = [];
  for (const element of Array.from(textBox.getElementsByTagName('*'))) {
    const relationshipId =
      element.getAttributeNS(RELATIONSHIPS_NS, 'id') ||
      element.getAttribute('r:id');
    if (!relationshipId) continue;
    const target = targets.get(relationshipId);
    if (!target) return undefined;
    references.push(
      `{${element.namespaceURI ?? ''}}${element.localName}|${target}`,
    );
  }
  return references.join('\n');
}

function storyDocumentXml(documentXml: string, textBoxIndex: number): string {
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0);
  const textBox = document
    .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
    .item(textBoxIndex);
  if (!body || !textBox) {
    throw new Error(`Could not isolate w:txbxContent[${textBoxIndex}]`);
  }
  replaceChildren(body, textBox);
  return serializer.serializeToString(document);
}

function storyDocumentXmlFromPart(
  documentXml: string,
  partXml: string,
  textBoxIndex: number,
): string {
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0);
  const part = parseXml(partXml);
  const textBox = part
    .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
    .item(textBoxIndex);
  if (!body || !textBox) {
    throw new Error(`Could not isolate ancillary w:txbxContent[${textBoxIndex}]`);
  }
  replaceChildren(body, textBox);
  return serializer.serializeToString(document);
}

function owningRelationshipsPath(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const directory = slash >= 0 ? partPath.slice(0, slash) : '';
  const filename = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return `${directory ? `${directory}/` : ''}_rels/${filename}.rels`;
}

interface SelectedAncillaryStory {
  targetPath: string;
  kind: 'header' | 'footer';
  bindings: SectPrBinding[];
  xml: string;
  relationshipsXml: string | null;
  textBoxes: Element[];
  canonical: string;
  scaffold: string;
}

interface SelectedAncillaryState {
  documentXml: string;
  sectionCount: number;
  auditBindings: SectPrBinding[];
  stories: SelectedAncillaryStory[];
}

interface PairedAncillaryStory {
  id: string;
  original: SelectedAncillaryStory;
  revised: SelectedAncillaryStory;
}

function partTextBoxes(xml: string): Element[] {
  const document = parseXml(xml);
  return Array.from(
    document.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  ) as Element[];
}

function partScaffoldFingerprint(xml: string): string {
  const document = parseXml(xml);
  const root = document.documentElement.cloneNode(true) as Element;
  for (const textBox of Array.from(
    root.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  )) {
    while (textBox.firstChild) textBox.removeChild(textBox.firstChild);
  }
  return canonicalNode(root);
}

function unsupportedBindingChanges(
  issues: ReturnType<typeof auditSectPr>['issues'],
): TextBoxRevisionChange[] {
  return issues.map((issue, index) => ({
    index,
    partPath: issue.targetPath ?? 'word/document.xml',
    reason: `invalid relationship-selected story binding (${issue.type})`,
  }));
}

/**
 * Resolve only the header/footer stories that are selected by direct section
 * bindings. Physical package filenames are allocation details and are not used
 * as cross-document story identity.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @see https://github.com/UseJunior/safe-docx/issues/726
 */
async function selectedAncillaryState(
  archive: DocxArchive,
): Promise<SelectedAncillaryState> {
  const documentXml = await archive.getDocumentXml();
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  const preliminary = auditSectPr(documentXml, relationshipsXml);
  if (!preliminary.ok) {
    // Relationship validation belongs to the package-level ancillary safety
    // boundary. Do not replace its precise, stable diagnostics with the
    // narrower text-box error merely because this preparatory scan runs first.
    return {
      documentXml,
      sectionCount: 0,
      auditBindings: [],
      stories: [],
    };
  }

  const parts = new Map<string, string>();
  for (const targetPath of new Set(
    preliminary.bindings.map((binding) => binding.targetPath),
  )) {
    const xml = await archive.getFile(targetPath);
    if (xml !== null) parts.set(targetPath, xml);
  }
  const audit = auditSectPr(documentXml, relationshipsXml, parts);
  if (!audit.ok) {
    return {
      documentXml,
      sectionCount: 0,
      auditBindings: [],
      stories: [],
    };
  }

  const bindingsByTarget = new Map<string, SectPrBinding[]>();
  for (const binding of audit.bindings) {
    const current = bindingsByTarget.get(binding.targetPath);
    if (current) current.push(binding);
    else bindingsByTarget.set(binding.targetPath, [binding]);
  }

  const stories: SelectedAncillaryStory[] = [];
  for (const [targetPath, bindings] of [...bindingsByTarget].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const xml = parts.get(targetPath)!;
    const root = parseXml(xml).documentElement;
    stories.push({
      targetPath,
      kind: bindings[0]!.kind,
      bindings,
      xml,
      relationshipsXml: await archive.getFile(owningRelationshipsPath(targetPath)),
      textBoxes: partTextBoxes(xml),
      canonical: canonicalNode(root),
      scaffold: partScaffoldFingerprint(xml),
    });
  }

  return {
    documentXml,
    sectionCount: audit.stats.totalSectPrCount,
    auditBindings: audit.bindings,
    stories,
  };
}

function bucketStories(
  stories: SelectedAncillaryStory[],
  keyOf: (story: SelectedAncillaryStory) => string,
): Map<string, SelectedAncillaryStory[]> {
  const buckets = new Map<string, SelectedAncillaryStory[]>();
  for (const story of stories) {
    const key = keyOf(story);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(story);
    else buckets.set(key, [story]);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => left.targetPath.localeCompare(right.targetPath));
  }
  return buckets;
}

function pairSelectedAncillaryStories(
  original: SelectedAncillaryStory[],
  revised: SelectedAncillaryStory[],
): {
  pairs: PairedAncillaryStory[];
  unpairedOriginal: SelectedAncillaryStory[];
  unpairedRevised: SelectedAncillaryStory[];
} {
  const originalCandidates = original.filter((story) => story.textBoxes.length > 0);
  const revisedCandidates = revised.filter((story) => story.textBoxes.length > 0);
  const matchedOriginal = new Set<SelectedAncillaryStory>();
  const matchedRevised = new Set<SelectedAncillaryStory>();
  const pairs: PairedAncillaryStory[] = [];

  const pair = (
    left: SelectedAncillaryStory,
    right: SelectedAncillaryStory,
  ): void => {
    matchedOriginal.add(left);
    matchedRevised.add(right);
    pairs.push({
      id: `ancillary-story-${pairs.length}`,
      original: left,
      revised: right,
    });
  };

  const exactOriginal = bucketStories(
    originalCandidates,
    (story) => `${story.kind}|${story.canonical}`,
  );
  const exactRevised = bucketStories(
    revisedCandidates,
    (story) => `${story.kind}|${story.canonical}`,
  );
  for (const key of [...exactOriginal.keys()].sort()) {
    const left = exactOriginal.get(key)!;
    const right = exactRevised.get(key) ?? [];
    const count = Math.min(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      pair(left[index]!, right[index]!);
    }
  }

  const remainingOriginal = originalCandidates.filter(
    (story) => !matchedOriginal.has(story),
  );
  const remainingRevised = revisedCandidates.filter(
    (story) => !matchedRevised.has(story),
  );
  const scaffoldOriginal = bucketStories(
    remainingOriginal,
    (story) => `${story.kind}|${story.scaffold}`,
  );
  const scaffoldRevised = bucketStories(
    remainingRevised,
    (story) => `${story.kind}|${story.scaffold}`,
  );
  for (const key of [...scaffoldOriginal.keys()].sort()) {
    const left = scaffoldOriginal.get(key)!;
    const right = scaffoldRevised.get(key) ?? [];
    if (left.length === 1 && right.length === 1) {
      pair(left[0]!, right[0]!);
    }
  }

  return {
    pairs,
    unpairedOriginal: originalCandidates.filter(
      (story) => !matchedOriginal.has(story),
    ),
    unpairedRevised: revisedCandidates.filter(
      (story) => !matchedRevised.has(story),
    ),
  };
}

function hasAncestorLocalName(element: Element, name: string): boolean {
  for (let parent = element.parentNode; parent; parent = parent.parentNode) {
    if (
      parent.nodeType === 1 &&
      ((parent as Element).localName ||
        (parent as Element).tagName.replace(/^.*:/u, '')) === name
    ) {
      return true;
    }
  }
  return false;
}

function sectionPropertyFingerprints(documentXml: string): string[] {
  const document = parseXml(documentXml);
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sectPr'))
    .filter((section) => !hasAncestorLocalName(section, 'sectPrChange'))
    .map((section) => {
      const clone = section.cloneNode(true) as Element;
      for (const child of directChildElements(clone)) {
        if (
          child.namespaceURI === OOXML.W_NS &&
          (child.localName === 'headerReference' ||
            child.localName === 'footerReference' ||
            child.localName === 'sectPrChange')
        ) {
          clone.removeChild(child);
        }
      }
      return canonicalNode(clone);
    });
}

function sectionSignatures(
  state: SelectedAncillaryState,
  side: 'original' | 'revised',
  pairIdByPath: ReadonlyMap<string, string>,
): string[] {
  const properties = sectionPropertyFingerprints(state.documentXml);
  return properties.map((property, sectionOrdinal) => {
    const bindings = state.auditBindings
      .filter((binding) => binding.sectionOrdinal === sectionOrdinal)
      .sort((left, right) =>
        `${left.kind}:${left.role}`.localeCompare(`${right.kind}:${right.role}`),
      );
    const slots = bindings.map((binding) => {
      const selected = state.stories.find(
        (story) => story.targetPath === binding.targetPath,
      );
      const identity = selected?.textBoxes.length
        ? pairIdByPath.get(binding.targetPath) ??
          `${side}:unpaired:${binding.targetPath}`
        : `plain:${binding.kind}:${binding.role}`;
      return `${binding.kind}:${binding.role}:${identity}`;
    });
    return `${property}\n${slots.join('\n')}`;
  });
}

function unmatchedSequenceOrdinals(
  original: string[],
  revised: string[],
): { original: Set<number>; revised: Set<number> } {
  const lengths = Array.from(
    { length: original.length + 1 },
    () => Array<number>(revised.length + 1).fill(0),
  );
  for (let left = original.length - 1; left >= 0; left -= 1) {
    for (let right = revised.length - 1; right >= 0; right -= 1) {
      lengths[left]![right] = original[left] === revised[right]
        ? 1 + lengths[left + 1]![right + 1]!
        : Math.max(lengths[left + 1]![right]!, lengths[left]![right + 1]!);
    }
  }
  const matchedOriginal = new Set<number>();
  const matchedRevised = new Set<number>();
  let left = 0;
  let right = 0;
  while (left < original.length && right < revised.length) {
    if (original[left] === revised[right]) {
      matchedOriginal.add(left);
      matchedRevised.add(right);
      left += 1;
      right += 1;
    } else if (lengths[left + 1]![right]! >= lengths[left]![right + 1]!) {
      left += 1;
    } else {
      right += 1;
    }
  }
  return {
    original: new Set(
      original.map((_, index) => index).filter((index) => !matchedOriginal.has(index)),
    ),
    revised: new Set(
      revised.map((_, index) => index).filter((index) => !matchedRevised.has(index)),
    ),
  };
}

function assertLifecycleStoriesAreSectionBound(
  originalState: SelectedAncillaryState,
  revisedState: SelectedAncillaryState,
  pairs: PairedAncillaryStory[],
  unpairedOriginal: SelectedAncillaryStory[],
  unpairedRevised: SelectedAncillaryStory[],
): void {
  if (unpairedOriginal.length === 0 && unpairedRevised.length === 0) return;
  const originalPairIds = new Map(
    pairs.map((pair) => [pair.original.targetPath, pair.id]),
  );
  const revisedPairIds = new Map(
    pairs.map((pair) => [pair.revised.targetPath, pair.id]),
  );
  const unmatched = unmatchedSequenceOrdinals(
    sectionSignatures(originalState, 'original', originalPairIds),
    sectionSignatures(revisedState, 'revised', revisedPairIds),
  );
  const changes: TextBoxRevisionChange[] = [];

  for (const story of unpairedOriginal) {
    const lifecycle =
      originalState.sectionCount > revisedState.sectionCount &&
      story.bindings.every((binding) =>
        unmatched.original.has(binding.sectionOrdinal),
      );
    if (!lifecycle) {
      changes.push({
        index: 0,
        partPath: story.targetPath,
        reason:
          'unpaired ancillary text-box story is not owned exclusively by a deleted section',
      });
    }
  }
  for (const story of unpairedRevised) {
    const lifecycle =
      revisedState.sectionCount > originalState.sectionCount &&
      story.bindings.every((binding) =>
        unmatched.revised.has(binding.sectionOrdinal),
      );
    if (!lifecycle) {
      changes.push({
        index: 0,
        partPath: story.targetPath,
        reason:
          'unpaired ancillary text-box story is not owned exclusively by an inserted section',
      });
    }
  }
  if (changes.length > 0) throw new UnsupportedTextBoxRevisionError(changes);
}

async function ancillaryStoryInputs(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
  originalDocumentXml: string,
  revisedDocumentXml: string,
): Promise<{
  stories: TextBoxStoryInput[];
  validateProjection: boolean;
}> {
  const [originalState, revisedState] = await Promise.all([
    selectedAncillaryState(originalArchive),
    selectedAncillaryState(revisedArchive),
  ]);
  const paired = pairSelectedAncillaryStories(
    originalState.stories,
    revisedState.stories,
  );
  assertLifecycleStoriesAreSectionBound(
    originalState,
    revisedState,
    paired.pairs,
    paired.unpairedOriginal,
    paired.unpairedRevised,
  );

  const stories: TextBoxStoryInput[] = [];
  for (const pair of paired.pairs) {
    if (pair.original.textBoxes.length !== pair.revised.textBoxes.length) {
      throw new UnsupportedTextBoxRevisionError([{
        index: Math.min(
          pair.original.textBoxes.length,
          pair.revised.textBoxes.length,
        ),
        partPath: pair.revised.targetPath,
        reason: 'inserted or deleted ancillary text-box topology is not supported',
      }]);
    }
    const originalTargets = relationshipTargets(pair.original.relationshipsXml);
    const revisedTargets = relationshipTargets(pair.revised.relationshipsXml);
    for (let index = 0; index < pair.original.textBoxes.length; index += 1) {
      const originalTextBox = pair.original.textBoxes[index]!;
      const revisedTextBox = pair.revised.textBoxes[index]!;
      if (canonicalNode(originalTextBox) === canonicalNode(revisedTextBox)) continue;
      const originalRelationshipClosure = relationshipClosureFingerprint(
        originalTextBox,
        originalTargets,
      );
      const revisedRelationshipClosure = relationshipClosureFingerprint(
        revisedTextBox,
        revisedTargets,
      );
      const reason =
        unsupportedStoryReason(originalTextBox) ??
        unsupportedStoryReason(revisedTextBox) ??
        (originalRelationshipClosure === undefined ||
        revisedRelationshipClosure === undefined ||
        originalRelationshipClosure !== revisedRelationshipClosure
          ? 'the ancillary text-box relationship closure changed or could not be resolved'
          : undefined) ??
        (scaffoldFingerprint(originalTextBox) === scaffoldFingerprint(revisedTextBox)
          ? undefined
          : 'the ancillary VML shape scaffold changed or could not be paired');
      if (reason) {
        throw new UnsupportedTextBoxRevisionError([{
          index,
          partPath: pair.revised.targetPath,
          reason,
          originalParagraphId: textBoxParagraphId(originalTextBox),
          revisedParagraphId: textBoxParagraphId(revisedTextBox),
        }]);
      }

      const storyOriginalArchive = await originalArchive.clone();
      const storyRevisedArchive = await revisedArchive.clone();
      storyOriginalArchive.setDocumentXml(
        storyDocumentXmlFromPart(
          originalDocumentXml,
          pair.original.xml,
          index,
        ),
      );
      storyRevisedArchive.setDocumentXml(
        storyDocumentXmlFromPart(
          revisedDocumentXml,
          pair.revised.xml,
          index,
        ),
      );
      storyOriginalArchive.setFile(
        'word/_rels/document.xml.rels',
        pair.original.relationshipsXml ??
          `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
      );
      storyRevisedArchive.setFile(
        'word/_rels/document.xml.rels',
        pair.revised.relationshipsXml ??
          `<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}"/>`,
      );
      stories.push({
        index,
        partPath: pair.revised.targetPath,
        original: await storyOriginalArchive.save(),
        revised: await storyRevisedArchive.save(),
      });
    }
  }

  return {
    stories,
    validateProjection:
      paired.pairs.some(
        (pair) => pair.original.targetPath !== pair.revised.targetPath,
      ) ||
      paired.unpairedOriginal.length > 0 ||
      paired.unpairedRevised.length > 0 ||
      stories.length > 0,
  };
}

/**
 * Split supported changed VML text boxes into independent WordprocessingML
 * stories and neutralize them for the outer-body comparison.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @see https://github.com/UseJunior/safe-docx/issues/713
 */
export async function prepareTextBoxStoryComparison(
  original: Buffer,
  revised: Buffer,
): Promise<TextBoxStoryComparisonPlan | undefined> {
  const originalArchive = await DocxArchive.load(original);
  const revisedArchive = await DocxArchive.load(revised);
  const originalDocumentXml = await originalArchive.getDocumentXml();
  const revisedDocumentXml = await revisedArchive.getDocumentXml();
  const ancillary = await ancillaryStoryInputs(
    originalArchive,
    revisedArchive,
    originalDocumentXml,
    revisedDocumentXml,
  );
  const originalRelationshipTargets = relationshipTargets(
    await originalArchive.getFile('word/_rels/document.xml.rels'),
  );
  const revisedRelationshipTargets = relationshipTargets(
    await revisedArchive.getFile('word/_rels/document.xml.rels'),
  );
  const originalDocument = parseXml(originalDocumentXml);
  const revisedDocument = parseXml(revisedDocumentXml);
  const originalTextBoxes = Array.from(
    originalDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  );
  const revisedTextBoxes = Array.from(
    revisedDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  );

  if (originalTextBoxes.length !== revisedTextBoxes.length) {
    throw new UnsupportedTextBoxRevisionError([{
      index: Math.min(originalTextBoxes.length, revisedTextBoxes.length),
      partPath: 'word/document.xml',
      reason: 'inserted or deleted text-box topology is not supported',
    }]);
  }

  const changedIndices: number[] = [];
  for (let index = 0; index < originalTextBoxes.length; index += 1) {
    const originalTextBox = originalTextBoxes[index]!;
    const revisedTextBox = revisedTextBoxes[index]!;
    if (canonicalNode(originalTextBox) === canonicalNode(revisedTextBox)) {
      continue;
    }
    const originalRelationshipClosure = relationshipClosureFingerprint(
      originalTextBox,
      originalRelationshipTargets,
    );
    const revisedRelationshipClosure = relationshipClosureFingerprint(
      revisedTextBox,
      revisedRelationshipTargets,
    );
    const reason =
      unsupportedStoryReason(originalTextBox) ??
      unsupportedStoryReason(revisedTextBox) ??
      (originalRelationshipClosure === undefined ||
      revisedRelationshipClosure === undefined ||
      originalRelationshipClosure !== revisedRelationshipClosure
        ? 'the text-box relationship closure changed or could not be resolved'
        : undefined) ??
      (scaffoldFingerprint(originalTextBox) !==
      scaffoldFingerprint(revisedTextBox)
        ? 'the containing VML shape scaffold changed or could not be paired'
        : undefined);
    if (reason) {
      throw new UnsupportedTextBoxRevisionError([{
        index,
        partPath: 'word/document.xml',
        reason,
        originalParagraphId: textBoxParagraphId(originalTextBox),
        revisedParagraphId: textBoxParagraphId(revisedTextBox),
      }]);
    }
    changedIndices.push(index);
  }

  const stories: TextBoxStoryInput[] = [...ancillary.stories];
  for (const index of changedIndices) {
    const storyOriginalArchive = await originalArchive.clone();
    const storyRevisedArchive = await revisedArchive.clone();
    storyOriginalArchive.setDocumentXml(
      storyDocumentXml(originalDocumentXml, index),
    );
    storyRevisedArchive.setDocumentXml(
      storyDocumentXml(revisedDocumentXml, index),
    );
    stories.push({
      index,
      partPath: 'word/document.xml',
      original: await storyOriginalArchive.save(),
      revised: await storyRevisedArchive.save(),
    });
    createPlaceholder(originalTextBoxes[index]!, index);
    createPlaceholder(revisedTextBoxes[index]!, index);
  }

  if (stories.length === 0 && !ancillary.validateProjection) return undefined;

  const outerOriginalArchive = await originalArchive.clone();
  const outerRevisedArchive = await revisedArchive.clone();
  outerOriginalArchive.setDocumentXml(serializer.serializeToString(originalDocument));
  outerRevisedArchive.setDocumentXml(serializer.serializeToString(revisedDocument));

  return {
    outerOriginal: await outerOriginalArchive.save(),
    outerRevised: await outerRevisedArchive.save(),
    originalDocumentXml,
    revisedDocumentXml,
    stories,
    validateAncillaryProjection: ancillary.validateProjection,
  };
}

/**
 * Splice independently compared text-box stories into the preserved outer
 * document scaffold.
 */
export async function assembleTextBoxStoryComparison(
  outerCompared: Buffer,
  storyResults: ReadonlyArray<{
    index: number;
    partPath: string;
    document: Buffer;
  }>,
): Promise<Buffer> {
  const outerArchive = await DocxArchive.load(outerCompared);
  const outerDocument = parseXml(await outerArchive.getDocumentXml());

  for (const storyResult of storyResults) {
    let targetDocument = outerDocument;
    if (storyResult.partPath !== 'word/document.xml') {
      const targetXml = await outerArchive.getFile(storyResult.partPath);
      if (targetXml === null) {
        throw new UnsupportedTextBoxRevisionError([{
          index: storyResult.index,
          partPath: storyResult.partPath,
          reason: 'the selected output story part is missing',
        }]);
      }
      targetDocument = parseXml(targetXml);
    }
    const target = targetDocument
      .getElementsByTagNameNS(OOXML.W_NS, 'txbxContent')
      .item(storyResult.index);
    if (!target) {
      throw new UnsupportedTextBoxRevisionError([{
        index: storyResult.index,
        partPath: storyResult.partPath,
        reason: 'the outer comparison changed text-box story topology',
      }]);
    }
    const storyArchive = await DocxArchive.load(storyResult.document);
    const storyDocument = parseXml(await storyArchive.getDocumentXml());
    const storyBody = storyDocument
      .getElementsByTagNameNS(OOXML.W_NS, 'body')
      .item(0);
    if (!storyBody) {
      throw new Error(`Compared text-box story ${storyResult.index} has no w:body`);
    }
    while (target.firstChild) target.removeChild(target.firstChild);
    for (const child of directChildElements(storyBody)) {
      if (
        child.namespaceURI === OOXML.W_NS &&
        child.localName === 'sectPr'
      ) {
        continue;
      }
      target.appendChild(targetDocument.importNode(child, true));
    }
    if (storyResult.partPath !== 'word/document.xml') {
      outerArchive.setFile(
        storyResult.partPath,
        serializer.serializeToString(targetDocument),
      );
    }
  }

  outerArchive.setDocumentXml(serializer.serializeToString(outerDocument));
  return outerArchive.save();
}

async function selectedStoryProjectionInventory(
  archive: DocxArchive,
  documentXml: string,
  projection: 'accept' | 'reject',
): Promise<string[]> {
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  const preliminary = auditSectPr(documentXml, relationshipsXml);
  if (!preliminary.ok) {
    throw new UnsupportedTextBoxRevisionError(
      unsupportedBindingChanges(preliminary.issues),
    );
  }
  const parts = new Map<string, string>();
  for (const targetPath of new Set(
    preliminary.bindings.map((binding) => binding.targetPath),
  )) {
    const xml = await archive.getFile(targetPath);
    if (xml !== null) parts.set(targetPath, xml);
  }
  const audit = auditSectPr(documentXml, relationshipsXml, parts);
  if (!audit.ok) {
    throw new UnsupportedTextBoxRevisionError(
      unsupportedBindingChanges(audit.issues),
    );
  }
  const project = projection === 'accept' ? acceptAllChanges : rejectAllChanges;
  return audit.bindings.map((binding) => {
    const xml = parts.get(binding.targetPath)!;
    const projectedXml = project(xml);
    return [
      binding.sectionOrdinal,
      binding.kind,
      binding.role,
      partScaffoldFingerprint(projectedXml),
      extractRoundTripComparisonText(projectedXml),
    ].join('|');
  });
}

/**
 * Validate the selected header/footer story graph after accept-all and
 * reject-all, independent of physical part allocation.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @see https://github.com/UseJunior/safe-docx/issues/726
 */
export async function assertAncillaryTextBoxStoryProjection(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
): Promise<void> {
  const [originalArchive, revisedArchive, comparedArchive] = await Promise.all([
    DocxArchive.load(original),
    DocxArchive.load(revised),
    DocxArchive.load(compared),
  ]);
  const [originalXml, revisedXml, comparedXml] = await Promise.all([
    originalArchive.getDocumentXml(),
    revisedArchive.getDocumentXml(),
    comparedArchive.getDocumentXml(),
  ]);
  const [
    expectedOriginal,
    expectedRevised,
    rejectedCompared,
    acceptedCompared,
  ] = await Promise.all([
    selectedStoryProjectionInventory(
      originalArchive,
      rejectAllChanges(originalXml),
      'reject',
    ),
    selectedStoryProjectionInventory(
      revisedArchive,
      acceptAllChanges(revisedXml),
      'accept',
    ),
    selectedStoryProjectionInventory(
      comparedArchive,
      rejectAllChanges(comparedXml),
      'reject',
    ),
    selectedStoryProjectionInventory(
      comparedArchive,
      acceptAllChanges(comparedXml),
      'accept',
    ),
  ]);
  if (
    JSON.stringify(expectedOriginal) !== JSON.stringify(rejectedCompared) ||
    JSON.stringify(expectedRevised) !== JSON.stringify(acceptedCompared)
  ) {
    const digest = (items: string[]): string =>
      createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12);
    throw new UnsupportedTextBoxRevisionError([{
      index: 0,
      partPath: 'word/document.xml',
      reason:
        'assembled relationship-selected stories failed accept/reject package projection validation ' +
        `(original ${digest(expectedOriginal)} != ${digest(rejectedCompared)}; ` +
        `revised ${digest(expectedRevised)} != ${digest(acceptedCompared)})`,
    }]);
  }
}

/**
 * Fail closed when a comparison would need to place tracked revision markup
 * inside a text-box story. The atomizer currently treats the containing VML or
 * DrawingML object as atomic, and wrapping the changed object produces a DOCX
 * that Microsoft Word rejects as unreadable.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/647
 */
export function assertTextBoxContentUnchanged(
  originalDocumentXml: string,
  revisedDocumentXml: string,
): void {
  const originalTextBoxes = textBoxes(originalDocumentXml);
  const revisedTextBoxes = textBoxes(revisedDocumentXml);
  const count = Math.max(originalTextBoxes.length, revisedTextBoxes.length);
  const changes: TextBoxRevisionChange[] = [];

  for (let index = 0; index < count; index++) {
    const originalTextBox = originalTextBoxes[index];
    const revisedTextBox = revisedTextBoxes[index];
    const originalSignature = originalTextBox
      ? createHash('sha256').update(canonicalNode(originalTextBox)).digest('hex')
      : undefined;
    const revisedSignature = revisedTextBox
      ? createHash('sha256').update(canonicalNode(revisedTextBox)).digest('hex')
      : undefined;
    if (originalSignature === revisedSignature) continue;

    changes.push({
      index,
      originalParagraphId: originalTextBox
        ? textBoxParagraphId(originalTextBox)
        : undefined,
      revisedParagraphId: revisedTextBox
        ? textBoxParagraphId(revisedTextBox)
        : undefined,
    });
  }

  if (changes.length > 0) throw new UnsupportedTextBoxRevisionError(changes);
}
