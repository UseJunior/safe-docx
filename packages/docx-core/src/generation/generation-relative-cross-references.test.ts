import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { parseNumberingXml, resolveReferenceNumber } from '../primitives/numbering.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { BlockSpec, DocumentSpec, InlineSpec, NumberingSpec, ParagraphSpec, StyleSpec } from './types.js';

const TEST_FEATURE = 'add-relative-cross-references';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });
const refConforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../../../../scripts/oracle/word/evidence');

type EvidenceReference = { site: string; story: 'body' | 'footnote'; instruction: string; word: string; libreOffice: string };
type Evidence = {
  probes: Array<{ name: string; spec: DocumentSpec; references: EvidenceReference[] }>;
};
type Issue1236Evidence = { spec: DocumentSpec; relativeContext: { byLocation: Record<string, Record<'s206b' | 's206bii', string>> } };

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = (value: string): InlineSpec => ({ kind: 'text', text: value });
const rref = (bookmark: string): InlineSpec => ({ kind: 'crossReference', bookmark, number: 'relative' });
const para = (runs: InlineSpec[], extra: Partial<ParagraphSpec> = {}): ParagraphSpec => ({ kind: 'paragraph', runs, ...extra });

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
const clause = (ilvl: number, runs: InlineSpec[], bookmark?: string): ParagraphSpec =>
  para(runs, { list: { numId: 'legal', ilvl }, ...(bookmark ? { bookmark } : {}) });

function doc(blocks: BlockSpec[], extra: Partial<DocumentSpec> = {}): DocumentSpec {
  return { meta: { createdIso: '2026-11-04T00:00:00Z' }, styles: HEADING_STYLES, numbering: [LEGAL], sections: [{ blocks }], ...extra };
}

/** Each REF field's instruction and result text, in document order. */
function refFields(root: Document): Array<{ instruction: string; result: string }> {
  const out: Array<{ instruction: string; result: string }> = [];
  let open: { instruction: string; result: string; inResult: boolean } | null = null;
  for (const run of Array.from(root.getElementsByTagNameNS(W, 'r'))) {
    const type = run.getElementsByTagNameNS(W, 'fldChar').item(0)?.getAttributeNS(W, 'fldCharType');
    if (type === 'begin') { open = { instruction: '', result: '', inResult: false }; continue; }
    if (!open) continue;
    if (type === 'separate') { open.inResult = true; continue; }
    if (type === 'end') { if (open.instruction.includes('REF')) out.push({ instruction: open.instruction, result: open.result }); open = null; continue; }
    for (const node of Array.from(run.getElementsByTagNameNS(W, 'instrText'))) open.instruction += node.textContent ?? '';
    if (open.inResult) for (const node of Array.from(run.getElementsByTagNameNS(W, 't'))) open.result += node.textContent ?? '';
  }
  return out;
}

/** Body fields, then footnote fields: the order the Word oracle reads them in. */
async function generatedFields(spec: DocumentSpec): Promise<Array<{ instruction: string; result: string }>> {
  const buffer = await generateDocx(spec);
  const document = parseXml((await readZipText(buffer, 'word/document.xml'))!);
  const footnotesXml = await readZipText(buffer, 'word/footnotes.xml');
  return [...refFields(document), ...(footnotesXml ? refFields(parseXml(footnotesXml)) : [])];
}

async function specError(spec: DocumentSpec): Promise<GenerationSpecError> {
  const error = await generateDocx(spec).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GenerationSpecError);
  return error as GenerationSpecError;
}

/** Rebuild the #1236 \r probe: legal numbering, a plain list, and relative references at nine named places. */
function issue1236RelativeProbe(): DocumentSpec {
  const probe = (location: string): InlineSpec[] => [text(`${location}: `), rref('s206b'), text(' '), rref('s206bii')];
  const h1 = (title: string, bookmark?: string) => para([text(title)], { styleId: 'Heading1', ...(bookmark ? { bookmark } : {}) });
  const h2 = (title: string, bookmark?: string) => para([text(title)], { styleId: 'Heading2', ...(bookmark ? { bookmark } : {}) });
  const plain = (ilvl: number, runs: InlineSpec[]) => para(runs, { list: { numId: 'plain', ilvl } });
  return doc([
    para(probe('L1-start')),
    h1('DEFINITIONS'), h2('Defined Terms.'), clause(2, probe('L2-art1-s101-a')),
    h1('PURCHASE AND SALE'), h2('Purchase.'), h2('Price.'), h2('Escrow.'), h2('Deposit.'), h2('Adjustment Mechanics.'),
    clause(2, probe('L4-s205-a')),
    h2('Purchase Price Adjustment.'),
    clause(2, probe('L3-s206-a')),
    clause(2, [text('second clause of 2.06.')], 's206b'),
    clause(3, [text('first sub-clause of 2.06(b).')]),
    clause(3, [text('second sub-clause of 2.06(b).')], 's206bii'),
    clause(3, probe('L8-s206b-iii')),
    h2('Closing.'),
    clause(2, probe('L6-s207-a')),
    para(probe('L5-after-art2-unnumbered')),
    plain(0, [text('plain one.')]), plain(0, [text('plain two.')]), plain(1, [text('plain two point one.')]), plain(2, [text('plain two point one (a).')]),
    plain(1, probe('L7-plain-2.2')),
    para(probe('L9-end')),
  ], {
    numbering: [LEGAL, {
      numId: 'plain',
      levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '%1.' }, { ilvl: 1, numFmt: 'decimal', lvlText: '%1.%2.' }, { ilvl: 2, numFmt: 'lowerLetter', lvlText: '(%3)' }],
    }],
  });
}

describe('Traceability: generated relative cross-references', () => {
  refConforming.openspec("[SDX-GEN-130] relative cross-references emit REF fields with the relative switch whose cached results equal Word's")(
    "Scenario: relative cross-references emit REF fields with the relative switch whose cached results equal Word's",
    async () => {
      const evidence = JSON.parse(readFileSync(path.join(EVIDENCE_DIR, 'issue-1258-word-16.114.json'), 'utf8')) as Evidence;
      expect(evidence.probes.map((probe) => probe.references.length)).toEqual([70, 24, 12]);
      for (const probe of evidence.probes) {
        const buffer = await generateDocx(probe.spec);
        expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
        expect(await generateDocx(probe.spec)).toEqual(buffer);
        expect(await generatedFields(probe.spec)).toEqual(probe.references.map(({ instruction, word }) => ({ instruction, result: word })));
      }
      const word = (probe: string, site: string, to: string) =>
        evidence.probes.find((entry) => entry.name === probe)!.references.find((reference) => reference.site === site && reference.instruction === ` REF ${to} \\r \\h `)!.word;
      // Another Article, the same Article, the same Section, a sibling clause, the target's own paragraph and its parent.
      expect([word('probe1-legal', 's101a', 's203bii'), word('probe1-legal', 's204a', 's203bii'), word('probe1-legal', 's203a', 's203bii')]).toEqual(['Section 2.03(b)(ii)', 'Section 2.03(b)(ii)', '(b)(ii)']);
      expect([word('probe1-legal', 's203bi', 's203bii'), word('probe1-legal', 's203bii', 's203bii'), word('probe1-legal', 's203bi', 's203b')]).toEqual(['(ii)', '(ii)', '(b)']);
      // Numbered headings as targets, and a field in a heading: a Section part names level 0, so it is kept whole.
      expect([word('probe1-legal', 's201a', 's203'), word('probe1-legal', 's203a', 's203'), word('probe1-legal', 's203-heading', 's203b'), word('probe1-legal', 'art2-heading', 's203b')])
        .toEqual(['Section 2.03', 'Section 2.03', '(b)', 'Section 2.03(b)']);
      // Table cells and plain paragraphs number relative to the target list's last paragraph before them.
      expect([word('probe1-legal', 'cell-plain', 's203b'), word('probe1-legal', 'cell-s203d', 's203bii'), word('probe1-legal', 'plain-s204', 's204a')]).toEqual(['(b)', '(b)(ii)', '(a)']);
      // A target in an earlier list: relative to that list's own (w:numId) last paragraph, not the field's.
      expect([word('probe1-legal', 's301a', 'pre2b'), word('probe2-lists', 'b2a', 'a2b'), word('probe2-lists', 'c2a', 'a2bi'), word('probe3-instances', 'y3', 'x2b')])
        .toEqual(['(b)', '2(b)', '2(b)(i)', '(b)']);
      // In a footnote the number is full, wherever the note is anchored.
      const notes = evidence.probes.flatMap((probe) => probe.references.filter((reference) => reference.story === 'footnote'));
      expect(notes.map((reference) => reference.word)).toEqual(['Section 2.03(b)(ii)', 'Section 2.03(b)', 'Section 2.03', 'Section 2.04(a)', 'ARTICLE II', 'Section 2.03(b)', 'Section 3.01', 'ARTICLE III', 'Section 2.03(b)', '2(b)', '2(b)']);
      // LibreOffice agrees under heading numbering, and differs with two w:num instances of one definition.
      expect(evidence.probes[0]!.references.every((reference) => reference.libreOffice === reference.word)).toBe(true);
      expect(evidence.probes[1]!.references.find((reference) => reference.site === 'b2a')).toMatchObject({ word: '2(b)', libreOffice: '(b)' });

      // The #1236 probe recorded \r results at nine places; a regenerated probe shows the same.
      const issue1236 = JSON.parse(readFileSync(path.join(EVIDENCE_DIR, 'issue-1236-word-16.114.json'), 'utf8')) as Issue1236Evidence;
      const recorded = Object.values(issue1236.relativeContext.byLocation).flatMap((byTarget) => [byTarget.s206b, byTarget.s206bii]);
      const regenerated = await generatedFields(issue1236RelativeProbe());
      expect(regenerated.map((field) => field.result)).toEqual([
        ...['L1-start', 'L2-art1-s101-a', 'L4-s205-a', 'L3-s206-a', 'L8-s206b-iii', 'L6-s207-a', 'L5-after-art2-unnumbered', 'L7-plain-2.2', 'L9-end']
          .flatMap((location) => [issue1236.relativeContext.byLocation[location]!.s206b, issue1236.relativeContext.byLocation[location]!.s206bii]),
      ]);
      expect(recorded).toHaveLength(18);
    },
  );

  test.openspec('[SDX-GEN-131] a relative number drops the levels it shares with the target list at the field')(
    'Scenario: a relative number drops the levels it shares with the target list at the field',
    async () => {
      const numbering = parseNumberingXml(parseXml(
        `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">`
        + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>'
        + '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/></w:lvl>'
        + '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="(%3)"/></w:lvl>'
        + '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
      ));
      const target = { numId: '1', ilvl: 2, levelValues: [2, 2, 2] };
      const at = (levelValues: number[], extra: object = {}) => ({ numId: '1', ilvl: levelValues.length - 1, levelValues, ...extra });
      const relative = (context: ReturnType<typeof at> | null) => resolveReferenceNumber(numbering, target, 'relative', context);
      expect(relative(null)).toEqual({ text: '2(b)(ii)' });
      expect(relative(at([3, 1]))).toEqual({ text: '2(b)(ii)' });
      expect(relative(at([2, 1]))).toEqual({ text: '(b)(ii)' });
      expect(relative(at([2, 2, 1]))).toEqual({ text: '(ii)' });
      expect(relative(at([2, 2, 2]))).toEqual({ text: '(ii)' });
      expect(relative(at([2]))).toEqual({ text: '(b)(ii)' });
      // A position in another list is not a position in the target's list.
      expect(relative({ ...at([2, 2, 1]), numId: '2' })).toEqual({ text: '2(b)(ii)' });
      // The target's own level is always kept, with its trailing period dropped.
      expect(resolveReferenceNumber(numbering, { numId: '1', ilvl: 0, levelValues: [2] }, 'relative', at([2, 2, 1]))).toEqual({ text: '2' });
      // A level shown at its start value, in the target or at the position: what Word shows is not measured.
      expect(relative(at([2, 1], { levelsAtStartValue: [0] }))).toEqual({ refused: 'relativeStartValue' });
      expect(resolveReferenceNumber(numbering, { ...target, levelsAtStartValue: [1] }, 'relative', at([2, 1]))).toEqual({ refused: 'relativeStartValue' });

      // Generated: a reference in the body numbers relative to where it sits, in a footnote in full.
      const spec = doc([
        para([text('ARTICLE')], { styleId: 'Heading1' }),
        para([text('Section')], { styleId: 'Heading2' }),
        clause(2, [text('first, see '), rref('b_ii'), { kind: 'footnote', blocks: [para([text('Note: '), rref('b_ii')])] }]),
        clause(2, [text('second.')], 'b'),
        clause(3, [text('one, see '), rref('b_ii'), text(' and '), rref('b')]),
        clause(3, [text('two.')], 'b_ii'),
        { kind: 'table', columnWidthsTwips: [4680], rows: [{ cells: [{ blocks: [para([text('Cell: '), rref('b_ii')])] }] }] },
        para([text('Next')], { styleId: 'Heading2' }),
        para([text('Plain: '), rref('b_ii')]),
      ]);
      expect((await generatedFields(spec)).map((field) => `${field.instruction.trim()} = ${field.result}`)).toEqual([
        'REF b_ii \\r \\h = (b)(ii)',
        'REF b_ii \\r \\h = (ii)',
        'REF b \\r \\h = (b)',
        'REF b_ii \\r \\h = (ii)',
        'REF b_ii \\r \\h = Section 1.01(b)(ii)',
        'REF b_ii \\r \\h = Section 1.01(b)(ii)',
      ]);
    },
  );

  test.openspec('[SDX-GEN-132] relative cross-references Word would show unmeasured numbers for are rejected')(
    'Scenario: relative cross-references Word would show unmeasured numbers for are rejected',
    async () => {
      const base = (footnote: ParagraphSpec): DocumentSpec => doc([
        para([text('Section')], { styleId: 'Heading2' }),
        clause(2, [text('target.')], 'target'),
        para([text('Body'), { kind: 'footnote', blocks: [footnote, para([text('See '), rref('target')])] }]),
      ]);
      // A numbered footnote paragraph, directly or through a style linked to a list level (or based on one).
      const listed = await specError(base(para([text('Numbered note.')], { list: { numId: 'legal', ilvl: 2 } })));
      expect(listed.path).toBe('/sections/0/blocks/2/runs/1/blocks/1/runs/1/number');
      expect(listed.message).toContain('/sections/0/blocks/2/runs/1/blocks/0');
      const styled = base(para([text('Styled note.')], { styleId: 'NoteHeading' }));
      styled.styles = [...HEADING_STYLES, { styleId: 'NoteHeading', name: 'note heading', type: 'paragraph', basedOn: 'Heading2' }];
      expect((await specError(styled)).path).toBe('/sections/0/blocks/2/runs/1/blocks/1/runs/1/number');
      // A footnote paragraph without a styleId takes FootnoteText, so a numbered FootnoteText counts too.
      const implicit = base(para([text('Implicit note.')]));
      implicit.styles = [...HEADING_STYLES, { styleId: 'FootnoteText', name: 'footnote text', type: 'paragraph', basedOn: 'Heading2' }];
      const implicitError = await specError(implicit);
      expect(implicitError.path).toBe('/sections/0/blocks/2/runs/1/blocks/1/runs/1/number');
      expect(implicitError.message).toContain('/sections/0/blocks/2/runs/1/blocks/0');
      // Without a numbered footnote paragraph the same reference generates, in full.
      const plain = await generatedFields(base(para([text('Plain note.')])));
      expect(plain).toEqual([{ instruction: ' REF target \\r \\h ', result: 'Section 1.01(a)' }]);

      // A clause right after an Article shows the Section level at its start value: refused as target and as position.
      const afterArticle = await specError(doc([
        para([text('ARTICLE')], { styleId: 'Heading1' }),
        clause(2, [text('clause.')], 'clause'),
        para([text('See '), rref('clause')]),
      ]));
      expect(afterArticle.path).toBe('/sections/0/blocks/1/bookmark');
      expect(afterArticle.message).toContain('start value');
      const fromArticleClause = await specError(doc([
        para([text('ARTICLE')], { styleId: 'Heading1' }),
        para([text('Section')], { styleId: 'Heading2' }),
        clause(2, [text('target.')], 'target'),
        para([text('ARTICLE')], { styleId: 'Heading1' }),
        clause(2, [text('See '), rref('target')]),
      ]));
      expect(fromArticleClause.path).toBe('/sections/0/blocks/2/bookmark');
      // A relative number is a number form: a text reference takes none.
      expect((await specError(doc([clause(2, [text('t')], 't'), para([{ kind: 'crossReference', bookmark: 't', show: 'text', number: 'relative' }])]))).path)
        .toBe('/sections/0/blocks/1/runs/0/number');
    },
  );
});
