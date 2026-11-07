import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { refreshDocumentFieldsXml } from '../primitives/field_evaluation.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { testAllure } from '../testing/allure-test.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { BlockSpec, DocumentSpec, InlineSpec, NumberingSpec, ParagraphSpec, StyleSpec } from './types.js';

const TEST_FEATURE = 'add-text-cross-references';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });
const refConforming = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = path.resolve(__dirname, '../../../../scripts/oracle/word/evidence/issue-1259-word-16.114.json');

/** `wordFormatted` is absent for a footnote field, whose characters AppleScript could not read one at a time. */
type EvidenceReference = { story: string; instruction: string; cached: string; cachedFormatted: string; word: string; wordFormatted?: string };
type EvidenceBookmark = { start: number; end: number; paragraphStart: number; paragraphEnd: number; text: string };
type EvidenceEdit = { action: string; bookmark: EvidenceBookmark | null; referencesAfterUpdate: Array<{ instruction: string; word: string }> };
type Evidence = {
  spec: DocumentSpec;
  formattingOfTheField: { wordFormatted: string };
  probe: {
    references: EvidenceReference[];
    edits: Record<'typedAtStart' | 'insertedAtStart' | 'typedAtEnd' | 'rewordedInside' | 'typedOverWholeText', EvidenceEdit>;
    wordNativeCrossReferences: Record<'headingText' | 'bookmarkText', { instruction: string; word: string }>;
  };
  create: {
    references: EvidenceReference[];
    edits: Record<'rewordedInside' | 'typedOverInnerWord' | 'typedAtStart' | 'typedAtEnd' | 'rewordedLastWords' | 'typedOverLastWord', EvidenceEdit>;
  };
};

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = (value: string, extra: Partial<Extract<InlineSpec, { kind: 'text' }>> = {}): InlineSpec => ({ kind: 'text', text: value, ...extra });
const tref = (bookmark: string, extra: Partial<Extract<InlineSpec, { kind: 'crossReference' }>> = {}): InlineSpec => ({ kind: 'crossReference', bookmark, show: 'text', ...extra });
const para = (runs: InlineSpec[], extra: Partial<ParagraphSpec> = {}): ParagraphSpec => ({ kind: 'paragraph', runs, ...extra });
const note = (value: string): InlineSpec => ({ kind: 'footnote', blocks: [para([text(value)])] });

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
  ],
};

function doc(blocks: BlockSpec[]): DocumentSpec {
  return { meta: { createdIso: '2026-11-04T00:00:00Z' }, styles: HEADING_STYLES, numbering: [LEGAL], sections: [{ blocks }] };
}

/** A numbered Article and Section (with emphasis and a footnote), a clause, and a plain paragraph in a table cell. */
function agreement(references: BlockSpec[]): DocumentSpec {
  return doc([
    ...references,
    para([text('PURCHASE AND SALE')], { styleId: 'Heading1', bookmark: 'purchase_and_sale' }),
    para([text('Payment of the '), text('Closing', { italic: true }), text(' Amount'), note('As adjusted.'), text('.')], { styleId: 'Heading2', bookmark: 'payment' }),
    para([text('the Buyer pays.')], { list: { numId: 'legal', ilvl: 2 }, bookmark: 'buyer_pays' }),
    { kind: 'table', columnWidthsTwips: [4680], rows: [{ cells: [{ blocks: [para([text('A cell target.')], { bookmark: 'cell' })] }] }] },
  ]);
}

/** Each field's instruction, then each result run as `[text, italic]`. */
function fields(root: Document): Array<{ instruction: string; runs: Array<[string, boolean]>; footnoteMarks: number }> {
  const out: Array<{ instruction: string; runs: Array<[string, boolean]>; footnoteMarks: number }> = [];
  let open: { instruction: string; runs: Array<[string, boolean]>; footnoteMarks: number; inResult: boolean } | null = null;
  for (const run of Array.from(root.getElementsByTagNameNS(W, 'r'))) {
    const type = run.getElementsByTagNameNS(W, 'fldChar').item(0)?.getAttributeNS(W, 'fldCharType');
    if (type === 'begin') { open = { instruction: '', runs: [], footnoteMarks: 0, inResult: false }; continue; }
    if (!open) continue;
    if (type === 'separate') { open.inResult = true; continue; }
    if (type === 'end') { const { inResult: _inResult, ...field } = open; void _inResult; out.push(field); open = null; continue; }
    for (const node of Array.from(run.getElementsByTagNameNS(W, 'instrText'))) open.instruction += node.textContent ?? '';
    if (!open.inResult) continue;
    open.footnoteMarks += run.getElementsByTagNameNS(W, 'footnoteReference').length;
    const t = run.getElementsByTagNameNS(W, 't').item(0);
    if (t) open.runs.push([t.textContent ?? '', run.getElementsByTagNameNS(W, 'i').length > 0]);
  }
  return out;
}

/** A field's result as {flags}text segments (b bold, i italic, h highlighted), as the evidence records it. */
function formatted(root: Document): Array<{ instruction: string; result: string; formatted: string }> {
  const out: Array<{ instruction: string; result: string; formatted: string }> = [];
  let open: { instruction: string; result: string; formatted: string; last: string | null; inResult: boolean } | null = null;
  for (const run of Array.from(root.getElementsByTagNameNS(W, 'r'))) {
    const type = run.getElementsByTagNameNS(W, 'fldChar').item(0)?.getAttributeNS(W, 'fldCharType');
    if (type === 'begin') { open = { instruction: '', result: '', formatted: '', last: null, inResult: false }; continue; }
    if (!open) continue;
    if (type === 'separate') { open.inResult = true; continue; }
    if (type === 'end') { out.push({ instruction: open.instruction, result: open.result, formatted: open.formatted }); open = null; continue; }
    for (const node of Array.from(run.getElementsByTagNameNS(W, 'instrText'))) open.instruction += node.textContent ?? '';
    const t = run.getElementsByTagNameNS(W, 't').item(0);
    if (!open.inResult || !t) continue;
    const has = (name: string) => run.getElementsByTagNameNS(W, name).length > 0;
    const flags = `${has('b') ? 'b' : ''}${has('i') ? 'i' : ''}${has('highlight') ? 'h' : ''}`;
    if (flags !== open.last) { open.formatted += `{${flags}}`; open.last = flags; }
    open.result += t.textContent ?? '';
    open.formatted += t.textContent ?? '';
  }
  return out;
}

async function parts(buffer: Buffer): Promise<{ documentXml: string; document: Document; footnotes: Document | null }> {
  const documentXml = (await readZipText(buffer, 'word/document.xml'))!;
  const footnotesXml = await readZipText(buffer, 'word/footnotes.xml');
  return { documentXml, document: parseXml(documentXml), footnotes: footnotesXml ? parseXml(footnotesXml) : null };
}

async function specError(spec: DocumentSpec): Promise<GenerationSpecError> {
  const error = await generateDocx(spec).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GenerationSpecError);
  return error as GenerationSpecError;
}

describe('Traceability: generated text cross-references', () => {
  refConforming.openspec("[SDX-GEN-127] text cross-references emit REF fields whose cached result is the target's text runs")(
    "Scenario: text cross-references emit REF fields whose cached result is the target's text runs",
    async () => {
      const spec = agreement([
        para([text('See '), tref('payment'), text(' under '), tref('purchase_and_sale'), text('.')]),
        para([text('Also '), tref('buyer_pays'), text(' and '), tref('cell'), text('.'), { kind: 'footnote', blocks: [para([text('Compare '), tref('payment'), text('.')])] }]),
        para([text('By number: '), { kind: 'crossReference', bookmark: 'payment' }, text('.')]),
      ]);
      const buffer = await generateDocx(spec);
      expect((await checkGeneratedPackage(buffer)).ok).toBe(true);
      expect(await generateDocx(spec)).toEqual(buffer);
      const { documentXml, document, footnotes } = await parts(buffer);

      // No number switch; the result leaves out "Section 1.01" and the footnote mark, and keeps each target
      // run's own formatting (the italic word).
      expect(fields(document)).toEqual([
        { instruction: ' REF payment \\h ', runs: [['Payment of the ', false], ['Closing', true], [' Amount', false], ['.', false]], footnoteMarks: 0 },
        { instruction: ' REF purchase_and_sale \\h ', runs: [['PURCHASE AND SALE', false]], footnoteMarks: 0 },
        { instruction: ' REF buyer_pays \\h ', runs: [['the Buyer pays.', false]], footnoteMarks: 0 },
        { instruction: ' REF cell \\h ', runs: [['A cell target.', false]], footnoteMarks: 0 },
        { instruction: ' REF payment \\w \\h ', runs: [['Section 1.01', false]], footnoteMarks: 0 },
      ]);
      // A reference in a footnote, emitted after the body, copies the same runs into the footnotes part.
      expect(fields(footnotes!).filter((field) => field.instruction.includes('REF'))).toEqual([
        { instruction: ' REF payment \\h ', runs: [['Payment of the ', false], ['Closing', true], [' Amount', false], ['.', false]], footnoteMarks: 0 },
      ]);

      // docx-core's own REF refresh, which reads the bookmarked text from the package, finds every cached text
      // result already current.
      const refreshed = refreshDocumentFieldsXml(documentXml);
      const textOutcomes = refreshed.outcomes.filter((outcome) => outcome.instruction.trim().split(/\s+/u).length === 3);
      expect(textOutcomes.map((outcome) => [outcome.target, outcome.status])).toEqual([
        ['payment', 'unchanged'],
        ['purchase_and_sale', 'unchanged'],
        ['buyer_pays', 'unchanged'],
        ['cell', 'unchanged'],
      ]);
    },
  );

  refConforming.openspec("[SDX-GEN-128] text cross-reference results equal Word's after-update results")(
    "Scenario: text cross-reference results equal Word's after-update results",
    async () => {
      const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as Evidence;
      const buffer = await generateDocx(evidence.spec);
      const { document, footnotes } = await parts(buffer);
      const generated = [...formatted(document), ...formatted(footnotes!).filter((field) => field.instruction.includes('REF'))];
      // Text and formatting: the italic word, the highlighted fill and the bold run come through as Word writes
      // them; list labels and footnote marks stay out.
      expect(generated.map(({ instruction, result }) => ({ instruction, result })))
        .toEqual(evidence.probe.references.map(({ instruction, word }) => ({ instruction, result: word })));
      generated.forEach((field, index) => {
        const { wordFormatted } = evidence.probe.references[index]!;
        if (wordFormatted !== undefined) expect(field.formatted).toBe(wordFormatted);
      });
      expect(generated.map((field) => field.formatted)).toEqual(expect.arrayContaining(['{}Payment of the {i}Closing{} Amount.', '{}Delivery by {h}[Effective Date]{}.', '{}the Seller shall deliver {b}the Closing Statement{}.']));
      expect(evidence.probe.references.filter((reference) => !/\\[wn] /u.test(reference.instruction))).toHaveLength(15);
      for (const reference of [...evidence.probe.references, ...evidence.create.references]) {
        expect(reference.word).toBe(reference.cached);
        if (reference.wordFormatted !== undefined) expect(reference.wordFormatted).toBe(reference.cachedFormatted);
      }
      // Formatting on the field itself does not survive Word's update, which is why a text reference takes none.
      expect(evidence.formattingOfTheField.wordFormatted).toBe('{}Purchase Price Adjustment.');

      // Word's own cross-references: "Bookmark text" writes the same instruction, and "Heading text" to a
      // heading already bookmarked over all its runs reuses that bookmark.
      expect(evidence.probe.wordNativeCrossReferences.bookmarkText).toMatchObject({ instruction: ' REF sec_ppa \\h ', word: 'Purchase Price Adjustment.' });
      expect(evidence.probe.wordNativeCrossReferences.headingText).toMatchObject({ instruction: ' REF sec_fn_mid \\h ', word: 'Escrow Release.' });

      // Edits a Word user makes to the target: typing at the start or inside stays in the bookmark and the
      // references follow; typing at the end lands after it; typing over the whole text deletes it.
      const { typedAtStart, insertedAtStart, typedAtEnd, rewordedInside, typedOverWholeText } = evidence.probe.edits;
      for (const [edit, shown] of [[typedAtStart, 'Typed Purchase Price Adjustment.'], [insertedAtStart, 'Inserted Purchase Price Adjustment.'], [rewordedInside, 'Purchase Consideration Adjustment.']] as const) {
        expect(edit.bookmark).toMatchObject({ text: shown });
        expect(edit.bookmark!.start).toBe(edit.bookmark!.paragraphStart);
        expect(edit.referencesAfterUpdate.filter((reference) => !reference.instruction.includes('\\w')).map((reference) => reference.word)).toEqual([shown, shown]);
      }
      expect(typedAtEnd.bookmark!.end).toBeLessThan(typedAtEnd.bookmark!.paragraphEnd - 1);
      expect(typedAtEnd.referencesAfterUpdate.filter((reference) => !reference.instruction.includes('\\w')).map((reference) => reference.word))
        .toEqual(['Purchase Price Adjustment.', 'Purchase Price Adjustment.']);
      expect(typedOverWholeText.bookmark).toBeNull();
      // In a created heading without a final period, a word typed over the last word lands after the bookmark too.
      const created = evidence.create.edits;
      const shown = (edit: EvidenceEdit) => edit.referencesAfterUpdate.filter((reference) => !reference.instruction.includes('\\w')).map((reference) => reference.word);
      expect(shown(created.typedOverInnerWord)).toEqual(['Purchase Consideration Adjustment']);
      expect(shown(created.typedAtStart)).toEqual(['Final Purchase Price Adjustment']);
      expect(shown(created.typedAtEnd)).toEqual(['Purchase Price Adjustment']);
      expect(shown(created.typedOverLastWord)).toEqual(['Purchase Price ']);
      expect(new Set(typedOverWholeText.referencesAfterUpdate.map((reference) => reference.word))).toEqual(new Set(['Error! Reference source not found.']));
    },
  );

  test.openspec('[SDX-GEN-129] invalid text cross-references are rejected')(
    'Scenario: invalid text cross-references are rejected',
    async () => {
      const target = (runs: InlineSpec[], reference: InlineSpec = tref('t')) => doc([para(runs, { bookmark: 't' }), para([text('See '), reference])]);
      const error = await specError(target([text('Target')], { kind: 'crossReference', bookmark: 't', show: 'page' as never }));
      expect(error.path).toBe('/sections/0/blocks/1/runs/1/show');
      expect((await specError(target([text('Target')], tref('t', { number: 'paragraph' })))).path).toBe('/sections/0/blocks/1/runs/1/number');
      // Word replaces a text reference's result with the target's runs, so formatting on the field would vanish.
      expect((await specError(target([text('Target')], tref('t', { italic: true })))).path).toBe('/sections/0/blocks/1/runs/1/italic');
      // A tab, break, field or cross-reference inside the target: Word's REF result for it is not measured.
      for (const inline of [{ kind: 'tab' }, { kind: 'break' }, { kind: 'field', field: 'PAGE', cachedResult: '1' }] as InlineSpec[]) {
        const refused = await specError(target([text('Target'), inline]));
        expect(refused.path).toBe('/sections/0/blocks/1/runs/1/show');
        expect(refused.message).toContain(`holds a ${inline.kind}`);
      }
      const nested = doc([para([text('One')], { bookmark: 'one', list: { numId: 'legal', ilvl: 0 } }), para([text('Under '), { kind: 'crossReference', bookmark: 'one' }], { bookmark: 't' }), para([tref('t')])]);
      expect((await specError(nested)).message).toContain('holds a crossReference');
      // A blank target would show nothing.
      expect((await specError(target([text('  '), note('Only a note.')]))).message).toContain('empty text');
      // A text reference needs no number: an unnumbered target is fine, and a footnote-only mark is left out.
      const fine = await generateDocx(target([text('Target'), note('A note.')]));
      expect(fields((await parts(fine)).document)).toEqual([{ instruction: ' REF t \\h ', runs: [['Target', false]], footnoteMarks: 0 }]);
    },
  );
});
