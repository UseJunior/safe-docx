import { createHash } from 'node:crypto';
import Markdoc, { type Node as MarkdocNode } from '@markdoc/markdoc';
import {
  DOCX_PATHS,
  DocxArchive,
  DocxZip,
  OOXML,
  TRACKED_CHANGE_ELEMENT_NAME_SET,
  auditSectPr,
  childElements,
  enumerateSelectedRevisionStoryPartPaths,
  parseXml,
  serializeXml,
} from '@usejunior/docx-core';
import { DocxMarkdocError } from './errors.js';

export const GREENFIELD_DOCUMENT_DATE = new Date('2006-01-01T00:00:00.000Z');

export type GreenfieldStyleProfile = {
  bodyStyleId: string;
  headingStyleIds?: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, string>>;
};

export type GreenfieldBodyBlock = {
  kind: 'paragraph' | 'heading';
  text: string;
  styleId: string;
  level?: number;
};

export type GreenfieldCertificate = {
  version: 1;
  canonicalSha256: string;
  templateSha256: string;
  styleProfileSha256?: string;
  outputSha256: string;
  templateDocumentXmlSha256: string;
  outputDocumentXmlSha256: string;
  changedParts: ['word/document.xml'];
  unchangedPartSha256: Record<string, string>;
  resolvedStyles: GreenfieldStyleProfile;
  blocks: GreenfieldBodyBlock[];
  sectionBindings: Array<{ kind: string; role: string; rid: string; targetPath: string }>;
  selectedRevisionStories: string[];
};

export type CompileGreenfieldOptions = {
  styleProfile?: GreenfieldStyleProfile;
  /** Exact JSON bytes when the profile came from a file. */
  styleProfileSource?: string | Buffer;
};

export type GreenfieldCompilation = {
  clean: Buffer;
  certificate: GreenfieldCertificate;
};

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

function fail(code: string, message: string, details?: unknown): never {
  throw new DocxMarkdocError(code, message, details);
}

function inlineText(node: MarkdocNode): string {
  if (node.type === 'text') return String(node.attributes.content ?? '');
  if (node.type === 'softbreak') return ' ';
  if (node.type === 'inline') return node.children.map(inlineText).join('');
  fail('UNSUPPORTED_GREENFIELD_SYNTAX', `Unsupported inline syntax '${node.type}' at line ${node.location?.start.line ?? '?'}.`);
}

function defaultProfile(): GreenfieldStyleProfile {
  return {
    bodyStyleId: 'Normal',
    headingStyleIds: { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3', 4: 'Heading4', 5: 'Heading5', 6: 'Heading6' },
  };
}

function resolvedProfile(input?: GreenfieldStyleProfile): GreenfieldStyleProfile {
  const defaults = defaultProfile();
  if (!input) return defaults;
  if (typeof input !== 'object' || Array.isArray(input)) fail('INVALID_STYLE_PROFILE', 'Style profile must be a JSON object.');
  if (typeof input.bodyStyleId !== 'string' || !input.bodyStyleId.trim()) fail('INVALID_STYLE_PROFILE', 'bodyStyleId must be a non-empty string.');
  if (input.headingStyleIds !== undefined && (typeof input.headingStyleIds !== 'object' || input.headingStyleIds === null || Array.isArray(input.headingStyleIds))) {
    fail('INVALID_STYLE_PROFILE', 'headingStyleIds must be a JSON object.');
  }
  for (const [level, styleId] of Object.entries(input.headingStyleIds ?? {})) {
    if (!/^[1-6]$/.test(level) || typeof styleId !== 'string' || !styleId.trim()) {
      fail('INVALID_STYLE_PROFILE', `Invalid heading style mapping '${level}'.`);
    }
  }
  return { bodyStyleId: input.bodyStyleId, headingStyleIds: { ...defaults.headingStyleIds, ...input.headingStyleIds } };
}

/** Parse the deliberately bounded, tag-free greenfield Markdoc grammar. */
export function parseGreenfieldMarkdoc(source: string, profile?: GreenfieldStyleProfile): GreenfieldBodyBlock[] {
  const ast = Markdoc.parse(source);
  if (Object.keys(ast.attributes ?? {}).length > 0) {
    fail('UNSUPPORTED_GREENFIELD_FRONTMATTER', 'Greenfield Markdoc does not admit YAML frontmatter.');
  }
  const styles = resolvedProfile(profile);
  const blocks: GreenfieldBodyBlock[] = [];
  for (const node of ast.children) {
    if (node.type !== 'paragraph' && node.type !== 'heading') {
      fail('UNSUPPORTED_GREENFIELD_SYNTAX', `Unsupported block syntax '${node.type}' at line ${node.location?.start.line ?? '?'}.`);
    }
    const text = node.children.map(inlineText).join('').trim();
    if (!text) fail('EMPTY_GREENFIELD_BLOCK', `Empty ${node.type} at line ${node.location?.start.line ?? '?'}.`);
    if (node.type === 'heading') {
      const level = Number(node.attributes.level);
      if (!Number.isInteger(level) || level < 1 || level > 6) fail('UNSUPPORTED_HEADING_LEVEL', `Unsupported heading level '${node.attributes.level}'.`);
      const styleId = styles.headingStyleIds?.[level as 1 | 2 | 3 | 4 | 5 | 6];
      if (!styleId) fail('UNMAPPED_HEADING_STYLE', `Heading level ${level} has no style mapping.`);
      blocks.push({ kind: 'heading', level, text, styleId });
    } else {
      blocks.push({ kind: 'paragraph', text, styleId: styles.bodyStyleId });
    }
  }
  if (blocks.length === 0) fail('EMPTY_GREENFIELD_DOCUMENT', 'Greenfield Markdoc must contain at least one paragraph or heading.');
  return blocks;
}

/** Emit one escaped plain-text OOXML run under an existing container. */
export function appendPlainTextRun(doc: Document, parent: Element, value: string): Element {
  const run = doc.createElementNS(OOXML.W_NS, 'w:r');
  const text = doc.createElementNS(OOXML.W_NS, 'w:t');
  if (/^\s|\s$|\s{2}/u.test(value)) text.setAttribute('xml:space', 'preserve');
  text.appendChild(doc.createTextNode(value));
  run.appendChild(text);
  parent.appendChild(run);
  return run;
}

function appendTextParagraph(doc: Document, body: Element, block: GreenfieldBodyBlock): void {
  const p = doc.createElementNS(OOXML.W_NS, 'w:p');
  const pPr = doc.createElementNS(OOXML.W_NS, 'w:pPr');
  const pStyle = doc.createElementNS(OOXML.W_NS, 'w:pStyle');
  pStyle.setAttributeNS(OOXML.W_NS, 'w:val', block.styleId);
  pPr.appendChild(pStyle);
  p.appendChild(pPr);
  appendPlainTextRun(doc, p, block.text);
  body.appendChild(p);
}

function collectStyleIds(stylesXml: string): Set<string> {
  const doc = parseXml(stylesXml);
  return new Set(Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, 'style'))
    .map((style) => style.getAttributeNS(OOXML.W_NS, 'styleId') || style.getAttribute('w:styleId'))
    .filter((value): value is string => Boolean(value)));
}

async function exactPartHashes(archive: DocxArchive): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of archive.listFiles().filter((entry) => entry !== DOCX_PATHS.DOCUMENT).sort()) {
    const value = await archive.getFileBuffer(path);
    if (value) result[path] = sha256(value);
  }
  return result;
}

async function packageTextParts(archive: DocxArchive): Promise<Map<string, string>> {
  const parts = new Map<string, string>();
  for (const path of archive.listFiles().filter((entry) => entry.endsWith('.xml'))) {
    const value = await archive.getFile(path);
    if (value !== null) parts.set(path, value);
  }
  return parts;
}

async function selectedRevisionStories(buffer: Buffer): Promise<string[]> {
  const zip = await DocxZip.load(buffer);
  return [DOCX_PATHS.DOCUMENT, ...await enumerateSelectedRevisionStoryPartPaths(zip)]
    .filter((path, index, all) => all.indexOf(path) === index && zip.hasFile(path))
    .sort();
}

async function assertRevisionFree(buffer: Buffer): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const stories = await selectedRevisionStories(buffer);
  for (const path of stories) {
    const xml = await archive.getFile(path);
    if (!xml) continue;
    const doc = parseXml(xml);
    for (const element of Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, '*'))) {
      if (TRACKED_CHANGE_ELEMENT_NAME_SET.has(element.localName)) {
        fail('GREENFIELD_TEMPLATE_HAS_REVISIONS', `Tracked revision w:${element.localName} is not admitted in ${path}.`);
      }
    }
  }
  return stories;
}

function bindingInventory(audit: ReturnType<typeof auditSectPr>) {
  return audit.bindings.map(({ kind, role, rid, targetPath }) => ({ kind, role, rid, targetPath }));
}

function projectedBlocks(documentXml: string): GreenfieldBodyBlock[] {
  const doc = parseXml(documentXml);
  const body = doc.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0) as Element | null;
  if (!body) return [];
  return childElements(body)
    .filter((node) => node.namespaceURI === OOXML.W_NS && node.localName === 'p')
    .map((paragraph) => {
      const style = paragraph.getElementsByTagNameNS(OOXML.W_NS, 'pStyle').item(0);
      const styleId = style?.getAttributeNS(OOXML.W_NS, 'val') || style?.getAttribute('w:val') || '';
      const text = Array.from(paragraph.getElementsByTagNameNS(OOXML.W_NS, 't')).map((node) => node.textContent ?? '').join('');
      return { kind: 'paragraph' as const, text, styleId };
    });
}

/**
 * Replace only the main-document body in a one-section presentation template.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.2.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.3.1.27
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/998
 */
export async function compileGreenfieldMarkdoc(
  template: Buffer,
  markdoc: string,
  options: CompileGreenfieldOptions = {},
): Promise<GreenfieldCompilation> {
  const profile = resolvedProfile(options.styleProfile);
  const blocks = parseGreenfieldMarkdoc(markdoc, profile);
  const archive = await DocxArchive.load(template);
  const documentXml = await archive.getDocumentXml();
  const relationshipsXml = await archive.getFile(DOCX_PATHS.RELS);
  const parts = await packageTextParts(archive);
  const sectionAudit = auditSectPr(documentXml, relationshipsXml, parts);
  if (!sectionAudit.ok || sectionAudit.stats.bodyLevelSectPrCount !== 1 || sectionAudit.stats.paragraphLevelSectPrCount !== 0 || sectionAudit.stats.totalSectPrCount !== 1) {
    fail('UNSUPPORTED_GREENFIELD_TEMPLATE_TOPOLOGY', 'Template must contain exactly one final direct body-level w:sectPr and no other section properties.', sectionAudit);
  }
  for (const binding of sectionAudit.bindings) {
    if (!archive.hasFile(binding.targetPath)) fail('MISSING_GREENFIELD_STORY', `Missing selected ${binding.kind} part ${binding.targetPath}.`);
  }
  const stories = await assertRevisionFree(template);
  const stylesXml = await archive.getStylesXml();
  if (!stylesXml) fail('MISSING_TEMPLATE_STYLES', 'Template is missing word/styles.xml.');
  const availableStyles = collectStyleIds(stylesXml);
  for (const styleId of new Set(blocks.map((block) => block.styleId))) {
    if (!availableStyles.has(styleId)) fail('MISSING_TEMPLATE_STYLE', `Template does not define required style '${styleId}'.`);
  }

  const beforeHashes = await exactPartHashes(archive);
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0) as Element | null;
  if (!body) fail('MISSING_TEMPLATE_BODY', 'Template is missing w:body.');
  const section = childElements(body).at(-1)!;
  const templateSectionXml = serializeXml(section as unknown as Document);
  for (const child of childElements(body)) body.removeChild(child);
  for (const block of blocks) appendTextParagraph(document, body, block);
  body.appendChild(section);
  const projectedXml = serializeXml(document);
  archive.setDocumentXml(projectedXml, { date: GREENFIELD_DOCUMENT_DATE });
  const clean = await archive.save();

  const outputArchive = await DocxArchive.load(clean);
  const outputDocumentXml = await outputArchive.getDocumentXml();
  const outputHashes = await exactPartHashes(outputArchive);
  if (JSON.stringify(outputHashes) !== JSON.stringify(beforeHashes)) fail('GREENFIELD_UNCHANGED_PART_DRIFT', 'A package part outside word/document.xml changed.');
  const outputAudit = auditSectPr(outputDocumentXml, await outputArchive.getFile(DOCX_PATHS.RELS), await packageTextParts(outputArchive));
  if (!outputAudit.ok || JSON.stringify(bindingInventory(outputAudit)) !== JSON.stringify(bindingInventory(sectionAudit))) {
    fail('GREENFIELD_STORY_BINDING_DRIFT', 'Section or selected header/footer bindings changed during projection.');
  }
  const outputDocument = parseXml(outputDocumentXml);
  const outputBody = outputDocument.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0) as Element | null;
  const outputSection = outputBody ? childElements(outputBody).at(-1) : undefined;
  if (!outputSection || serializeXml(outputSection as unknown as Document) !== templateSectionXml) {
    fail('GREENFIELD_SECTION_DRIFT', 'Final section properties changed during projection.');
  }
  const actualBlocks = projectedBlocks(outputDocumentXml);
  const expectedBlocks = blocks.map(({ text, styleId }) => ({ kind: 'paragraph' as const, text, styleId }));
  if (JSON.stringify(actualBlocks) !== JSON.stringify(expectedBlocks)) fail('GREENFIELD_BODY_PROJECTION_DRIFT', 'Reloaded body text or styles do not match canonical Markdoc.');
  const outputStories = await assertRevisionFree(clean);
  if (JSON.stringify(outputStories) !== JSON.stringify(stories)) fail('GREENFIELD_STORY_INVENTORY_DRIFT', 'Selected revision-story inventory changed.');

  return {
    clean,
    certificate: {
      version: 1,
      canonicalSha256: sha256(markdoc),
      templateSha256: sha256(template),
      ...(options.styleProfileSource === undefined ? {} : { styleProfileSha256: sha256(options.styleProfileSource) }),
      outputSha256: sha256(clean),
      templateDocumentXmlSha256: sha256(documentXml),
      outputDocumentXmlSha256: sha256(outputDocumentXml),
      changedParts: [DOCX_PATHS.DOCUMENT],
      unchangedPartSha256: beforeHashes,
      resolvedStyles: profile,
      blocks,
      sectionBindings: bindingInventory(sectionAudit),
      selectedRevisionStories: stories,
    },
  };
}
