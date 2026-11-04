import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { DocxDocument, parseXml, type ParagraphSpec } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from '../compile.js';
import { importDocxToMarkdoc } from '../import.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import { PAGE_NUMBER_FIELD, comparePdfWords, projectSourceText, type PdfWordComparison, type SourceProjection } from './oracle.js';

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

/** Move the footnote reference out of `from` and into `to`, splitting `to`'s first text run at `offset`. */
function moveReference(from: ParagraphSpec, to: ParagraphSpec, offset: number): void {
  const reference = from.runs.find((run) => run.kind === 'footnote')!;
  from.runs = from.runs.filter((run) => run !== reference);
  const [first, ...rest] = to.runs;
  if (first?.kind !== 'text') throw new Error('expected a text run first');
  to.runs = [{ ...first, text: first.text.slice(0, offset) }, reference, { ...first, text: first.text.slice(offset) }, ...rest];
}

async function verificationFailure(promise: Promise<unknown>): Promise<CreationCertificate> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught as { code?: string; details?: unknown });
  expect(error?.code).toBe('CREATION_VERIFICATION_FAILED');
  return error!.details as CreationCertificate;
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

  test.openspec('[SDX-MDOC-FOOTNOTE-04] footnote numbers in split table rows, repeated headers and pages holding only a continued note')(
    'Scenario: footnote numbers in split table rows, repeated headers and pages holding only a continued note',
    async () => {
      const note = [{ id: 'a', paragraphs: ['Note text.'] }];
      // A row whose cells split across two pages: "Alpha beta" and "Gamma delta", printed as "Alpha Gamma" then "beta delta".
      const row = (marks: Partial<Record<2 | 3, number[]>>): SourceProjection => ({
        footers: [null],
        footnotes: note,
        body: [
          { text: 'Left', table: { id: 0, row: 0 } },
          { text: 'Right', table: { id: 0, row: 0 } },
          { text: 'Alpha beta', table: { id: 0, row: 1 }, ...(marks[2] ? { footnoteMarks: marks[2] } : {}) },
          { text: 'Gamma delta', table: { id: 0, row: 1 }, ...(marks[3] ? { footnoteMarks: marks[3] } : {}) },
        ],
      });
      // The mark is printed in the second fragment, so the note starts on page 2; on page 1 it is a wrong page.
      const late = row({ 3: [11] });
      expect(comparePdfWords(late, ['Left Right Alpha Gamma', 'Left Right beta delta1 1 Note text.'])).toMatchObject({ passed: true, footnoteMismatches: [], knownGenerated: { splitRows: [{ table: 0, row: 1, pages: [1, 2] }] } });
      expect(comparePdfWords(late, ['Left Right Alpha Gamma 1 Note text.', 'Left Right beta delta1']).footnoteMismatches)
        .toEqual([expect.objectContaining({ note: 1, page: 1, reason: 'the note starts on page 1 but its reference is on page 2' })]);
      const early = row({ 2: [5] });
      expect(comparePdfWords(early, ['Left Right Alpha1 Gamma 1 Note text.', 'Left Right beta delta']).passed).toBe(true);
      expect(comparePdfWords(early, ['Left Right Alpha1 Gamma', 'Left Right beta delta 1 Note text.']).footnoteMismatches)
        .toEqual([expect.objectContaining({ note: 1, page: 2, reason: 'the note starts on page 2 but its reference is on page 1' })]);

      // LibreOffice repeats a header row without its footnote number.
      const header: SourceProjection = {
        footers: [null],
        footnotes: note,
        body: [{ text: 'Term', footnoteMarks: [4], table: { id: 0, row: 0 } }, { text: 'First', table: { id: 0, row: 1 } }, { text: 'Second', table: { id: 0, row: 2 } }],
      };
      expect(comparePdfWords(header, ['Term1 First 1 Note text.', 'Term Second'])).toMatchObject({ passed: true, knownGenerated: { repeatedTableHeaders: [{ page: 2, table: 0 }] } });
      expect(comparePdfWords(header, ['Term1 First 1 Note text.', 'Term1 Second']).passed).toBe(false);

      // Pages that hold only the rest of a note: they keep the footer of the content before them.
      const anchored: SourceProjection = { body: [{ text: 'Anchor', footnoteMarks: [6] }], footers: [['Draft', PAGE_NUMBER_FIELD]], footnotes: [{ id: 'a', paragraphs: ['First second third fourth five six.'] }] };
      expect(comparePdfWords(anchored, ['Draft 1 Anchor1 1 First second', 'Draft 2 third fourth five six.'])).toMatchObject({ passed: true, knownGenerated: { footnoteAreas: ['1 First second', 'third fourth five six.'] } });
      expect(comparePdfWords(anchored, ['Draft 1 Anchor1 1 First second', 'Draft 2 third fourth', 'Draft 3 five six.']).passed).toBe(true);
      // Negative controls: an empty page, and a continuation page under another footer.
      expect(comparePdfWords(anchored, ['Draft 1 Anchor1 1 First second third fourth five six.', 'Draft 2']).passed).toBe(false);
      expect(comparePdfWords(anchored, ['Draft 1 Anchor1 1 First second', 'Other 2 third fourth five six.']).passed).toBe(false);
      const sections: SourceProjection = {
        body: [{ text: 'Anchor', footnoteMarks: [6], section: 0 }, { text: 'Next', section: 1 }],
        footers: [['A'], ['B']],
        footnotes: [{ id: 'a', paragraphs: ['First second third.'] }],
      };
      expect(comparePdfWords(sections, ['A Anchor1 1 First second', 'A third.', 'B Next']).passed).toBe(true);
      // The continuation belongs to the section before: under the next section's footer it fails.
      expect(comparePdfWords(sections, ['A Anchor1 1 First second', 'B third.', 'B Next']).passed).toBe(false);
    },
  );

  test.openspec('[SDX-MDOC-FOOTNOTE-07] the PDF word check accepts punctuation that pdftotext splits from a footnote number')(
    'Scenario: the PDF word check accepts punctuation that pdftotext splits from a footnote number',
    async () => {
      const source = projectSourceText([
        '---', 'footer: Draft', '---', '',
        'The Closing{% fnref id="a" /%}. Costs{% fnref id="b" /%}, fees{% fnref id="c" /%}; taxes{% fnref id="d" /%}: (as defined{% fnref id="e" /%}) apply.', '',
        '1. The Price{% fnref id="f" /%}. {% #price %}', '',
        '{% footnote id="a" %}Closing note.{% /footnote %}', '',
        '{% footnote id="b" %}Costs note.{% /footnote %}', '',
        '{% footnote id="c" %}Fees as in Section {% xref to="price" /%}; nothing else.{% /footnote %}', '',
        '{% footnote id="d" %}Taxes note.{% /footnote %}', '',
        '{% footnote id="e" %}Defined note.{% /footnote %}', '',
        '{% footnote id="f" %}See Section {% xref to="price" /%}.{% /footnote %}',
      ].join('\n'), { reader: 'libreoffice' });
      const notes = '1\nClosing note.\n2\nCosts note.\n3\nFees as in Section 1; nothing else.\n4\nTaxes note.\n5\nDefined note.\n6\nSee Section 1.\n';
      const body = (clause: string, item = 'The Price6 .') => `Draft\n${clause}\n1.\n${item}\n${notes}`;
      // pdftotext -raw breaks the word after the superscript number when punctuation follows on the baseline.
      const split = 'The Closing1 . Costs2 , fees3 ; taxes4 : (as defined5 ) apply.';
      const result = comparePdfWords(source, [body(split)]);
      expect(result).toMatchObject({ passed: true, missing: [], unexplainedExtra: [], footnoteMismatches: [] });
      expect(result.knownGenerated.markSplits).toEqual(['Closing1 .', 'Costs2 ,', 'fees3 ;', 'taxes4 :', 'defined5 )', 'Price6 .'].map((words) => ({ page: 1, words })));
      // The word read whole still passes, and so does a mix of the two forms.
      expect(comparePdfWords(source, [body('The Closing1. Costs2, fees3; taxes4: (as defined5) apply.', 'The Price6.')])).toMatchObject({ passed: true, knownGenerated: { markSplits: [] } });
      expect(comparePdfWords(source, [body('The Closing1. Costs2 , fees3; taxes4 : (as defined5) apply.')]).passed).toBe(true);

      // Negative controls: punctuation dropped, changed, doubled, or moved before the number; a split that is not
      // right after a footnote number; the number lost with the punctuation kept.
      for (const wrong of [
        'The Closing1 Costs2 , fees3 ; taxes4 : (as defined5 ) apply.',
        'The Closing1 , Costs2 , fees3 ; taxes4 : (as defined5 ) apply.',
        'The Closing1 . Costs2 , fees3 : taxes4 : (as defined5 ) apply.',
        'The Closing1 . . Costs2 , fees3 ; taxes4 : (as defined5 ) apply.',
        'The Closing.1 Costs2 , fees3 ; taxes4 : (as defined5 ) apply.',
        'The Closing1 . Costs2 , fees3 ; taxes4 : (as defined5 apply.',
        'The Clos ing1. Costs2 , fees3 ; taxes4 : (as defined5 ) apply.',
        'The Closing . Costs2 , fees3 ; taxes4 : (as defined5 ) apply.',
      ]) {
        expect(comparePdfWords(source, [body(wrong)]).passed, wrong).toBe(false);
      }
      expect(comparePdfWords(source, [body(split, 'The Price6 ,')]).passed).toBe(false);
      expect(comparePdfWords(source, [body(split, 'The Price6')]).passed).toBe(false);
      // A footnote that holds a cross-reference followed by punctuation must keep it.
      expect(comparePdfWords(source, [body(split).replace('Section 1; nothing', 'Section 1 nothing')]).passed).toBe(false);
    },
  );

  test.openspec('[SDX-MDOC-FOOTNOTE-06] the round trip checks where each reference sits against the source')(
    'Scenario: the round trip checks where each reference sits against the source',
    async () => {
      const source = 'Alpha beta{% fnref id="a" /%} gamma.\n\n{% footnote id="a" %}Note words.{% /footnote %}';
      const clean = await createDocumentFromMarkdoc(source);
      expect(clean.certificate.checks.roundTrip.footnotes?.references).toEqual({ passed: true, mismatches: [], negativeControlDetected: true });

      // A lowering defect that moves the reference and projects the moved place consistently still fails.
      const moved = await verificationFailure(createDocumentFromMarkdoc(source, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks[0] as ParagraphSpec;
          paragraph.runs = [...paragraph.runs.filter((run) => run.kind === 'footnote'), ...paragraph.runs.filter((run) => run.kind !== 'footnote')];
          lowering.projection.footnoteReferences[0]!.offset = 0;
          return lowering;
        },
      }));
      expect(moved.checks.readback.passed).toBe(true);
      expect(moved.checks.footnotes.passed).toBe(true);
      expect(moved.checks.roundTrip.footnotes?.references.mismatches).toEqual([{ note: 1, expected: 'paragraph 1: Alpha beta‸ gamma.', actual: 'paragraph 1: ‸Alpha beta gamma.' }]);

      // Two notes with the same text: swapping where they are referenced is still caught.
      const twins = 'One{% fnref id="a" /%} two{% fnref id="b" /%}.\n\n{% footnote id="a" %}Same.{% /footnote %}\n\n{% footnote id="b" %}Same.{% /footnote %}';
      expect((await createDocumentFromMarkdoc(twins)).certificate.passed).toBe(true);
      const bunched = await verificationFailure(createDocumentFromMarkdoc(twins, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks[0] as ParagraphSpec;
          const notes = paragraph.runs.filter((run) => run.kind === 'footnote');
          const text = paragraph.runs.filter((run) => run.kind !== 'footnote');
          paragraph.runs = [text[0]!, ...notes, ...text.slice(1)];
          lowering.projection.footnoteReferences[1]!.offset = 3;
          return lowering;
        },
      }));
      expect(bunched.checks.roundTrip.footnotes?.references.mismatches).toEqual([{ note: 2, expected: 'paragraph 1: One two‸.', actual: 'paragraph 1: One‸ two.' }]);

      // Moving a reference into another paragraph with the same text, at the same offset, is caught: the
      // paragraph occurrence is part of the place. Likewise between table cells with the same text.
      const note = '\n\n{% footnote id="a" %}Note words.{% /footnote %}';
      const twinParagraphs = `Alpha{% fnref id="a" /%} beta.\n\nAlpha beta.${note}`;
      expect((await createDocumentFromMarkdoc(twinParagraphs)).certificate.passed).toBe(true);
      const elsewhere = await verificationFailure(createDocumentFromMarkdoc(twinParagraphs, {
        transformLowering(lowering) {
          const blocks = lowering.spec.sections[0]!.blocks as ParagraphSpec[];
          moveReference(blocks[0]!, blocks[1]!, 5);
          lowering.projection.footnoteReferences[0]!.paragraph = 1;
          return lowering;
        },
      }));
      expect(elsewhere.checks.readback.passed).toBe(true);
      expect(elsewhere.checks.roundTrip.footnotes?.references.mismatches).toEqual([{ note: 1, expected: 'paragraph 1: Alpha‸ beta.', actual: 'paragraph 2: Alpha‸ beta.' }]);
      const twinCells = `{% table %}\n* Heading\n---\n* Alpha{% fnref id="a" /%} beta.\n---\n* Alpha beta.\n{% /table %}${note}`;
      expect((await createDocumentFromMarkdoc(twinCells)).certificate.passed).toBe(true);
      const otherCell = await verificationFailure(createDocumentFromMarkdoc(twinCells, {
        transformLowering(lowering) {
          const table = lowering.spec.sections[0]!.blocks.find((block) => block.kind === 'table')!;
          const cell = (row: number) => table.rows[row]!.cells[0]!.blocks[0] as ParagraphSpec;
          moveReference(cell(1), cell(2), 5);
          lowering.projection.footnoteReferences[0]!.paragraph += 1;
          return lowering;
        },
      }));
      expect(otherCell.checks.readback.passed).toBe(true);
      expect(otherCell.checks.roundTrip.footnotes?.references.mismatches).toEqual([{ note: 1, expected: 'paragraph 2: Alpha‸ beta.', actual: 'paragraph 3: Alpha‸ beta.' }]);

      // A literal caret in the source does not let a moved reference compare equal: places are compared field by field.
      const caret = `Alpha‸{% fnref id="a" /%} beta.${note}`;
      expect((await createDocumentFromMarkdoc(caret)).certificate.passed).toBe(true);
      const acrossCaret = await verificationFailure(createDocumentFromMarkdoc(caret, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks[0] as ParagraphSpec;
          moveReference(paragraph, paragraph, 5);
          lowering.projection.footnoteReferences[0]!.offset = 5;
          return lowering;
        },
      }));
      expect(acrossCaret.checks.roundTrip.footnotes?.references.passed).toBe(false);
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

      // Complex-script bold and italic twins are admitted only where they change nothing: on complex-script
      // text (Devanagari, Thai) import fails closed rather than dropping them.
      for (const [text, twin, admitted] of [['Hello', 'bCs', true], ['Hello', 'iCs', true], ['नमस्ते', 'bCs', false], ['สวัสดี', 'iCs', false], ['مرحبا', 'bCs', false]] as const) {
        const plain = await createDocumentFromMarkdoc(`Body{% fnref id="a" /%}.\n\n{% footnote id="a" %}${text}{% /footnote %}`);
        const zip = await JSZip.loadAsync(plain.docx);
        const xml = await zip.file('word/footnotes.xml')!.async('string');
        const run = `<w:t xml:space="preserve">${text}</w:t>`;
        expect(xml).toContain(run);
        zip.file('word/footnotes.xml', xml.replace(run, `<w:rPr><w:${twin}/></w:rPr>${run}`));
        const result = await importDocxToMarkdoc(await zip.generateAsync({ type: 'nodebuffer' })).then(() => 'imported', (error: { code?: string }) => error.code);
        expect(result, `${twin} on ${text}`).toBe(admitted ? 'imported' : 'ANNOTATION_IMPORT_UNSUPPORTED');
      }
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

        // A note referenced from the last paragraph runs on to a page with no body text; a note in a repeated
        // header row (LibreOffice repeats the row without the number) and one in a row split across pages.
        const tail = path.join(dir, 'tail.mdoc');
        await writeFile(tail, [
          '---', 'footer: Draft', 'page-numbers: true', '---', '',
          ...filler.slice(0, 8),
          'The final clause{% fnref id="tail" /%} ends the body.', '',
          `{% footnote id="tail" %}${guidance} ${guidance}{% /footnote %}`,
        ].join('\n'));
        const continued = await runCreateCommand([tail, path.join(dir, 'out'), '--require-pdf']);
        expect(continued.pdf).toMatchObject({ status: 'passed', words: { passed: true, footnoteMismatches: [] } });
        const continuedAreas = (continued.pdf as { words: { knownGenerated: { footnoteAreas: string[] } } }).words.knownGenerated.footnoteAreas;
        expect(continuedAreas.length).toBeGreaterThanOrEqual(2);
        expect(continuedAreas.at(-1)).toMatch(/^[^1]/u);

        const rows = Array.from({ length: 70 }, (_, index) => ['---', `* Holder ${index + 1}`, `* Description ${index + 1} ordinary terms apply.`]).flat();
        const words = (prefix: string) => Array.from({ length: 150 }, (_, index) => `${prefix}${index}`).join(' ');
        const tables = path.join(dir, 'tables.mdoc');
        await writeFile(tables, [
          '---', 'footer: Draft', 'page-numbers: true', '---', '', '# TABLE', '',
          '{% table widths="30,70" %}', '* Holder{% fnref id="holder" /%}', '* Description', ...rows, '{% /table %}', '',
          '{% footnote id="holder" %}Holders as of the record date.{% /footnote %}', '',
          'A row split across pages:', '',
          '{% table %}', '* L', '* R', '---', `* ${words('left')}{% fnref id="split" /%}`, `* ${words('right')}`, '{% /table %}', '',
          '{% footnote id="split" %}Split row note.{% /footnote %}', '', 'After.',
        ].join('\n'));
        const table = await runCreateCommand([tables, path.join(dir, 'out'), '--require-pdf']);
        expect(table.pdf).toMatchObject({ status: 'passed', words: { passed: true, footnoteMismatches: [], knownGenerated: { repeatedTableHeaders: expect.arrayContaining([{ page: 2, table: 0 }]) } } });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test.openspec('[SDX-MDOC-FOOTNOTE-07] a real LibreOffice PDF of references followed by punctuation passes the word check')(
    'Scenario: a real LibreOffice PDF of references followed by punctuation passes the word check',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-fnref-punctuation-'));
      try {
        const file = path.join(dir, 'punctuation.mdoc');
        await writeFile(file, [
          '---', 'title: Footnote Punctuation', 'footer: Draft', 'page-numbers: true', '---', '',
          'The parties will complete the Closing{% fnref id="a" /%}. Each party bears its own costs{% fnref id="b" /%}, except as stated; the Buyer pays the fees{% fnref id="c" /%}; the Seller pays the taxes{% fnref id="d" /%}: transfer taxes only (as defined{% fnref id="e" /%}) apply.', '',
          '1. The Purchase Price{% fnref id="f" /%}. {% #price %}', '2. The Escrow{% fnref id="g" /%}, held by the agent.', '',
          '{% table %}', '* Term', '* Meaning', '---', '* Cap{% fnref id="h" /%}.', '* The limit (see note{% fnref id="i" /%}).', '{% /table %}', '',
          '{% footnote id="a" %}The Closing occurs on the Closing Date (see Section {% xref to="price" /%}).{% /footnote %}', '',
          '{% footnote id="b" %}Including counsel fees.{% /footnote %}', '',
          '{% footnote id="c" %}Fees as in Section {% xref to="price" /%}; nothing else.{% /footnote %}', '',
          '{% footnote id="d" %}Taxes: as in Section {% xref to="price" /%}: only these.{% /footnote %}', '',
          '{% footnote id="e" %}Defined below.{% /footnote %}', '',
          '{% footnote id="f" %}Subject to adjustment.{% /footnote %}', '',
          '{% footnote id="g" %}Escrow terms, see Section {% xref to="price" /%}, apply.{% /footnote %}', '',
          '{% footnote id="h" %}The cap.{% /footnote %}', '',
          '{% footnote id="i" %}The limit note.{% /footnote %}',
        ].join('\n'));
        const result = await runCreateCommand([file, path.join(dir, 'out'), '--require-pdf']);
        expect(result.pdf).toMatchObject({ status: 'passed', words: { passed: true, missing: [], unexplainedExtra: [], footnoteMismatches: [] } });
        // Whatever this LibreOffice and pdftotext split, every split joined back is a reference followed by punctuation.
        const splits = (result.pdf as { words: PdfWordComparison }).words.knownGenerated.markSplits;
        for (const { words } of splits) expect(words).toMatch(/^\S*\d [.,;:)]+$/u);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
