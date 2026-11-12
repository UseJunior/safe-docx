import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxArchive, DocxDocument, parseXml, buildSyntheticDocx, buildDocxFromParts } from '@usejunior/docx-core';
import JSZip from 'jszip';
import { XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments, acceptAllChanges, rejectAllChanges, extractTextWithParagraphs } from '../index.js';
import { canonicalizeNoteArchiveIds, separateRepeatedNoteReferences } from './noteReferenceIdentity.js';
import { AncillaryStorySafetyError } from './ancillaryFieldSafety.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';

const TEST_FEATURE = 'Note reference identity';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const moving = 'the complete paragraph with an attached explanatory note moves here';
const stable = 'a long stable paragraph that remains in the same relative position';
const final = 'the final stable anchor paragraph is unchanged throughout';
const serialize = (node: Node) => new XMLSerializer().serializeToString(node);
async function fiveAlignedNotes(kind: 'footnote' | 'endnote', revised: boolean) {
  const archive = await DocxArchive.load(await buildSyntheticDocx({
    paragraphs: ['First anchor', 'Second anchor', 'Third anchor', 'Fourth anchor', 'Fifth anchor'],
    [`${kind}OnParagraph`]: 0, [`${kind}Text`]: revised ? 'First revised body' : 'First original body',
  }));
  const document = parseXml(await archive.getDocumentXml());
  const notes = parseXml((await archive.getFile(`word/${kind}s.xml`))!);
  const firstReference = document.getElementsByTagNameNS(W, `${kind}Reference`)[0]!.parentNode!;
  const firstNote = Array.from(notes.getElementsByTagNameNS(W, kind)).find(n => n.getAttributeNS(W, 'id') === '1')!;
  for (let id = 2; id <= 5; id++) {
    const run = firstReference.cloneNode(true) as Element;
    run.getElementsByTagNameNS(W, `${kind}Reference`)[0]!.setAttributeNS(W, 'w:id', String(id));
    document.getElementsByTagNameNS(W, 'p')[id - 1]!.appendChild(run);
    const note = firstNote.cloneNode(true) as Element;
    note.setAttributeNS(W, 'w:id', String(id));
    note.getElementsByTagNameNS(W, 't')[0]!.textContent = `Stable note ${id}`;
    notes.documentElement.appendChild(note);
  }
  archive.setDocumentXml(serialize(document)); archive.setFile(`word/${kind}s.xml`, serialize(notes));
  return archive.save();
}
const fiveAlignedFootnotes = (revised: boolean) => fiveAlignedNotes('footnote', revised);
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

type NoteKind = 'footnote' | 'endnote';
interface AlignedNoteOptions {
  kinds?: readonly NoteKind[];
  edited?: Partial<Record<NoteKind, readonly number[]>>;
  lexical?: boolean;
  boldRevisedFirstAnchor?: NoteKind;
}
const alignedNoteBody = (kind: NoteKind, id: number, edited: boolean, revised: boolean) =>
  edited ? `${kind} ${id} ${revised ? 'revised' : 'original'} body` : `Stable ${kind} ${id}`;
/** Five anchors per kind, one per paragraph, with selected bodies edited between sides. */
async function alignedNotes(revised: boolean, options: AlignedNoteOptions = {}) {
  const { kinds = ['endnote'], edited = { endnote: [1] }, lexical = false, boldRevisedFirstAnchor } = options;
  const archive = await DocxArchive.load(await buildSyntheticDocx({
    paragraphs: ['First anchor', 'Second anchor', 'Third anchor', 'Fourth anchor', 'Fifth anchor'],
    ...Object.fromEntries(kinds.map(kind => [`${kind}OnParagraph`, 0])),
  }));
  const document = parseXml(await archive.getDocumentXml());
  for (const kind of kinds) {
    const notes = parseXml((await archive.getFile(`word/${kind}s.xml`))!);
    const firstReference = document.getElementsByTagNameNS(W, `${kind}Reference`)[0]!.parentNode as Element;
    const firstNote = Array.from(notes.getElementsByTagNameNS(W, kind)).find(n => n.getAttributeNS(W, 'id') === '1')!;
    for (let id = 1; id <= 5; id++) {
      const note = id === 1 ? firstNote : firstNote.cloneNode(true) as Element;
      note.getElementsByTagNameNS(W, 't')[0]!.textContent = alignedNoteBody(kind, id, edited[kind]?.includes(id) ?? false, revised);
      if (id === 1) continue;
      const run = firstReference.cloneNode(true) as Element;
      run.getElementsByTagNameNS(W, `${kind}Reference`)[0]!.setAttributeNS(W, 'w:id', String(id));
      document.getElementsByTagNameNS(W, 'p')[id - 1]!.appendChild(run);
      note.setAttributeNS(W, 'w:id', String(id));
      notes.documentElement.appendChild(note);
    }
    if (lexical) {
      // Lexically distinct decimal identifiers name the same note (ST_DecimalNumber).
      (firstReference.getElementsByTagNameNS(W, `${kind}Reference`)[0]!).setAttributeNS(W, 'w:id', '01');
      firstNote.setAttributeNS(W, 'w:id', '+1');
    }
    if (revised && boldRevisedFirstAnchor === kind) {
      firstReference.getElementsByTagNameNS(W, 'rPr')[0]!.appendChild(document.createElementNS(W, 'w:b'));
    }
    archive.setFile(`word/${kind}s.xml`, serialize(notes));
  }
  archive.setDocumentXml(serialize(document));
  return archive.save();
}
/** Anchor order to bound definition text, read from one story and its note part. */
function noteBindings(kind: NoteKind, documentXml: string, notesXml: string): string[] {
  const bodies = new Map(Array.from(parseXml(notesXml).getElementsByTagNameNS(W, kind)).map(n => [String(BigInt(n.getAttributeNS(W, 'id')!)), n.textContent ?? '']));
  return Array.from(parseXml(documentXml).getElementsByTagNameNS(W, `${kind}Reference`)).map(r => bodies.get(String(BigInt(r.getAttributeNS(W, 'id')!))) ?? '<unbound>');
}
async function packageNoteBindings(kind: NoteKind, docx: Buffer): Promise<string[]> {
  const archive = await DocxArchive.load(docx);
  return noteBindings(kind, await archive.getDocumentXml(), (await archive.getFile(`word/${kind}s.xml`)) ?? `<w:${kind}s xmlns:w="${W}"/>`);
}
/** Text of the definitions whose every paragraph mark carries a lifecycle marker, by marker. */
function lifecycleMarkedDefinitions(notesXml: string, kind: NoteKind): { ins: string[]; del: string[] } {
  const marked = { ins: [] as string[], del: [] as string[] };
  for (const note of Array.from(parseXml(notesXml).getElementsByTagNameNS(W, kind))) {
    const marks = Array.from(note.getElementsByTagNameNS(W, 'p')).map(p => {
      const rPr = Array.from(p.getElementsByTagNameNS(W, 'rPr')).find(r => (r.parentNode as Element).localName === 'pPr');
      return rPr?.getElementsByTagNameNS(W, 'ins').length ? 'ins' : rPr?.getElementsByTagNameNS(W, 'del').length ? 'del' : null;
    });
    const marker = marks[0];
    if (marker && marks.every(m => m === marker)) marked[marker].push(note.textContent ?? '');
  }
  return marked;
}
async function nativeProjection(docx: Buffer, operation: 'acceptChanges' | 'rejectChanges'): Promise<Buffer> {
  const complete = await DocxDocument.load(docx);
  await complete[operation]();
  return (await complete.toBuffer()).buffer;
}
/** Independently loaded identity states versus AST and complete-package projections of the comparison. */
async function expectNoteBindingsResolve(kind: NoteKind, original: Buffer, revised: Buffer, compared: Buffer) {
  const expected = { accept: await packageNoteBindings(kind, revised), reject: await packageNoteBindings(kind, original) };
  expect(expected.accept).not.toContain('<unbound>');
  expect(expected.reject).not.toContain('<unbound>');
  const archive = await DocxArchive.load(compared);
  const documentXml = await archive.getDocumentXml(), notesXml = (await archive.getFile(`word/${kind}s.xml`))!;
  expect(noteBindings(kind, acceptAllChanges(documentXml), acceptAllChanges(notesXml))).toEqual(expected.accept);
  expect(noteBindings(kind, rejectAllChanges(documentXml), rejectAllChanges(notesXml))).toEqual(expected.reject);
  expect(await packageNoteBindings(kind, await nativeProjection(compared, 'acceptChanges'))).toEqual(expected.accept);
  expect(await packageNoteBindings(kind, await nativeProjection(compared, 'rejectChanges'))).toEqual(expected.reject);
}
/** Stable aligned anchors: no anchor-level history, definition history inside the note part. */
async function expectStableAnchorsWithDefinitionHistory(kind: NoteKind, compared: Buffer) {
  const archive = await DocxArchive.load(compared);
  const references = Array.from(parseXml(await archive.getDocumentXml()).getElementsByTagNameNS(W, `${kind}Reference`));
  expect(references.map(r => r.getAttributeNS(W, 'id'))).toEqual(['1', '2', '3', '4', '5']);
  for (const reference of references) {
    for (let node = reference.parentNode; node; node = node.parentNode) {
      expect(node.nodeType === 1 && (node as Element).namespaceURI === W && ['ins', 'del'].includes((node as Element).localName)).toBe(false);
    }
  }
  const notes = parseXml((await archive.getFile(`word/${kind}s.xml`))!);
  expect(Array.from(notes.getElementsByTagNameNS(W, kind)).map(n => n.getAttributeNS(W, 'id'))).toEqual(['-1', '0', '1', '2', '3', '4', '5']);
  expect(notes.getElementsByTagNameNS(W, 'ins').length).toBeGreaterThan(0);
  expect(notes.getElementsByTagNameNS(W, 'del').length).toBeGreaterThan(0);
}
const SCHEMA_GATE = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
/** Tracked, native Accept and native Reject main and note parts validate against the vendored schema. */
async function expectSchemaValid(compared: Buffer, kinds: readonly NoteKind[]) {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-996-notes-'));
  try {
    let instances = 0;
    for (const [name, docx] of [['tracked', compared], ['accepted', await nativeProjection(compared, 'acceptChanges')], ['rejected', await nativeProjection(compared, 'rejectChanges')]] as const) {
      const archive = await DocxArchive.load(docx);
      writeFileSync(join(dir, `${name}-document.xml`), await archive.getDocumentXml()); instances++;
      for (const kind of kinds) { writeFileSync(join(dir, `${name}-${kind}s.xml`), (await archive.getFile(`word/${kind}s.xml`))!); instances++; }
    }
    const gate = spawnSync(process.execPath, [SCHEMA_GATE, dir], { encoding: 'utf8' });
    expect(gate.status, `${gate.stdout}\n${gate.stderr}`).toBe(0);
    expect(gate.stdout).toContain(`${instances} of ${instances} document.xml instances validate`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('inline endnote definitions remain bound to their source sides', () => {
  for (const kind of ['endnote', 'footnote'] as const) {
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: kind === 'endnote' ? '17.11.7' : '17.11.14' })(`keeps edited and unchanged ${kind} anchors stable with tracked definition history`, async () => {
      const options = { kinds: [kind], edited: { [kind]: [1] } };
      const original = await alignedNotes(false, options), revised = await alignedNotes(true, options);
      const result = await compareDocuments(original, revised);
      await expectStableAnchorsWithDefinitionHistory(kind, result.document);
      await expectNoteBindingsResolve(kind, original, revised, result.document);
      await expectSchemaValid(result.document, [kind]);
    });
  }
  const cases: Array<[string, AlignedNoteOptions, NoteKind[]]> = [
    ['multiple edited endnotes', { edited: { endnote: [1, 3, 5] } }, ['endnote']],
    ['lexical decimal endnote identifiers', { lexical: true }, ['endnote']],
    ['an edited endnote beside an edited footnote', { kinds: ['footnote', 'endnote'], edited: { footnote: [2], endnote: [1] } }, ['footnote', 'endnote']],
    ['an edited endnote beside unchanged footnotes', { kinds: ['footnote', 'endnote'], edited: { endnote: [4] } }, ['endnote']],
  ];
  for (const [name, options, stabilized] of cases) for (const detectMoves of [false, true]) {
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.7' })(`binds ${name} on AST and complete-package projections with moves=${detectMoves}`, async () => {
      const original = await alignedNotes(false, options), revised = await alignedNotes(true, options);
      const result = await compareDocuments(original, revised, { detectMoves });
      for (const kind of options.kinds ?? ['endnote']) await expectNoteBindingsResolve(kind, original, revised, result.document);
      for (const kind of stabilized) await expectStableAnchorsWithDefinitionHistory(kind, result.document);
      await expectSchemaValid(result.document, options.kinds ?? ['endnote']);
    });
  }
  test('leaves unchanged footnotes untouched beside a reconciled endnote', async () => {
    const options: AlignedNoteOptions = { kinds: ['footnote', 'endnote'], edited: { endnote: [4] } };
    const result = await compareDocuments(await alignedNotes(false, options), await alignedNotes(true, options));
    const notes = (await (await DocxArchive.load(result.document)).getFile('word/footnotes.xml'))!;
    expect(notes).toBe((await (await DocxArchive.load(await alignedNotes(true, options))).getFile('word/footnotes.xml'))!);
  });
  test('characterizes separate side definitions when an aligned endnote anchor format changes', async () => {
    const options: AlignedNoteOptions = { boldRevisedFirstAnchor: 'endnote' };
    const original = await alignedNotes(false, options), revised = await alignedNotes(true, options);
    const result = await compareDocuments(original, revised);
    const archive = await DocxArchive.load(result.document);
    // Coarse anchor history keeps the property change's Reject semantics (#990).
    const references = Array.from(parseXml(await archive.getDocumentXml()).getElementsByTagNameNS(W, 'endnoteReference'));
    expect(references).toHaveLength(6);
    // The superseded and replacing definitions follow their anchors (#1388).
    expect(lifecycleMarkedDefinitions((await archive.getFile('word/endnotes.xml'))!, 'endnote')).toEqual({ ins: ['endnote 1 revised body'], del: ['endnote 1 original body'] });
    await expectNoteBindingsResolve('endnote', original, revised, result.document);
    await expectSchemaValid(result.document, ['endnote']);
  });
});

describe('inline footnote definitions remain bound to their source sides', () => {
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })('keeps aligned edited and unchanged footnote IDs sequential with matched definitions', async () => {
    const original = await fiveAlignedFootnotes(false), revised = await fiveAlignedFootnotes(true);
    const result = await compareDocuments(original, revised);
    const archive = await DocxArchive.load(result.document);
    const main = parseXml(await archive.getDocumentXml()), notes = parseXml((await archive.getFile('word/footnotes.xml'))!);
    const ids = Array.from(main.getElementsByTagNameNS(W, 'footnoteReference')).map(n => n.getAttributeNS(W, 'id'));
    expect(ids).toEqual(['1', '2', '3', '4', '5']);
    expect(Array.from(notes.getElementsByTagNameNS(W, 'footnote')).map(n => n.getAttributeNS(W, 'id'))).toEqual(['-1', '0', ...ids]);
    expect(notes.getElementsByTagNameNS(W, 'ins').length).toBeGreaterThan(0);
    for (const [operation, expected] of [['acceptChanges', 'First revised body'], ['rejectChanges', 'First original body']] as const) {
      const complete = await DocxDocument.load(result.document); await complete[operation]();
      const resolved = await DocxArchive.load((await complete.toBuffer()).buffer);
      const projected = parseXml((await resolved.getFile('word/footnotes.xml'))!);
      expect(Array.from(projected.getElementsByTagNameNS(W, 'footnote')).filter(n => Number(n.getAttributeNS(W, 'id')) > 0).map(n => n.textContent)).toEqual([expected, 'Stable note 2', 'Stable note 3', 'Stable note 4', 'Stable note 5']);
    }
  });
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
      // The superseded and replacing definitions follow their anchors (#1388).
      expect(lifecycleMarkedDefinitions(notes, 'footnote')).toEqual({ ins: ['After note text'], del: ['Before note text'] });
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

/** One anchor in a paragraph shared with other note anchors (issue #852). */
interface SharedParagraphNote { kind: NoteKind; lead: string; edited?: boolean; revisedId?: number; bold?: boolean }
const sharedNoteBody = (note: SharedParagraphNote, revised: boolean) =>
  `${note.lead.trim()} ${note.kind} ${note.edited ? revised ? 'revised' : 'original' : 'pinned'} note`;
/**
 * One paragraph `lead¹ lead² … .` holding every anchor, then a stable paragraph.
 * Original IDs count up per kind; a revised ID, when given, is pre-distinct.
 */
async function sharedParagraphNotes(revised: boolean, notes: readonly SharedParagraphNote[]): Promise<Buffer> {
  const kinds = [...new Set(notes.map(note => note.kind))];
  const archive = await DocxArchive.load(await buildSyntheticDocx({
    paragraphs: ['placeholder', 'A stable closing paragraph stays unchanged.'],
    ...Object.fromEntries(kinds.map(kind => [`${kind}OnParagraph`, 0])),
  }));
  const document = parseXml(await archive.getDocumentXml());
  const paragraph = document.getElementsByTagNameNS(W, 'p')[0]!;
  while (paragraph.firstChild) paragraph.removeChild(paragraph.firstChild);
  const textRun = (text: string) => {
    const run = document.createElementNS(W, 'w:r'), t = document.createElementNS(W, 'w:t');
    t.setAttribute('xml:space', 'preserve'); t.textContent = text; run.appendChild(t);
    return run;
  };
  const parts = new Map<NoteKind, Document>();
  for (const kind of kinds) {
    const part = parseXml((await archive.getFile(`word/${kind}s.xml`))!);
    const template = Array.from(part.getElementsByTagNameNS(W, kind)).find(n => n.getAttributeNS(W, 'id') === '1')!;
    for (const note of notes.filter(candidate => candidate.kind === kind)) {
      const ordinal = notes.filter(candidate => candidate.kind === kind).indexOf(note) + 1;
      const id = String(revised && note.revisedId !== undefined ? note.revisedId : ordinal);
      const definition = template.cloneNode(true) as Element;
      definition.setAttributeNS(W, 'w:id', id);
      definition.getElementsByTagNameNS(W, 't')[0]!.textContent = sharedNoteBody(note, revised);
      part.documentElement.appendChild(definition);
      (note as SharedParagraphNote & { id?: string }).id = id;
    }
    part.documentElement.removeChild(template);
    parts.set(kind, part);
  }
  const ordinals = new Map<NoteKind, number>();
  for (const note of notes) {
    const ordinal = (ordinals.get(note.kind) ?? 0) + 1;
    ordinals.set(note.kind, ordinal);
    paragraph.appendChild(textRun(note.lead));
    const run = document.createElementNS(W, 'w:r'), properties = document.createElementNS(W, 'w:rPr');
    const style = document.createElementNS(W, 'w:rStyle');
    style.setAttributeNS(W, 'w:val', note.kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference');
    properties.appendChild(style);
    if (note.bold) properties.appendChild(document.createElementNS(W, 'w:b'));
    const reference = document.createElementNS(W, `w:${note.kind}Reference`);
    reference.setAttributeNS(W, 'w:id', String(revised && note.revisedId !== undefined ? note.revisedId : ordinal));
    run.appendChild(properties); run.appendChild(reference);
    paragraph.appendChild(run);
  }
  paragraph.appendChild(textRun('.'));
  archive.setDocumentXml(serialize(document));
  for (const [kind, part] of parts) archive.setFile(`word/${kind}s.xml`, serialize(part));
  return archive.save();
}
/**
 * Every anchor of the kind is live (no anchor-level history), several anchors'
 * IDs run 1..n in anchor order, definitions follow that same order, and
 * edited bodies carry their history inside the note part.
 */
async function expectOrdinalAnchorsWithDefinitionHistory(kind: NoteKind, compared: Buffer, notes: readonly SharedParagraphNote[]) {
  const archive = await DocxArchive.load(compared);
  const references = Array.from(parseXml(await archive.getDocumentXml()).getElementsByTagNameNS(W, `${kind}Reference`));
  const mine = notes.filter(note => note.kind === kind);
  const ids = references.map(r => r.getAttributeNS(W, 'id'));
  expect(ids).toHaveLength(mine.length);
  // A lone anchor keeps its established collision-safe ID (#994).
  if (mine.length > 1) expect(ids).toEqual(mine.map((_, index) => String(index + 1)));
  for (const reference of references) {
    for (let node = reference.parentNode; node; node = node.parentNode) {
      expect(node.nodeType === 1 && (node as Element).namespaceURI === W && ['ins', 'del'].includes((node as Element).localName)).toBe(false);
    }
  }
  const part = parseXml((await archive.getFile(`word/${kind}s.xml`))!);
  const definitions = Array.from(part.getElementsByTagNameNS(W, kind)).filter(n => !n.getAttributeNS(W, 'type'));
  expect(definitions.map(n => n.getAttributeNS(W, 'id'))).toEqual(ids);
  definitions.forEach((definition, index) => {
    const edited = mine[index]!.edited ?? false;
    expect(definition.getElementsByTagNameNS(W, 'ins').length > 0).toBe(edited);
    expect(definition.getElementsByTagNameNS(W, 'del').length > 0).toBe(edited);
  });
}
/** Combined state: definition IDs are unique and every reference names exactly one definition. */
async function expectCombinedReferencesResolve(kind: NoteKind, compared: Buffer) {
  const archive = await DocxArchive.load(compared);
  const ids = Array.from(parseXml((await archive.getFile(`word/${kind}s.xml`))!).getElementsByTagNameNS(W, kind)).map(n => n.getAttributeNS(W, 'id'));
  expect(new Set(ids).size).toBe(ids.length);
  for (const reference of Array.from(parseXml(await archive.getDocumentXml()).getElementsByTagNameNS(W, `${kind}Reference`))) {
    expect(ids.filter(id => id === reference.getAttributeNS(W, 'id'))).toHaveLength(1);
  }
}
const VOYAGER = 'Voyager clause', MERIDIAN = ' and Meridian clause', HALCYON = ' with Halcyon clause';
/** The #852 / #871 matrix: edited subset x identifier provenance x reference-run formatting. */
const sharedParagraphCases: Array<[string, SharedParagraphNote[]]> = [];
for (const [edit, edited] of [['first-only', [true, false]], ['second-only', [false, true]], ['both', [true, true]]] as const) {
  for (const ids of ['same', 'pre-distinct'] as const) for (const styling of ['uniform', 'different'] as const) {
    sharedParagraphCases.push([`${edit} edits with ${ids} IDs and ${styling} reference runs`, [
      { kind: 'footnote', lead: VOYAGER, edited: edited[0], ...(ids === 'pre-distinct' ? { revisedId: 3 } : {}) },
      { kind: 'footnote', lead: MERIDIAN, edited: edited[1], bold: styling === 'different', ...(ids === 'pre-distinct' ? { revisedId: 4 } : {}) },
    ]]);
  }
}
sharedParagraphCases.push(
  ['a single edited footnote (control)', [{ kind: 'footnote', lead: VOYAGER, edited: true }]],
  ['three footnotes with only the middle body edited', [
    { kind: 'footnote', lead: VOYAGER }, { kind: 'footnote', lead: MERIDIAN, edited: true }, { kind: 'footnote', lead: HALCYON },
  ]],
  ['three footnotes with the outer bodies edited and pre-distinct IDs', [
    { kind: 'footnote', lead: VOYAGER, edited: true, revisedId: 4 }, { kind: 'footnote', lead: MERIDIAN, revisedId: 5 }, { kind: 'footnote', lead: HALCYON, edited: true, revisedId: 6 },
  ]],
  ['two endnotes with the first body edited', [
    { kind: 'endnote', lead: VOYAGER, edited: true }, { kind: 'endnote', lead: MERIDIAN },
  ]],
  ['two endnotes with the second body edited and pre-distinct IDs', [
    { kind: 'endnote', lead: VOYAGER, revisedId: 3 }, { kind: 'endnote', lead: MERIDIAN, edited: true, revisedId: 4 },
  ]],
  ['interleaved footnotes and an endnote with one body of each kind edited', [
    { kind: 'footnote', lead: VOYAGER, edited: true }, { kind: 'endnote', lead: MERIDIAN, edited: true }, { kind: 'footnote', lead: HALCYON },
  ]],
);
describe('notes sharing one paragraph pair by ordinal', () => {
  for (const [name, notes] of sharedParagraphCases) for (const detectMoves of [false, true]) {
    const kinds = [...new Set(notes.map(note => note.kind))];
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: kinds.includes('footnote') ? '17.11.14' : '17.11.7' })(`keeps ${name} bound with definition history with moves=${detectMoves}`, async () => {
      const original = await sharedParagraphNotes(false, notes), revised = await sharedParagraphNotes(true, notes);
      const result = await compareDocuments(original, revised, { detectMoves });
      for (const kind of kinds) {
        await expectCombinedReferencesResolve(kind, result.document);
        await expectNoteBindingsResolve(kind, original, revised, result.document);
        if (notes.filter(note => note.kind === kind).some(note => note.edited)) await expectOrdinalAnchorsWithDefinitionHistory(kind, result.document, notes);
      }
      await expectSchemaValid(result.document, kinds);
    });
  }
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })('still keeps separate side definitions when one paired body has a field', async () => {
    const notes: SharedParagraphNote[] = [{ kind: 'footnote', lead: VOYAGER, edited: true }, { kind: 'footnote', lead: MERIDIAN, edited: true }];
    const original = await sharedParagraphNotes(false, notes);
    const revisedArchive = await DocxArchive.load(await sharedParagraphNotes(true, notes));
    const part = parseXml((await revisedArchive.getFile('word/footnotes.xml'))!);
    const first = Array.from(part.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!;
    const fieldRun = part.createElementNS(W, 'w:r');
    for (const type of ['begin', 'end']) {
      const marker = part.createElementNS(W, 'w:fldChar'); marker.setAttributeNS(W, 'w:fldCharType', type); fieldRun.appendChild(marker);
    }
    first.getElementsByTagNameNS(W, 'p')[0]!.appendChild(fieldRun);
    revisedArchive.setFile('word/footnotes.xml', serialize(part));
    const revised = await revisedArchive.save();
    const result = await compareDocuments(original, revised);
    const archive = await DocxArchive.load(result.document);
    const references = Array.from(parseXml(await archive.getDocumentXml()).getElementsByTagNameNS(W, 'footnoteReference'));
    // The field-bearing pair keeps anchor-level history; the plain pair still reconciles.
    expect(references.filter(r => r.parentNode?.parentNode && (r.parentNode.parentNode as Element).localName === 'del')).toHaveLength(1);
    expect(references.filter(r => r.parentNode?.parentNode && (r.parentNode.parentNode as Element).localName === 'ins')).toHaveLength(1);
    expect(references).toHaveLength(3);
    await expectCombinedReferencesResolve('footnote', result.document);
    await expectNoteBindingsResolve('footnote', original, revised, result.document);
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
  for (const kind of ['footnote', 'endnote'] as const) {
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })(`keeps five edited and unchanged inline ${kind} bodies attached to their own anchors`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const original = await fiveAlignedNotes(kind, false), revised = await fiveAlignedNotes(kind, true);
      const result = await compareDocuments(original, revised);
      const states = await runLibreOfficeOracle([
        { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
        { op: 'accept', docx: result.document, saveAs: 'odt' }, { op: 'reject', docx: result.document, saveAs: 'odt' },
      ]);
      const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
        .filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName)).map(n => n.textContent);
      const notes = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(T, 'note'))
        .map(n => ({ kind: n.getAttributeNS(T, 'note-class'), body: n.getElementsByTagNameNS(T, 'note-body')[0]!.textContent }));
      expect(notes(states[1]!).map(n => n.kind)).toEqual(Array(5).fill(kind));
      expect(notes(states[2]!)).toEqual(notes(states[1]!));
      expect(notes(states[3]!)).toEqual(notes(states[0]!));
      expect(project(states[2]!)).toEqual(project(states[1]!));
      expect(project(states[3]!)).toEqual(project(states[0]!));
    }, 120000);
  }
  const readerCases: Array<[string, AlignedNoteOptions, boolean]> = [
    ['multiple edited endnotes', { edited: { endnote: [1, 3, 5] } }, false],
    ['lexical decimal endnote identifiers', { lexical: true }, true],
    ['an edited endnote beside an edited footnote', { kinds: ['footnote', 'endnote'], edited: { footnote: [2], endnote: [1] } }, true],
    ['an edited endnote whose anchor format changes', { edited: { endnote: [1, 3] }, boldRevisedFirstAnchor: 'endnote' }, false],
  ];
  for (const [name, options, detectMoves] of readerCases) {
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.7' })(`binds ${name} on both reader projections`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const original = await alignedNotes(false, options), revised = await alignedNotes(true, options);
      const compared = await compareDocuments(original, revised, { detectMoves });
      const states = await runLibreOfficeOracle([
        { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
        { op: 'accept', docx: compared.document, saveAs: 'odt' }, { op: 'reject', docx: compared.document, saveAs: 'odt' },
      ]);
      const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
        .filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName)).map(n => n.textContent);
      const notes = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(T, 'note'))
        .map(n => ({ kind: n.getAttributeNS(T, 'note-class'), body: n.getElementsByTagNameNS(T, 'note-body')[0]!.textContent }));
      expect(notes(states[1]!)).toHaveLength(5 * (options.kinds ?? ['endnote']).length);
      expect(notes(states[2]!)).toEqual(notes(states[1]!));
      expect(notes(states[3]!)).toEqual(notes(states[0]!));
      expect(project(states[2]!)).toEqual(project(states[1]!));
      expect(project(states[3]!)).toEqual(project(states[0]!));
    }, 180_000);
  }
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
  test.openspec('Reject restores the original numbered paragraph').openspec('Accept permits correct renumbering')('restores outline numbering and paragraph formatting on both reader projections', async () => {
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
    const numberingStyles: string[] = [];
    const capturedContent: string[] = [];
    const results = await runLibreOfficeOracle([
      { op: 'identity', docx: original, saveAs: 'odt' },
      { op: 'identity', docx: revised, saveAs: 'odt' },
      { op: 'accept', docx: comparison.document, saveAs: 'odt' },
      { op: 'reject', docx: comparison.document, saveAs: 'odt' },
    ], undefined, async (index, bytes) => {
      const readerPackage = await JSZip.loadAsync(bytes);
      numberingStyles[index] = await readerPackage.file('styles.xml')!.async('string');
      expect(numberingStyles[index]).toBeTruthy();
      capturedContent[index] = await readerPackage.file('content.xml')!.async('string');
      // Evidence collection gets an isolated copy, never the reader's vote.
      bytes.fill(0);
    });
    expect(results).toEqual(capturedContent);
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
    // This single-level outline starts at one. Preserve its rule and restart
    // metadata before deriving ordinals from the measured reader heading order;
    // paragraph text alone does not contain automatic outline numbers.
    const outline = (xml: string, index: number) => {
      const document = parseXml(xml);
      const definitions = parseXml(numberingStyles[index]!);
      // text:h uses the document outline, not an unrelated list style whose
      // decimal level could accidentally make this numbering assertion pass.
      const outlines = Array.from(definitions.getElementsByTagNameNS(T, 'outline-style'));
      expect(outlines).toHaveLength(1);
      const rule = Array.from(outlines[0]!.getElementsByTagNameNS(T, 'outline-level-style'))
        .find(n => n.getAttributeNS(T, 'level') === '1')!;
      expect(rule, numberingStyles[index]).toBeDefined();
      expect(rule.getAttributeNS(S, 'num-format')).toBe('1');
      expect(rule.getAttributeNS(T, 'start-value') || '1').toBe('1');
      const headings = Array.from(document.getElementsByTagNameNS(T, 'h'));
      expect(headings).toHaveLength(2);
      for (const heading of headings) {
        expect(heading.textContent).toBeTruthy();
        expect(heading.getAttributeNS(T, 'outline-level')).toBe('1');
        expect(heading.getAttributeNS(T, 'restart-numbering')).not.toBe('true');
        expect(heading.getAttributeNS(T, 'start-value')).toBeFalsy();
        for (let ancestor = heading.parentNode; ancestor; ancestor = ancestor.parentNode) {
          expect(ancestor.nodeType === 1 && (ancestor as Element).namespaceURI === T &&
            (ancestor as Element).localName === 'list-header').toBe(false);
        }
      }
      return headings.findIndex(heading => heading.textContent?.startsWith(moving)) + 1;
    };
    expect(results.map(outline)).toEqual([1, 2, 2, 1]);
    expect(compareSourceProjectedFormattingFidelity(
      await (await DocxArchive.load(original)).getDocumentXml(),
      await (await DocxArchive.load(revised)).getDocumentXml(),
      await (await DocxArchive.load(comparison.document)).getDocumentXml(),
    ).score).toBe(1);
  }, 180_000);
  for (const kind of ['footnote', 'endnote'] as const) test(`preserves mixed edited and moved ${kind} bindings in LibreOffice`, async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const original = await mixedNotes(kind, false);
    const revised = await mixedNotes(kind, true);
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
reader('LibreOffice notes sharing one paragraph', () => {
  const fieldPair: SharedParagraphNote[] = [{ kind: 'footnote', lead: VOYAGER, edited: true }, { kind: 'footnote', lead: MERIDIAN, edited: true }];
  for (const [name, notes] of sharedParagraphCases) {
    test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: notes.some(note => note.kind === 'footnote') ? '17.11.14' : '17.11.7' })(`binds ${name} on both reader projections`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const original = await sharedParagraphNotes(false, notes), revised = await sharedParagraphNotes(true, notes);
      const compared = await compareDocuments(original, revised);
      const states = await runLibreOfficeOracle([
        { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
        { op: 'accept', docx: compared.document, saveAs: 'odt' }, { op: 'reject', docx: compared.document, saveAs: 'odt' },
      ]);
      const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
        .filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName)).map(n => n.textContent);
      const bodies = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(T, 'note'))
        .map(n => ({ kind: n.getAttributeNS(T, 'note-class'), body: n.getElementsByTagNameNS(T, 'note-body')[0]!.textContent }));
      expect(bodies(states[0]!).map(n => n.body)).toEqual(notes.map(note => sharedNoteBody(note, false)));
      expect(bodies(states[1]!).map(n => n.body)).toEqual(notes.map(note => sharedNoteBody(note, true)));
      expect(bodies(states[2]!)).toEqual(bodies(states[1]!));
      expect(bodies(states[3]!)).toEqual(bodies(states[0]!));
      expect(project(states[2]!)).toEqual(project(states[1]!));
      expect(project(states[3]!)).toEqual(project(states[0]!));
    }, 180_000);
  }
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })('binds a reconciled pair beside a field-bearing fallback pair on both reader projections', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const original = await sharedParagraphNotes(false, fieldPair);
    const revisedArchive = await DocxArchive.load(await sharedParagraphNotes(true, fieldPair));
    const part = parseXml((await revisedArchive.getFile('word/footnotes.xml'))!);
    const fieldRun = part.createElementNS(W, 'w:r');
    for (const type of ['begin', 'end']) {
      const marker = part.createElementNS(W, 'w:fldChar'); marker.setAttributeNS(W, 'w:fldCharType', type); fieldRun.appendChild(marker);
    }
    Array.from(part.getElementsByTagNameNS(W, 'footnote')).find(n => n.getAttributeNS(W, 'id') === '1')!.getElementsByTagNameNS(W, 'p')[0]!.appendChild(fieldRun);
    revisedArchive.setFile('word/footnotes.xml', serialize(part));
    const revised = await revisedArchive.save();
    const compared = await compareDocuments(original, revised);
    const states = await runLibreOfficeOracle([
      { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
      { op: 'accept', docx: compared.document, saveAs: 'odt' }, { op: 'reject', docx: compared.document, saveAs: 'odt' },
    ]);
    const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
    const bodies = (xml: string) => Array.from(parseXml(xml).getElementsByTagNameNS(T, 'note-body')).map(n => n.textContent);
    expect(bodies(states[2]!)).toEqual(bodies(states[1]!));
    expect(bodies(states[3]!)).toEqual(bodies(states[0]!));
  }, 180_000);
});
