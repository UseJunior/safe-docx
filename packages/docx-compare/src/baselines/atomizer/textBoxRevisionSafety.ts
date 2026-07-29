import { createHash } from 'node:crypto';
import { XMLSerializer } from '@xmldom/xmldom';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { canonicalNode } from './opaquePassthrough.js';
import { parseDocumentXml } from './xmlToWmlElement.js';

const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const VML_NS = 'urn:schemas-microsoft-com:vml';
const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
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
  original: Buffer;
  revised: Buffer;
}

export interface TextBoxStoryComparisonPlan {
  outerOriginal: Buffer;
  outerRevised: Buffer;
  originalDocumentXml: string;
  revisedDocumentXml: string;
  stories: TextBoxStoryInput[];
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

const ANCILLARY_STORY_PART_RE =
  /^word\/(?:header[^/]*|footer[^/]*|footnotes|endnotes|comments)\.xml$/u;

async function assertAncillaryTextBoxStoriesUnchanged(
  originalArchive: DocxArchive,
  revisedArchive: DocxArchive,
): Promise<void> {
  const partPaths = new Set([
    ...originalArchive.listFiles().filter((path) => ANCILLARY_STORY_PART_RE.test(path)),
    ...revisedArchive.listFiles().filter((path) => ANCILLARY_STORY_PART_RE.test(path)),
  ]);

  for (const partPath of [...partPaths].sort()) {
    const originalXml = await originalArchive.getFile(partPath);
    const revisedXml = await revisedArchive.getFile(partPath);
    if (
      !originalXml?.includes('txbxContent') &&
      !revisedXml?.includes('txbxContent')
    ) {
      continue;
    }
    const originalStories = originalXml?.includes('txbxContent')
      ? textBoxes(originalXml)
      : [];
    const revisedStories = revisedXml?.includes('txbxContent')
      ? textBoxes(revisedXml)
      : [];
    const count = Math.max(originalStories.length, revisedStories.length);
    for (let index = 0; index < count; index += 1) {
      const originalStory = originalStories[index];
      const revisedStory = revisedStories[index];
      if (
        originalStory &&
        revisedStory &&
        canonicalNode(originalStory) === canonicalNode(revisedStory)
      ) {
        continue;
      }
      throw new UnsupportedTextBoxRevisionError([{
        index,
        partPath,
        reason: 'changed ancillary text-box stories are outside the supported main-document scope',
        originalParagraphId: originalStory
          ? textBoxParagraphId(originalStory)
          : undefined,
        revisedParagraphId: revisedStory
          ? textBoxParagraphId(revisedStory)
          : undefined,
      }]);
    }
  }
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
  await assertAncillaryTextBoxStoriesUnchanged(
    originalArchive,
    revisedArchive,
  );
  const originalDocumentXml = await originalArchive.getDocumentXml();
  const revisedDocumentXml = await revisedArchive.getDocumentXml();
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

  if (changedIndices.length === 0) return undefined;

  const stories: TextBoxStoryInput[] = [];
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
      original: await storyOriginalArchive.save(),
      revised: await storyRevisedArchive.save(),
    });
    createPlaceholder(originalTextBoxes[index]!, index);
    createPlaceholder(revisedTextBoxes[index]!, index);
  }

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
  };
}

/**
 * Splice independently compared text-box stories into the preserved outer
 * document scaffold.
 */
export async function assembleTextBoxStoryComparison(
  outerCompared: Buffer,
  storyResults: ReadonlyArray<{ index: number; document: Buffer }>,
): Promise<Buffer> {
  const outerArchive = await DocxArchive.load(outerCompared);
  const outerDocument = parseXml(await outerArchive.getDocumentXml());
  const outerTextBoxes = Array.from(
    outerDocument.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
  );

  for (const storyResult of storyResults) {
    const target = outerTextBoxes[storyResult.index];
    if (!target) {
      throw new UnsupportedTextBoxRevisionError([{
        index: storyResult.index,
        partPath: 'word/document.xml',
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
      target.appendChild(outerDocument.importNode(child, true));
    }
  }

  outerArchive.setDocumentXml(serializer.serializeToString(outerDocument));
  return outerArchive.save();
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
