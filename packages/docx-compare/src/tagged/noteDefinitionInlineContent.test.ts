import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSyntheticDocx, DocxArchive, DocxDocument, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

/**
 * A footnote or endnote whose body holds a field, a hyperlink or a comment
 * anchor is compared in place like any other note: only the changed words are
 * tracked inside the one surviving definition, and the field, hyperlink and
 * comment survive both projections (#1389).
 */
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Note definitions with fields, hyperlinks and comments' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SCHEMA_GATE = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const AUTHOR = 'Note inline content';
const DATE = new Date('2025-01-01T00:00:00Z');
type NoteKind = 'footnote' | 'endnote';

interface NoteSpec {
  /** Word inside the plain text between the field and the hyperlink. */
  word: string;
  /** REF field result; omitted for a note without a field. */
  fieldResult?: string;
  /** Hyperlink display text, relationship id and external target. */
  link?: { text: string; id: string; target: string };
  /** Comment text; the comment anchors the plain-text run. */
  comment?: string;
}

const BASE: NoteSpec = {
  word: 'notice',
  fieldResult: 'Section 4.2',
  link: { text: 'the public filing', id: 'rIdNoteLink1', target: 'https://example.com/filing' },
  comment: 'Confirm the cross-reference.',
};

const escapeText = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

/** A Word-shaped note body: `See <REF> for the <word> terms and <hyperlink>.` */
function noteBody(kind: NoteKind, spec: NoteSpec): string {
  const ref = kind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
  const style = kind === 'footnote' ? 'Footnote' : 'Endnote';
  const field = spec.fieldResult === undefined ? '' :
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\h </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    `<w:r><w:t>${escapeText(spec.fieldResult)}</w:t></w:r>` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const link = spec.link === undefined ? '' :
    `<w:hyperlink r:id="${spec.link.id}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>` +
    `<w:t>${escapeText(spec.link.text)}</w:t></w:r></w:hyperlink>`;
  return `<w:p><w:pPr><w:pStyle w:val="${style}Text"/></w:pPr>` +
    `<w:r><w:rPr><w:rStyle w:val="${style}Reference"/></w:rPr><w:${ref}/></w:r>` +
    '<w:r><w:t xml:space="preserve"> See </w:t></w:r>' + field +
    (spec.comment === undefined ? '' : '<w:commentRangeStart w:id="1"/>') +
    `<w:r><w:t xml:space="preserve"> for the ${escapeText(spec.word)} terms</w:t></w:r>` +
    (spec.comment === undefined ? '' :
      '<w:commentRangeEnd w:id="1"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>') +
    '<w:r><w:t xml:space="preserve"> and </w:t></w:r>' + link + '<w:r><w:t>.</w:t></w:r></w:p>';
}

/**
 * Build a document whose first paragraph anchors one note holding `spec`; the
 * second paragraph carries the `_Ref1` bookmark the REF field points at.
 */
async function notedDocx(kind: NoteKind, spec: NoteSpec, closing = 'Notice terms appear in Section 4.2.'): Promise<Buffer> {
  const docx = await buildSyntheticDocx({
    paragraphs: ['The parties agree to the terms below.', closing],
    ...(kind === 'footnote' ? { footnoteOnParagraph: 0 } : { endnoteOnParagraph: 0 }),
    bookmarkOnParagraph: { paragraph: 1, name: '_Ref1' },
    ...(spec.comment === undefined ? {} : { commentOnParagraph: 1, commentText: spec.comment }),
  });
  const archive = await DocxArchive.load(docx);
  if (spec.comment !== undefined) {
    // Move the fixture's body comment anchor into the note.
    const body = parseXml(await archive.getDocumentXml());
    for (const element of Array.from(body.getElementsByTagNameNS(W, '*'))) {
      if (['commentRangeStart', 'commentRangeEnd'].includes(element.localName)) element.parentNode!.removeChild(element);
      if (element.localName === 'commentReference') element.parentNode!.parentNode!.removeChild(element.parentNode!);
    }
    archive.setDocumentXml(body.toString());
  }
  const part = `word/${kind}s.xml`;
  const notes = (await archive.getFile(part))!
    .replace(`<w:${kind}s xmlns:w=`, `<w:${kind}s xmlns:r="${R}" xmlns:w=`)
    .replace(new RegExp(`(<w:${kind} w:id="1">)[\\s\\S]*?(</w:${kind}>)`), `$1${noteBody(kind, spec)}$2`);
  archive.setFile(part, notes);
  if (spec.link !== undefined) {
    archive.setFile(`word/_rels/${kind}s.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}">` +
      `<Relationship Id="rIdUnrelated9" Type="${R}/hyperlink" Target="https://example.com/unrelated" TargetMode="External"/>` +
      `<Relationship Id="${spec.link.id}" Type="${R}/hyperlink" Target="${spec.link.target}" TargetMode="External"/>` +
      '</Relationships>');
  }
  return archive.save();
}

function userEntries(notesXml: string, kind: NoteKind): Element[] {
  return Array.from(parseXml(notesXml).getElementsByTagNameNS(W, kind))
    .filter(entry => !entry.hasAttributeNS(W, 'type') || entry.getAttributeNS(W, 'type') === 'normal');
}

const textOf = (root: Element, localNames: readonly string[]): string =>
  Array.from(root.getElementsByTagNameNS(W, '*'))
    .filter(element => localNames.includes(element.localName))
    .map(element => element.textContent ?? '')
    .join('');

function hasAncestor(element: Element, stop: Element, localName: string): boolean {
  for (let node = element.parentNode; node && node !== stop; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName) return true;
  }
  return false;
}

async function notePart(docx: Buffer, kind: NoteKind) {
  const archive = await DocxArchive.load(docx);
  return {
    archive,
    documentXml: await archive.getDocumentXml(),
    notesXml: (await archive.getFile(`word/${kind}s.xml`))!,
    relsXml: await archive.getFile(`word/_rels/${kind}s.xml.rels`),
  };
}

/**
 * The relationship target each hyperlink in the note part resolves to. A
 * hyperlink a projection emptied of text displays nothing, so it is skipped:
 * docx-core's Accept keeps the empty wrapper where the comparison acceptor
 * drops it.
 */
function hyperlinkTargets(notesXml: string, relsXml: string | null): string[] {
  const targets = new Map(relsXml === null ? [] : Array.from(parseXml(relsXml).getElementsByTagNameNS(PR, 'Relationship'))
    .map(rel => [rel.getAttribute('Id')!, rel.getAttribute('Target')!]));
  return Array.from(parseXml(notesXml).getElementsByTagNameNS(W, 'hyperlink'))
    .filter(link => textOf(link, ['t', 'delText']) !== '')
    .map(link => targets.get(link.getAttributeNS(R, 'id') ?? '') ?? '<unresolved>');
}

async function nativeProjection(docx: Buffer, operation: 'acceptChanges' | 'rejectChanges'): Promise<Buffer> {
  const complete = await DocxDocument.load(docx);
  await complete[operation]();
  return (await complete.toBuffer()).buffer;
}

/** What a reader sees in the note: text, field instructions, hyperlink targets and comment anchors. */
async function noteView(docx: Buffer, kind: NoteKind, project: (xml: string) => string = xml => xml) {
  const { documentXml, notesXml, relsXml } = await notePart(docx, kind);
  const projected = project(notesXml);
  const entries = userEntries(projected, kind);
  const references = Array.from(parseXml(project(documentXml)).getElementsByTagNameNS(W, `${kind}Reference`));
  return {
    anchors: references.length,
    text: entries.map(entry => textOf(entry, ['t'])),
    instructions: entries.map(entry => textOf(entry, ['instrText']).trim()),
    hyperlinks: hyperlinkTargets(projected, relsXml),
    commentAnchors: entries.map(entry => entry.getElementsByTagNameNS(W, 'commentReference').length),
  };
}

/**
 * Accept All reproduces the revised note and Reject All the original one,
 * through the comparison acceptor and docx-core.
 */
async function expectProjections(kind: NoteKind, original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  expect(await noteView(compared, kind, acceptAllChanges), 'AST accept').toEqual(await noteView(revised, kind));
  expect(await noteView(compared, kind, rejectAllChanges), 'AST reject').toEqual(await noteView(original, kind));
  expect(await noteView(await nativeProjection(compared, 'acceptChanges'), kind), 'docx-core accept')
    .toEqual(await noteView(revised, kind));
  expect(await noteView(await nativeProjection(compared, 'rejectChanges'), kind), 'docx-core reject')
    .toEqual(await noteView(original, kind));
}

/** Tracked, native Accept and native Reject main and note parts validate against the vendored schema. */
async function expectSchemaValid(compared: Buffer, kind: NoteKind): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-1389-notes-'));
  try {
    let instances = 0;
    for (const [name, docx] of [
      ['tracked', compared],
      ['accepted', await nativeProjection(compared, 'acceptChanges')],
      ['rejected', await nativeProjection(compared, 'rejectChanges')],
    ] as const) {
      const { documentXml, notesXml } = await notePart(docx, kind);
      writeFileSync(join(dir, `${name}-document.xml`), documentXml); instances++;
      writeFileSync(join(dir, `${name}-${kind}s.xml`), notesXml); instances++;
    }
    const gate = spawnSync(process.execPath, [SCHEMA_GATE, dir], { encoding: 'utf8' });
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    expect(gate.stdout).toContain(`${instances} of ${instances} document.xml instances validate`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One definition remains, and only the changed words are tracked inside it:
 * the tracked text holds the changed word and stays within the source run
 * that held it, never the whole note.
 */
async function expectInPlaceEdit(
  compared: Buffer,
  kind: NoteKind,
  [deleted, deletedRun]: [string, string],
  [inserted, insertedRun]: [string, string],
): Promise<Element> {
  const { documentXml, notesXml } = await notePart(compared, kind);
  const entries = userEntries(notesXml, kind);
  expect(entries).toHaveLength(1);
  expect(parseXml(documentXml).getElementsByTagNameNS(W, `${kind}Reference`)).toHaveLength(1);
  const entry = entries[0]!;
  const deletedText = textOf(entry, ['delText']);
  expect(deletedText).toContain(deleted);
  expect(deletedRun).toContain(deletedText);
  const insertedText = Array.from(entry.getElementsByTagNameNS(W, 't'))
    .filter(t => hasAncestor(t, entry, 'ins'))
    .map(t => t.textContent)
    .join('');
  expect(insertedText).toContain(inserted);
  expect(insertedRun).toContain(insertedText);
  return entry;
}

describe('a note holding a field, hyperlink or comment is compared in place', () => {
  for (const kind of ['footnote', 'endnote'] as const) {
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' })(
      `tracks one changed word in a ${kind} that holds a REF field, a hyperlink and a comment`,
      async () => {
        const original = await notedDocx(kind, BASE);
        const revised = await notedDocx(kind, { ...BASE, word: 'payment' }, 'Notice terms appear in Section 4.2 today.');
        const compared = (await compareDocuments(original, revised, { author: AUTHOR, date: DATE })).document;
        const entry = await expectInPlaceEdit(compared, kind, ['notice', ' for the notice terms'], ['payment', ' for the payment terms']);
        expect(textOf(entry, ['instrText']).trim()).toBe('REF _Ref1 \\h');
        expect(entry.getElementsByTagNameNS(W, 'hyperlink')).toHaveLength(1);
        expect(entry.getElementsByTagNameNS(W, 'commentReference')).toHaveLength(1);
        await expectProjections(kind, original, revised, compared);
        await expectSchemaValid(compared, kind);
      },
    );
  }

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' })(
    'tracks a changed REF field result inside the field (the issue reproduction)',
    async () => {
      const original = await notedDocx('footnote', { ...BASE, comment: undefined });
      const revised = await notedDocx('footnote', { ...BASE, comment: undefined, fieldResult: 'Section 4.3' });
      const compared = (await compareDocuments(original, revised, { author: AUTHOR, date: DATE })).document;
      const entry = await expectInPlaceEdit(compared, 'footnote', ['4.2', 'Section 4.2'], ['4.3', 'Section 4.3']);
      expect(entry.getElementsByTagNameNS(W, 'fldChar')).toHaveLength(3);
      await expectProjections('footnote', original, revised, compared);
      await expectSchemaValid(compared, 'footnote');
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' })(
    'tracks changed hyperlink text inside the hyperlink, never around it',
    async () => {
      const original = await notedDocx('footnote', { ...BASE, fieldResult: undefined, comment: undefined });
      const revised = await notedDocx('footnote', {
        ...BASE, fieldResult: undefined, comment: undefined, link: { ...BASE.link!, text: 'the official filing' },
      });
      const compared = (await compareDocuments(original, revised, { author: AUTHOR, date: DATE })).document;
      const entry = await expectInPlaceEdit(compared, 'footnote', ['public', 'the public filing'], ['official', 'the official filing']);
      const links = Array.from(entry.getElementsByTagNameNS(W, 'hyperlink'));
      expect(links).toHaveLength(1);
      for (const mark of Array.from(entry.getElementsByTagNameNS(W, '*')).filter(e => ['ins', 'del'].includes(e.localName))) {
        expect(hasAncestor(mark, entry, 'hyperlink'), 'revision marks sit inside w:hyperlink').toBe(true);
        expect(mark.getElementsByTagNameNS(W, 'hyperlink'), 'no hyperlink inside a revision mark').toHaveLength(0);
      }
      await expectProjections('footnote', original, revised, compared);
      await expectSchemaValid(compared, 'footnote');
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.3.4' })(
    'keeps an unchanged hyperlink stored under a different relationship id unchanged',
    async () => {
      const spec = { ...BASE, fieldResult: undefined, comment: undefined };
      const original = await notedDocx('footnote', { ...spec, link: { ...spec.link!, id: 'rIdOriginalOnly4' } });
      const revised = await notedDocx('footnote', { ...spec, word: 'payment' });
      const compared = (await compareDocuments(original, revised, { author: AUTHOR, date: DATE })).document;
      const entry = await expectInPlaceEdit(compared, 'footnote', ['notice', ' for the notice terms'], ['payment', ' for the payment terms']);
      expect(entry.getElementsByTagNameNS(W, 'hyperlink')).toHaveLength(1);
      const { notesXml, relsXml } = await notePart(compared, 'footnote');
      expect(hyperlinkTargets(notesXml, relsXml)).toEqual(['https://example.com/filing']);
      await expectProjections('footnote', original, revised, compared);
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.3.4' })(
    'imports the original relationship of a hyperlink the revised note removes',
    async () => {
      const original = await notedDocx('footnote', {
        ...BASE, fieldResult: undefined, comment: undefined,
        link: { text: 'the archived filing', id: 'rIdArchive7', target: 'https://example.com/archive' },
      });
      const revised = await notedDocx('footnote', { ...BASE, fieldResult: undefined, comment: undefined, link: undefined });
      const compared = (await compareDocuments(original, revised, { author: AUTHOR, date: DATE })).document;
      const { notesXml, relsXml } = await notePart(compared, 'footnote');
      const entries = userEntries(notesXml, 'footnote');
      expect(entries).toHaveLength(1);
      expect(textOf(entries[0]!, ['delText'])).toContain('the archived filing');
      expect(hyperlinkTargets(notesXml, relsXml)).toEqual(['https://example.com/archive']);
      await expectProjections('footnote', original, revised, compared);
      await expectSchemaValid(compared, 'footnote');
    },
  );

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.4' })(
    'keeps both comments when the note and its comment text both change',
    async () => {
      const spec = { ...BASE, fieldResult: undefined, link: undefined };
      const original = await notedDocx('footnote', spec);
      const revised = await notedDocx('footnote', { ...spec, word: 'payment', comment: 'Updated reviewer note.' });
      const compared = (await compareDocuments(original, revised, { author: AUTHOR, date: DATE })).document;
      const { notesXml, archive } = await notePart(compared, 'footnote');
      const entries = userEntries(notesXml, 'footnote');
      expect(entries).toHaveLength(1);
      expect(textOf(entries[0]!, ['delText'])).toContain('notice');
      const commentsXml = (await archive.getFile('word/comments.xml'))!;
      const comments = new Map(Array.from(parseXml(commentsXml).getElementsByTagNameNS(W, 'comment'))
        .map(comment => [comment.getAttributeNS(W, 'id')!, textOf(comment, ['t'])]));
      const anchored = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'commentReference'))
        .map(reference => comments.get(reference.getAttributeNS(W, 'id')!) ?? '<unbound>');
      expect(anchored(acceptAllChanges(notesXml))).toEqual(['Updated reviewer note.']);
      expect(anchored(rejectAllChanges(notesXml))).toEqual(['Confirm the cross-reference.']);
      await expectProjections('footnote', original, revised, compared);
      await expectSchemaValid(compared, 'footnote');
    },
  );
});

function hasOdfNoteAncestor(element: Element, T: string): boolean {
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === T && (node as Element).localName === 'note') return true;
  }
  return false;
}

// Explicit opt-in, as in noteLifecycleBodyMarks.test.ts: a requested reader
// run must fail, never silently skip an unusable installed LibreOffice.
const reader = process.env.SAFE_DOCX_NOTE_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice binds a note compared in place on both projections', () => {
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(
    'accepts and rejects notes holding fields, hyperlinks and comments with each anchor on its own body',
    async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      const X = 'http://www.w3.org/1999/xlink';
      const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
        .filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName) && !hasOdfNoteAncestor(n, T))
        .map(n => n.textContent);
      const notes = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(T, 'note')).map(n => {
        const body = n.getElementsByTagNameNS(T, 'note-body')[0]!;
        return {
          kind: n.getAttributeNS(T, 'note-class'),
          body: body.textContent,
          links: Array.from(body.getElementsByTagNameNS(T, 'a')).map(a => a.getAttributeNS(X, 'href')),
        };
      });
      const pairs: Array<[Buffer, Buffer]> = [];
      for (const kind of ['footnote', 'endnote'] as const) {
        pairs.push(
          [await notedDocx(kind, BASE), await notedDocx(kind, { ...BASE, word: 'payment' }, 'Notice terms appear in Section 4.2 today.')],
          [await notedDocx(kind, { ...BASE, comment: undefined }), await notedDocx(kind, { ...BASE, comment: undefined, fieldResult: 'Section 4.3' })],
          [await notedDocx(kind, { ...BASE, comment: undefined }), await notedDocx(kind, { ...BASE, comment: undefined, link: { ...BASE.link!, text: 'the official filing' } })],
          [await notedDocx(kind, { ...BASE, comment: undefined }), await notedDocx(kind, { ...BASE, comment: undefined, link: undefined })],
        );
      }
      const jobs = [];
      for (const [original, revised] of pairs) {
        const compared = (await compareDocuments(original, revised, { author: AUTHOR, date: DATE })).document;
        jobs.push(
          { op: 'identity' as const, docx: original, saveAs: 'odt' as const },
          { op: 'identity' as const, docx: revised, saveAs: 'odt' as const },
          { op: 'accept' as const, docx: compared, saveAs: 'odt' as const },
          { op: 'reject' as const, docx: compared, saveAs: 'odt' as const },
        );
      }
      const states = await runLibreOfficeOracle(jobs);
      for (let i = 0; i < pairs.length; i++) {
        const [originalState, revisedState, accepted, rejected] = states.slice(i * 4, i * 4 + 4) as [string, string, string, string];
        expect(notes(originalState)).toHaveLength(1);
        expect(notes(accepted), `pair ${i} accept`).toEqual(notes(revisedState));
        expect(notes(rejected), `pair ${i} reject`).toEqual(notes(originalState));
        expect(project(accepted)).toEqual(project(revisedState));
        expect(project(rejected)).toEqual(project(originalState));
      }
    },
    240_000,
  );
});
