import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptChanges, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Pipeline Auxiliary Note Merge' });

const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-renumbered-note-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function coreProject(xml: string, project: typeof acceptChanges | typeof rejectChanges): string {
  const doc = parseXml(xml);
  project(doc);
  return serializeXml(doc);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type Kind = 'footnote' | 'endnote';
interface Para { text: string; notes?: Array<{ kind: Kind; id: number; text: string }> }

function notesPart(kind: Kind, paragraphs: Para[]): string {
  const entries = paragraphs.flatMap((p) => p.notes ?? []).filter((n) => n.kind === kind)
    .map((n) => `<w:${kind} w:id="${n.id}"><w:p><w:r><w:t>${n.text}</w:t></w:r></w:p></w:${kind}>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s xmlns:w="${W}">` +
    `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>` +
    `${entries}</w:${kind}s>`;
}

async function build(paragraphs: Para[]): Promise<Buffer> {
  const bodyXml = paragraphs.map((p) => `<w:p><w:r><w:t>${p.text}</w:t></w:r>` +
    (p.notes ?? []).map((n) => `<w:r><w:${n.kind}Reference w:id="${n.id}"/></w:r>`).join('') + '</w:p>').join('');
  const zip = await JSZip.loadAsync(await buildDocxFromBodyXml(bodyXml));
  const rels = 'word/_rels/document.xml.rels';
  const relsXml = (await zip.file(rels)?.async('string')) ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  zip.file(rels, relsXml.replace('</Relationships>',
    `<Relationship Id="rIdFn" Type="${relType}footnotes" Target="footnotes.xml"/>` +
    `<Relationship Id="rIdEn" Type="${relType}endnotes" Target="endnotes.xml"/></Relationships>`));
  const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
  const types = (await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>',
    `<Override PartName="/word/footnotes.xml" ContentType="${contentType}footnotes+xml"/>` +
    `<Override PartName="/word/endnotes.xml" ContentType="${contentType}endnotes+xml"/></Types>`);
  zip.file('[Content_Types].xml', types);
  zip.file('word/footnotes.xml', notesPart('footnote', paragraphs));
  zip.file('word/endnotes.xml', notesPart('endnote', paragraphs));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function parts(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  const read = async (path: string) => (await zip.file(path)?.async('string')) ?? '';
  return { document: await read('word/document.xml'), footnotes: await read('word/footnotes.xml'), endnotes: await read('word/endnotes.xml') };
}

/** Each reference of the kind, in order, with its tracked state and its note's projected text. */
function anchors(documentXml: string, notesXml: string, kind: Kind): Array<{ state: string; text: string }> {
  const doc = new DOMParser().parseFromString(documentXml, 'text/xml');
  const notes = new DOMParser().parseFromString(notesXml, 'text/xml');
  const bodies = new Map(Array.from(notes.getElementsByTagName(`w:${kind}`))
    .map((n) => [n.getAttribute('w:id'), n.textContent ?? '']));
  return Array.from(doc.getElementsByTagName(`w:${kind}Reference`)).map((ref) => {
    let state = 'live';
    for (let node = ref.parentNode; node; node = node.parentNode) {
      if (node.nodeName === 'w:ins') state = 'ins';
      if (node.nodeName === 'w:del') state = 'del';
    }
    return { state, text: bodies.get(ref.getAttribute('w:id')) ?? '<missing>' };
  });
}

function projectedTexts(documentXml: string, notesXml: string, kind: Kind): string[] {
  return anchors(documentXml, notesXml, kind).map((a) => a.text);
}

async function compareAndCheck(original: Para[], revised: Para[], kind: Kind) {
  const result = await compareDocumentsAtomizer(await build(original), await build(revised), {
    moveDetection: { detectMoves: false },
  });
  const p = await parts(result.document);
  const notesXml = kind === 'footnote' ? p.footnotes : p.endnotes;
  const expectText = (paras: Para[]) => paras.flatMap((x) => x.notes ?? []).filter((n) => n.kind === kind).map((n) => n.text);
  expect(projectedTexts(acceptAllChanges(p.document), acceptAllChanges(notesXml), kind)).toEqual(expectText(revised));
  expect(projectedTexts(rejectAllChanges(p.document), rejectAllChanges(notesXml), kind)).toEqual(expectText(original));
  expect(projectedTexts(coreProject(p.document, acceptChanges), coreProject(notesXml, acceptChanges), kind)).toEqual(expectText(revised));
  expect(projectedTexts(coreProject(p.document, rejectChanges), coreProject(notesXml, rejectChanges), kind)).toEqual(expectText(original));
  await assertSchema(result.document);
  return { result, anchors: anchors(p.document, notesXml, kind), notesXml };
}

describe('renumbered but unchanged notes pair with their counterparts', () => {
  for (const kind of ['footnote', 'endnote'] as const) {
    test(`a renumbered ${kind} linking to a bookmark that moved keeps the original target on Reject`, async ({ given, when, then }: AllureBddContext) => {
      const withBookmarkLink = async (docx: Buffer, text: string, first: boolean): Promise<Buffer> => {
        const zip = await JSZip.loadAsync(docx);
        const path = `word/${kind}s.xml`;
        const xml = await zip.file(path)!.async('string');
        zip.file(path, xml.replace('<w:r><w:t>First note</w:t></w:r>', '<w:hyperlink w:anchor="Target"><w:r><w:t>First note</w:t></w:r></w:hyperlink>'));
        const documentXml = await zip.file('word/document.xml')!.async('string');
        const target = `<w:p><w:bookmarkStart w:id="9" w:name="Target"/><w:r><w:t>${text}</w:t></w:r><w:bookmarkEnd w:id="9"/></w:p>`;
        zip.file('word/document.xml', first ? documentXml.replace('<w:body>', `<w:body>${target}`) : documentXml.replace('<w:sectPr/>', `${target}<w:sectPr/>`));
        return zip.generateAsync({ type: 'nodebuffer' });
      };
      let original!: Buffer;
      let revised!: Buffer;
      let result!: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;
      await given('a note renumbered from 1 to 2 whose identical internal hyperlink names a bookmark that moved', async () => {
        original = await withBookmarkLink(await build([{ text: 'Alpha text.', notes: [{ kind, id: 1, text: 'First note' }] }]), 'Old target paragraph', true);
        revised = await withBookmarkLink(await build([{ text: 'Alpha text.', notes: [{ kind, id: 2, text: 'First note' }] }]), 'Replacement location', false);
      });
      await when('the documents are compared', async () => {
        result = await compareDocumentsAtomizer(original, revised, { moveDetection: { detectMoves: false } });
      });
      await then('Reject links the note to the original bookmark paragraph', async () => {
        const zip = await JSZip.loadAsync(result.document);
        const documentXml = await zip.file('word/document.xml')!.async('string');
        const notesXml = await zip.file(`word/${kind}s.xml`)!.async('string');
        for (const [projectDocument, projectNotes] of [
          [rejectAllChanges(documentXml), rejectAllChanges(notesXml)],
          [coreProject(documentXml, rejectChanges), coreProject(notesXml, rejectChanges)],
        ] as const) {
          const anchor = parseXml(projectNotes).getElementsByTagNameNS(W, 'hyperlink')[0]?.getAttributeNS(W, 'anchor');
          const bookmark = Array.from(parseXml(projectDocument).getElementsByTagNameNS(W, 'bookmarkStart')).find((b) => b.getAttributeNS(W, 'name') === anchor);
          expect(bookmark?.parentNode?.textContent).toBe('Old target paragraph');
        }
        await assertSchema(result.document);
      });
    });
  }

  for (const kind of ['footnote', 'endnote'] as const) {
    test(`a renumbered ${kind} whose comment changed keeps the original comment on Reject`, async ({ given, when, then }: AllureBddContext) => {
      const withComment = async (docx: Buffer, text: string): Promise<Buffer> => {
        const zip = await JSZip.loadAsync(docx);
        const path = `word/${kind}s.xml`;
        const xml = await zip.file(path)!.async('string');
        zip.file(path, xml.replace('<w:r><w:t>First note</w:t></w:r>',
          '<w:commentRangeStart w:id="1"/><w:r><w:t>First note</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>'));
        zip.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Tester"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:comment></w:comments>`);
        const rels = 'word/_rels/document.xml.rels';
        zip.file(rels, (await zip.file(rels)!.async('string')).replace('</Relationships>',
          '<Relationship Id="rIdComment" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>'));
        zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>',
          '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'));
        return zip.generateAsync({ type: 'nodebuffer' });
      };
      let original!: Buffer;
      let revised!: Buffer;
      let result!: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;
      await given('a note renumbered from 1 to 2 whose identical comment anchors name different comment text', async () => {
        original = await withComment(await build([{ text: 'Alpha text.', notes: [{ kind, id: 1, text: 'First note' }] }]), 'Original comment');
        revised = await withComment(await build([{ text: 'Alpha text.', notes: [{ kind, id: 2, text: 'First note' }] }]), 'Revised comment');
      });
      await when('the documents are compared', async () => {
        result = await compareDocumentsAtomizer(original, revised, { moveDetection: { detectMoves: false } });
      });
      await then('Reject anchors the original comment text', async () => {
        const zip = await JSZip.loadAsync(result.document);
        const notes = parseXml(rejectAllChanges(await zip.file(`word/${kind}s.xml`)!.async('string')));
        const comments = parseXml(await zip.file('word/comments.xml')!.async('string'));
        const id = notes.getElementsByTagNameNS(W, 'commentReference')[0]?.getAttributeNS(W, 'id');
        const text = Array.from(comments.getElementsByTagNameNS(W, 'comment')).find((c) => c.getAttributeNS(W, 'id') === id)?.textContent;
        expect(text).toBe('Original comment');
        await assertSchema(result.document);
      });
    });
  }

  for (const [kind, prefix] of [['footnote', ''], ['endnote', ''], ['footnote', 'pr:']] as const) {
    test(`a renumbered ${kind} whose hyperlink target changed keeps both targets${prefix ? ' (prefixed relationships)' : ''}`, async ({ given, when, then }: AllureBddContext) => {
      const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const withLink = async (docx: Buffer, url: string): Promise<Buffer> => {
        const zip = await JSZip.loadAsync(docx);
        const path = `word/${kind}s.xml`;
        const xml = await zip.file(path)!.async('string');
        zip.file(path, xml.replace('<w:r><w:t>First note</w:t></w:r>',
          `<w:hyperlink xmlns:r="${R}" r:id="rIdLink"><w:r><w:t>First note</w:t></w:r></w:hyperlink>`));
        zip.file(`word/_rels/${kind}s.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<${prefix}Relationships xmlns${prefix ? ':' + prefix.slice(0, -1) : ''}="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<${prefix}Relationship Id="rIdLink" Type="${R}/hyperlink" Target="${url}" TargetMode="External"/></${prefix}Relationships>`);
        return zip.generateAsync({ type: 'nodebuffer' });
      };
      let original!: Buffer;
      let revised!: Buffer;
      let result!: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;
      await given('a note renumbered from 1 to 2 whose identical hyperlink XML resolves to a different URL on each side', async () => {
        original = await withLink(await build([{ text: 'Alpha text.', notes: [{ kind, id: 1, text: 'First note' }] }]), 'https://original.example/');
        revised = await withLink(await build([{ text: 'Alpha text.', notes: [{ kind, id: 2, text: 'First note' }] }]), 'https://revised.example/');
      });
      await when('the documents are compared', async () => {
        result = await compareDocumentsAtomizer(original, revised, { moveDetection: { detectMoves: false } });
      });
      await then('Reject resolves the link to the original URL and Accept to the revised URL', async () => {
        const zip = await JSZip.loadAsync(result.document);
        const notesXml = await zip.file(`word/${kind}s.xml`)!.async('string');
        const rels = parseXml(await zip.file(`word/_rels/${kind}s.xml.rels`)!.async('string'));
        const relationships = rels.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship');
        const target = (projected: string): string | null | undefined => {
          const id = parseXml(projected).getElementsByTagNameNS(W, 'hyperlink')[0]?.getAttributeNS(R, 'id');
          return Array.from(relationships).find((r) => r.getAttribute('Id') === id)?.getAttribute('Target');
        };
        expect(target(rejectAllChanges(notesXml))).toBe('https://original.example/');
        expect(target(acceptAllChanges(notesXml))).toBe('https://revised.example/');
        await assertSchema(result.document);
      });
    });
  }

  test('footnotes and endnotes renumber independently in one document', async ({ given, when, then }: AllureBddContext) => {
    let original: Para[] = [];
    let revised: Para[] = [];
    await given('a document whose footnotes and endnotes both shift', () => {
      original = [{ text: 'Alpha text.', notes: [{ kind: 'footnote', id: 1, text: 'Foot A' }, { kind: 'endnote', id: 1, text: 'End A' }] }];
      revised = [{ text: 'Alpha text.', notes: [
        { kind: 'footnote', id: 1, text: 'Foot new' }, { kind: 'footnote', id: 2, text: 'Foot A' },
        { kind: 'endnote', id: 1, text: 'End new' }, { kind: 'endnote', id: 2, text: 'End A' },
      ] }];
    });
    await when('the documents are compared', () => undefined);
    await then('each kind tracks only its inserted note', async () => {
      for (const kind of ['footnote', 'endnote'] as const) {
        const outcome = await compareAndCheck(original, revised, kind);
        expect(outcome.anchors.map((a) => a.state)).toEqual(['ins', 'live']);
      }
    });
  });

  for (const kind of ['footnote', 'endnote'] as const) {
    test(`a ${kind} inserted before others leaves the renumbered ${kind}s untracked`, async ({ given, when, then }: AllureBddContext) => {
      let original: Para[] = [];
      let revised: Para[] = [];
      let outcome!: Awaited<ReturnType<typeof compareAndCheck>>;
      await given('two notes, then a new note inserted ahead of both so their ids shift', () => {
        original = [
          { text: 'Alpha paragraph text.', notes: [{ kind, id: 1, text: 'First note' }] },
          { text: 'Beta paragraph text.', notes: [{ kind, id: 2, text: 'Second note' }] },
        ];
        revised = [
          { text: 'New lead paragraph.', notes: [{ kind, id: 1, text: 'Inserted note' }] },
          { text: 'Alpha paragraph text.', notes: [{ kind, id: 2, text: 'First note' }] },
          { text: 'Beta paragraph text.', notes: [{ kind, id: 3, text: 'Second note' }] },
        ];
      });
      await when('the documents are compared', async () => {
        outcome = await compareAndCheck(original, revised, kind);
      });
      await then('only the new note is inserted and the shifted notes stay live', () => {
        testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
        expect(outcome.anchors).toEqual([
          { state: 'ins', text: 'Inserted note' },
          { state: 'live', text: 'First note' },
          { state: 'live', text: 'Second note' },
        ]);
      });
    });

    const n = (id: number, text: string) => ({ kind, id, text });
    const scenarios: Array<{ name: string; original: Para[]; revised: Para[]; expected: Array<{ state: string; text: string }> }> = [
      {
        name: `a ${kind} inserted ahead of two in the same paragraph`,
        original: [{ text: 'Alpha text.', notes: [n(1, 'First note'), n(2, 'Second note')] }],
        revised: [{ text: 'Alpha text.', notes: [n(1, 'Inserted note'), n(2, 'First note'), n(3, 'Second note')] }],
        expected: [{ state: 'ins', text: 'Inserted note' }, { state: 'live', text: 'First note' }, { state: 'live', text: 'Second note' }],
      },
      {
        name: `the first of three ${kind}s in one paragraph deleted`,
        original: [{ text: 'Alpha text.', notes: [n(1, 'Gone note'), n(2, 'First note'), n(3, 'Second note')] }],
        revised: [{ text: 'Alpha text.', notes: [n(1, 'First note'), n(2, 'Second note')] }],
        expected: [{ state: 'del', text: 'Gone note' }, { state: 'live', text: 'First note' }, { state: 'live', text: 'Second note' }],
      },
      {
        name: `an earlier paragraph's ${kind} deleted`,
        original: [{ text: 'Lead.', notes: [n(1, 'Gone note')] }, { text: 'Alpha text.', notes: [n(2, 'First note')] }, { text: 'Beta text.', notes: [n(3, 'Second note')] }],
        revised: [{ text: 'Lead.' }, { text: 'Alpha text.', notes: [n(1, 'First note')] }, { text: 'Beta text.', notes: [n(2, 'Second note')] }],
        expected: [{ state: 'del', text: 'Gone note' }, { state: 'live', text: 'First note' }, { state: 'live', text: 'Second note' }],
      },
      {
        name: `a renumbered ${kind} that was also edited`,
        original: [{ text: 'Alpha text.', notes: [n(1, 'First note'), n(2, 'Second note')] }],
        revised: [{ text: 'Alpha text.', notes: [n(1, 'Inserted note'), n(2, 'First note'), n(3, 'Second note edited')] }],
        expected: [],
      },
      {
        name: `two ${kind}s swapped between paragraphs`,
        original: [{ text: 'Alpha text.', notes: [n(1, 'First note')] }, { text: 'Beta text.', notes: [n(2, 'Second note')] }],
        revised: [{ text: 'Beta text.', notes: [n(1, 'Second note')] }, { text: 'Alpha text.', notes: [n(2, 'First note')] }],
        expected: [],
      },
    ];
    for (const scenario of scenarios) {
      test(`${scenario.name} redlines only the real change`, async ({ given, when, then }: AllureBddContext) => {
        let outcome!: Awaited<ReturnType<typeof compareAndCheck>>;
        await given(scenario.name, () => undefined);
        await when('the documents are compared', async () => {
          outcome = await compareAndCheck(scenario.original, scenario.revised, kind);
        });
        await then('both acceptors reproduce each side and unchanged notes stay live', () => {
          if (scenario.expected.length > 0) expect(outcome.anchors).toEqual(scenario.expected);
        });
      });
    }
  }
});
