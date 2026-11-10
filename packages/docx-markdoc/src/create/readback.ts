import JSZip from 'jszip';
import { OOXML, parseXml } from '@usejunior/docx-core';
import { DocxMarkdocError } from '../errors.js';
import { PAGE_FIELD_TOKEN, type FirstPageProjection, type FooterProjection, type FootnoteReferencePosition } from './lower.js';

const W = OOXML.W_NS;
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** What a created DOCX reads back as, independent of how it was produced. */
export type CreationReadback = {
  /** Body paragraphs in document order, table-cell paragraphs included. */
  paragraphs: string[];
  /** Parallel to `paragraphs`: whether each paragraph sits in a table cell. */
  inTableCell: boolean[];
  /** Per section: the default footer's paragraph texts, or null without a footer reference. */
  footers: FooterProjection[];
  /** Per section: the default header's paragraph texts, or null without a header reference. */
  headers: FooterProjection[];
  /** Per section: null without `w:titlePg`; with it, the first-page header and footer texts (null without a reference). */
  firstPage: FirstPageProjection[];
  /** Every body `w:footnoteReference`, in document order: its paragraph (index into `paragraphs`) and offset. */
  footnoteReferences: FootnoteReferencePosition[];
  /** The note each reference names, in the same order: its paragraph texts (the number mark reads as nothing). */
  footnotes: string[][];
  /** Every body REF field (a cross-reference), in document order: its paragraph, offset, cached result and instruction. Absent when there are none. */
  crossReferences?: CrossReferenceSite[];
  /** Every REF field in the notes, note by note in reference order; `paragraph` counts within its note. Absent when there are none. */
  footnoteCrossReferences?: Array<CrossReferenceSite & { note: number }>;
  /** Every body bookmark start, in document order, with the paragraph (index into `paragraphs`) it opens in. Absent when there are none. */
  bookmarks?: BookmarkSite[];
};

/**
 * A bookmark and the paragraph it opens in. `text` is the read-back text
 * between its start and its end, which is what a text cross-reference to it
 * shows; it is absent when the bookmark does not end in that paragraph.
 */
export type BookmarkSite = { name: string; paragraph: number; text?: string };

/** Where a cross-reference's cached result sits in the read-back text, and the field's instruction. */
export type CrossReferenceSite = { paragraph: number; offset: number; text: string; instruction: string };

function isW(node: Node, localName: string): node is Element {
  return node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName;
}

function elementChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

/**
 * Paragraph text with `w:tab` as \t and `w:br` as \n. A complex field reads
 * as its instruction token (PAGE → `<PAGE>`), never its cached result, so a
 * footer projection does not depend on the page a reader rendered. A REF
 * field (a cross-reference) reads as its cached result: the number generation
 * computed for its target, which the projection predicts independently.
 * `onRunText` is told the run each piece of text came from (a field's piece
 * comes with the run that ends it), so a caller can read its formatting.
 */
export function paragraphReadbackText(
  paragraph: Element,
  onFootnoteReference?: (offset: number, id: string) => void,
  onCrossReference?: (offset: number, text: string, instruction: string) => void,
  onBookmark?: (name: string, id: string, offset: number) => void,
  onBookmarkEnd?: (id: string, offset: number) => void,
  onRunText?: (start: number, end: number, run: Element | null) => void,
): string {
  let text = '';
  let field: { instruction: string; inResult: boolean; result: string } | null = null;
  let run: Element | null = null;
  /** Append read-back text, telling `onRunText` which run (or field) it came from. */
  const append = (value: string, from: Element | null = run): void => {
    if (!value) return;
    onRunText?.(text.length, text.length + value.length, from);
    text += value;
  };
  const visit = (node: Element): void => {
    for (const child of elementChildren(node)) {
      if (child.namespaceURI !== W) continue;
      switch (child.localName) {
        case 'pPr':
        case 'rPr':
          break;
        case 'fldChar': {
          const type = child.getAttributeNS(W, 'fldCharType') || child.getAttribute('w:fldCharType');
          if (type === 'begin') field = { instruction: '', inResult: false, result: '' };
          else if (type === 'separate' && field) field.inResult = true;
          else if (type === 'end' && field) {
            const name = field.instruction.trim().split(/\s+/)[0] ?? '';
            if (name === 'REF') onCrossReference?.(text.length, field.result, field.instruction);
            append(name === 'PAGE' ? PAGE_FIELD_TOKEN : name === 'REF' ? field.result : `<${name}>`);
            field = null;
          }
          break;
        }
        case 'fldSimple': {
          // A simple field (Word writes some this way): its instruction is an
          // attribute and its cached result the runs inside. It reads like
          // the complex form; create never writes one.
          if (field) break;
          const instruction = child.getAttributeNS(W, 'instr') || child.getAttribute('w:instr') || '';
          const name = instruction.trim().split(/\s+/)[0] ?? '';
          const result = Array.from(child.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('');
          const firstRun = Array.from(child.getElementsByTagNameNS(W, 'r'))[0] ?? null;
          if (name === 'REF') onCrossReference?.(text.length, result, instruction);
          append(name === 'PAGE' ? PAGE_FIELD_TOKEN : name === 'REF' ? result : `<${name}>`, firstRun);
          break;
        }
        case 'instrText':
          if (field) field.instruction += child.textContent ?? '';
          break;
        case 't':
          if (!field) append(child.textContent ?? '');
          else if (field.inResult) field.result += child.textContent ?? '';
          break;
        case 'tab':
          if (!field) append('\t');
          break;
        case 'br':
          if (!field) append('\n');
          break;
        case 'bookmarkStart':
          onBookmark?.(child.getAttributeNS(W, 'name') || child.getAttribute('w:name') || '', child.getAttributeNS(W, 'id') || child.getAttribute('w:id') || '', text.length);
          break;
        case 'bookmarkEnd':
          onBookmarkEnd?.(child.getAttributeNS(W, 'id') || child.getAttribute('w:id') || '', text.length);
          break;
        case 'footnoteReference':
          onFootnoteReference?.(text.length, child.getAttributeNS(W, 'id') || child.getAttribute('w:id') || '');
          break;
        case 'r': {
          const outer = run;
          run = child;
          visit(child);
          run = outer;
          break;
        }
        default:
          visit(child);
      }
    }
  };
  visit(paragraph);
  return text;
}

type FootnoteReferenceSite = FootnoteReferencePosition & { id: string };

function blockParagraphs(
  container: Element,
  out: string[],
  cells: boolean[] = [],
  inCell = false,
  references: FootnoteReferenceSite[] = [],
  crossReferences: CrossReferenceSite[] = [],
  bookmarks: BookmarkSite[] = [],
): void {
  for (const child of elementChildren(container)) {
    if (isW(child, 'p')) {
      const paragraph = out.length;
      const opened = new Map<string, { site: BookmarkSite; start: number }>();
      const closed: Array<{ site: BookmarkSite; start: number; end: number }> = [];
      const text = paragraphReadbackText(
        child,
        (offset, id) => references.push({ paragraph, offset, id }),
        (offset, result, instruction) => crossReferences.push({ paragraph, offset, text: result, instruction }),
        (name, id, offset) => {
          const site: BookmarkSite = { name, paragraph };
          bookmarks.push(site);
          opened.set(id, { site, start: offset });
        },
        (id, offset) => {
          const start = opened.get(id);
          if (start) closed.push({ ...start, end: offset });
          opened.delete(id);
        },
      );
      for (const { site, start, end } of closed) site.text = text.slice(start, end);
      out.push(text);
      cells.push(inCell);
    } else if (isW(child, 'tbl')) {
      for (const row of elementChildren(child).filter((node) => isW(node, 'tr'))) {
        for (const cell of elementChildren(row).filter((node) => isW(node, 'tc'))) blockParagraphs(cell, out, cells, true, references, crossReferences, bookmarks);
      }
    }
  }
}

/** The note each reference names, read from word/footnotes.xml. */
async function readFootnotes(
  read: (path: string) => Promise<string>,
  hasPart: boolean,
  references: readonly FootnoteReferenceSite[],
  crossReferences: Array<CrossReferenceSite & { note: number }> = [],
): Promise<string[][]> {
  if (references.length === 0) return [];
  if (!hasPart) throw new DocxMarkdocError('CREATION_READBACK_FAILED', 'The document references footnotes but has no word/footnotes.xml.');
  const notes = new Map<string, Element>();
  for (const note of Array.from(parseXml(await read('word/footnotes.xml')).getElementsByTagNameNS(W, 'footnote'))) {
    notes.set(note.getAttributeNS(W, 'id') || note.getAttribute('w:id') || '', note);
  }
  return references.map(({ id }, index) => {
    const note = notes.get(id);
    if (!note) throw new DocxMarkdocError('CREATION_READBACK_FAILED', `Footnote reference ${id} does not resolve.`);
    const lines: string[] = [];
    const sites: CrossReferenceSite[] = [];
    blockParagraphs(note, lines, [], false, [], sites);
    crossReferences.push(...sites.map((site) => ({ ...site, note: index + 1 })));
    return lines;
  });
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
  const inTableCell: boolean[] = [];
  const references: FootnoteReferenceSite[] = [];
  const crossReferences: CrossReferenceSite[] = [];
  const bookmarks: BookmarkSite[] = [];
  blockParagraphs(body, paragraphs, inTableCell, false, references, crossReferences, bookmarks);
  const footnoteCrossReferences: Array<CrossReferenceSite & { note: number }> = [];
  const footnotes = await readFootnotes(read, zip.file('word/footnotes.xml') !== null, references, footnoteCrossReferences);

  const rels = parseXml(await read('word/_rels/document.xml.rels'));
  const targets = new Map(Array.from(rels.getElementsByTagName('Relationship'))
    .map((rel) => [rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '']));
  const footers: FooterProjection[] = [];
  const headers: FooterProjection[] = [];
  const firstPage: FirstPageProjection[] = [];
  /** The paragraph texts of the part a sectPr's header or footer reference of `type` selects, or null without one. */
  const story = async (sectPr: Element, kind: 'header' | 'footer', type: 'default' | 'first'): Promise<FooterProjection> => {
    const reference = elementChildren(sectPr).find((child) => isW(child, `${kind}Reference`)
      && (child.getAttributeNS(W, 'type') || child.getAttribute('w:type')) === type);
    if (!reference) return null;
    const target = targets.get(reference.getAttributeNS(R, 'id') || reference.getAttribute('r:id') || '');
    if (!target) throw new DocxMarkdocError('CREATION_READBACK_FAILED', `A ${kind} reference does not resolve.`);
    const part = parseXml(await read(`word/${target.replace(/^\//, '').replace(/^word\//, '')}`));
    const lines: string[] = [];
    blockParagraphs(part.documentElement!, lines);
    return lines;
  };
  for (const sectPr of Array.from(document.getElementsByTagNameNS(W, 'sectPr'))) {
    footers.push(await story(sectPr, 'footer', 'default'));
    headers.push(await story(sectPr, 'header', 'default'));
    // w:titlePg is an on/off property: present and not turned off with w:val.
    const titlePg = elementChildren(sectPr).find((child) => isW(child, 'titlePg'));
    const value = titlePg ? titlePg.getAttributeNS(W, 'val') || titlePg.getAttribute('w:val') : null;
    const on = titlePg !== undefined && !['0', 'false', 'off'].includes(value ?? '');
    firstPage.push(on ? { header: await story(sectPr, 'header', 'first'), footer: await story(sectPr, 'footer', 'first') } : null);
  }
  return {
    paragraphs,
    inTableCell,
    footers,
    headers,
    firstPage,
    footnoteReferences: references.map(({ paragraph, offset }) => ({ paragraph, offset })),
    footnotes,
    ...(crossReferences.length ? { crossReferences } : {}),
    ...(footnoteCrossReferences.length ? { footnoteCrossReferences } : {}),
    ...(bookmarks.length ? { bookmarks } : {}),
  };
}
