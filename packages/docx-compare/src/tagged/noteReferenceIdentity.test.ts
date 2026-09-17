import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, parseXml, buildSyntheticDocx, buildDocxFromParts } from '@usejunior/docx-core';
import { XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments, acceptAllChanges, rejectAllChanges, extractTextWithParagraphs } from '../index.js';
import { canonicalizeNoteArchiveIds, separateRepeatedNoteReferences } from './noteReferenceIdentity.js';
import { AncillaryStorySafetyError } from './ancillaryFieldSafety.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Note reference identity' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const moving = 'the complete paragraph with an attached explanatory note moves here';
const stable = 'a long stable paragraph that remains in the same relative position';
const final = 'the final stable anchor paragraph is unchanged throughout';
const serialize = (node: Node) => new XMLSerializer().serializeToString(node);
async function expectUnsafe(promise: Promise<unknown>, detail: string) {
  await expect(promise).rejects.toMatchObject({
    name: 'AncillaryStorySafetyError',
    issues: [expect.objectContaining({ code: 'NOTE_REFERENCE_IDENTITY_UNSAFE', detail: expect.stringContaining(detail) })],
  });
}

async function repeatedNotes() {
  const archive = await DocxArchive.load(await buildSyntheticDocx({ paragraphs: [stable, moving], footnoteOnParagraph: 1, footnoteText: 'original note' }));
  const document = parseXml(await archive.getDocumentXml());
  const paragraph = document.getElementsByTagNameNS(W, 'p')[1]!;
  paragraph.parentNode!.insertBefore(paragraph.cloneNode(true), paragraph);
  return { archive, document, xml: serialize(document) };
}

async function mixedNotes(kind: 'footnote' | 'endnote', revised: boolean) {
  const tail = 'an unchanged ending after the reordered paragraphs';
  const archive = await DocxArchive.load(await buildSyntheticDocx({
    paragraphs: revised ? ['Aligned body', stable, final, moving, tail] : ['Aligned body', stable, moving, final, tail],
    [`${kind}OnParagraph`]: 0, [`${kind}Text`]: revised ? 'After note text' : 'Before note text',
  }));
  const document = parseXml(await archive.getDocumentXml());
  const ref = document.getElementsByTagNameNS(W, `${kind}Reference`)[0]!.parentNode!.cloneNode(true) as Element;
  ref.getElementsByTagNameNS(W, `${kind}Reference`)[0]!.setAttributeNS(W, 'w:id', '2');
  document.getElementsByTagNameNS(W, 'p')[revised ? 3 : 2]!.appendChild(ref);
  archive.setDocumentXml(serialize(document));
  const notes = parseXml((await archive.getFile(`word/${kind}s.xml`))!);
  const copy = Array.from(notes.getElementsByTagNameNS(W, kind)).find(n => n.getAttributeNS(W, 'id') === '1')!.cloneNode(true) as Element;
  copy.setAttributeNS(W, 'w:id', '2');
  copy.getElementsByTagNameNS(W, 't')[0]!.textContent = 'shared moved note';
  notes.documentElement.appendChild(copy);
  archive.setFile(`word/${kind}s.xml`, serialize(notes));
  return archive.save();
}

async function inlineFootnoteAndMovedEndnote(revised: boolean, mixed: boolean, lexical: boolean, edited = true) {
  const archive = await DocxArchive.load(await buildSyntheticDocx({
    paragraphs: mixed && revised ? ['Aligned body', stable, final, moving, 'Stable ending'] : ['Aligned body', stable, moving, final, 'Stable ending'],
    footnoteOnParagraph: 0, footnoteText: edited ? revised ? 'After note text' : 'Before note text' : 'Stable footnote text',
    ...(mixed ? { endnoteOnParagraph: revised ? 3 : 2, endnoteText: 'shared moved endnote' } : {}),
  }));
  if (lexical) {
    const document = parseXml(await archive.getDocumentXml());
    document.getElementsByTagNameNS(W, 'footnoteReference')[0]!.setAttributeNS(W, 'w:id', '01');
    archive.setDocumentXml(serialize(document));
    const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
    Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!.setAttributeNS(W, 'w:id', '+1');
    archive.setFile('word/footnotes.xml', serialize(notes));
  }
  return archive.save();
}

describe('inline footnote definitions remain bound to their source sides', () => {
  for (const difference of ['format', 'reference'] as const) {
    test(`characterizes separate side definitions when aligned anchor ${difference} changes`, async () => {
      const original = await inlineFootnoteAndMovedEndnote(false, false, false);
      const revised = await DocxArchive.load(await inlineFootnoteAndMovedEndnote(true, false, false));
      const document = parseXml(await revised.getDocumentXml());
      const ref = document.getElementsByTagNameNS(W, 'footnoteReference')[0]!;
      if (difference === 'reference') ref.setAttributeNS(W, 'w:customMarkFollows', '1');
      else (ref.parentNode as Element).getElementsByTagNameNS(W, 'rPr')[0]!.appendChild(document.createElementNS(W, 'w:b'));
      revised.setDocumentXml(serialize(document));
      const result = await compareDocuments(original, await revised.save());
      const archive = await DocxArchive.load(result.document);
      expect(parseXml(await archive.getDocumentXml()).getElementsByTagNameNS(W, 'footnoteReference').length).toBe(2);
      const notes = (await archive.getFile('word/footnotes.xml'))!;
      expect(parseXml(notes).getElementsByTagNameNS(W, 'footnote').length).toBe(4);
      expect(notes).not.toMatch(/<w:(ins|del)\b/);
      // Characterization of coarse history, not a claim of orphan-free
      // single-part projection: package resolution has the anchor inventory.
      for (const [project, expected] of [[acceptAllChanges, 'After note text'], [rejectAllChanges, 'Before note text']] as const) {
        const refs = parseXml(project(await archive.getDocumentXml())).getElementsByTagNameNS(W, 'footnoteReference');
        expect(refs.length).toBe(1);
        const projected = parseXml(project(notes));
        const entry = Array.from(projected.getElementsByTagNameNS(W, 'footnote')).find(e => e.getAttributeNS(W, 'id') === refs[0]!.getAttributeNS(W, 'id'));
        expect(entry!.textContent).toBe(expected);
      }
      for (const op of ['acceptChanges', 'rejectChanges'] as const) {
        const complete = await DocxDocument.load(result.document);
        await complete[op]();
        const resolved = await DocxArchive.load((await complete.toBuffer()).buffer);
        const resolvedNotes = (await resolved.getFile('word/footnotes.xml'))!;
        expect(parseXml(resolvedNotes).getElementsByTagNameNS(W, 'footnote').length).toBe(3);
        expect(resolvedNotes).not.toContain(op === 'acceptChanges' ? 'Before' : 'After');
      }
    });
  }
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })('keeps an aligned anchor stable while redlining its definition without superseded projection text', async () => {
    const result = await compareDocuments(await inlineFootnoteAndMovedEndnote(false, false, false), await inlineFootnoteAndMovedEndnote(true, false, false));
    const archive = await DocxArchive.load(result.document);
    const document = parseXml(await archive.getDocumentXml());
    expect(document.getElementsByTagNameNS(W, 'footnoteReference').length).toBe(1);
    const notes = (await archive.getFile('word/footnotes.xml'))!;
    expect(parseXml(notes).getElementsByTagNameNS(W, 'footnote').length).toBe(3);
    expect(notes).toContain('<w:del');
    expect(notes).toContain('<w:ins');
    expect(acceptAllChanges(notes)).not.toContain('Before');
    expect(rejectAllChanges(notes)).not.toContain('After');
  });
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })('normalizes only note identities without touching other story IDs', async () => {
    const archive = await DocxArchive.load(await inlineFootnoteAndMovedEndnote(false, false, true));
    archive.setFile('word/header-control.xml', `<w:hdr xmlns:w="${W}"><w:p><w:bookmarkStart w:id="01" w:name="keep"/><w:r><w:t>Unchanged story</w:t></w:r></w:p></w:hdr>`);
    const header = await archive.getFile('word/header-control.xml');
    archive.setFile('word/settings.xml', `<w:settings xmlns:w="${W}"><w:footnotePr><w:footnote w:id="-01"/></w:footnotePr></w:settings>`);
    await canonicalizeNoteArchiveIds(archive);
    expect(parseXml(await archive.getDocumentXml()).getElementsByTagNameNS(W, 'footnoteReference')[0]!.getAttributeNS(W, 'id')).toBe('1');
    const definitions = parseXml((await archive.getFile('word/footnotes.xml'))!);
    expect(Array.from(definitions.getElementsByTagNameNS(W, 'footnote')).map(n => n.getAttributeNS(W, 'id'))).toContain('1');
    expect(await archive.getFile('word/header-control.xml')).toBe(header);
    expect(parseXml((await archive.getFile('word/settings.xml'))!).getElementsByTagNameNS(W, 'footnote')[0]!.getAttributeNS(W, 'id')).toBe('-1');
  });
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })('still rejects contributing numeric-equivalent duplicate definitions', async () => {
    const original = await inlineFootnoteAndMovedEndnote(false, false, false);
    const archive = await DocxArchive.load(await inlineFootnoteAndMovedEndnote(true, false, false));
    const definitions = parseXml((await archive.getFile('word/footnotes.xml'))!);
    const duplicate = Array.from(definitions.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!.cloneNode(true) as Element;
    duplicate.setAttributeNS(W, 'w:id', '+1');
    definitions.documentElement.appendChild(duplicate);
    archive.setFile('word/footnotes.xml', serialize(definitions));
    await expect(compareDocuments(original, await archive.save())).rejects.toMatchObject({ name: 'AncillaryStorySafetyError' });
  });
  for (const mixed of [false, true]) for (const lexical of [false, true]) for (const detectMoves of [false, true]) {
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(`preserves inline ${mixed ? 'and moved endnote' : 'only'} bindings with lexical=${lexical}, moves=${detectMoves}`, async () => {
      const result = await compareDocuments(await inlineFootnoteAndMovedEndnote(false, mixed, lexical), await inlineFootnoteAndMovedEndnote(true, mixed, lexical), { detectMoves });
      const archive = await DocxArchive.load(result.document);
      for (const [project, expected] of [[acceptAllChanges, 'After note text'], [rejectAllChanges, 'Before note text']] as const) {
        const document = parseXml(project(await archive.getDocumentXml()));
        const refs = Array.from(document.getElementsByTagNameNS(W, 'footnoteReference'));
        expect(refs).toHaveLength(1);
        const notes = parseXml(project((await archive.getFile('word/footnotes.xml'))!));
        const id = refs[0]!.getAttributeNS(W, 'id');
        const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === id);
        expect(note?.textContent).toBe(expected);
      }
    });
  }
  test('keeps a lone stable footnote anchor alongside a moved endnote', async () => {
    const result = await compareDocuments(await inlineFootnoteAndMovedEndnote(false, true, false, false), await inlineFootnoteAndMovedEndnote(true, true, false, false), { detectMoves: true });
    const archive = await DocxArchive.load(result.document);
    for (const project of [acceptAllChanges, rejectAllChanges]) {
      const document = parseXml(project(await archive.getDocumentXml()));
      expect(document.getElementsByTagNameNS(W, 'footnoteReference')).toHaveLength(1);
      expect(project((await archive.getFile('word/footnotes.xml'))!)).toContain('Stable footnote text');
    }
  });
});

describe('Opus review regressions', () => {
  for (const kind of ['footnote', 'endnote'] as const) {
    for (const detectMoves of [true, false]) {
      test(`preserves mixed edited and moved ${kind}s with detectMoves=${detectMoves}`, async () => {
        const original = await mixedNotes(kind, false);
        const revised = await mixedNotes(kind, true);
        const result = await compareDocuments(original, revised, { detectMoves });
        const archive = await DocxArchive.load(result.document);
        const xml = await archive.getDocumentXml();
        const notes = (await archive.getFile(`word/${kind}s.xml`))!;
        const ids = Array.from(parseXml(xml).getElementsByTagNameNS(W, `${kind}Reference`)).map(n => n.getAttributeNS(W, 'id'));
        expect(ids).toHaveLength(4);
        // Mixed reader repairs use collision-safe original/revised definitions,
        // avoiding duplicate inline anchors during LibreOffice import.
        expect(new Set(ids).size).toBe(4);
        for (const [project, input, expected] of [[acceptAllChanges, revised, 'After note text'], [rejectAllChanges, original, 'Before note text']] as const) {
          const projected = project(xml);
          expect(extractTextWithParagraphs(projected)).toBe(extractTextWithParagraphs(await (await DocxArchive.load(input)).getDocumentXml()));
          const projectedNotes = parseXml(project(notes));
          const text = Array.from(parseXml(projected).getElementsByTagNameNS(W, `${kind}Reference`)).map(ref =>
            Array.from(projectedNotes.getElementsByTagNameNS(W, kind)).find(n => n.getAttributeNS(W, 'id') === ref.getAttributeNS(W, 'id'))?.textContent);
          expect(text).toEqual([expected, 'shared moved note']);
        }
      });
    }
  }

  for (const name of ['proofErr', 'kern', 'lastRenderedPageBreak', 'shd', 'vanish', 'sym']) {
    test(`copies harmless ${name} note markup`, async () => {
      const { archive, xml } = await repeatedNotes();
      const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
      const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
      const element = notes.createElementNS(W, `w:${name}`);
      if (name === 'proofErr') element.setAttributeNS(W, 'w:type', 'spellEnd');
      if (name === 'kern') element.setAttributeNS(W, 'w:val', '2');
      if (name === 'shd') element.setAttributeNS(W, 'w:val', 'clear');
      if (name === 'sym') {
        element.setAttributeNS(W, 'w:font', 'Wingdings');
        element.setAttributeNS(W, 'w:char', 'F0A7');
      }
      let parent = note.getElementsByTagNameNS(W, 'r')[0]!;
      if (['kern', 'shd', 'vanish'].includes(name)) {
        const props = notes.createElementNS(W, 'w:rPr');
        parent.insertBefore(props, parent.firstChild);
        parent = props;
      } else if (name === 'proofErr') parent = note.getElementsByTagNameNS(W, 'p')[0]!;
      parent.appendChild(element);
      archive.setFile('word/footnotes.xml', serialize(notes));
      await separateRepeatedNoteReferences(archive, xml);
      expect(parseXml((await archive.getFile('word/footnotes.xml'))!).getElementsByTagNameNS(W, name)).toHaveLength(2);
    });
  }

  test('reports typed errors with note-entry identity', async () => {
    const { archive, document } = await repeatedNotes();
    for (const ref of Array.from(document.getElementsByTagNameNS(W, 'footnoteReference'))) ref.setAttributeNS(W, 'w:id', '99');
    const error = await separateRepeatedNoteReferences(archive, serialize(document)).catch(e => e);
    expect(error).toBeInstanceOf(AncillaryStorySafetyError);
    expect(error.issues[0]).toMatchObject({ code: 'NOTE_REFERENCE_IDENTITY_UNSAFE', locator: { locatorType: 'note_entry', normalizedPartPath: 'word/footnotes.xml', entryId: '99' } });
  });
});

describe('copied note identity safety', () => {
  for (const local of ['sectPr', 'annotationRef']) {
    test(`does not treat ${local} as ordinary copyable note properties`, async () => {
      const { archive, xml } = await repeatedNotes();
      const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
      const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
      const p = note.getElementsByTagNameNS(W, 'p')[0]!;
      const props = notes.createElementNS(W, local === 'sectPr' ? 'w:pPr' : 'w:rPr');
      props.appendChild(notes.createElementNS(W, `w:${local}`));
      // annotationRef is deliberately invalid under rPr: the low-level copy
      // guard must reject it, never bless it by finding a property ancestor.
      if (local === 'sectPr') p.insertBefore(props, p.firstChild);
      else p.getElementsByTagNameNS(W, 'r')[0]!.insertBefore(props, p.getElementsByTagNameNS(W, 'r')[0]!.firstChild);
      archive.setFile('word/footnotes.xml', serialize(notes));
      await expectUnsafe(separateRepeatedNoteReferences(archive, xml), 'unsupported annotations or structure');
    });
  }
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(
    'binds lexical note identifiers rather than treating them as display numbers or positions', async () => {
      const { archive, document } = await repeatedNotes();
      const refs = document.getElementsByTagNameNS(W, 'footnoteReference');
      refs[0]!.setAttributeNS(W, 'w:id', '+37');
      refs[1]!.setAttributeNS(W, 'w:id', '037');
      const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
      const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
      note.setAttributeNS(W, 'w:id', ' 037 ');
      archive.setFile('word/footnotes.xml', serialize(notes));
      const mapping = new Map<'footnote' | 'endnote', Map<string, string>>();
      await separateRepeatedNoteReferences(archive, serialize(document), mapping);
      expect([...mapping.get('footnote')!]).toEqual([['1', '37'], ['2', '37']]);
      const result = parseXml((await archive.getFile('word/footnotes.xml'))!);
      expect(Array.from(result.getElementsByTagNameNS(W, 'footnote')).filter(n => ['1', '2'].includes(n.getAttributeNS(W, 'id')!)).map(n => n.textContent)).toEqual(['original note', 'original note']);
    });

  test('rejects canonical duplicate IDs and nested note definitions as typed failures', async () => {
    const { archive, xml } = await repeatedNotes();
    const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
    const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
    const alias = note.cloneNode(true) as Element;
    alias.setAttributeNS(W, 'w:id', '+01');
    notes.documentElement.appendChild(alias);
    archive.setFile('word/footnotes.xml', serialize(notes));
    await expectUnsafe(separateRepeatedNoteReferences(archive, xml), 'duplicate definition IDs');
    notes.documentElement.removeChild(alias);
    note.appendChild(alias);
    archive.setFile('word/footnotes.xml', serialize(notes));
    await expectUnsafe(separateRepeatedNoteReferences(archive, xml), 'nested note definition');
  });
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

  for (const annotation of ['bookmarkStart', 'commentReference', 'permStart', 'ins', 'fldChar', 'sdt', 'drawing', 'rPrChange']) {
    test(`fails closed instead of duplicating ${annotation}`, async () => {
      const { archive, xml } = await repeatedNotes();
      const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
      const note = Array.from(notes.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
      note.appendChild(notes.createElementNS(W, `w:${annotation}`));
      const before = serialize(notes);
      archive.setFile('word/footnotes.xml', before);
      await expectUnsafe(separateRepeatedNoteReferences(archive, xml), 'unsupported annotations or structure');
      expect(await archive.getFile('word/footnotes.xml')).toBe(before);
    });
  }

  test('rejects dangling references and duplicate definition IDs', async () => {
    const { archive, document, xml } = await repeatedNotes();
    for (const ref of Array.from(document.getElementsByTagNameNS(W, 'footnoteReference'))) ref.setAttributeNS(W, 'w:id', '99');
    await expectUnsafe(separateRepeatedNoteReferences(archive, serialize(document)), 'invalid referenced definition');
    const notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
    notes.documentElement.appendChild(notes.getElementsByTagNameNS(W, 'footnote')[0]!.cloneNode(true));
    archive.setFile('word/footnotes.xml', serialize(notes));
    await expectUnsafe(separateRepeatedNoteReferences(archive, xml), 'duplicate definition IDs');
  });

  test('refuses to invalidate references in another story', async () => {
    const { archive, xml } = await repeatedNotes();
    archive.setFile('word/header1.xml', xml);
    await expectUnsafe(separateRepeatedNoteReferences(archive, xml), 'reference outside the main story');
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
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })('keeps a lone stable footnote beside a moved endnote on both reader projections', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const original = await inlineFootnoteAndMovedEndnote(false, true, false, false);
    const revised = await inlineFootnoteAndMovedEndnote(true, true, false, false);
    const compared = await compareDocuments(original, revised, { detectMoves: true });
    const states = await runLibreOfficeOracle([
      { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
      { op: 'accept', docx: compared.document, saveAs: 'odt' }, { op: 'reject', docx: compared.document, saveAs: 'odt' },
    ]);
    const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
    const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
      .filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName)).map(n => n.textContent);
    expect(project(states[2]!)).toEqual(project(states[1]!));
    expect(project(states[3]!)).toEqual(project(states[0]!));
    for (const xml of states.slice(2)) expect(Array.from(parseXml(xml).getElementsByTagNameNS(T, 'note'))
      .filter(n => n.getAttributeNS(T, 'note-class') === 'footnote').map(n => n.getElementsByTagNameNS(T, 'note-body')[0]!.textContent)).toEqual(['Stable footnote text']);
  }, 180_000);
  for (const mixed of [false, true]) for (const lexical of [false, true]) for (const detectMoves of [false, true]) {
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(`resolves edited footnote ${mixed ? 'beside a moved endnote' : 'alone'} with lexical=${lexical}, moves=${detectMoves}`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const original = await inlineFootnoteAndMovedEndnote(false, mixed, lexical);
      const revised = await inlineFootnoteAndMovedEndnote(true, mixed, lexical);
      const compared = await compareDocuments(original, revised, { detectMoves });
      const results = await runLibreOfficeOracle([
        { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
        { op: 'accept', docx: compared.document, saveAs: 'odt' }, { op: 'reject', docx: compared.document, saveAs: 'odt' },
      ]);
      const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
        .filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName)).map(n => n.textContent);
      const notes = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(T, 'note'))
        .map(n => ({ kind: n.getAttributeNS(T, 'note-class'), body: n.getElementsByTagNameNS(T, 'note-body')[0]!.textContent }));
      expect(project(results[2]!)).toEqual(project(results[1]!));
      expect(project(results[3]!)).toEqual(project(results[0]!));
      expect(notes(results[2]!)).toEqual(notes(results[1]!));
      expect(notes(results[3]!)).toEqual(notes(results[0]!));
    }, 180_000);
  }
  test('restores outline numbering and paragraph formatting on both reader projections', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const numbered = async (revised: boolean) => {
      const tail = 'unchanged final paragraph after every numbered item';
      const archive = await DocxArchive.load(await buildSyntheticDocx({
        paragraphs: revised ? [stable, final, moving, tail] : [stable, moving, final, tail],
        footnoteOnParagraph: revised ? 2 : 1, footnoteText: 'numbered paragraph note',
      }));
      const document = parseXml(await archive.getDocumentXml());
      const paragraphs = Array.from(document.getElementsByTagNameNS(W, 'p'));
      for (let i = 0; i < paragraphs.length; i++) {
        const props = document.createElementNS(W, 'w:pPr');
        const style = document.createElementNS(W, 'w:pStyle');
        style.setAttributeNS(W, 'w:val', i === 1 || i === 2 ? 'Heading1' : 'Body');
        props.appendChild(style);
        paragraphs[i]!.insertBefore(props, paragraphs[i]!.firstChild);
      }
      archive.setDocumentXml(serialize(document));
      // Reuse the shared parts builder for styles, numbering and their OPC scaffolding.
      const parts = await DocxArchive.load(await buildDocxFromParts({
        bodyXml: '',
        stylesXml: `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/><w:pPr><w:jc w:val="left"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Body"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:jc w:val="right"/><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
        numberingXml: `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading1"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
        documentRelEntries: ['styles', 'numbering'].map(name => `<Relationship Id="${name}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${name}" Target="${name}.xml"/>`),
      }));
      for (const name of ['styles', 'numbering']) archive.setFile(`word/${name}.xml`, (await parts.getFile(`word/${name}.xml`))!);
      for (const name of ['[Content_Types].xml', 'word/_rels/document.xml.rels']) {
        const target = parseXml((await archive.getFile(name))!);
        const extra = parseXml((await parts.getFile(name))!);
        for (const node of Array.from(extra.documentElement.childNodes).filter(n => n.nodeType === 1) as Element[]) {
          if (node.getAttribute('PartName')?.match(/\/(styles|numbering)\.xml$/) || ['styles', 'numbering'].includes(node.getAttribute('Id') ?? '')) {
            target.documentElement.appendChild(target.importNode(node, true));
          }
        }
        archive.setFile(name, serialize(target));
      }
      return archive.save();
    };
    const original = await numbered(false);
    const revised = await numbered(true);
    const comparison = await compareDocuments(original, revised, { detectMoves: true });
    const results = await runLibreOfficeOracle([
      { op: 'identity', docx: original, saveAs: 'odt' },
      { op: 'identity', docx: revised, saveAs: 'odt' },
      { op: 'accept', docx: comparison.document, saveAs: 'odt' },
      { op: 'reject', docx: comparison.document, saveAs: 'odt' },
    ]);
    const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
    const S = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
    const project = (xml: string) => {
      const document = parseXml(xml);
      const styles = Array.from(document.getElementsByTagNameNS(S, 'style'));
      return Array.from(document.getElementsByTagName('*')).filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName)).map(p => {
        const styleId = p.getAttributeNS(T, 'style-name');
        const auto = styles.find(s => s.getAttributeNS(S, 'name') === styleId);
        // Outline-numbered headings need not have text:list-item ancestors.
        // An explicit empty list-style-name is the reader's numbering suppression.
        const suppressesNumbering = auto?.hasAttributeNS(S, 'list-style-name') && auto.getAttributeNS(S, 'list-style-name') === '';
        return { text: p.textContent, heading: p.localName === 'h', outline: p.getAttributeNS(T, 'outline-level'), style: auto?.getAttributeNS(S, 'parent-style-name') || styleId, suppressesNumbering: !!suppressesNumbering, listHeader: p.getAttributeNS(T, 'is-list-header') === 'true' };
      });
    };
    expect(project(results[2]!)).toEqual(project(results[1]!));
    expect(project(results[3]!)).toEqual(project(results[0]!));
  }, 180_000);
  test('preserves mixed edited and moved footnote bindings in LibreOffice', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const original = await mixedNotes('footnote', false);
    const revised = await mixedNotes('footnote', true);
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
  for (const kind of ['footnote', 'endnote'] as const) {
    test(`accepts and rejects a moved ${kind} without text or paragraph drift`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
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
