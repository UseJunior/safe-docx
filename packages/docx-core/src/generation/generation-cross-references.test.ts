import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { childElements } from '../primitives/dom-helpers.js';
import { parseNumberingXml, renderReferenceNumber } from '../primitives/numbering.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { refFieldInstruction } from '../testing/ooxml-fixtures.js';
import { BookmarkNameError, bookmarkNameForSlug, bookmarkNamesForSlugs, isWordBookmarkName } from './bookmark-names.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { BlockSpec, DocumentSpec, InlineSpec, NumberingSpec, ParagraphSpec, StyleSpec } from './types.js';

const TEST_FEATURE = 'add-generated-cross-references';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });
const bookmarkConforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' });
const refConforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = path.resolve(__dirname, '../../../../scripts/oracle/word/evidence/issue-1236-word-16.114.json');
const START_VALUE_EVIDENCE_PATH = path.resolve(__dirname, '../../../../scripts/oracle/word/evidence/issue-1254-word-16.114.json');

type Evidence = {
  spec: DocumentSpec;
  references: Array<{ instruction: string; word: string; libreOffice?: string }>;
  wordNativeCrossReferenceInstructions: string[];
  alphabeticPastZ: { numbering: NumberingSpec[]; references: Array<{ instruction: string; word: string }> };
  deeperLevelPlaceholders: { numbering: NumberingSpec; references: Array<{ instruction: string; word: string }> };
};

/** Word's list strings and REF results for paragraphs after skipped levels (#1254); legal probes use LEGAL's levels. */
type StartValueEvidence = {
  fixtures: Record<string, { paragraphs: Array<{ ilvl: number; bookmark: string; word: { listString: string; fullContext: string; paragraph: string } }> }>;
};

const text = (value: string, extra: Partial<Extract<InlineSpec, { kind: 'text' }>> = {}): InlineSpec => ({ kind: 'text', text: value, ...extra });
const ref = (bookmark: string, extra: Partial<Extract<InlineSpec, { kind: 'crossReference' }>> = {}): InlineSpec => ({ kind: 'crossReference', bookmark, ...extra });
const para = (runs: InlineSpec[], extra: Partial<ParagraphSpec> = {}): ParagraphSpec => ({ kind: 'paragraph', runs, ...extra });
const item = (ilvl: number, value: string, extra: Partial<ParagraphSpec> = {}): ParagraphSpec => para([text(value)], { list: { numId: 'legal', ilvl }, ...extra });

const HEADING_STYLES: StyleSpec[] = [
  { styleId: 'Heading1', name: 'heading 1', type: 'paragraph', basedOn: 'Normal', run: { bold: true } },
  { styleId: 'Heading2', name: 'heading 2', type: 'paragraph', basedOn: 'Normal', run: { bold: true } },
];
const LEGAL: NumberingSpec = {
  numId: 'legal',
  levels: [
    { ilvl: 0, numFmt: 'upperRoman', lvlText: 'ARTICLE %1', pStyle: 'Heading1' },
    { ilvl: 1, numFmt: 'decimalZero', lvlText: 'Section %1.%2', isLgl: true, pStyle: 'Heading2' },
    { ilvl: 2, numFmt: 'lowerLetter', lvlText: '(%3)' },
    { ilvl: 3, numFmt: 'lowerRoman', lvlText: '(%4)' },
  ],
};

function doc(blocks: BlockSpec[], extra: Partial<DocumentSpec> = {}): DocumentSpec {
  return { meta: { createdIso: '2026-11-02T00:00:00Z' }, styles: HEADING_STYLES, numbering: [LEGAL], ...extra, sections: [{ blocks }] };
}

/** Article I with Section 1.01, Article II with Sections 2.01 and 2.02(a)/(b), targets bookmarked. */
function agreement(references: BlockSpec[], extra: Partial<DocumentSpec> = {}): DocumentSpec {
  return doc([
    ...references,
    para([text('DEFINITIONS')], { styleId: 'Heading1' }),
    para([text('Defined Terms.')], { styleId: 'Heading2', bookmark: 'defined_terms' }),
    para([text('PURCHASE AND SALE')], { styleId: 'Heading1', bookmark: 'purchase_and_sale' }),
    para([text('Purchase.')], { styleId: 'Heading2' }),
    para([text('Purchase Price Adjustment.')], { styleId: 'Heading2', bookmark: 'purchase_price_adjustment' }),
    item(2, 'first clause.'),
    item(2, 'second clause.', { bookmark: 'adjustment_clause_b' }),
    item(3, 'sub-clause.', { bookmark: 'adjustment_clause_b_i' }),
  ], extra);
}

type ReadField = { instruction: string; result: string; runs: Element[] };

/** Complex fields of a story part in document order, with their instruction, result text and runs. */
function readFields(root: Document): ReadField[] {
  const fields: ReadField[] = [];
  let open: (ReadField & { inResult: boolean }) | null = null;
  for (const run of Array.from(root.getElementsByTagName('w:r'))) {
    const fldChar = run.getElementsByTagName('w:fldChar').item(0);
    const type = fldChar?.getAttribute('w:fldCharType');
    if (type === 'begin') open = { instruction: '', result: '', runs: [], inResult: false };
    if (!open) continue;
    open.runs.push(run);
    if (type === 'separate') open.inResult = true;
    for (const node of Array.from(run.getElementsByTagName('w:instrText'))) open.instruction += node.textContent ?? '';
    if (open.inResult) for (const node of Array.from(run.getElementsByTagName('w:t'))) open.result += node.textContent ?? '';
    if (type === 'end') {
      const { inResult: _inResult, ...field } = open;
      void _inResult;
      fields.push(field);
      open = null;
    }
  }
  return fields;
}

async function parts(buffer: Buffer): Promise<{ document: Document; footnotes: Document | null }> {
  const footnotesXml = await readZipText(buffer, 'word/footnotes.xml');
  return { document: parseXml((await readZipText(buffer, 'word/document.xml'))!), footnotes: footnotesXml ? parseXml(footnotesXml) : null };
}

async function specError(spec: DocumentSpec): Promise<GenerationSpecError> {
  const error = await generateDocx(spec).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GenerationSpecError);
  return error as GenerationSpecError;
}

describe('Traceability: generated cross-references', () => {
  bookmarkConforming.openspec('[SDX-GEN-122] bookmarked paragraphs wrap their content in a bookmark with an annotation id of its own')(
    'Scenario: bookmarked paragraphs wrap their content in a bookmark with an annotation id of its own',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      let spec!: DocumentSpec;
      let buffer!: Buffer;
      await given('a numbered heading with a drafting note and a bookmark, a bookmarked table-cell paragraph and an empty bookmarked list item', async () => {
        spec = doc([
          para([text('Commented heading.')], { styleId: 'Heading2', bookmark: 'commented', note: { text: 'Check this.' } }),
          para([text('Plain commented paragraph.')], { note: { text: 'And this.' } }),
          { kind: 'table', columnWidthsTwips: [4000], rows: [{ cells: [{ blocks: [item(2, 'in a cell', { bookmark: 'in_cell' })] }] }] },
          para([], { list: { numId: 'legal', ilvl: 2 }, bookmark: 'Empty_Item' }),
        ]);
        await attachPrettyJson('spec', spec);
      });
      await when('it is generated', async () => {
        buffer = await generateDocx(spec);
      });
      await then('each bookmark starts after the paragraph properties and ends after the content, around the comment range', async () => {
        const { document } = await parts(buffer);
        const first = document.getElementsByTagName('w:p').item(0)!;
        expect(childElements(first).map((child) => child.localName)).toEqual([
          'pPr', 'bookmarkStart', 'commentRangeStart', 'r', 'commentRangeEnd', 'bookmarkEnd', 'r',
        ]);
        const empty = Array.from(document.getElementsByTagName('w:p')).at(-1)!;
        expect(childElements(empty).map((child) => child.localName)).toEqual(['pPr', 'bookmarkStart', 'bookmarkEnd']);
        const starts = Array.from(document.getElementsByTagName('w:bookmarkStart'));
        expect(starts.map((start) => start.getAttribute('w:name'))).toEqual(['commented', 'in_cell', 'Empty_Item']);
        const ends = Array.from(document.getElementsByTagName('w:bookmarkEnd'));
        expect(ends.map((end) => end.getAttribute('w:id'))).toEqual(starts.map((start) => start.getAttribute('w:id')));
      });
      await and('bookmark and comment ids come from one sequence, so none repeats', async () => {
        const { document } = await parts(buffer);
        const ids = [
          ...Array.from(document.getElementsByTagName('w:bookmarkStart')),
          ...Array.from(document.getElementsByTagName('w:commentRangeStart')),
        ].map((el) => Number(el.getAttribute('w:id')));
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
        const comments = parseXml((await readZipText(buffer, 'word/comments.xml'))!);
        expect(Array.from(comments.getElementsByTagName('w:comment')).map((c) => c.getAttribute('w:id'))).toEqual(['1', '3']);
      });
      await and('the package passes the structural check, including bookmark pairing, and regenerates byte for byte', async () => {
        expect((await checkGeneratedPackage(buffer)).issues).toEqual([]);
        expect(Buffer.compare(buffer, await generateDocx(spec))).toBe(0);
      });
      await and('a spec without bookmarks keeps its comment ids and writes no bookmark', async () => {
        const plain = doc([para([text('One.')], { note: { text: 'n1' } }), para([text('Two.')], { note: { text: 'n2' } })]);
        const { document } = await parts(await generateDocx(plain));
        expect(document.getElementsByTagName('w:bookmarkStart').length).toBe(0);
        expect(Array.from(document.getElementsByTagName('w:commentRangeStart')).map((el) => el.getAttribute('w:id'))).toEqual(['1', '2']);
      });
    },
  );

  refConforming.openspec('[SDX-GEN-123] cross-references emit REF fields whose cached result is the target number')(
    'Scenario: cross-references emit REF fields whose cached result is the target number',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      let spec!: DocumentSpec;
      let buffer!: Buffer;
      await given('references before and after their targets, formatted, with both number forms, in a table cell and in a footnote', async () => {
        spec = agreement([
          para([text('See '), ref('adjustment_clause_b'), text(' and '), ref('adjustment_clause_b', { number: 'paragraph', bold: true }), text('.')]),
          { kind: 'table', columnWidthsTwips: [4000], rows: [{ cells: [{ blocks: [para([ref('purchase_price_adjustment')])] }] }] },
          para([text('Noted'), { kind: 'footnote', blocks: [para([text('As in '), ref('adjustment_clause_b_i'), text('.')])] }]),
        ]);
        spec.sections[0]!.blocks.push(para([text('Back to '), ref('purchase_and_sale', { number: 'fullContext' }), text(' and '), ref('defined_terms', { number: 'paragraph' })]));
        await attachPrettyJson('spec', spec);
      });
      await when('it is generated', async () => {
        buffer = await generateDocx(spec);
      });
      await then('each reference is a five-run REF field naming its bookmark with \\w or \\n and \\h', async () => {
        const { document, footnotes } = await parts(buffer);
        const fields = [...readFields(document), ...readFields(footnotes!)];
        expect(fields.map((field) => field.instruction)).toEqual([
          refFieldInstruction('adjustment_clause_b', 'w'),
          refFieldInstruction('adjustment_clause_b', 'n'),
          refFieldInstruction('purchase_price_adjustment', 'w'),
          refFieldInstruction('purchase_and_sale', 'w'),
          refFieldInstruction('defined_terms', 'n'),
          refFieldInstruction('adjustment_clause_b_i', 'w'),
        ]);
        for (const field of fields) expect(field.runs).toHaveLength(5);
      });
      await and('each cached result is the number Word shows after updating fields', async () => {
        const { document, footnotes } = await parts(buffer);
        expect([...readFields(document), ...readFields(footnotes!)].map((field) => field.result)).toEqual([
          'Section 2.02(b)', '(b)', 'Section 2.02', 'ARTICLE II', 'Section 1.01', 'Section 2.02(b)(i)',
        ]);
      });
      await and('every run of a formatted reference carries its formatting', async () => {
        const { document } = await parts(buffer);
        const bold = readFields(document)[1]!;
        for (const run of bold.runs) expect(run.getElementsByTagName('w:b').length).toBe(1);
      });
      await and('the package passes the structural check and regenerates byte for byte', async () => {
        expect((await checkGeneratedPackage(buffer)).issues).toEqual([]);
        expect(Buffer.compare(buffer, await generateDocx(spec))).toBe(0);
      });
    },
  );

  refConforming.openspec('[SDX-GEN-124] cached results equal Word results for every recorded numbering shape')(
    'Scenario: cached results equal Word results for every recorded numbering shape',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      let evidence!: Evidence;
      let fields!: ReadField[];
      await given('the spec and Word 16.114 after-update results recorded in the #1236 oracle evidence', async () => {
        evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as Evidence;
        expect(evidence.references.length).toBeGreaterThan(90);
        await attachPrettyJson('references', evidence.references);
      });
      await when('the recorded spec is generated again', async () => {
        const buffer = await generateDocx(evidence.spec);
        const { document, footnotes } = await parts(buffer);
        fields = [...readFields(document), ...readFields(footnotes!)];
      });
      await then('every field has the recorded instruction and a cached result equal to what Word showed', async () => {
        expect(fields.map((field) => field.instruction)).toEqual(evidence.references.map((reference) => reference.instruction));
        expect(fields.map((field) => field.result)).toEqual(evidence.references.map((reference) => reference.word));
      });
      await and('the instructions are the ones Word itself writes for a hyperlinked full-context or no-context cross-reference', async () => {
        for (const instruction of evidence.wordNativeCrossReferenceInstructions) {
          expect(fields.map((field) => field.instruction)).toContain(instruction);
        }
      });
      await and('letter numbers past z repeat the letter (aa, bb, zz, aaa), as Word shows them', async () => {
        const { numbering, references } = evidence.alphabeticPastZ;
        const marks = [26, 27, 28, 52, 53];
        const blocks: BlockSpec[] = [];
        const runs: InlineSpec[] = [];
        for (const [numId, prefix] of [['alpha', 'lo'], ['upper', 'up']] as const) {
          blocks.push(para([text('Parent')], { list: { numId, ilvl: 0 } }));
          for (let index = 1; index <= 53; index += 1) {
            blocks.push(para([text(`item ${index}`)], { list: { numId, ilvl: 1 }, ...(marks.includes(index) ? { bookmark: `${prefix}${index}` } : {}) }));
          }
          for (const mark of marks) runs.push(ref(`${prefix}${mark}`), ref(`${prefix}${mark}`, { number: 'paragraph' }));
        }
        const { document } = await parts(await generateDocx(doc([...blocks, para(runs)], { numbering })));
        const generated = readFields(document).map((field) => ({ instruction: field.instruction, word: field.result }));
        expect(generated).toEqual(references);
        expect(generated.map((field) => field.word)).toContain('1(bb)');
      });
      await and('targets after skipped levels carry Word\'s results, ancestors at their start values (#1254 evidence)', async () => {
        const { fixtures } = JSON.parse(readFileSync(START_VALUE_EVIDENCE_PATH, 'utf8')) as StartValueEvidence;
        for (const name of ['legal_orphan_clause', 'legal_section_first', 'legal_l3_after_section', 'legal_l3_first']) {
          const { paragraphs } = fixtures[name]!;
          const blocks = paragraphs.map((p) => item(p.ilvl, p.bookmark, { bookmark: p.bookmark }));
          const runs = paragraphs.flatMap((p) => [ref(p.bookmark), ref(p.bookmark, { number: 'paragraph' })]);
          const { document } = await parts(await generateDocx(doc([...blocks, para(runs)])));
          expect(readFields(document).map((field) => field.result), name).toEqual(paragraphs.flatMap((p) => [p.word.fullContext, p.word.paragraph]));
        }
      });
      await and('a full-context number passes over a silent parent level: deep2 reads "(a)" in both forms, as Word shows it', async () => {
        const { numbering: deep, references } = evidence.deeperLevelPlaceholders;
        const { document } = await parts(await generateDocx(doc([
          para([text('zero')], { list: { numId: 'deep', ilvl: 0 } }),
          para([text('one')], { list: { numId: 'deep', ilvl: 1 } }),
          para([text('two')], { list: { numId: 'deep', ilvl: 2 }, bookmark: 'deep2' }),
          para([ref('deep2'), ref('deep2', { number: 'paragraph' })]),
        ], { numbering: [LEGAL, deep] })));
        const generated = readFields(document).map((field) => ({ instruction: field.instruction, word: field.result }));
        expect(generated).toEqual(references.filter((reference) => reference.instruction.includes('deep2')));
      });
    },
  );

  test.openspec('[SDX-GEN-125] invalid bookmarks and cross-references are rejected')(
    'Scenario: invalid bookmarks and cross-references are rejected',
    async ({ given, then, and }: AllureBddContext) => {
      await given('specs that misuse bookmarks or cross-references', async () => {});
      await then('bookmark names outside Word\'s dialog rules, repeated names and bookmarks outside the body fail at the bookmark', async () => {
        for (const name of ['_hidden', '1st', 'has-hyphen', 'has space', 'a'.repeat(41), '']) {
          const error = await specError(doc([item(2, 'x', { bookmark: name })]));
          expect(error.path).toBe('/sections/0/blocks/0/bookmark');
          expect(error.code).toBe('invalid_value');
        }
        expect((await specError(doc([item(2, 'x', { bookmark: 'a'.repeat(40) }), item(2, 'y', { bookmark: 'Dup' }), item(2, 'z', { bookmark: 'dup' })]))).path)
          .toBe('/sections/0/blocks/2/bookmark');
        const inFootnote = await specError(doc([para([text('x'), { kind: 'footnote', blocks: [para([text('n')], { bookmark: 'note' })] }])]));
        expect(inFootnote.path).toBe('/sections/0/blocks/0/runs/1/blocks/0/bookmark');
        const header = doc([item(2, 'x')]);
        header.sections[0]!.headers = { default: { blocks: [para([text('h')], { bookmark: 'head' })] } };
        expect((await specError(header)).path).toBe('/sections/0/headers/default/blocks/0/bookmark');
      });
      await and('a reference to an undeclared bookmark, in a footer, with an unknown number form or without a name fails at the reference', async () => {
        const dangling = await specError(doc([item(2, 'x', { bookmark: 'target' }), para([ref('Target')])]));
        expect(dangling.code).toBe('dangling_bookmark_reference');
        expect(dangling.path).toBe('/sections/0/blocks/1/runs/0/bookmark');
        const footer = doc([item(2, 'x', { bookmark: 'target' })]);
        footer.sections[0]!.footers = { default: { blocks: [para([ref('target')])] } };
        expect((await specError(footer)).path).toBe('/sections/0/footers/default/blocks/0/runs/0');
        const unknownForm = await specError(doc([item(2, 'x', { bookmark: 'target' }), para([ref('target', { number: 'page' as never })])]));
        expect(unknownForm.path).toBe('/sections/0/blocks/1/runs/0/number');
        expect((await specError(doc([para([ref('' as string)])]))).path).toBe('/sections/0/blocks/0/runs/0/bookmark');
      });
      await and('a target without a list number, whose own level text names a deeper level or no level, or that renders empty fails at its bookmark', async () => {
        const unnumbered = await specError(doc([para([text('Plain.')], { bookmark: 'plain' }), para([ref('plain')])]));
        expect(unnumbered.path).toBe('/sections/0/blocks/0/bookmark');
        expect(unnumbered.message).toMatch(/without a list number/);
        // A level text naming a deeper level: Word shows no number (REF shows 0), so both forms are refused.
        const { numbering: deep } = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')).deeperLevelPlaceholders as Evidence['deeperLevelPlaceholders'];
        for (const [ilvl, number] of [[0, 'paragraph'], [0, 'fullContext'], [1, 'paragraph'], [1, 'fullContext']] as const) {
          const deeper = await specError(doc([
            para([text('zero')], { list: { numId: 'deep', ilvl: 0 }, ...(ilvl === 0 ? { bookmark: 'deep' } : {}) }),
            para([text('one')], { list: { numId: 'deep', ilvl: 1 }, ...(ilvl === 1 ? { bookmark: 'deep' } : {}) }),
            para([text('two')], { list: { numId: 'deep', ilvl: 2 } }),
            para([ref('deep', { number })]),
          ], { numbering: [LEGAL, deep] }));
          expect(deeper.path).toBe(`/sections/0/blocks/${ilvl}/bookmark`);
          expect(deeper.message).toMatch(/names a deeper list level/);
        }
        // A placeholder past %9 names no list level; Word's result for it is not measured.
        const pastNine: NumberingSpec = { numId: 'past', levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.%10' }] };
        const past = await specError(doc([para([text('x')], { list: { numId: 'past', ilvl: 0 }, bookmark: 'past' }), para([ref('past')])], { numbering: [LEGAL, pastNine] }));
        expect(past.message).toMatch(/names no list level/);
        const silent: NumberingSpec = { numId: 'silent', levels: [{ ilvl: 0, numFmt: 'none', lvlText: '%1' }] };
        const empty = await specError(doc([para([text('x')], { list: { numId: 'silent', ilvl: 0 }, bookmark: 'silent' }), para([ref('silent')])], { numbering: [LEGAL, silent] }));
        expect(empty.message).toMatch(/renders as empty text/);
      });
    },
  );

  test.openspec('[SDX-GEN-126] kebab-case ids map to Word bookmark names and colliding ids fail')(
    'Scenario: kebab-case ids map to Word bookmark names and colliding ids fail',
    async ({ given, then, and }: AllureBddContext) => {
      await given('ids short and long', async () => {});
      await then('hyphens become underscores and a long id keeps 31 characters plus an 8-digit hash', async () => {
        expect(bookmarkNameForSlug('purchase-price-adjustment')).toBe('purchase_price_adjustment');
        const long = 'indemnification-escrow-release-mechanics-and-conditions';
        const name = bookmarkNameForSlug(long);
        expect(name).toMatch(/^indemnification_escrow_release_[0-9a-f]{8}$/);
        expect(name.length).toBeLessThanOrEqual(40);
        expect(isWordBookmarkName(name)).toBe(true);
        expect(bookmarkNameForSlug(long)).toBe(name);
        expect(bookmarkNameForSlug('a'.repeat(40))).toBe('a'.repeat(40));
        expect(bookmarkNameForSlug('b'.repeat(30) + '--' + 'c'.repeat(20))).toMatch(new RegExp(`^${'b'.repeat(30)}_[0-9a-f]{8}$`));
      });
      await and('an id that cannot become a visible bookmark name is refused', async () => {
        for (const slug of ['-lead', '_hidden', '9lives', 'with space', '']) {
          expect(() => bookmarkNameForSlug(slug)).toThrow(BookmarkNameError);
        }
      });
      await and('ids that map to one name, regardless of case, fail with both ids named', async () => {
        expect([...bookmarkNamesForSlugs(['closing', 'closing-deliveries', 'closing']).entries()]).toEqual([
          ['closing', 'closing'],
          ['closing-deliveries', 'closing_deliveries'],
        ]);
        for (const pair of [['a-b', 'a_b'], ['Escrow', 'escrow']]) {
          let caught: unknown;
          try {
            bookmarkNamesForSlugs(pair);
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(BookmarkNameError);
          expect((caught as BookmarkNameError).code).toBe('name_collision');
          expect((caught as BookmarkNameError).slugs).toEqual(pair);
        }
      });
      await and('the full-context and paragraph number renderer reports an undefined level as no result', async () => {
        const numbering = parseNumberingXml(parseXml((await readZipText(await generateDocx(doc([item(2, 'x')])), 'word/numbering.xml'))!));
        expect(renderReferenceNumber(numbering, { numId: '99', ilvl: 0, levelValues: [1] }, 'paragraph')).toBeNull();
        expect(renderReferenceNumber(numbering, { numId: '1', ilvl: 2, levelValues: [2, 6, 2] }, 'fullContext')).toBe('Section 2.06(b)');
      });
    },
  );

  // A repeated bookmark name is legal, though readers disagree on which range
  // it names, so the check is a policy for packages safe-docx writes; a caller
  // checking a package it did not write can ask for a warning instead (#1264).
  test('a repeated bookmark name fails a generated package and is only a warning in a package safe-docx did not write', async () => {
    const generated = await generateDocx(agreement([]));
    const zip = await JSZip.loadAsync(generated);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).toContain('w:name="purchase_and_sale"');
    // A case variant of an earlier name still counts as the same name.
    zip.file('word/document.xml', documentXml.replace('w:name="purchase_price_adjustment"', 'w:name="Purchase_And_Sale"'));
    const repeated = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    const expected = {
      check: 'bookmark_name_uniqueness',
      part: 'word/document.xml',
      message: "Bookmark name 'Purchase_And_Sale' is used twice",
      bookmarkName: 'purchase_and_sale',
    };

    const strict = await checkGeneratedPackage(repeated);
    expect(strict.ok).toBe(false);
    expect(strict.issues).toEqual([expected]);
    expect(strict.warnings).toEqual([]);

    const lenient = await checkGeneratedPackage(repeated, { duplicateBookmarkNames: 'warning' });
    expect(lenient.ok).toBe(true);
    expect(lenient.issues).toEqual([]);
    expect(lenient.warnings).toEqual([expected]);

    // Warning mode relaxes names only: an unpaired bookmark still fails.
    const unpaired = documentXml.replace(/<w:bookmarkEnd w:id="\d+"\/>/u, '');
    expect(unpaired).not.toBe(documentXml);
    zip.file('word/document.xml', unpaired);
    const broken = await checkGeneratedPackage((await zip.generateAsync({ type: 'nodebuffer' })) as Buffer, { duplicateBookmarkNames: 'warning' });
    expect(broken.ok).toBe(false);
    expect(broken.issues.map((issue) => issue.check)).toEqual(['bookmark_pairing']);
  });
});
