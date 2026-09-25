import {
  DocxZip,
  OOXML,
  W,
  auditSectPr,
  collectBookmarkReservation,
  getParagraphBookmarkId,
  getParagraphText,
  insertSingleParagraphBookmark,
  parseXml,
  serializeXml,
  type SectPrBinding,
} from '@usejunior/docx-core';
import { DocxMarkdocError } from './errors.js';
import { sha256 } from './hash.js';
import type { ReadOnlyStoryParagraph, StoryDeclaration } from './types.js';

export type StoryParagraph = {
  id: string;
  text: string;
  style: string;
};

export type SelectedStory = StoryDeclaration & {
  /** Package path is internal only; canonical authoring uses the opaque ID. */
  partPath: string;
  paragraphsInOrder: StoryParagraph[];
  blocksInOrder: Array<
    | { kind: 'editable'; paragraph: StoryParagraph }
    | { kind: 'readonly'; paragraph: ReadOnlyStoryParagraph }
  >;
  readOnlyInOrder: ReadOnlyStoryParagraph[];
};

type StoryPart = {
  kind: 'header' | 'footer';
  partPath: string;
  bindings: string[];
  id: string;
  xml: string;
  doc: Document;
};

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

function isW(element: Element, name: string): boolean {
  return element.namespaceURI === OOXML.W_NS && element.localName === name;
}

function directElements(element: Element): Element[] {
  return Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function nearestWordAncestor(element: Element, name: string): Element | null {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (isW(current, name)) return current;
  }
  return null;
}

function inMarkupCompatibilityFallback(element: Element): boolean {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (current.namespaceURI === MC_NS && current.localName === 'Fallback') return true;
  }
  return false;
}

export function projectedStoryParagraphs(story: Document): Element[] {
  return Array.from(story.getElementsByTagNameNS(OOXML.W_NS, W.p))
    .filter((paragraph): paragraph is Element => !inMarkupCompatibilityFallback(paragraph));
}

function continuationMerge(cell: Element): 'vMerge' | 'hMerge' | null {
  const properties = directElements(cell).find((child) => isW(child, W.tcPr));
  for (const kind of ['vMerge', 'hMerge'] as const) {
    const merge = properties && directElements(properties).find((child) => isW(child, kind));
    if (!merge) continue;
    const value = merge.getAttributeNS(OOXML.W_NS, 'val') ?? merge.getAttribute('w:val');
    if (!value || value === 'continue') return kind;
  }
  return null;
}

function isPhysicalStoryParagraph(paragraph: Element, root: Element): boolean {
  if (paragraph.parentElement === root) return true;
  let cellCount = 0;
  let current = paragraph.parentElement;
  while (current && current !== root) {
    if (current.namespaceURI !== OOXML.W_NS || !['tc', 'tr', 'tbl'].includes(current.localName)) return false;
    if (isW(current, W.tc)) {
      cellCount += 1;
      if (cellCount > 1 || continuationMerge(current)) return false;
    }
    current = current.parentElement;
  }
  return current === root && cellCount === 1;
}

const RUN_CHILDREN = new Set(['rPr', 't', 'tab', 'br', 'cr', 'sym', 'noBreakHyphen', 'softHyphen', 'fldChar', 'instrText', 'delInstrText']);
const PARAGRAPH_MARKERS = new Set([
  'bookmarkStart', 'bookmarkEnd', 'proofErr', 'commentRangeStart', 'commentRangeEnd',
  'permStart', 'permEnd', 'moveFromRangeStart', 'moveFromRangeEnd',
  'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart',
  'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd',
]);

function admittedContent(element: Element): boolean {
  if (element.namespaceURI !== OOXML.W_NS) return false;
  if (isW(element, W.pPr)) return true;
  if (isW(element, W.r)) return directElements(element).every((child) =>
    child.namespaceURI === OOXML.W_NS && RUN_CHILDREN.has(child.localName));
  if (isW(element, W.hyperlink) || isW(element, 'fldSimple')) {
    return directElements(element).every((child) => isW(child, W.r) && admittedContent(child));
  }
  return PARAGRAPH_MARKERS.has(element.localName);
}

/**
 * Admit only direct story-root or physical-cell paragraphs with bounded text
 * content. Structural children are projected read-only and never receive an
 * operative Markdoc anchor.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see #1034
 */
export function admittedStoryParagraphs(story: Document): Element[] {
  const root = story.documentElement;
  return Array.from(story.getElementsByTagNameNS(OOXML.W_NS, W.p))
    .filter((paragraph): paragraph is Element => {
      if (!isPhysicalStoryParagraph(paragraph, root)) return false;
      return directElements(paragraph).every(admittedContent);
    });
}

function readOnlyReason(paragraph: Element, root: Element): string {
  const parent = paragraph.parentElement;
  if (!isPhysicalStoryParagraph(paragraph, root)) {
    if (parent && isW(parent, W.tc)) {
      const continuation = continuationMerge(parent);
      if (continuation) return continuation;
    }
    const table = parent && nearestWordAncestor(parent, W.tbl);
    if (table && nearestWordAncestor(table, W.tc)) return 'nested-table';
    return 'nested';
  }
  const offending = directElements(paragraph).find((child) => !admittedContent(child));
  if (!offending) return 'unsupported';
  if (isW(offending, W.r)) {
    return directElements(offending).find((child) => !RUN_CHILDREN.has(child.localName))?.localName ?? 'run';
  }
  return offending.localName;
}

function bindingKey(binding: SectPrBinding): string {
  return `${binding.sectionOrdinal}:${binding.role}`;
}

function sortedBindings(bindings: SectPrBinding[]): string[] {
  return bindings.map(bindingKey).sort((left, right) => {
    const [leftOrdinal] = left.split(':');
    const [rightOrdinal] = right.split(':');
    return Number(leftOrdinal) - Number(rightOrdinal) || left.localeCompare(right);
  });
}

async function storyParts(zip: DocxZip): Promise<{ body: Document; stories: StoryPart[] }> {
  const bodyXml = await zip.readText('word/document.xml');
  const relationshipsXml = await zip.readTextOrNull('word/_rels/document.xml.rels');
  const initial = auditSectPr(bodyXml, relationshipsXml);
  if (!initial.ok) {
    throw new DocxMarkdocError('STORY_TOPOLOGY_UNSUPPORTED', 'Selected header/footer bindings are invalid.', initial.issues);
  }
  const paths = [...new Set(initial.bindings.map((binding) => binding.targetPath))].sort();
  const xmlByPath = new Map<string, string>();
  for (const path of paths) {
    const xml = await zip.readTextOrNull(path);
    if (!xml) throw new DocxMarkdocError('STORY_TOPOLOGY_UNSUPPORTED', `Selected story part ${path} is missing.`);
    xmlByPath.set(path, xml);
  }
  const audit = auditSectPr(bodyXml, relationshipsXml, xmlByPath);
  if (!audit.ok) throw new DocxMarkdocError('STORY_TOPOLOGY_UNSUPPORTED', 'Selected header/footer part topology is invalid.', audit.issues);
  const stories: StoryPart[] = [];
  for (const partPath of paths) {
    const bindings = audit.bindings.filter((binding) => binding.targetPath === partPath);
    const kind = bindings[0]?.kind;
    if (!kind || bindings.some((binding) => binding.kind !== kind)) {
      throw new DocxMarkdocError('STORY_TOPOLOGY_UNSUPPORTED', `Selected story ${partPath} has ambiguous kind.`);
    }
    const closure = sortedBindings(bindings);
    const xml = xmlByPath.get(partPath)!;
    const id = `story-${kind}-${sha256(Buffer.from(`${kind}\0${closure.join(',')}`)).slice(0, 12)}`;
    stories.push({ kind, partPath, bindings: closure, id, xml, doc: parseXml(xml) });
  }
  return { body: parseXml(bodyXml), stories: stories.sort((left, right) => left.id.localeCompare(right.id)) };
}

function paragraphStyle(paragraph: Element): string {
  const properties = directElements(paragraph).find((child) => isW(child, W.pPr));
  const style = properties && directElements(properties).find((child) => isW(child, W.pStyle));
  return style?.getAttributeNS(OOXML.W_NS, W.val) ?? style?.getAttribute('w:val') ?? 'Normal';
}

export async function selectedStories(buffer: Buffer): Promise<SelectedStory[]> {
  const { stories } = await storyParts(await DocxZip.load(buffer));
  return stories.map((story) => {
    const admitted = new Set(admittedStoryParagraphs(story.doc));
    const blocksInOrder: SelectedStory['blocksInOrder'] = projectedStoryParagraphs(story.doc)
      .map((paragraph, ordinal) => {
        const text = getParagraphText(paragraph);
        if (admitted.has(paragraph)) {
          return { kind: 'editable' as const, paragraph: {
            id: getParagraphBookmarkId(paragraph) ?? '', text, style: paragraphStyle(paragraph),
          } };
        }
        return { kind: 'readonly' as const, paragraph: {
          story: story.id,
          ordinal,
          fingerprint: `sha256:${sha256(Buffer.from(paragraph.toString()))}`,
          reason: readOnlyReason(paragraph, story.doc.documentElement),
          text,
        } };
      });
    const paragraphsInOrder = blocksInOrder
      .filter((block): block is Extract<(typeof blocksInOrder)[number], { kind: 'editable' }> => block.kind === 'editable')
      .map((block) => block.paragraph);
    const readOnlyInOrder = blocksInOrder
      .filter((block): block is Extract<(typeof blocksInOrder)[number], { kind: 'readonly' }> => block.kind === 'readonly')
      .map((block) => block.paragraph);
    return {
      id: story.id,
      kind: story.kind,
      bindings: story.bindings,
      partPath: story.partPath,
      fingerprint: `sha256:${sha256(Buffer.from(story.xml))}`,
      paragraphs: paragraphsInOrder.length,
      readOnlyParagraphs: readOnlyInOrder.length,
      paragraphsInOrder,
      readOnlyInOrder,
      blocksInOrder,
    };
  });
}

/**
 * Add bookmarks to admitted side paragraphs in a separate DOCX copy, sharing
 * one reservation with the already-anchored main body and every selected part.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see #1034
 */
export async function anchorSelectedStories(bodyAnchored: Buffer): Promise<Buffer> {
  const zip = await DocxZip.load(bodyAnchored);
  const { body, stories } = await storyParts(zip);
  if (stories.length === 0) return bodyAnchored;
  const reservation = collectBookmarkReservation([body, ...stories.map((story) => story.doc)]);
  for (const story of stories) {
    let changed = false;
    for (const paragraph of admittedStoryParagraphs(story.doc)) {
      if (getParagraphBookmarkId(paragraph)) continue;
      insertSingleParagraphBookmark(story.doc, paragraph, reservation);
      changed = true;
    }
    if (changed) zip.writeText(story.partPath, serializeXml(story.doc));
  }
  return zip.toBuffer();
}
