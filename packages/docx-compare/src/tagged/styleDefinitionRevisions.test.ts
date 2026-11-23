import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { XMLSerializer } from '@xmldom/xmldom';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptChanges, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { testAllure } from '../testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Pipeline Auxiliary Note Merge' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
type Story = 'body' | 'footnote' | 'endnote';

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-style-defs-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

interface StyleSide { jc: string; bold: boolean; fontSize?: string; priorRecord?: boolean }

function stylesXml(side: StyleSide): string {
  const record = side.priorRecord
    ? '<w:pPrChange w:id="900" w:author="Prior Editor" w:date="2020-01-01T00:00:00Z"><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrChange>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>${side.fontSize ? `<w:sz w:val="${side.fontSize}"/>` : ''}</w:rPr></w:rPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:styleId="NoteText"><w:name w:val="Note Text"/><w:pPr><w:jc w:val="${side.jc}"/>${record}</w:pPr></w:style>` +
    `<w:style w:type="character" w:styleId="NoteChar"><w:name w:val="Note Char"/><w:rPr>${side.bold ? '<w:b/>' : '<w:i/>'}</w:rPr></w:style>` +
    `</w:styles>`;
}

/** A package whose story `styled` carries pStyle NoteText / rStyle NoteChar; `edit` changes one body word. */
async function build(styles: StyleSide, styled: Story, edit: string, noteId = 1): Promise<Buffer> {
  const pStyle = '<w:pPr><w:pStyle w:val="NoteText"/></w:pPr>';
  const run = (text: string, on: boolean) => `<w:r>${on ? '<w:rPr><w:rStyle w:val="NoteChar"/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>`;
  const body = `<w:p>${styled === 'body' ? pStyle : ''}${run('Styled body text', styled === 'body')}</w:p>` +
    `<w:p><w:r><w:t>Plain ${edit}</w:t></w:r><w:r><w:footnoteReference w:id="${noteId}"/></w:r><w:r><w:endnoteReference w:id="${noteId}"/></w:r></w:p>`;
  const zip = await JSZip.loadAsync(await buildDocxFromBodyXml(body));
  const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const rels = (await zip.file('word/_rels/document.xml.rels')!.async('string')).replace('</Relationships>',
    `<Relationship Id="rIdFn" Type="${relType}footnotes" Target="footnotes.xml"/>` +
    `<Relationship Id="rIdEn" Type="${relType}endnotes" Target="endnotes.xml"/>` +
    `<Relationship Id="rIdSt" Type="${relType}styles" Target="styles.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', rels);
  const ct = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>',
    `<Override PartName="/word/footnotes.xml" ContentType="${ct}footnotes+xml"/>` +
    `<Override PartName="/word/endnotes.xml" ContentType="${ct}endnotes+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${ct}styles+xml"/></Types>`));
  zip.file('word/styles.xml', stylesXml(styles));
  for (const kind of ['footnote', 'endnote'] as const) {
    zip.file(`word/${kind}s.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s xmlns:w="${W}">` +
      `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
      `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>` +
      `<w:${kind} w:id="${noteId}"><w:p>${styled === kind ? pStyle : ''}${run('Note text', styled === kind)}</w:p></w:${kind}></w:${kind}s>`);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Each definition's properties, as the reader resolves the style chain. */
function definitions(xml: string): Record<string, string> {
  const root = parseXml(xml).documentElement;
  const out: Record<string, string> = {};
  const show = (element: Element | undefined): string => (element ? new XMLSerializer().serializeToString(element).replace(/ xmlns:w="[^"]*"/gu, '') : '');
  const first = (parent: Element | undefined, name: string): Element | undefined =>
    parent ? Array.from(parent.childNodes).find((n): n is Element => n.nodeType === 1 && (n as Element).localName === name) : undefined;
  out.defaults = show(first(first(first(root, 'docDefaults'), 'rPrDefault'), 'rPr'));
  for (const style of Array.from(root.getElementsByTagNameNS(W, 'style'))) {
    const id = style.getAttributeNS(W, 'styleId')!;
    out[`${id}.pPr`] = show(first(style, 'pPr'));
    out[`${id}.rPr`] = show(first(style, 'rPr'));
  }
  return out;
}

const coreProject = (xml: string, project: typeof acceptChanges | typeof rejectChanges): string => {
  const doc = parseXml(xml);
  project(doc);
  return serializeXml(doc);
};

async function stylesOf(docx: Buffer): Promise<string> {
  return (await JSZip.loadAsync(docx)).file('word/styles.xml')!.async('string');
}

async function expectProjections(compared: Buffer, original: Buffer, revised: Buffer): Promise<string> {
  const styles = await stylesOf(compared);
  const expectedOriginal = definitions(rejectAllChanges(await stylesOf(original)));
  const expectedRevised = definitions(acceptAllChanges(await stylesOf(revised)));
  expect(definitions(rejectAllChanges(styles))).toEqual(expectedOriginal);
  expect(definitions(acceptAllChanges(styles))).toEqual(expectedRevised);
  expect(definitions(coreProject(styles, rejectChanges))).toEqual(expectedOriginal);
  expect(definitions(coreProject(styles, acceptChanges))).toEqual(expectedRevised);
  await assertSchema(compared);
  return styles;
}

const ORIGINAL: StyleSide = { jc: 'left', bold: false, fontSize: '20' };
const REVISED: StyleSide = { jc: 'right', bold: true, fontSize: '24' };

describe('style references that resolve to different definitions on each side (#1578)', () => {
  for (const story of ['footnote', 'endnote', 'body'] as const) {
    for (const noteId of [1, 2]) {
      test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' })(
        `a ${story} whose identical pStyle/rStyle resolves differently${noteId === 2 ? ' (note renumbered)' : ''} keeps the original definitions on Reject`,
        async () => {
          const original = await build(ORIGINAL, story, 'old');
          const revised = await build(REVISED, story, 'new', noteId);
          const result = await compareDocumentsAtomizer(original, revised, { moveDetection: { detectMoves: false } });
          const styles = await expectProjections(result.document, original, revised);
          const root = parseXml(styles);
          expect(root.getElementsByTagNameNS(W, 'pPrChange')).toHaveLength(1);
          expect(root.getElementsByTagNameNS(W, 'rPrChange')).toHaveLength(2);
        },
      );
    }
  }

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.31' })('leaves the styles part untouched when the definitions match', async () => {
    const original = await build(ORIGINAL, 'footnote', 'old');
    const revised = await build(ORIGINAL, 'footnote', 'new');
    const result = await compareDocumentsAtomizer(original, revised, { moveDetection: { detectMoves: false } });
    expect(await stylesOf(result.document)).toBe(await stylesOf(revised));
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' })('keeps a prior style record and its author when the current properties are unchanged', async () => {
    const original = await build({ ...ORIGINAL, jc: 'right', priorRecord: true }, 'endnote', 'old');
    const revised = await build({ ...ORIGINAL, jc: 'right' }, 'endnote', 'new');
    const result = await compareDocumentsAtomizer(original, revised, { moveDetection: { detectMoves: false } });
    const styles = await expectProjections(result.document, original, revised);
    const records = parseXml(styles).getElementsByTagNameNS(W, 'pPrChange');
    expect(records).toHaveLength(1);
    expect(records[0]!.getAttributeNS(W, 'author')).toBe('Prior Editor');
  });

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' })('records the original Reject projection when the original style has a prior record', async () => {
    const original = await build({ ...ORIGINAL, priorRecord: true }, 'footnote', 'old');
    const revised = await build(REVISED, 'footnote', 'new');
    const result = await compareDocumentsAtomizer(original, revised, { moveDetection: { detectMoves: false } });
    await expectProjections(result.document, original, revised);
  });

  test('records nothing when format detection is off', async () => {
    const original = await build(ORIGINAL, 'footnote', 'old');
    const revised = await build(REVISED, 'footnote', 'new');
    const result = await compareDocumentsAtomizer(original, revised, {
      moveDetection: { detectMoves: false },
      formatDetection: { detectFormatChanges: false },
    });
    expect(await stylesOf(result.document)).toBe(await stylesOf(revised));
  });
});
