import { describe, expect } from 'vitest';
import { DocxArchive, parseXml, buildSyntheticDocx } from '@usejunior/docx-core';
import { XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments, acceptAllChanges, rejectAllChanges, extractTextWithParagraphs } from '../index.js';
import { separateRepeatedNoteReferences } from './noteReferenceIdentity.js';
import { runLibreOfficeOracle } from '../../../docx-core/dist/integration/libreoffice-oracle.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Note reference identity' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const moving = 'the complete paragraph with an attached explanatory note moves here';
const stable = 'a long stable paragraph that remains in the same relative position';
const final = 'the final stable anchor paragraph is unchanged throughout';
const serialize = (node: Node) => new XMLSerializer().serializeToString(node);

async function repeatedNotes() {
  const archive = await DocxArchive.load(await buildSyntheticDocx({ paragraphs: [stable, moving], footnoteOnParagraph: 1, footnoteText: 'original note' }));
  const document = parseXml(await archive.getDocumentXml());
  const paragraph = document.getElementsByTagNameNS(W, 'p')[1]!;
  paragraph.parentNode!.insertBefore(paragraph.cloneNode(true), paragraph);
  return { archive, document, xml: serialize(document) };
}

describe('copied note identity safety', () => {
  test('does not copy optional paragraph editing identities into the second note', async () => {
    const { archive, xml } = await repeatedNotes();
    const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
    const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
    const ns = 'http://schemas.microsoft.com/office/word/2010/wordml';
    note.getElementsByTagNameNS(W, 'p')[0]!.setAttributeNS(ns, 'w14:paraId', '12345678');
    archive.setFile('word/footnotes.xml', serialize(notes));
    await separateRepeatedNoteReferences(archive, xml);
    const paragraphs = Array.from(parseXml((await archive.getFile('word/footnotes.xml'))!).getElementsByTagNameNS(W, 'p'));
    expect(paragraphs.filter(p => p.getAttributeNS(ns, 'paraId') === '12345678')).toHaveLength(1);
  });
  test('records source IDs and preserves reserved and unreferenced definitions', async () => {
    const { archive, xml } = await repeatedNotes();
    const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
    const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
    const unused = note.cloneNode(true) as Element;
    unused.setAttributeNS(W, 'w:id', '9');
    notes.documentElement.appendChild(unused);
    archive.setFile('word/footnotes.xml', serialize(notes));
    const mapping = new Map<'footnote' | 'endnote', Map<string, string>>();
    const result = await separateRepeatedNoteReferences(archive, xml, mapping);
    expect(Array.from(parseXml(result).getElementsByTagNameNS(W, 'footnoteReference')).map(n => n.getAttributeNS(W, 'id'))).toEqual(['1', '2']);
    expect([...mapping.get('footnote')!]).toEqual([['1', '1'], ['2', '1'], ['3', '9']]);
    const output = parseXml((await archive.getFile('word/footnotes.xml'))!);
    expect(Array.from(output.getElementsByTagNameNS(W, 'footnote')).map(n => n.getAttributeNS(W, 'id'))).toEqual(['-1', '0', '1', '2', '3']);
  });

  for (const annotation of ['bookmarkStart', 'commentReference', 'ins', 'fldChar']) {
    test(`fails closed instead of duplicating ${annotation}`, async () => {
      const { archive, xml } = await repeatedNotes();
      const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
      const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
      note.appendChild(notes.createElementNS(W, `w:${annotation}`));
      const before = serialize(notes);
      archive.setFile('word/footnotes.xml', before);
      await expect(separateRepeatedNoteReferences(archive, xml)).rejects.toThrow('unsupported annotations or structure');
      expect(await archive.getFile('word/footnotes.xml')).toBe(before);
    });
  }

  test('rejects dangling references and duplicate definition IDs', async () => {
    const { archive, document, xml } = await repeatedNotes();
    for (const ref of Array.from(document.getElementsByTagNameNS(W, 'footnoteReference'))) ref.setAttributeNS(W, 'w:id', '99');
    await expect(separateRepeatedNoteReferences(archive, serialize(document))).rejects.toThrow('invalid referenced definition');
    const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
    notes.documentElement.appendChild(notes.getElementsByTagNameNS(W, 'footnote')[0]!.cloneNode(true));
    archive.setFile('word/footnotes.xml', serialize(notes));
    await expect(separateRepeatedNoteReferences(archive, xml)).rejects.toThrow('duplicate definition IDs');
  });

  test('refuses to invalidate references in another story', async () => {
    const { archive, xml } = await repeatedNotes();
    archive.setFile('word/header1.xml', xml);
    await expect(separateRepeatedNoteReferences(archive, xml)).rejects.toThrow('reference outside the main story');
  });

  test('leaves corresponding inline references and unique references untouched', async () => {
    const archive = await DocxArchive.load(await buildSyntheticDocx({ paragraphs: [moving], footnoteOnParagraph: 0 }));
    const xml = await archive.getDocumentXml();
    expect(await separateRepeatedNoteReferences(archive, xml)).toBe(xml);
    const document = parseXml(xml);
    const ref = document.getElementsByTagNameNS(W, 'footnoteReference')[0]!;
    ref.parentNode!.appendChild(ref.cloneNode(true));
    const inline = serialize(document);
    expect(await separateRepeatedNoteReferences(archive, inline)).toBe(inline);
  });
});

describe('note-bearing paragraph reorders', () => {
  for (const kind of ['footnote', 'endnote'] as const) {
    test(`preserves distinct ${kind} bindings through both projections`, async () => {
      const original = await buildSyntheticDocx({ paragraphs: [stable, moving, final], [`${kind}OnParagraph`]: 1, [`${kind}Text`]: 'the original explanatory note' });
      const revised = await buildSyntheticDocx({ paragraphs: [stable, final, moving], [`${kind}OnParagraph`]: 2, [`${kind}Text`]: 'the original explanatory note' });
      const result = await compareDocuments(original, revised, { detectMoves: true });
      const archive = await DocxArchive.load(result.document);
      const xml = await archive.getDocumentXml();
      const document = parseXml(xml);
      const references = Array.from(document.getElementsByTagNameNS(W, `${kind}Reference`));
      expect(references).toHaveLength(2);
      const ids = references.map(ref => ref.getAttributeNS(W, 'id'));
      expect(new Set(ids).size).toBe(2);
      // A note-bearing paragraph must use the proven paragraph deletion/insertion path.
      for (const direction of ['moveFrom', 'moveTo']) {
        expect(Array.from(document.getElementsByTagNameNS(W, direction))
          .some(move => move.getElementsByTagNameNS(W, `${kind}Reference`).length > 0)).toBe(false);
      }
      const definitions = parseXml((await archive.getFile(`word/${kind}s.xml`))!);
      for (const id of ids) {
        const note = Array.from(definitions.getElementsByTagNameNS(W, kind)).find(n => n.getAttributeNS(W, 'id') === id);
        expect(note?.textContent).toContain('the original explanatory note');
      }
      for (const [project, expected] of [[acceptAllChanges, revised], [rejectAllChanges, original]] as const) {
        const projected = project(xml);
        expect(parseXml(projected).getElementsByTagNameNS(W, `${kind}Reference`)).toHaveLength(1);
        expect(extractTextWithParagraphs(projected)).toBe(extractTextWithParagraphs(await (await DocxArchive.load(expected)).getDocumentXml()));
      }
    });
  }
});

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable installed LibreOffice. Full packages preserve the note sidecars.
const reader = process.env.SAFE_DOCX_NOTE_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice note-bearing paragraph projections', () => {
  for (const kind of ['footnote', 'endnote'] as const) {
    test(`accepts and rejects a moved ${kind} without text or paragraph drift`, async () => {
      // Keep the destination away from the document-final boundary. The
      // separate #891/#973 terminal-empty-paragraph limitation is not fixed here.
      const tail = 'the unchanged document ending remains after every edit';
      const original = await buildSyntheticDocx({ paragraphs: [stable, moving, final, tail], [`${kind}OnParagraph`]: 1, [`${kind}Text`]: 'the explanatory note' });
      const revised = await buildSyntheticDocx({ paragraphs: [stable, final, moving, tail], [`${kind}OnParagraph`]: 2, [`${kind}Text`]: 'the explanatory note' });
      const compared = await compareDocuments(original, revised, { detectMoves: true });
      const results = await runLibreOfficeOracle([
        { op: 'identity', docx: original, saveAs: 'odt' },
        { op: 'identity', docx: revised, saveAs: 'odt' },
        { op: 'accept', docx: compared.document, saveAs: 'odt' },
        { op: 'reject', docx: compared.document, saveAs: 'odt' },
      ]);
      const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
        .filter(n => n.namespaceURI === 'urn:oasis:names:tc:opendocument:xmlns:text:1.0' && ['p', 'h'].includes(n.localName))
        .map(n => n.textContent);
      expect(project(results[2]!)).toEqual(project(results[1]!));
      expect(project(results[3]!)).toEqual(project(results[0]!));
    }, 180_000);
  }
});
