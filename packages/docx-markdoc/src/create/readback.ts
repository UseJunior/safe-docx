import JSZip from 'jszip';
import { OOXML, parseXml } from '@usejunior/docx-core';
import { DocxMarkdocError } from '../errors.js';
import { PAGE_FIELD_TOKEN, type FooterProjection } from './lower.js';

const W = OOXML.W_NS;
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** What a created DOCX reads back as, independent of how it was produced. */
export type CreationReadback = {
  /** Body paragraphs in document order, table-cell paragraphs included. */
  paragraphs: string[];
  /** Per section: the default footer's paragraph texts, or null without a footer reference. */
  footers: FooterProjection[];
};

function isW(node: Node, localName: string): node is Element {
  return node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName;
}

function elementChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

/**
 * Paragraph text with `w:tab` as \t and `w:br` as \n. A complex field reads
 * as its instruction token (PAGE → `<PAGE>`), never its cached result, so a
 * footer projection does not depend on the page a reader rendered.
 */
export function paragraphReadbackText(paragraph: Element): string {
  let text = '';
  let field: { instruction: string; inResult: boolean } | null = null;
  const visit = (node: Element): void => {
    for (const child of elementChildren(node)) {
      if (child.namespaceURI !== W) continue;
      switch (child.localName) {
        case 'pPr':
        case 'rPr':
          break;
        case 'fldChar': {
          const type = child.getAttributeNS(W, 'fldCharType') || child.getAttribute('w:fldCharType');
          if (type === 'begin') field = { instruction: '', inResult: false };
          else if (type === 'separate' && field) field.inResult = true;
          else if (type === 'end' && field) {
            const name = field.instruction.trim().split(/\s+/)[0] ?? '';
            text += name === 'PAGE' ? PAGE_FIELD_TOKEN : `<${name}>`;
            field = null;
          }
          break;
        }
        case 'instrText':
          if (field) field.instruction += child.textContent ?? '';
          break;
        case 't':
          if (!field) text += child.textContent ?? '';
          break;
        case 'tab':
          if (!field) text += '\t';
          break;
        case 'br':
          if (!field) text += '\n';
          break;
        default:
          visit(child);
      }
    }
  };
  visit(paragraph);
  return text;
}

function blockParagraphs(container: Element, out: string[]): void {
  for (const child of elementChildren(container)) {
    if (isW(child, 'p')) out.push(paragraphReadbackText(child));
    else if (isW(child, 'tbl')) {
      for (const row of elementChildren(child).filter((node) => isW(node, 'tr'))) {
        for (const cell of elementChildren(row).filter((node) => isW(node, 'tc'))) blockParagraphs(cell, out);
      }
    }
  }
}

/** Read a created DOCX back: body paragraph text and each section's footer. */
export async function readCreatedDocx(buffer: Buffer): Promise<CreationReadback> {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (!file) throw new DocxMarkdocError('CREATION_READBACK_FAILED', `Created package is missing ${path}.`);
    return file.async('string');
  };
  const document = parseXml(await read('word/document.xml'));
  const body = document.getElementsByTagNameNS(W, 'body').item(0);
  if (!body) throw new DocxMarkdocError('CREATION_READBACK_FAILED', 'Created document has no w:body.');
  const paragraphs: string[] = [];
  blockParagraphs(body, paragraphs);

  const rels = parseXml(await read('word/_rels/document.xml.rels'));
  const targets = new Map(Array.from(rels.getElementsByTagName('Relationship'))
    .map((rel) => [rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '']));
  const footers: FooterProjection[] = [];
  for (const sectPr of Array.from(document.getElementsByTagNameNS(W, 'sectPr'))) {
    const reference = elementChildren(sectPr).find((child) => isW(child, 'footerReference')
      && (child.getAttributeNS(W, 'type') || child.getAttribute('w:type')) === 'default');
    if (!reference) {
      footers.push(null);
      continue;
    }
    const target = targets.get(reference.getAttributeNS(R, 'id') || reference.getAttribute('r:id') || '');
    if (!target) throw new DocxMarkdocError('CREATION_READBACK_FAILED', 'A footer reference does not resolve.');
    const footer = parseXml(await read(`word/${target.replace(/^\//, '').replace(/^word\//, '')}`));
    const lines: string[] = [];
    blockParagraphs(footer.documentElement!, lines);
    footers.push(lines);
  }
  return { paragraphs, footers };
}
