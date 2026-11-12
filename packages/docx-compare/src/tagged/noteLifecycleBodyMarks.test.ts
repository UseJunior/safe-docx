import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLSerializer } from '@xmldom/xmldom';
import { buildSyntheticDocx, DocxArchive, DocxDocument, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments, extractTextWithParagraphs } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Note lifecycle body marks' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SCHEMA_GATE = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const AUTHOR = 'Note lifecycle';
const DATE = new Date('2025-01-01T00:00:00Z');
type NoteKind = 'footnote' | 'endnote';
const serialize = (node: Node): string => new XMLSerializer().serializeToString(node);
const sectionFor = (kind: NoteKind): string => (kind === 'footnote' ? '17.11.14' : '17.11.7');

const BODY = ['The parties agree to the terms below.', 'Closing occurs on the agreed date.'];
const NOTE_PARAGRAPHS: Record<'single' | 'multi', string[]> = {
  single: ['Subject to Schedule 2.'],
  multi: ['Subject to Schedule 2.', 'Schedule 2 lists the excluded assets.'],
};

/**
 * Replace the synthetic fixture's single-run note with Word-shaped paragraphs:
 * the first carries the note's own reference mark (`w:footnoteRef` /
 * `w:endnoteRef`), every paragraph carries the note text style.
 */
async function withNoteParagraphs(docx: Buffer, kind: NoteKind, paragraphs: string[]): Promise<Buffer> {
  const archive = await DocxArchive.load(docx);
  const part = `word/${kind}s.xml`;
  const notes = parseXml((await archive.getFile(part))!);
  const entry = Array.from(notes.getElementsByTagNameNS(W, kind)).find(n => n.getAttributeNS(W, 'id') === '1')!;
  while (entry.firstChild) entry.removeChild(entry.firstChild);
  const style = kind === 'footnote' ? 'Footnote' : 'Endnote';
  const markup = paragraphs.map((text, index) =>
    `<w:p xmlns:w="${W}"><w:pPr><w:pStyle w:val="${style}Text"/></w:pPr>` +
    (index === 0 ? `<w:r><w:rPr><w:rStyle w:val="${style}Reference"/></w:rPr><w:${kind}Ref/></w:r>` : '') +
    `<w:r><w:t xml:space="preserve">${index === 0 ? ' ' : ''}${text}</w:t></w:r></w:p>`);
  for (const xml of markup) entry.appendChild(notes.importNode(parseXml(xml).documentElement, true));
  archive.setFile(part, serialize(notes));
  return archive.save();
}

async function notedDocx(kind: NoteKind, size: 'single' | 'multi', paragraphs = BODY): Promise<Buffer> {
  return withNoteParagraphs(
    await buildSyntheticDocx({ paragraphs, [`${kind}OnParagraph`]: 0, [`${kind}Text`]: 'placeholder' }),
    kind,
    NOTE_PARAGRAPHS[size],
  );
}

function userEntries(notesXml: string, kind: NoteKind): Element[] {
  return Array.from(parseXml(notesXml).getElementsByTagNameNS(W, kind))
    .filter(entry => !['separator', 'continuationSeparator', 'continuationNotice'].includes(entry.getAttributeNS(W, 'type') ?? ''));
}

function hasAncestor(element: Element, stop: Element, localName: string): boolean {
  for (let node = element.parentNode; node && node !== stop; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName) return true;
  }
  return false;
}

/**
 * Every run sits inside the marker wrapper; paragraph marks carry no
 * revision, since the note story resolves with its anchor and LibreOffice
 * joins body paragraphs when a styled note paragraph mark is tracked.
 */
function expectEntryMarked(entry: Element, marker: 'ins' | 'del'): void {
  const paragraphs = Array.from(entry.getElementsByTagNameNS(W, 'p'));
  expect(paragraphs.length).toBeGreaterThan(0);
  for (const paragraph of paragraphs) {
    const markRunProperties = Array.from(paragraph.getElementsByTagNameNS(W, 'rPr'))
      .find(rPr => (rPr.parentNode as Element).localName === 'pPr');
    expect(['ins', 'del'].map(name => markRunProperties?.getElementsByTagNameNS(W, name).length ?? 0), 'paragraph mark').toEqual([0, 0]);
  }
  const runs = Array.from(entry.getElementsByTagNameNS(W, 'r'));
  expect(runs.length).toBeGreaterThan(0);
  for (const run of runs) expect(hasAncestor(run, entry, marker), `run inside w:${marker}`).toBe(true);
  if (marker === 'del') expect(entry.getElementsByTagNameNS(W, 't')).toHaveLength(0);
}

/** Anchor order to bound definition text (all text of each referenced definition). */
function noteBindings(kind: NoteKind, documentXml: string, notesXml: string | null): string[] {
  const bodies = new Map(notesXml === null ? [] : userEntries(notesXml, kind)
    .map(n => [String(BigInt(n.getAttributeNS(W, 'id')!)), n.textContent ?? '']));
  return Array.from(parseXml(documentXml).getElementsByTagNameNS(W, `${kind}Reference`))
    .map(r => bodies.get(String(BigInt(r.getAttributeNS(W, 'id')!))) ?? '<unbound>');
}

/** Text left in definitions no anchor references after a projection. */
function orphanNoteText(kind: NoteKind, documentXml: string, notesXml: string | null): string {
  if (notesXml === null) return '';
  const live = new Set(Array.from(parseXml(documentXml).getElementsByTagNameNS(W, `${kind}Reference`))
    .map(r => String(BigInt(r.getAttributeNS(W, 'id')!))));
  return userEntries(notesXml, kind)
    .filter(n => !live.has(String(BigInt(n.getAttributeNS(W, 'id')!))))
    .map(n => Array.from(n.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''))
    .join('');
}

async function packageState(kind: NoteKind, docx: Buffer) {
  const archive = await DocxArchive.load(docx);
  const documentXml = await archive.getDocumentXml();
  const notesXml = await archive.getFile(`word/${kind}s.xml`);
  return { bindings: noteBindings(kind, documentXml, notesXml), orphanText: orphanNoteText(kind, documentXml, notesXml) };
}

async function nativeProjection(docx: Buffer, operation: 'acceptChanges' | 'rejectChanges'): Promise<Buffer> {
  const complete = await DocxDocument.load(docx);
  await complete[operation]();
  return (await complete.toBuffer()).buffer;
}

/**
 * Accept All binds every anchor to the revised body and Reject All to the
 * original body, through the comparison acceptor and docx-core, and no
 * superseded note text survives in an unreferenced definition.
 */
async function expectProjectionsBind(kind: NoteKind, original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const expected = {
    accept: (await packageState(kind, revised)).bindings,
    reject: (await packageState(kind, original)).bindings,
  };
  const archive = await DocxArchive.load(compared);
  const documentXml = await archive.getDocumentXml();
  const notesXml = await archive.getFile(`word/${kind}s.xml`);
  for (const [operation, project] of [['accept', acceptAllChanges], ['reject', rejectAllChanges]] as const) {
    const projectedDocument = project(documentXml);
    const projectedNotes = notesXml === null ? null : project(notesXml);
    expect(noteBindings(kind, projectedDocument, projectedNotes), `AST ${operation}`).toEqual(expected[operation]);
    expect(orphanNoteText(kind, projectedDocument, projectedNotes), `AST ${operation} orphan text`).toBe('');
  }
  for (const [operation, native] of [['accept', 'acceptChanges'], ['reject', 'rejectChanges']] as const) {
    const state = await packageState(kind, await nativeProjection(compared, native));
    expect(state.bindings, `docx-core ${operation}`).toEqual(expected[operation]);
    expect(state.orphanText, `docx-core ${operation} orphan text`).toBe('');
  }
}

/** Tracked, native Accept and native Reject main and note parts validate against the vendored schema. */
async function expectSchemaValid(compared: Buffer, kinds: readonly NoteKind[]): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-1388-notes-'));
  try {
    let instances = 0;
    for (const [name, docx] of [
      ['tracked', compared],
      ['accepted', await nativeProjection(compared, 'acceptChanges')],
      ['rejected', await nativeProjection(compared, 'rejectChanges')],
    ] as const) {
      const archive = await DocxArchive.load(docx);
      writeFileSync(join(dir, `${name}-document.xml`), await archive.getDocumentXml()); instances++;
      for (const kind of kinds) {
        const notes = await archive.getFile(`word/${kind}s.xml`);
        if (notes === null) continue;
        writeFileSync(join(dir, `${name}-${kind}s.xml`), notes); instances++;
      }
    }
    const gate = spawnSync(process.execPath, [SCHEMA_GATE, dir], { encoding: 'utf8' });
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    expect(gate.stdout).toContain(`${instances} of ${instances} document.xml instances validate`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Revision IDs stay unique across the main story and both note parts. */
async function expectUniqueRevisionIds(compared: Buffer): Promise<void> {
  const archive = await DocxArchive.load(compared);
  const ids: string[] = [];
  for (const xml of [await archive.getDocumentXml(), await archive.getFile('word/footnotes.xml'), await archive.getFile('word/endnotes.xml')]) {
    if (xml === null) continue;
    for (const element of Array.from(parseXml(xml).getElementsByTagName('*'))) {
      if (element.namespaceURI === W && ['ins', 'del'].includes(element.localName)) ids.push(element.getAttributeNS(W, 'id')!);
    }
  }
  expect(new Set(ids).size).toBe(ids.length);
}

/**
 * Original: footnote A on paragraph 1, unchanged footnote B on paragraph 2.
 * Revised: footnote A removed, a new two-paragraph footnote C added to
 * paragraph 2 after B, endnote D added, and paragraph 1's wording edited.
 */
async function mixedNoteDocx(revised: boolean): Promise<Buffer> {
  const paragraphs = revised
    ? ['The parties agree to every term below.', 'Closing occurs on the agreed date.']
    : BODY;
  const archive = await DocxArchive.load(await buildSyntheticDocx({ paragraphs, footnoteOnParagraph: 1, footnoteText: 'Unchanged note B.', ...(revised ? { endnoteOnParagraph: 0, endnoteText: 'Added endnote D.' } : {}) }));
  const document = parseXml(await archive.getDocumentXml());
  const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
  const bodyParagraphs = Array.from(document.getElementsByTagNameNS(W, 'p'));
  const referenceRun = Array.from(document.getElementsByTagNameNS(W, 'footnoteReference'))[0]!.parentNode as Element;
  const addNote = (id: string, paragraph: Element, texts: string[]): void => {
    const run = referenceRun.cloneNode(true) as Element;
    run.getElementsByTagNameNS(W, 'footnoteReference')[0]!.setAttributeNS(W, 'w:id', id);
    paragraph.appendChild(run);
    const definition = notes.importNode(parseXml(
      `<w:footnote xmlns:w="${W}" w:id="${id}">${texts.map(t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')}</w:footnote>`,
    ).documentElement, true);
    // Keep definitions in anchor order: LibreOffice binds notes by position.
    const later = paragraph === bodyParagraphs[0]
      ? Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1') ?? null
      : null;
    notes.documentElement.insertBefore(definition, later);
  };
  if (revised) addNote('2', bodyParagraphs[1]!, ['Added note C.', 'Second paragraph of C.']);
  else addNote('2', bodyParagraphs[0]!, ['Removed note A.']);
  archive.setDocumentXml(serialize(document));
  archive.setFile('word/footnotes.xml', serialize(notes));
  return archive.save();
}

describe('added and removed note bodies carry tracked lifecycle marks', () => {
  for (const kind of ['footnote', 'endnote'] as const) {
    for (const size of ['single', 'multi'] as const) {
      for (const lifecycle of ['added', 'removed'] as const) {
        test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: sectionFor(kind) })(
          `marks the body of a ${size}-paragraph ${lifecycle} ${kind}`,
          async () => {
            const plain = await buildSyntheticDocx({ paragraphs: BODY });
            const noted = await notedDocx(kind, size);
            const [original, revised] = lifecycle === 'added' ? [plain, noted] : [noted, plain];
            const result = await compareDocuments(original, revised, { author: AUTHOR, date: DATE });
            const archive = await DocxArchive.load(result.document);
            const entries = userEntries((await archive.getFile(`word/${kind}s.xml`))!, kind);
            expect(entries).toHaveLength(1);
            expectEntryMarked(entries[0]!, lifecycle === 'added' ? 'ins' : 'del');
            expect(entries[0]!.getElementsByTagNameNS(W, lifecycle === 'added' ? 'del' : 'ins')).toHaveLength(0);
            for (const marker of Array.from(entries[0]!.getElementsByTagNameNS(W, lifecycle === 'added' ? 'ins' : 'del'))) {
              expect(marker.getAttributeNS(W, 'author')).toBe(AUTHOR);
            }
            await expectProjectionsBind(kind, original, revised, result.document);
            await expectSchemaValid(result.document, [kind]);
            await expectUniqueRevisionIds(result.document);
          },
        );
      }
    }
  }

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(
    'marks a replaced note per side and leaves an unchanged note and an ordinary body edit alone',
    async () => {
      const original = await mixedNoteDocx(false);
      const revised = await mixedNoteDocx(true);
      const result = await compareDocuments(original, revised, { author: AUTHOR, date: DATE });
      const archive = await DocxArchive.load(result.document);
      const footnotes = userEntries((await archive.getFile('word/footnotes.xml'))!, 'footnote');
      const byText = (text: string): Element => footnotes.find(n => (n.textContent ?? '').includes(text))!;
      const unchanged = byText('Unchanged note B.');
      expect(unchanged.getElementsByTagNameNS(W, 'ins')).toHaveLength(0);
      expect(unchanged.getElementsByTagNameNS(W, 'del')).toHaveLength(0);
      expectEntryMarked(byText('Removed note A.'), 'del');
      // LibreOffice binds note bodies in ascending identifier order, so the
      // anchors' identifiers ascend in document order (A, B, C).
      expect(footnotes.map(n => (n.textContent ?? '').slice(0, 9))).toEqual(['Removed n', 'Unchanged', 'Added not']);
      const anchorIds = Array.from(parseXml(await archive.getDocumentXml()).getElementsByTagNameNS(W, 'footnoteReference')).map(r => Number(r.getAttributeNS(W, 'id')));
      expect(anchorIds).toEqual([...anchorIds].sort((a, b) => a - b));
      expect(footnotes.map(n => Number(n.getAttributeNS(W, 'id')))).toEqual(anchorIds);
      expectEntryMarked(byText('Added note C.'), 'ins');
      expectEntryMarked(userEntries((await archive.getFile('word/endnotes.xml'))!, 'endnote')[0]!, 'ins');
      expect(extractTextWithParagraphs(acceptAllChanges(await archive.getDocumentXml()))).toContain('agree to every term below');
      expect(extractTextWithParagraphs(rejectAllChanges(await archive.getDocumentXml()))).toContain('agree to the terms below');
      for (const kind of ['footnote', 'endnote'] as const) await expectProjectionsBind(kind, original, revised, result.document);
      await expectSchemaValid(result.document, ['footnote', 'endnote']);
      await expectUniqueRevisionIds(result.document);
    },
  );

  for (const lifecycle of ['added', 'removed', 'unanchored'] as const) {
    // 'unanchored': the revised package keeps the definition but drops its
    // anchor, as when a paragraph holding a note is deleted.
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(
      `marks a ${lifecycle} footnote whose body holds a cross-reference field`,
      async () => {
        const field = (kind: 'instrText' | 't', text: string): string => `<w:r><w:${kind} xml:space="preserve">${text}</w:${kind}></w:r>`;
        const noted = await withNoteParagraphs(
          await buildSyntheticDocx({ paragraphs: BODY, footnoteOnParagraph: 0, footnoteText: 'placeholder' }), 'footnote', ['See Section'],
        );
        const archive = await DocxArchive.load(noted);
        const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
        const paragraph = Array.from(notes.getElementsByTagNameNS(W, 'p')).at(-1)!;
        for (const xml of [
          `<w:r xmlns:w="${W}"><w:fldChar w:fldCharType="begin"/></w:r>`,
          field('instrText', ' REF _Ref1 \\h ').replace('<w:r>', `<w:r xmlns:w="${W}">`),
          `<w:r xmlns:w="${W}"><w:fldChar w:fldCharType="separate"/></w:r>`,
          field('t', '2.1').replace('<w:r>', `<w:r xmlns:w="${W}">`),
          `<w:r xmlns:w="${W}"><w:fldChar w:fldCharType="end"/></w:r>`,
        ]) paragraph.appendChild(notes.importNode(parseXml(xml).documentElement, true));
        archive.setFile('word/footnotes.xml', serialize(notes));
        const withField = await archive.save();
        let plain = await buildSyntheticDocx({ paragraphs: BODY });
        if (lifecycle === 'unanchored') {
          const unanchored = await DocxArchive.load(withField);
          const main = parseXml(await unanchored.getDocumentXml());
          const reference = main.getElementsByTagNameNS(W, 'footnoteReference')[0]!.parentNode as Element;
          reference.parentNode!.removeChild(reference);
          unanchored.setDocumentXml(serialize(main));
          plain = await unanchored.save();
        }
        const [original, revised] = lifecycle === 'added' ? [plain, withField] : [withField, plain];
        const result = await compareDocuments(original, revised, { author: AUTHOR, date: DATE });
        const entry = userEntries((await (await DocxArchive.load(result.document)).getFile('word/footnotes.xml'))!, 'footnote')[0]!;
        expectEntryMarked(entry, lifecycle === 'added' ? 'ins' : 'del');
        expect(entry.getElementsByTagNameNS(W, lifecycle === 'added' ? 'instrText' : 'delInstrText')).toHaveLength(1);
        expect(result.ancillaryFieldEvidence).toMatchObject({ status: 'passed' });
        await expectProjectionsBind('footnote', original, revised, result.document);
        await expectSchemaValid(result.document, ['footnote']);
      },
    );
  }

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(
    'leaves the body of a footnote the revised source already tracks as inserted',
    async () => {
      const plain = await buildSyntheticDocx({ paragraphs: BODY });
      const archive = await DocxArchive.load(await notedDocx('footnote', 'single'));
      const document = parseXml(await archive.getDocumentXml());
      const referenceRun = document.getElementsByTagNameNS(W, 'footnoteReference')[0]!.parentNode as Element;
      const wrapper = document.createElementNS(W, 'w:ins');
      for (const [name, value] of [['w:id', '901'], ['w:author', 'Earlier author'], ['w:date', '2024-06-01T00:00:00Z']]) wrapper.setAttributeNS(W, name!, value!);
      referenceRun.parentNode!.replaceChild(wrapper, referenceRun);
      wrapper.appendChild(referenceRun);
      archive.setDocumentXml(serialize(document));
      const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
      const textRun = Array.from(notes.getElementsByTagNameNS(W, 't')).at(-1)!.parentNode as Element;
      const bodyWrapper = notes.createElementNS(W, 'w:ins');
      for (const [name, value] of [['w:id', '902'], ['w:author', 'Earlier author'], ['w:date', '2024-06-01T00:00:00Z']]) bodyWrapper.setAttributeNS(W, name!, value!);
      textRun.parentNode!.replaceChild(bodyWrapper, textRun);
      bodyWrapper.appendChild(textRun);
      archive.setFile('word/footnotes.xml', serialize(notes));
      const revised = await archive.save();
      const result = await compareDocuments(plain, revised, { author: AUTHOR, date: DATE });
      const compared = await DocxArchive.load(result.document);
      expect(await compared.getFile('word/footnotes.xml')).toBe(await (await DocxArchive.load(revised)).getFile('word/footnotes.xml'));
    },
  );

  for (const [lifecycle, operation] of [['added', 'rejectChanges'], ['removed', 'acceptChanges']] as const) {
    test(`characterizes the definition docx-core leaves when the anchor of a ${lifecycle} note is resolved away`, async () => {
      const plain = await buildSyntheticDocx({ paragraphs: BODY });
      const resolvedEntries: Record<NoteKind, Element[]> = { footnote: [], endnote: [] };
      for (const kind of ['footnote', 'endnote'] as const) {
        const noted = await notedDocx(kind, 'multi');
        const [original, revised] = lifecycle === 'added' ? [plain, noted] : [noted, plain];
        const compared = (await compareDocuments(original, revised, { author: AUTHOR, date: DATE })).document;
        const notesXml = (await (await DocxArchive.load(await nativeProjection(compared, operation))).getFile(`word/${kind}s.xml`))!;
        resolvedEntries[kind] = userEntries(notesXml, kind);
      }
      // docx-core prunes an unreferenced footnote; an unreferenced endnote
      // keeps an empty, textless shell until endnote pruning lands in
      // docx-core's document.ts. The marks guarantee no note text survives.
      expect(resolvedEntries.footnote).toEqual([]);
      expect(resolvedEntries.endnote.map(entry => entry.getAttributeNS(W, 'id'))).toEqual(['1']);
      expect(resolvedEntries.endnote[0]!.getElementsByTagNameNS(W, 'p')).toHaveLength(NOTE_PARAGRAPHS.multi.length);
      expect(resolvedEntries.endnote[0]!.getElementsByTagNameNS(W, 'r')).toHaveLength(0);
    });
  }
});

// Explicit opt-in, as in noteReferenceIdentity.test.ts: a requested reader run
// must fail, never silently skip an unusable installed LibreOffice.
const reader = process.env.SAFE_DOCX_NOTE_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice binds added and removed note bodies on both projections', () => {
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(
    'accepts and rejects added and removed footnotes and endnotes with each anchor on its own body',
    async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
        .filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName) && !hasOdfNoteAncestor(n, T))
        .map(n => n.textContent);
      const notes = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(T, 'note'))
        .map(n => ({ kind: n.getAttributeNS(T, 'note-class'), body: n.getElementsByTagNameNS(T, 'note-body')[0]!.textContent }));
      const pairs: Array<[Buffer, Buffer]> = [];
      for (const kind of ['footnote', 'endnote'] as const) {
        for (const size of ['single', 'multi'] as const) {
          const plain = await buildSyntheticDocx({ paragraphs: BODY });
          const noted = await notedDocx(kind, size);
          pairs.push([plain, noted], [noted, plain]);
        }
      }
      pairs.push([await mixedNoteDocx(false), await mixedNoteDocx(true)]);
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
        if (i < pairs.length - 1) expect(notes(originalState).length + notes(revisedState).length).toBe(1);
        expect(notes(accepted), `pair ${i} accept`).toEqual(notes(revisedState));
        expect(notes(rejected), `pair ${i} reject`).toEqual(notes(originalState));
        expect(project(accepted)).toEqual(project(revisedState));
        expect(project(rejected)).toEqual(project(originalState));
      }
    },
    240_000,
  );
});

function hasOdfNoteAncestor(element: Element, T: string): boolean {
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === T && (node as Element).localName === 'note') return true;
  }
  return false;
}
