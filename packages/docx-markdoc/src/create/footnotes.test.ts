import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { DocxDocument, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from '../compile.js';
import { importDocxToMarkdoc } from '../import.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc } from './create.js';
import { comparePdfWords, projectSourceText } from './oracle.js';

const TEST_FEATURE = 'add-generated-document-footnotes';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1237 footnotes in created documents',
  severity: 'critical',
});
const conforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.10' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const ANNOTATED_SOURCE = [
  '---',
  'footer: Annotated Draft',
  'page-numbers: true',
  '---',
  '',
  '# STOCK PURCHASE AGREEMENT',
  '',
  'This Agreement{% fnref id="intro" /%} is entered into by the parties named below.',
  '',
  '{% footnote id="intro" %}',
  'This form is annotated. The notes are **guidance** only.',
  '',
  'A second paragraph of the note, with {% u %}underlined{% /u %} and *italic* words.',
  '{% /footnote %}',
  '',
  '1. The Buyer shall pay the {% fill %}Purchase Price{% /fill %}{% fnref id="price" /%} at Closing.',
  '',
  '{% footnote id="price" %}See the {% fill %}Pricing Schedule{% /fill %} for adjustments.{% /footnote %}',
  '',
  '{% table %}',
  '* Term',
  '---',
  '* Escrow{% fnref id="escrow" /%}',
  '{% /table %}',
  '',
  '{% footnote id="escrow" %}Held for twelve months.{% /footnote %}',
].join('\n');

function wChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName);
}

async function part(docx: Buffer, name: string): Promise<Document> {
  return parseXml(await (await JSZip.loadAsync(docx)).file(name)!.async('string'));
}

async function failure(source: string): Promise<{ code?: string; message: string; details?: { line?: number } } | undefined> {
  return createDocumentFromMarkdoc(source).then(() => undefined, (error: { code?: string; message: string; details?: { line?: number } }) => error);
}

describe('Traceability: footnotes in created documents', () => {
  conforming.openspec('[SDX-MDOC-FOOTNOTE-01] a reference tag and a footnote block create a numbered footnote')(
    'Scenario: a reference tag and a footnote block create a numbered footnote',
    async () => {
      const created = await createDocumentFromMarkdoc(ANNOTATED_SOURCE);
      expect(created.certificate.passed).toBe(true);
      expect(created.certificate.checks.footnotes).toEqual({ passed: true, notes: 3, negativeControlDetected: true });
      expect(created.certificate.checks.roundTrip.footnotes).toMatchObject({ comparison: { passed: true }, notes: { expected: 3, actual: 3 }, negativeControlDetected: true });

      // Body references, in order, as FootnoteReference runs; the footnote blocks leave no body paragraph behind.
      const document = await part(created.docx, 'word/document.xml');
      const references = Array.from(document.getElementsByTagNameNS(W, 'footnoteReference'));
      expect(references.map((reference) => reference.getAttributeNS(W, 'id'))).toEqual(['1', '2', '3']);
      expect(created.readback.paragraphs).toEqual([
        'STOCK PURCHASE AGREEMENT',
        'This Agreement is entered into by the parties named below.',
        'The Buyer shall pay the [Purchase Price] at Closing.',
        'Term',
        'Escrow',
        // The empty paragraph Word needs after a document-ending table.
        '',
      ]);
      expect(created.readback.footnoteReferences).toEqual([{ paragraph: 1, offset: 14 }, { paragraph: 2, offset: 40 }, { paragraph: 4, offset: 6 }]);
      expect(created.readback.footnotes).toEqual([
        [' This form is annotated. The notes are guidance only.', 'A second paragraph of the note, with underlined and italic words.'],
        [' See the [Pricing Schedule] for adjustments.'],
        [' Held for twelve months.'],
      ]);

      // Note bodies carry their inline formatting, and the fill keeps its highlight.
      const notes = Array.from((await part(created.docx, 'word/footnotes.xml')).getElementsByTagNameNS(W, 'footnote')).filter((note) => !note.getAttributeNS(W, 'type'));
      const formatting = (run: Element) => {
        const rPr = wChildren(run, 'rPr')[0];
        return ['b', 'i', 'u', 'highlight'].filter((name) => rPr && wChildren(rPr, name).length > 0).join(',');
      };
      const runs = (note: Element, p: number) => wChildren(wChildren(note, 'p')[p]!, 'r')
        .map((run) => [wChildren(run, 't').map((t) => t.textContent).join(''), formatting(run)])
        .filter(([text]) => text);
      expect(runs(notes[0]!, 0)).toEqual([[' ', ''], ['This form is annotated. The notes are ', ''], ['guidance', 'b'], [' only.', '']]);
      expect(runs(notes[0]!, 1)).toEqual([['A second paragraph of the note, with ', ''], ['underlined', 'u'], [' and ', ''], ['italic', 'i'], [' words.', '']]);
      expect(runs(notes[1]!, 0)).toEqual([[' ', ''], ['See the ', ''], ['[Pricing Schedule]', 'highlight'], [' for adjustments.', '']]);
      for (const note of notes) {
        for (const paragraph of wChildren(note, 'p')) {
          expect(wChildren(wChildren(paragraph, 'pPr')[0]!, 'pStyle')[0]!.getAttributeNS(W, 'val')).toBe('FootnoteText');
        }
      }
      // The text mirror is built from the read-back, so the notes appear there too.
      expect(created.text.split('Footnotes:\n\n')[1]).toBe([
        '[1] This form is annotated. The notes are guidance only.\nA second paragraph of the note, with underlined and italic words.',
        '[2] See the [Pricing Schedule] for adjustments.',
        '[3] Held for twelve months.',
      ].join('\n\n') + '\n');
    },
  );

  test.openspec('[SDX-MDOC-FOOTNOTE-02] notes are numbered by reference order, wherever their bodies sit')(
    'Scenario: notes are numbered by reference order, wherever their bodies sit',
    async () => {
      const created = await createDocumentFromMarkdoc([
        '{% footnote id="z" %}Body declared first, referenced second.{% /footnote %}',
        '',
        'First{% fnref id="a" /%} then second{% fnref id="z" /%}.',
        '',
        '{% footnote id="a" %}Referenced first.{% /footnote %}',
      ].join('\n'));
      expect(created.certificate.passed).toBe(true);
      expect(created.readback.footnotes).toEqual([[' Referenced first.'], [' Body declared first, referenced second.']]);
      const loaded = await DocxDocument.load(created.docx);
      expect((await loaded.getFootnotes()).map((note) => [note.displayNumber, note.text])).toEqual([
        [1, ' Referenced first.'],
        [2, ' Body declared first, referenced second.'],
      ]);
      // The CLI summary reports the footnote check, and the text mirror lists the notes.
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-footnote-cli-'));
      try {
        const file = path.join(dir, 'notes.mdoc');
        await writeFile(file, 'Only{% fnref id="1" /%} one.\n\n{% footnote id="1" %}The note.{% /footnote %}\n');
        const result = await runCreateCommand([file, path.join(dir, 'out'), '--no-pdf']);
        expect(result.summary).toContain('footnotes ok (1 note; negative control ok)');
        expect(await readFile(result.outputs.text, 'utf8')).toContain('Footnotes:\n\n[1] The note.\n');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      // A footnote-free source certifies the footnote check as not applicable and adds no footnote part.
      const plain = await createDocumentFromMarkdoc('No notes.');
      expect(plain.certificate.checks.footnotes).toEqual({ passed: true, notes: 0, negativeControlDetected: 'not applicable' });
      expect(plain.certificate.checks.roundTrip.footnotes).toBeUndefined();
      expect((await JSZip.loadAsync(plain.docx)).file('word/footnotes.xml')).toBeNull();
    },
  );

  test.openspec('[SDX-MDOC-FOOTNOTE-03] malformed footnotes fail closed with a code and a line')(
    'Scenario: malformed footnotes fail closed with a code and a line',
    async () => {
      const cases: Array<[string, string, number | undefined]> = [
        ['Text{% fnref /%}.\n\n{% footnote id="1" %}x{% /footnote %}', 'INVALID_FOOTNOTE', 1],
        ['Text{% fnref id="" /%}.', 'INVALID_FOOTNOTE', 1],
        ['Text{% fnref id="1" %}x{% /fnref %}.', 'INVALID_FOOTNOTE', 1],
        ['Text {% literal %}a{% fnref id="1" /%}{% /literal %}.\n\n{% footnote id="1" %}x{% /footnote %}', 'INVALID_FOOTNOTE', 1],
        ['Text {% fill %}a{% fnref id="1" /%}{% /fill %}.\n\n{% footnote id="1" %}x{% /footnote %}', 'INVALID_FOOTNOTE', 1],
        ['Text{% fnref id="1" /%}.\n\n{% footnote id="1" %}{% /footnote %}', 'INVALID_FOOTNOTE', 3],
        ['Text{% fnref id="1" /%}.\n\n{% footnote id="1" %}\nLine one\\\nline two.\n{% /footnote %}', 'INVALID_FOOTNOTE', 4],
        ['Text{% fnref id="1" /%}.\n\n{% footnote id="1" %}\n- a list item\n{% /footnote %}', 'INVALID_FOOTNOTE', 4],
        ['Text{% fnref id="1" /%}.\n\n{% footnote id="1" %}See{% fnref id="2" /%}.{% /footnote %}\n\n{% footnote id="2" %}x{% /footnote %}', 'NESTED_FOOTNOTE', 3],
        ['Text{% fnref id="1" /%}.\n\n{% footnote id="1" %}\n{% footnote id="2" %}x{% /footnote %}\n{% /footnote %}', 'NESTED_FOOTNOTE', 4],
        ['Text{% fnref id="1" /%}.\n\n{% footnote id="1" %}x{% /footnote %}\n\n{% footnote id="1" %}y{% /footnote %}', 'DUPLICATE_FOOTNOTE_ID', 5],
        ['A{% fnref id="1" /%} and B{% fnref id="1" /%}.\n\n{% footnote id="1" %}x{% /footnote %}', 'DUPLICATE_FOOTNOTE_REFERENCE', 1],
        ['Text{% fnref id="missing" /%}.', 'FOOTNOTE_REFERENCE_WITHOUT_BODY', 1],
        ['Text.\n\n{% footnote id="orphan" %}x{% /footnote %}', 'FOOTNOTE_BODY_WITHOUT_REFERENCE', 3],
        ['- Item\n  {% footnote id="1" %}x{% /footnote %}\n\nText{% fnref id="1" /%}.', 'UNSUPPORTED_CREATION_SYNTAX', undefined],
      ];
      for (const [source, code, line] of cases) {
        const error = await failure(source);
        expect(error?.code, source).toBe(code);
        if (line !== undefined) expect(error?.details?.line, source).toBe(line);
      }
    },
  );

  test.openspec('[SDX-MDOC-FOOTNOTE-04] the PDF word check reads each note at the foot of its reference page')(
    'Scenario: the PDF word check reads each note at the foot of its reference page',
    async () => {
      const source = projectSourceText([
        '---', 'footer: Draft', 'page-numbers: true', '---', '',
        'Alpha clause{% fnref id="a" /%} applies.', '',
        '{% footnote id="a" %}First note text continues across the page break.{% /footnote %}', '',
        '{% page-break /%}', '',
        'Beta clause{% fnref id="b" /%} applies.', '',
        '{% footnote id="b" %}Second note.{% /footnote %}',
      ].join('\n'));
      expect(source.footnotes).toEqual([
        { id: 'a', paragraphs: ['First note text continues across the page break.'] },
        { id: 'b', paragraphs: ['Second note.'] },
      ]);
      // LibreOffice: footer region, body (the number glued to the word before it), then the page's footnote area:
      // the rest of a note continued from the page before, then each note that starts on the page.
      const page1 = 'Draft\n1\nAlpha clause1\napplies.\n1\nFirst note text continues\n';
      const page2 = 'Draft\n2\nBeta clause2\napplies.\nacross the page break.\n2\nSecond note.\n';
      expect(comparePdfWords(source, [page1, page2])).toMatchObject({
        passed: true,
        missing: [],
        unexplainedExtra: [],
        footnoteMismatches: [],
        knownGenerated: { footnoteAreas: ['1 First note text continues', 'across the page break. 2 Second note.'] },
      });

      // Negative controls: a note word lost, a note set on the wrong page, notes out of order, a reference number lost.
      expect(comparePdfWords(source, [page1, page2.replace('Second note.', 'Second.')]).passed).toBe(false);
      const moved = comparePdfWords(source, ['Draft\n1\nAlpha clause1\napplies.\n', 'Draft\n2\nBeta clause2\napplies.\n1\nFirst note text continues across the page break.\n2\nSecond note.\n']);
      expect(moved.passed).toBe(false);
      expect(moved.footnoteMismatches).toContainEqual(expect.objectContaining({ note: 1, page: 2, reason: expect.stringMatching(/reference is on page 1/) }));
      const swapped = comparePdfWords(source, ['Draft\n1\nAlpha clause1\napplies.\n', 'Draft\n2\nBeta clause2\napplies.\n2\nSecond note.\n1\nFirst note text continues across the page break.\n']);
      expect(swapped.passed).toBe(false);
      expect(swapped.footnoteMismatches.length).toBeGreaterThan(0);
      expect(comparePdfWords(source, [page1.replace('clause1', 'clause'), page2]).passed).toBe(false);
    },
  );

  conforming.openspec('[SDX-MDOC-FOOTNOTE-05] created footnotes survive import and compile')(
    'Scenario: created footnotes survive import and compile',
    async () => {
      const created = await createDocumentFromMarkdoc(ANNOTATED_SOURCE);
      const imported = await importDocxToMarkdoc(created.docx);
      const annotations = imported.markdoc.split('\n').filter((line) => line.includes('source-presentation="footnote"'));
      expect(annotations).toHaveLength(3);
      const compiled = await compileMarkdoc(imported.anchoredSource, imported.markdoc, { annotationPresentation: { unspecified: { as: 'preserve' } } });
      const view = async (docx: Buffer) => (await (await DocxDocument.load(docx)).getFootnotes())
        .map((note) => ({ number: note.displayNumber, paragraphs: note.paragraphs.map((paragraph) => [paragraph.style, paragraph.tagged_text]) }));
      const before = await view(created.docx);
      expect(before.map((note) => note.paragraphs.map(([style]) => style))).toEqual([['FootnoteText', 'FootnoteText'], ['FootnoteText'], ['FootnoteText']]);
      expect(await view(compiled.tracked)).toEqual(before);
    },
  );
});

const realTools = defaultPdfRenderTools();
const describeWithLibreOffice = realTools.resolve('soffice') && realTools.resolve('pdftotext') ? describe : describe.skip;

describeWithLibreOffice('Traceability: footnotes in a real LibreOffice PDF', () => {
  test.openspec('[SDX-MDOC-FOOTNOTE-04] a real LibreOffice PDF with a note spanning pages passes the word check')(
    'Scenario: a real LibreOffice PDF with a note spanning pages passes the word check',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-footnotes-'));
      try {
        const guidance = Array.from({ length: 80 }, (_, index) => `Guidance sentence ${index + 1} explains how to adapt the clause.`).join(' ');
        const filler = Array.from({ length: 12 }, (_, index) => [`Filler paragraph ${index + 1} keeps the body text going.`, '']).flat();
        const file = path.join(dir, 'annotated.mdoc');
        await writeFile(file, [
          '---', 'footer: Annotated Draft', 'page-numbers: true', '---', '',
          '# ANNOTATED FORM', '',
          ...filler,
          'The Buyer shall pay{% fnref id="pay" /%} at Closing.', '',
          `{% footnote id="pay" %}${guidance}{% /footnote %}`, '',
          'The Seller shall deliver{% fnref id="deliver" /%} the Shares.', '',
          '{% footnote id="deliver" %}', 'A **short** note.', '', 'Its *second* paragraph.', '{% /footnote %}',
        ].join('\n'));
        const result = await runCreateCommand([file, path.join(dir, 'out'), '--require-pdf']);
        expect(result.summary).toContain('footnotes ok (2 notes; negative control ok)');
        expect(result.pdf).toMatchObject({ status: 'passed', words: { passed: true, missing: [], unexplainedExtra: [], footnoteMismatches: [] } });
        const areas = (result.pdf as { pageCount: number; words: { knownGenerated: { footnoteAreas: string[] } } });
        expect(areas.pageCount).toBeGreaterThanOrEqual(2);
        // The long note starts on page 1 and continues at the foot of page 2.
        expect(areas.words.knownGenerated.footnoteAreas[0]).toMatch(/^1 Guidance sentence 1 /u);
        expect(areas.words.knownGenerated.footnoteAreas[1]).toMatch(/^\S/u);
        expect(areas.words.knownGenerated.footnoteAreas[1]).not.toMatch(/^1 /u);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
