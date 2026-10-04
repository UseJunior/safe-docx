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

/**
 * Re-zip a package with `prefix` (a UTF-8 BOM by default) in front of every
 * XML and relationship part, the shape Word's ISO-Strict exports and the
 * Open Agreements cache copy of the NVCA Voting Agreement carry (#1024). The
 * SHA-pinned NVCA downloads have no BOM, so the gate derives this variant.
 */
export async function prefixEveryXmlPart(source: Buffer, prefix = '\uFEFF'): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  for (const file of Object.values(zip.files)) {
    if (file.dir || !/\.(xml|rels)$/i.test(file.name)) continue;
    zip.file(file.name, prefix + (await file.async('string')));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function isPlainTextRun(node: XmlNode | null): node is XmlElement {
  if (node?.nodeType !== 1 || (node as XmlElement).tagName !== 'w:r') return false;
  const children = Array.from(node.childNodes).filter((child) => child.nodeType === 1) as XmlElement[];
  const content = children.filter((child) => child.tagName !== 'w:rPr');
  return content.length === 1 && content[0]!.tagName === 'w:t'
    && children.length - content.length <= 1;
}

function runPropertiesXml(run: XmlElement): string {
  const properties = Array.from(run.childNodes)
    .find((child) => child.nodeType === 1 && (child as XmlElement).tagName === 'w:rPr');
  return properties ? new XMLSerializer().serializeToString(properties) : '';
}

/**
 * Replace one whole-run word in the first body paragraph that carries it, and
 * re-segment that paragraph the way a save does: every maximal sequence of
 * adjacent plain-text runs with identical run properties becomes one run.
 * Text and formatting elsewhere in the paragraph are unchanged (#1142).
 */
export async function resegmentAndReplaceRealRunText(
  original: Buffer,
  word: string,
  replacement: string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(original);
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new Error('DOCX has no word/document.xml');
  const document = new DOMParser().parseFromString(await documentPart.async('string'), 'text/xml');
  const isTarget = (run: XmlElement): boolean =>
    isPlainTextRun(run) && elements(run, 'w:t')[0]!.textContent === word;
  const paragraph = directBodyParagraphs(document)
    .find((candidate) => elements(candidate, 'w:r').some(isTarget));
  if (!paragraph) throw new Error(`no body paragraph has a run reading "${word}"`);
  elements(paragraph, 'w:t').find((text) => isTarget(text.parentNode as XmlElement))!
    .textContent = replacement;
  let previous: XmlElement | null = null;
  for (const node of Array.from(paragraph.childNodes)) {
    if (node.nodeType === 3 && (node.nodeValue ?? '').trim() === '') continue;
    if (!isPlainTextRun(node)) {
      previous = null;
      continue;
    }
    if (previous && runPropertiesXml(previous) === runPropertiesXml(node)) {
      const text = elements(previous, 'w:t')[0]!;
      text.textContent = (text.textContent ?? '') + (elements(node, 'w:t')[0]!.textContent ?? '');
      text.setAttribute('xml:space', 'preserve');
      paragraph.removeChild(node);
      continue;
    }
    previous = node;
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  return zip.generateAsync({ type: 'nodebuffer' });
}
