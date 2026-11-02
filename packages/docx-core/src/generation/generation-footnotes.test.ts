import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DocxDocument } from '../primitives/document.js';
import { childElements, getDirectChildrenByName } from '../primitives/dom-helpers.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { BlockSpec, DocumentSpec, FootnoteSpec, InlineSpec, ParagraphSpec, StyleSpec } from './types.js';

const TEST_FEATURE = 'add-generated-document-footnotes';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.10' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.13' });
const partConforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.15' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.23' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.1' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.12' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.9' });

const FOOTNOTES_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const FOOTNOTES_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';

function text(value: string, extra: Partial<Extract<InlineSpec, { kind: 'text' }>> = {}): InlineSpec {
  return { kind: 'text', text: value, ...extra };
}

function paragraph(runs: InlineSpec[], extra: Partial<ParagraphSpec> = {}): ParagraphSpec {
  return { kind: 'paragraph', runs, ...extra };
}

function footnote(...blocks: ParagraphSpec[]): FootnoteSpec {
  return { kind: 'footnote', blocks };
}

function single(blocks: BlockSpec[], extra: Partial<DocumentSpec> = {}): DocumentSpec {
  return { meta: { createdIso: '2026-11-02T00:00:00Z' }, ...extra, sections: [{ blocks }] };
}

/** A plain note, a formatted two-paragraph note, and a note referenced from a table cell. */
function annotatedSpec(): DocumentSpec {
  return single([
    paragraph([text('The Company'), footnote(paragraph([text('Plain note.')])), text(' shall indemnify.')]),
    paragraph([
      text('Losses'),
      footnote(
        paragraph([text('Bold', { bold: true }), text(' and '), text('italic', { italic: true }), text(' and '), text('underlined', { underline: 'single' }), text('.')]),
        paragraph([text('A second paragraph of the same note.')]),
      ),
      text(' are capped.'),
    ]),
    {
      kind: 'table',
      columnWidthsTwips: [4000],
      rows: [{ cells: [{ blocks: [paragraph([text('Cell'), footnote(paragraph([text('Note from a table cell.')]))])] }] }],
    },
  ]);
}

function validateAgainstSchema(parts: Record<string, string>): void {
  const dir = mkdtempSync(resolve(tmpdir(), 'safe-docx-footnotes-'));
  try {
    const schema = resolve(process.cwd(), '../../spec-compliance/ecma-376/validation/wml-document-transitional.xsd');
    const files = Object.entries(parts).map(([name, xml]) => {
      const path = resolve(dir, name);
      writeFileSync(path, xml);
      return path;
    });
    const result = spawnSync('xmllint', ['--noout', '--nonet', '--schema', schema, ...files], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function elements(root: Document | Element, qualifiedName: string): Element[] {
  return Array.from(root.getElementsByTagName(qualifiedName));
}

function wVal(parent: Element, localName: string): string | null | undefined {
  const found = getDirectChildrenByName(parent, localName)[0];
  return found ? found.getAttribute('w:val') : undefined;
}

function runText(run: Element): string {
  return elements(run, 'w:t').map((t) => t.textContent ?? '').join('');
}

function userNotes(footnotesXml: string): Element[] {
  return elements(parseXml(footnotesXml), 'w:footnote').filter((note) => !note.getAttribute('w:type'));
}

function styleById(stylesXml: string, styleId: string): Element | undefined {
  return elements(parseXml(stylesXml), 'w:style').find((style) => style.getAttribute('w:styleId') === styleId);
}

async function specError(spec: DocumentSpec): Promise<GenerationSpecError> {
  const error = await generateDocx(spec).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GenerationSpecError);
  return error as GenerationSpecError;
}

describe('Traceability: generated documents carry footnotes', () => {
  conforming.openspec('[SDX-GEN-118] footnote inlines emit numbered references and FootnoteText note bodies')(
    'Scenario: footnote inlines emit numbered references and FootnoteText note bodies',
    async ({ given, when, then, attachPrettyJson, attachPrettyXml }: AllureBddContext) => {
      let spec!: DocumentSpec;
      await given('a spec with a plain note, a formatted two-paragraph note, and a note in a table cell', async () => {
        spec = annotatedSpec();
        await attachPrettyJson('spec', spec);
      });

      let buffer!: Buffer;
      let documentXml!: string;
      let footnotesXml!: string;
      await when('the document is generated', async () => {
        buffer = await generateDocx(spec);
        documentXml = (await readZipText(buffer, 'word/document.xml'))!;
        footnotesXml = (await readZipText(buffer, 'word/footnotes.xml'))!;
        await attachPrettyXml('word/footnotes.xml', footnotesXml);
      });

      await then('the package passes the structural check and is byte-identical when regenerated', async () => {
        expect((await checkGeneratedPackage(buffer)).issues).toEqual([]);
        expect(Buffer.compare(buffer, await generateDocx(spec))).toBe(0);
      });

      await then('each reference is a FootnoteReference superscript run naming ids 1, 2, 3 in document order', async () => {
        const references = elements(parseXml(documentXml), 'w:footnoteReference');
        expect(references.map((reference) => reference.getAttribute('w:id'))).toEqual(['1', '2', '3']);
        for (const reference of references) {
          const run = reference.parentNode as Element;
          expect(run.nodeName).toBe('w:r');
          const rPr = getDirectChildrenByName(run, 'rPr')[0]!;
          expect(wVal(rPr, 'rStyle')).toBe('FootnoteReference');
          expect(wVal(rPr, 'vertAlign')).toBe('superscript');
        }
        const firstParagraph = elements(parseXml(documentXml), 'w:p')[0]!;
        expect(childElements(firstParagraph).map((run) => runText(run) || run.getElementsByTagName('w:footnoteReference').length))
          .toEqual(['The Company', 1, ' shall indemnify.']);
      });

      await then('each note body opens with the footnoteRef mark and a space, and every paragraph is FootnoteText', async () => {
        const notes = userNotes(footnotesXml);
        expect(notes.map((note) => note.getAttribute('w:id'))).toEqual(['1', '2', '3']);
        expect(notes.map((note) => getDirectChildrenByName(note, 'p').length)).toEqual([1, 2, 1]);
        for (const note of notes) {
          const paragraphs = getDirectChildrenByName(note, 'p');
          for (const p of paragraphs) {
            expect(wVal(getDirectChildrenByName(p, 'pPr')[0]!, 'pStyle')).toBe('FootnoteText');
          }
          const [markRun, spaceRun] = getDirectChildrenByName(paragraphs[0]!, 'r');
          expect(markRun!.getElementsByTagName('w:footnoteRef')).toHaveLength(1);
          expect(wVal(getDirectChildrenByName(markRun!, 'rPr')[0]!, 'rStyle')).toBe('FootnoteReference');
          expect(runText(spaceRun!)).toBe(' ');
        }
        const formatted = getDirectChildrenByName(getDirectChildrenByName(notes[1]!, 'p')[0]!, 'r').slice(2);
        const flags = formatted.map((run) => {
          const rPr = getDirectChildrenByName(run, 'rPr')[0];
          return [runText(run), rPr ? ['b', 'i', 'u'].filter((name) => getDirectChildrenByName(rPr, name).length > 0).join('') : ''];
        });
        expect(flags).toEqual([['Bold', 'b'], [' and ', ''], ['italic', 'i'], [' and ', ''], ['underlined', 'u'], ['.', '']]);
        expect(getDirectChildrenByName(getDirectChildrenByName(notes[1]!, 'p')[1]!, 'r').map(runText)).toEqual(['A second paragraph of the same note.']);
      });

      await then('the document, footnotes, styles and settings parts validate against the transitional WML schema', async () => {
        validateAgainstSchema({
          'document.xml': documentXml,
          'footnotes.xml': footnotesXml,
          'styles.xml': (await readZipText(buffer, 'word/styles.xml'))!,
          'settings.xml': (await readZipText(buffer, 'word/settings.xml'))!,
        });
      });
    },
  );

  test.openspec('[SDX-GEN-118] a footnote paragraph keeps a declared paragraph style and list numbering')(
    'Scenario: a footnote paragraph keeps a declared paragraph style and list numbering',
    async () => {
      const spec = single(
        [paragraph([text('Body'), footnote(
          paragraph([text('Styled.')], { styleId: 'NoteQuote' }),
          paragraph([text('Listed.')], { list: { numId: 'notes', ilvl: 0 } }),
        )])],
        {
          styles: [{ styleId: 'NoteQuote', name: 'Note Quote', type: 'paragraph', basedOn: 'Normal', run: { italic: true } }],
          numbering: [{ numId: 'notes', levels: [{ ilvl: 0, numFmt: 'lowerLetter', lvlText: '(%1)' }] }],
        },
      );
      const footnotesXml = (await readZipText(await generateDocx(spec), 'word/footnotes.xml'))!;
      const [first, second] = getDirectChildrenByName(userNotes(footnotesXml)[0]!, 'p');
      expect(wVal(getDirectChildrenByName(first!, 'pPr')[0]!, 'pStyle')).toBe('NoteQuote');
      const secondPPr = getDirectChildrenByName(second!, 'pPr')[0]!;
      expect(wVal(secondPPr, 'pStyle')).toBe('FootnoteText');
      expect(getDirectChildrenByName(secondPPr, 'numPr')).toHaveLength(1);
    },
  );

  partConforming.openspec('[SDX-GEN-119] the footnotes part, settings and styles are added only when a footnote is used')(
    'Scenario: the footnotes part, settings and styles are added only when a footnote is used',
    async ({ given, when, then }: AllureBddContext) => {
      let withNotes!: Buffer;
      let withoutNotes!: Buffer;
      await given('one spec with footnotes and one without', async () => {
        withNotes = await generateDocx(annotatedSpec());
        withoutNotes = await generateDocx({ sections: [{ blocks: [paragraph([text('No notes here.')])], headers: { even: { blocks: [paragraph([text('Even')])] } } }] });
      });

      let contentTypes!: Document;
      let rels!: Document;
      let settings!: Document;
      let stylesXml!: string;
      await when('their package parts are read back', async () => {
        contentTypes = parseXml((await readZipText(withNotes, '[Content_Types].xml'))!);
        rels = parseXml((await readZipText(withNotes, 'word/_rels/document.xml.rels'))!);
        settings = parseXml((await readZipText(withNotes, 'word/settings.xml'))!);
        stylesXml = (await readZipText(withNotes, 'word/styles.xml'))!;
      });

      await then('word/footnotes.xml is registered with its content type and relationship', async () => {
        const override = elements(contentTypes, 'Override').find((element) => element.getAttribute('PartName') === '/word/footnotes.xml');
        expect(override?.getAttribute('ContentType')).toBe(FOOTNOTES_CONTENT_TYPE);
        const relationship = elements(rels, 'Relationship').filter((element) => element.getAttribute('Type') === FOOTNOTES_REL_TYPE);
        expect(relationship.map((element) => element.getAttribute('Target'))).toEqual(['footnotes.xml']);
      });

      await then('the part holds the separator (id -1) and continuation separator (id 0) ahead of the notes', async () => {
        const notes = elements(parseXml((await readZipText(withNotes, 'word/footnotes.xml'))!), 'w:footnote');
        expect(notes.slice(0, 2).map((note) => [note.getAttribute('w:type'), note.getAttribute('w:id')]))
          .toEqual([['separator', '-1'], ['continuationSeparator', '0']]);
        expect(notes[0]!.getElementsByTagName('w:separator')).toHaveLength(1);
        expect(notes[1]!.getElementsByTagName('w:continuationSeparator')).toHaveLength(1);
      });

      await then('settings list both special notes in footnotePr, placed before compat', async () => {
        const children = childElements(settings.documentElement!).map((element) => element.nodeName);
        expect(children.indexOf('w:footnotePr')).toBeGreaterThanOrEqual(0);
        expect(children.indexOf('w:footnotePr')).toBeLessThan(children.indexOf('w:compat'));
        const listed = elements(settings, 'w:footnotePr')[0]!;
        expect(getDirectChildrenByName(listed, 'footnote').map((note) => note.getAttribute('w:id'))).toEqual(['-1', '0']);
      });

      await then('styles gain Word-shaped FootnoteText and FootnoteReference definitions', async () => {
        const textStyle = styleById(stylesXml, 'FootnoteText')!;
        expect(textStyle.getAttribute('w:type')).toBe('paragraph');
        expect(wVal(textStyle, 'name')).toBe('footnote text');
        expect(wVal(textStyle, 'basedOn')).toBe('Normal');
        expect(wVal(getDirectChildrenByName(textStyle, 'rPr')[0]!, 'sz')).toBe('20');
        const spacing = getDirectChildrenByName(getDirectChildrenByName(textStyle, 'pPr')[0]!, 'spacing')[0]!;
        expect([spacing.getAttribute('w:after'), spacing.getAttribute('w:line'), spacing.getAttribute('w:lineRule')]).toEqual(['0', '240', 'auto']);
        const referenceStyle = styleById(stylesXml, 'FootnoteReference')!;
        expect(referenceStyle.getAttribute('w:type')).toBe('character');
        expect(wVal(referenceStyle, 'name')).toBe('footnote reference');
        expect(wVal(getDirectChildrenByName(referenceStyle, 'rPr')[0]!, 'vertAlign')).toBe('superscript');
      });

      await then('a document without footnotes has no footnotes part, relationship, settings entry or footnote styles', async () => {
        expect(await readZipText(withoutNotes, 'word/footnotes.xml')).toBeNull();
        expect((await readZipText(withoutNotes, '[Content_Types].xml'))!).not.toContain('footnotes');
        expect((await readZipText(withoutNotes, 'word/_rels/document.xml.rels'))!).not.toContain(FOOTNOTES_REL_TYPE);
        const plainSettings = parseXml((await readZipText(withoutNotes, 'word/settings.xml'))!);
        expect(elements(plainSettings, 'w:footnotePr')).toHaveLength(0);
        expect(elements(plainSettings, 'w:evenAndOddHeaders')).toHaveLength(1);
        const plainStyles = (await readZipText(withoutNotes, 'word/styles.xml'))!;
        expect(styleById(plainStyles, 'FootnoteText')).toBeUndefined();
        expect(styleById(plainStyles, 'FootnoteReference')).toBeUndefined();
      });
    },
  );

  test.openspec('[SDX-GEN-119] declared footnote styles replace the built-in definitions')(
    'Scenario: declared footnote styles replace the built-in definitions',
    async () => {
      const styles: StyleSpec[] = [
        { styleId: 'FootnoteText', name: 'footnote text', type: 'paragraph', basedOn: 'Normal', run: { sizePt: 9, font: 'Georgia' } },
        { styleId: 'FootnoteReference', name: 'footnote reference', type: 'character', run: { bold: true } },
      ];
      const buffer = await generateDocx(single([paragraph([text('Body'), footnote(paragraph([text('Note.')]))])], { styles }));
      const stylesXml = (await readZipText(buffer, 'word/styles.xml'))!;
      const declared = elements(parseXml(stylesXml), 'w:style').filter((style) => style.getAttribute('w:styleId')?.startsWith('Footnote'));
      expect(declared.map((style) => style.getAttribute('w:styleId'))).toEqual(['FootnoteText', 'FootnoteReference']);
      expect(wVal(getDirectChildrenByName(declared[0]!, 'rPr')[0]!, 'sz')).toBe('18');
      expect(getDirectChildrenByName(getDirectChildrenByName(declared[1]!, 'rPr')[0]!, 'b')).toHaveLength(1);
      // The reference run still states superscript directly, so a redefined style keeps the mark raised.
      const run = elements(parseXml((await readZipText(buffer, 'word/document.xml'))!), 'w:footnoteReference')[0]!.parentNode as Element;
      expect(wVal(getDirectChildrenByName(run, 'rPr')[0]!, 'vertAlign')).toBe('superscript');
      // Only one of the two declared: the other built-in is still supplied.
      const partial = (await readZipText(await generateDocx(single([paragraph([text('Body'), footnote(paragraph([text('Note.')]))])], { styles: [styles[0]!] })), 'word/styles.xml'))!;
      expect(wVal(getDirectChildrenByName(styleById(partial, 'FootnoteText')!, 'rPr')[0]!, 'sz')).toBe('18');
      expect(styleById(partial, 'FootnoteReference')?.getAttribute('w:type')).toBe('character');
    },
  );

  test.openspec('[SDX-GEN-120] invalid footnote specs are rejected before emission')(
    'Scenario: invalid footnote specs are rejected before emission',
    async () => {
      const note = footnote(paragraph([text('Note.')]));
      const cases: Array<[DocumentSpec, string, GenerationSpecError['code'], RegExp]> = [
        [single([paragraph([text('Body'), footnote()])]), '/sections/0/blocks/0/runs/1/blocks', 'invalid_value', /at least one paragraph/],
        [single([paragraph([text('Body'), { kind: 'footnote' } as unknown as FootnoteSpec])]), '/sections/0/blocks/0/runs/1/blocks', 'invalid_value', /at least one paragraph/],
        [single([paragraph([footnote(paragraph([text('Outer'), note]))])]), '/sections/0/blocks/0/runs/0/blocks/0/runs/1', 'invalid_value', /cannot contain another footnote/],
        [single([paragraph([{ kind: 'footnote', blocks: [{ kind: 'table', columnWidthsTwips: [100], rows: [] }] } as unknown as FootnoteSpec])]), '/sections/0/blocks/0/runs/0/blocks/0', 'unsupported_feature', /must be paragraphs/],
        [single([paragraph([footnote(paragraph([text('x')], { pageBreakBefore: true }))])]), '/sections/0/blocks/0/runs/0/blocks/0/pageBreakBefore', 'invalid_value', /cannot start a new page/],
        [single([paragraph([footnote(paragraph([text('x'), { kind: 'break', breakType: 'page' }]))])]), '/sections/0/blocks/0/runs/0/blocks/0/runs/1/breakType', 'invalid_value', /page break/],
        [single([paragraph([footnote(paragraph([text('x')], { note: { text: 'n', author: 'A', dateIso: '2026-01-01T00:00:00Z' } }))])]), '/sections/0/blocks/0/runs/0/blocks/0/note', 'invalid_value', /cannot live in footnotes/],
        [single([paragraph([footnote(paragraph([text('x')], { styleId: 'Missing' }))])]), '/sections/0/blocks/0/runs/0/blocks/0/styleId', 'dangling_style_reference', /Missing/],
        [{ sections: [{ blocks: [paragraph([text('Body')])], headers: { default: { blocks: [paragraph([text('Header'), note])] } } }] }, '/sections/0/headers/default/blocks/0/runs/1', 'invalid_value', /only in the body story/],
        [single([paragraph([text('Body'), note])], { styles: [{ styleId: 'FootnoteText', name: 'Wrong', type: 'character' }] }), '/styles/0/type', 'invalid_value', /type 'paragraph'/],
        [single([paragraph([text('Body'), note])], { styles: [{ styleId: 'FootnoteReference', name: 'Wrong', type: 'paragraph' }] }), '/styles/0/type', 'invalid_value', /type 'character'/],
      ];
      for (const [spec, path, code, message] of cases) {
        const error = await specError(spec);
        expect(error.path, message.source).toBe(path);
        expect(error.code, path).toBe(code);
        expect(error.message, path).toMatch(message);
      }
    },
  );

  test.openspec('[SDX-GEN-120] FootnoteText and FootnoteReference resolve only when the document uses footnotes')(
    'Scenario: FootnoteText and FootnoteReference resolve only when the document uses footnotes',
    async () => {
      const error = await specError(single([paragraph([text('Body')], { styleId: 'FootnoteText' })]));
      expect(error.code).toBe('dangling_style_reference');
      const buffer = await generateDocx(single([
        paragraph([text('Body')], { styleId: 'FootnoteText' }),
        paragraph([text('Ref'), footnote(paragraph([text('Note.')]))]),
      ]));
      expect((await checkGeneratedPackage(buffer)).issues).toEqual([]);
    },
  );

  conforming.openspec('[SDX-GEN-121] generated footnotes read back through getFootnotes and accept add_footnote')(
    'Scenario: generated footnotes read back through getFootnotes and accept add_footnote',
    async ({ given, when, then }: AllureBddContext) => {
      let document!: DocxDocument;
      await given('a generated document with three footnotes, loaded for editing', async () => {
        document = await DocxDocument.load(await generateDocx(annotatedSpec()));
        document.insertParagraphBookmarks('generated-footnotes');
      });

      await then('getFootnotes returns each note with its number, paragraphs, style and reference point', async () => {
        const notes = await document.getFootnotes();
        expect(notes.map((note) => [note.id, note.displayNumber])).toEqual([[1, 1], [2, 2], [3, 3]]);
        expect(notes.map((note) => note.paragraphs.map((p) => p.text))).toEqual([
          [' Plain note.'],
          [' Bold and italic and underlined.', 'A second paragraph of the same note.'],
          [' Note from a table cell.'],
        ]);
        expect(notes.flatMap((note) => note.paragraphs.map((p) => p.style))).toEqual(Array(4).fill('FootnoteText'));
        expect(notes[1]!.paragraphs[0]!.tagged_text).toContain('<b>Bold</b>');
        expect(notes[1]!.paragraphs[0]!.tagged_text).toContain('<i>italic</i>');
        expect(notes[1]!.paragraphs[0]!.tagged_text).toContain('<u>underlined</u>');
        expect(notes.map((note) => note.referencePoints.map((point) => point.textOffset))).toEqual([[11], [6], [4]]);
      });

      let addedId!: number;
      await when('a footnote is added to the first paragraph with add_footnote', async () => {
        const paragraphId = document.buildDocumentView().nodes[0]!.id;
        addedId = (await document.addFootnote({ paragraphId, visibleOffset: 3, text: 'Added later.' })).noteId;
      });

      await then('the added note takes the next id and renumbers by document order after save', async () => {
        expect(addedId).toBe(4);
        const reopened = await DocxDocument.load((await document.toBuffer({ cleanBookmarks: false })).buffer);
        const notes = await reopened.getFootnotes();
        expect(notes.map((note) => [note.id, note.displayNumber, note.text])).toEqual([
          [4, 1, ' Added later.'],
          [1, 2, ' Plain note.'],
          [2, 3, ' Bold and italic and underlined.\nA second paragraph of the same note.'],
          [3, 4, ' Note from a table cell.'],
        ]);
      });
    },
  );

  test.openspec('[SDX-GEN-121] a multi-paragraph note added with add_footnote styles every paragraph FootnoteText')(
    'Scenario: a multi-paragraph note added with add_footnote styles every paragraph FootnoteText',
    async () => {
      const document = await DocxDocument.load(await generateDocx(single([paragraph([text('Alpha beta.')])])));
      document.insertParagraphBookmarks('added-footnote');
      const paragraphId = document.buildDocumentView().nodes[0]!.id;
      await document.addFootnote({
        paragraphId,
        visibleOffset: 5,
        text: 'First',
        presentation: { body: [{ runs: [{ text: 'First' }] }, { runs: [{ text: 'Second' }] }] },
      });
      const reopened = await DocxDocument.load((await document.toBuffer({ cleanBookmarks: false })).buffer);
      const note = (await reopened.getFootnotes())[0]!;
      expect(note.paragraphs.map((p) => [p.text, p.style])).toEqual([[' First', 'FootnoteText'], ['Second', 'FootnoteText']]);
    },
  );
});
