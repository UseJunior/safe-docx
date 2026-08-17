import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import JSZip from 'jszip';

export const REAL_CORPUS_ENV = 'SAFE_DOCX_REAL_CORPUS_DIR';
export const REAL_CORPUS_REQUIRED_ENV = 'SAFE_DOCX_REAL_CORPUS_REQUIRED';
const INTEGRATION_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(INTEGRATION_DIR, 'real-corpus-manifest.json');
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface RealCorpusEntry {
  id: string;
  sourceUrl: string;
  sha256: string;
}

export interface RealCorpusAvailability {
  available: boolean;
  skipWarning: string | null;
  entries: RealCorpusEntry[];
}

export interface ParagraphDeletionFixture {
  revised: Buffer;
  targetedBookmarkNames: string[];
}

const corpusEntries = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as RealCorpusEntry[];

const preferredDeletionTargets: Readonly<Partial<Record<string, string>>> = {
  'nvca-voting-agreement': '_Ref444624639',
};

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function resolveRealCorpusAvailability(corpusRoot: string): RealCorpusAvailability {
  const problems: string[] = [];
  if (!corpusRoot) {
    problems.push(`${REAL_CORPUS_ENV} is unset`);
  } else {
    for (const entry of corpusEntries) {
      const sourcePath = join(corpusRoot, entry.id, 'source.docx');
      if (!existsSync(sourcePath)) {
        problems.push(`${entry.id}/source.docx is missing`);
        continue;
      }
      const actualSha256 = sha256(readFileSync(sourcePath));
      if (actualSha256 !== entry.sha256) {
        problems.push(`${entry.id}/source.docx failed SHA-256 verification`);
      }
    }
  }

  return {
    available: problems.length === 0,
    entries: corpusEntries,
    skipWarning:
      problems.length === 0
        ? null
        : `[real-corpus] SKIP: set ${REAL_CORPUS_ENV} to the ` +
          `SHA-256-verified Open Agreements cache root. ${problems.join('; ')}.`,
  };
}

function elements(node: XmlDocument | XmlElement, tagName: string): XmlElement[] {
  return Array.from(node.getElementsByTagName(tagName));
}

function fieldTargetNames(documentXml: string): Set<string> {
  const document = new DOMParser().parseFromString(documentXml, 'text/xml');
  const instructions = [
    ...elements(document, 'w:instrText').map((node) => node.textContent ?? ''),
    ...elements(document, 'w:fldSimple').map(
      (node) => node.getAttribute('w:instr') ?? node.getAttributeNS(W_NS, 'instr') ?? '',
    ),
  ];
  const names = new Set<string>();
  for (const instruction of instructions) {
    const match = instruction.match(/\b(?:REF|PAGEREF)\s+(?:"([^"]+)"|([^\s\\]+))/i);
    const name = match?.[1] ?? match?.[2];
    if (name) names.add(name);
  }
  return names;
}

function directBodyParagraphs(document: XmlDocument): XmlElement[] {
  const body = elements(document, 'w:body')[0];
  if (!body) throw new Error('word/document.xml has no w:body');
  return Array.from(body.childNodes).filter(
    (node): node is XmlElement =>
      node.nodeType === 1 && (node as XmlElement).tagName === 'w:p',
  );
}

function targetedBookmarkNames(
  paragraph: XmlElement,
  targets: Set<string>,
): { all: string[]; midParagraph: string[] } {
  const orderedNodes: XmlNode[] = [];
  const visit = (node: XmlNode): void => {
    orderedNodes.push(node);
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(paragraph);

  const all: string[] = [];
  const midParagraph: string[] = [];
  for (const start of elements(paragraph, 'w:bookmarkStart')) {
    const name = start.getAttribute('w:name') ?? start.getAttributeNS(W_NS, 'name');
    const id = start.getAttribute('w:id') ?? start.getAttributeNS(W_NS, 'id');
    if (!name || !id || !targets.has(name)) continue;
    const end = elements(paragraph, 'w:bookmarkEnd').find(
      (candidate) =>
        (candidate.getAttribute('w:id') ?? candidate.getAttributeNS(W_NS, 'id')) === id,
    );
    if (!end) continue;
    const startIndex = orderedNodes.indexOf(start);
    const endIndex = orderedNodes.indexOf(end);
    const hasTextInside = orderedNodes.some(
      (node, index) =>
        index > startIndex &&
        index < endIndex &&
        node.nodeType === 3 &&
        (node.nodeValue ?? '').trim() !== '',
    );
    if (!hasTextInside) continue;
    all.push(name);
    const hasTextAfter = orderedNodes.some(
      (node, index) =>
        index > endIndex && node.nodeType === 3 && (node.nodeValue ?? '').trim() !== '',
    );
    if (hasTextAfter) midParagraph.push(name);
  }
  return { all, midParagraph };
}

function selectDeletionParagraph(
  paragraphs: XmlElement[],
  targetNames: Set<string>,
  preferredTargetName?: string,
): { paragraph: XmlElement; targetedBookmarkNames: string[] } {
  const candidates = paragraphs
    .map((paragraph) => {
      const targets = targetedBookmarkNames(paragraph, targetNames);
      return {
        paragraph,
        targetedBookmarkNames: targets.all,
        midParagraphTargetedBookmarkNames: targets.midParagraph,
        text: paragraph.textContent?.trim() ?? '',
      };
    })
    .filter((candidate) => candidate.text.length >= 20);

  const selected =
    candidates.find((candidate) =>
      candidate.midParagraphTargetedBookmarkNames.includes(preferredTargetName ?? ''),
    ) ??
    candidates.find((candidate) => candidate.midParagraphTargetedBookmarkNames.length > 0) ??
    candidates.find((candidate) => candidate.targetedBookmarkNames.length > 0) ??
    candidates.find((_candidate, index) => index > 0 && index < candidates.length - 1);

  if (!selected) throw new Error('no suitable body-level paragraph found for deletion');
  return {
    paragraph: selected.paragraph,
    targetedBookmarkNames:
      preferredTargetName &&
      selected.midParagraphTargetedBookmarkNames.includes(preferredTargetName)
        ? [preferredTargetName]
        : selected.midParagraphTargetedBookmarkNames.length > 0
          ? selected.midParagraphTargetedBookmarkNames
          : selected.targetedBookmarkNames,
  };
}

export async function deleteOneRealParagraph(
  original: Buffer,
  entryId?: string,
): Promise<ParagraphDeletionFixture> {
  const zip = await JSZip.loadAsync(original);
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new Error('DOCX has no word/document.xml');
  const documentXml = await documentPart.async('string');
  const document = new DOMParser().parseFromString(documentXml, 'text/xml');
  const selected = selectDeletionParagraph(
    directBodyParagraphs(document),
    fieldTargetNames(documentXml),
    entryId ? preferredDeletionTargets[entryId] : undefined,
  );
  selected.paragraph.parentNode?.removeChild(selected.paragraph);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  return {
    revised: await zip.generateAsync({ type: 'nodebuffer' }),
    targetedBookmarkNames: selected.targetedBookmarkNames,
  };
}
