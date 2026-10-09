import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPdfRenderTools, type PdfRenderTools } from '../pdf/tools.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import type { CreationLowering } from './lower.js';
import { PAGE_NUMBER_FIELD, comparePdfWords, compareParagraphs, listMarker, projectSourceText, type SourceBodyEntry, type SourceProjection } from './oracle.js';

const TEST_FEATURE = 'add-markdoc-document-creation';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1185 independent round-trip oracle',
  severity: 'critical',
});

/** Every construct in the grammar, synthetic text only. */
const FULL_SOURCE = [
  '---',
  'footer: Confidential Draft',
  'page-numbers: true',
  '---',
  '',
  '# WRITTEN CONSENT',
  '',
  '{% center %}**Board of Directors**{% /center %}',
  '',
  'The directors adopt these resolutions effective {% fill %}Effective Date{% /fill %}; "[t]he Plan" [sic] stays literal.',
  '',
  '## Approval',
  '',
  '1. RESOLVED, that the Plan is *approved*.',
  '   1. The Plan reserves {% fill %}Number{% /fill %} shares.',
  '',
  '{% table widths="50,50" %}',
  '* Holder',
  '* Shares',
  '---',
  '* Holder One',
  '* 1,000',
  '{% /table %}',
  '',
  '> Quoted resolution text.',
  '',
  'A line that breaks\\',
  'onto a second line.',
  '',
  '{% legend %}[Signature page follows.]{% /legend %}',
  '',
  '{% section footer="Signature Page" /%}',
  '',
  '{% signer name="Jane Roe, Director" date="Date: ________" /%}',
].join('\n');

async function verificationFailure(promise: Promise<unknown>): Promise<CreationCertificate> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught as { code?: string; details?: unknown });
  expect(error?.code).toBe('CREATION_VERIFICATION_FAILED');
  return error!.details as CreationCertificate;
}

/**
 * A lowering bug simulated consistently: the same corruption is applied to the
 * DocumentSpec AND to its own projection, so the read-back check (which
 * compares the DOCX against that projection) cannot see it.
 */
function corrupt(edit: (json: string) => string): (lowering: CreationLowering) => CreationLowering {
  return (lowering) => ({
    ...lowering,
    spec: JSON.parse(edit(JSON.stringify(lowering.spec))),
    projection: JSON.parse(edit(JSON.stringify(lowering.projection))),
  });
}

/** Drop every body block (paragraph or table cell paragraph) whose text contains `needle`, from spec and projection alike. */
function dropParagraph(needle: string): (lowering: CreationLowering) => CreationLowering {
  const keep = (block: unknown) => !JSON.stringify(block).includes(needle);
  return (lowering) => ({
    ...lowering,
    spec: { ...lowering.spec, sections: lowering.spec.sections.map((section) => ({ ...section, blocks: section.blocks.filter(keep) })) },
    projection: { ...lowering.projection, paragraphs: lowering.projection.paragraphs.filter((paragraph) => !paragraph.includes(needle)) },
  });
}

describe('Traceability: independent round-trip oracle for created documents', () => {
  test.openspec('[SDX-MDOC-CREATE-11] the created DOCX re-imports to the source text, with negative controls')(
    'Scenario: the created DOCX re-imports to the source text, with negative controls',
    async () => {
      const { certificate } = await createDocumentFromMarkdoc(FULL_SOURCE);
      const roundTrip = certificate.checks.roundTrip;
      expect(roundTrip.passed).toBe(true);
      expect(roundTrip.body.mismatches).toEqual([]);
      expect(roundTrip.negativeControls).toEqual({ deletedWord: true, deletedParagraph: true, deletedTableCell: true, deletedFooterText: true });
      expect(roundTrip.footers.map((footer) => [footer.section, footer.passed])).toEqual([[0, true], [1, true]]);
      expect(roundTrip.footers[0]!.comparison!.knownGenerated).toEqual(['page number field rendered as "1"']);
      expect(roundTrip.normalization).toMatch(/NFC/);

      // The expected side comes from the Markdoc text alone.
      const projection = projectSourceText(FULL_SOURCE);
      expect(projection.body.map((entry) => entry.text)).toContain('The directors adopt these resolutions effective [Effective Date]; "[t]he Plan" [sic] stays literal.');
      expect(projection.body.filter((entry) => entry.cell).map((entry) => entry.text)).toEqual(['Holder', 'Shares', 'Holder One', '1,000']);
      expect(projection.footers).toEqual([['Confidential Draft', PAGE_NUMBER_FIELD], ['Signature Page']]);
      expect(projection.body.find((entry) => entry.text.includes('Holder One'))!.line).toBe(21);
    },
  );

  test.openspec('[SDX-MDOC-CREATE-11] a lowering that drops content from both the spec and its projection fails the round trip')(
    'Scenario: a lowering that drops content from both the spec and its projection fails the round trip',
    async () => {
      // Dropped paragraph: the old read-back passes, the round trip names the paragraph and its source line.
      let certificate = await verificationFailure(createDocumentFromMarkdoc(FULL_SOURCE, { transformLowering: dropParagraph('Quoted resolution text.') }));
      expect(certificate.checks.readback.passed).toBe(true);
      expect(certificate.checks.roundTrip.passed).toBe(false);
      expect(certificate.checks.roundTrip.body.mismatches).toEqual([{ kind: 'missing', expected: 'Quoted resolution text.', expectedIndex: 10, line: 25 }]);

      // Dropped word: reported as a changed paragraph with the missing word span and its context.
      certificate = await verificationFailure(createDocumentFromMarkdoc(FULL_SOURCE, { transformLowering: corrupt((json) => json.replaceAll('reserves ', '')) }));
      expect(certificate.checks.readback.passed).toBe(true);
      const changed = certificate.checks.roundTrip.body.mismatches[0]!;
      expect(changed).toMatchObject({ kind: 'changed', line: 15, missingWords: [{ words: 'reserves', before: 'The Plan', after: '[Number] shares.' }], extraWords: [] });

      // Dropped table cell.
      certificate = await verificationFailure(createDocumentFromMarkdoc(FULL_SOURCE, { transformLowering: corrupt((json) => json.replaceAll('Holder One', '')) }));
      expect(certificate.checks.readback.passed).toBe(true);
      expect(certificate.checks.roundTrip.body.mismatches).toEqual([{ kind: 'missing', expected: 'Holder One', expectedIndex: 8, line: 21 }]);

      // Dropped footer text.
      certificate = await verificationFailure(createDocumentFromMarkdoc(FULL_SOURCE, { transformLowering: corrupt((json) => json.replaceAll('Signature Page', 'Signature')) }));
      expect(certificate.checks.footers.passed).toBe(true);
      const footer = certificate.checks.roundTrip.footers[1]!;
      expect(footer).toMatchObject({ section: 1, expected: ['Signature Page'], actual: ['Signature'], passed: false });
      expect(footer.comparison!.mismatches[0]).toMatchObject({ kind: 'changed', missingWords: [{ words: 'Page', before: 'Signature', after: '' }] });
    },
  );

  test.openspec('[SDX-MDOC-CREATE-11] paragraph comparison reports missing, extra and changed paragraphs')(
    'Scenario: paragraph comparison reports missing, extra and changed paragraphs',
    async () => {
      const expected = [{ text: 'One two  three', line: 1 }, { text: 'Repeated.', line: 3 }, { text: 'Repeated.', line: 5 }];
      expect(compareParagraphs(expected, ['One two three', 'Repeated.', 'Repeated.']).passed).toBe(true);
      // A repeated paragraph dropped once is still missing.
      expect(compareParagraphs(expected, ['One two three', 'Repeated.']).mismatches).toEqual([{ kind: 'missing', expected: 'Repeated.', expectedIndex: 2, line: 5 }]);
      expect(compareParagraphs(expected, ['One two three', 'Repeated.', 'Repeated.', 'Surprise.']).mismatches).toEqual([{ kind: 'extra', actual: 'Surprise.', actualIndex: 3 }]);
      // Normalization is whitespace only: case and punctuation still differ.
      expect(compareParagraphs([{ text: 'Approved.' }], ['approved.']).passed).toBe(false);
      expect(compareParagraphs([{ text: 'Approved.' }], ['Approved']).passed).toBe(false);
      expect(compareParagraphs([{ text: PAGE_NUMBER_FIELD }], ['12']).passed).toBe(true);
      expect(compareParagraphs([{ text: PAGE_NUMBER_FIELD }], ['twelve']).passed).toBe(false);
    },
  );

  test.openspec('[SDX-MDOC-CREATE-12] the PDF text layer matches the source word for word')(
    'Scenario: the PDF text layer matches the source word for word',
    async () => {
      const source: SourceProjection = {
        body: [{ text: 'CONSENT' }, { text: 'Confidential terms apply.' }, { text: 'The the Board approves.', marker: '1.' }],
        footers: [['Confidential', PAGE_NUMBER_FIELD]],
      };
      const page1 = 'Confidential\n1\nCONSENT\nConfidential terms apply.\n';
      const page2 = 'Confidential\n2\n1. The the Board approves.\n';
      // Each page starts with its footer region (text, then its own page number); list labels are expected words.
      const clean = comparePdfWords(source, [page1, page2]);
      expect(clean).toMatchObject({ passed: true, alignment: 'complete', missing: [], unexplainedExtra: [], footerMismatches: [], knownGenerated: { footerRegions: ['Confidential 1', 'Confidential 2'], listMarkers: 1, repeatedTableHeaders: [] } });

      // A body word that also appears in the footer is still missing when the body drops it.
      expect(comparePdfWords(source, ['Confidential\n1\nCONSENT\nterms apply.\n', page2])).toMatchObject({ passed: false, missing: [{ words: 'Confidential', before: 'CONSENT', after: 'terms apply. 1. The' }], unexplainedExtra: [] });
      // A repeated word ("The the") dropped once is missing, though the same word survives next to it.
      expect(comparePdfWords(source, [page1, 'Confidential\n2\n1. The Board approves.\n']).missing.map((span) => span.words)).toEqual(['the']);
      // Extra text fails, including footer text duplicated in the body.
      expect(comparePdfWords(source, [page1.replace('apply.', 'apply. Unexpected words'), page2]).unexplainedExtra).toEqual([{ words: 'Unexpected words', before: 'CONSENT Confidential terms apply.', after: '1. The the Board' }]);
      expect(comparePdfWords(source, [page1.replace('CONSENT', 'Confidential CONSENT'), page2]).unexplainedExtra.map((span) => span.words)).toEqual(['Confidential']);
      // A footer missing from a later page, or showing the wrong page number, fails.
      expect(comparePdfWords(source, [page1, '1. The the Board approves.\n']).footerMismatches).toEqual([{ page: 2, section: 0, expected: 'Confidential 2', found: '' }]);
      expect(comparePdfWords(source, [page1, page2.replace('\n2\n', '\n1\n')]).passed).toBe(false);
      // A generated list label cannot stand in for a deleted literal "1." (review P1).
      const literal: SourceProjection = { body: [{ text: 'The number is 1.' }, { text: 'Approved.', marker: '1.' }], footers: [null] };
      expect(comparePdfWords(literal, ['The number is 1.\n1. Approved.\n']).passed).toBe(true);
      expect(comparePdfWords(literal, ['The number is\n1. Approved.\n'])).toMatchObject({ passed: false, missing: [{ words: '1.' }] });
      expect(comparePdfWords(literal, ['The number is 1.\nApproved.\n'])).toMatchObject({ passed: false, missing: [{ words: '1.' }] });
      // A numeric footer is footer text, not the page number, so the PAGE value cannot hide a lost body "1" (review P1).
      const numeric: SourceProjection = { body: [{ text: '1' }, { text: 'TITLE' }, { text: 'Body final.' }], footers: [['123', PAGE_NUMBER_FIELD]] };
      expect(comparePdfWords(numeric, ['123\n1\n1\nTITLE\nBody final.\n']).passed).toBe(true);
      expect(comparePdfWords(numeric, ['123\n1\nTITLE\nBody final.\n'])).toMatchObject({ passed: false, missing: [{ words: '1' }] });
      expect(comparePdfWords({ ...numeric, body: numeric.body.slice(1) }, ['123\n1\nTITLE\nBody final.\n']).passed).toBe(true);
      // The footer region is only ever the head of the page: body text equal to the footer stays body text.
      const edge: SourceProjection = { body: [{ text: 'Terms.' }, { text: 'Confidential' }], footers: [['Confidential', PAGE_NUMBER_FIELD]] };
      expect(comparePdfWords(edge, ['Confidential\n1\nTerms.\nConfidential\n']).passed).toBe(true);
      expect(comparePdfWords(edge, ['Confidential\n1\nTerms.\n'])).toMatchObject({ passed: false, missing: [{ words: 'Confidential' }] });
      expect(comparePdfWords(edge, ['Terms.\nConfidential\n1\n']).passed).toBe(false);

      // Ligatures fold under NFKC; nothing else is normalized.
      expect(comparePdfWords({ body: [{ text: 'final' }], footers: [null] }, ['ﬁnal\n']).passed).toBe(true);
      expect(comparePdfWords({ body: [{ text: 'Final' }], footers: [null] }, ['final\n']).passed).toBe(false);
    },
  );

  test.openspec('[SDX-MDOC-CREATE-12] each page carries the footer of its own section, and only a continuing table repeats its header')(
    'Scenario: each page carries the footer of its own section, and only a continuing table repeats its header',
    async () => {
      // Sections: A, then inherited A, then B. A wrong-section footer fails.
      const sections: SourceProjection = {
        body: [{ text: 'first', section: 0 }, { text: 'second', section: 1 }, { text: 'third', section: 2 }],
        footers: [['A'], null, ['B']],
      };
      expect(comparePdfWords(sections, ['A\nfirst\n', 'A\nsecond\n', 'B\nthird\n']).passed).toBe(true);
      expect(comparePdfWords(sections, ['A\nfirst\n', 'A\nsecond\n', 'A\nthird\n']).footerMismatches).toEqual([{ page: 3, section: 2, expected: 'B', found: 'A' }]);
      expect(comparePdfWords(sections, ['A\nfirst\n', 'B\nsecond\n', 'B\nthird\n']).footerMismatches).toEqual([{ page: 2, section: 1, expected: 'A', found: 'B' }]);

      const cell = (text: string, row: number, id = 0): SourceBodyEntry => ({ text, cell: true, table: { id, row } });
      const table: SourceProjection = {
        body: [cell('Holder', 0), cell('Shares', 0), cell('A', 1), cell('1', 1), cell('Holder', 2), cell('Shares', 2), cell('B', 3), cell('2', 3), { text: 'After.' }],
        footers: [null],
      };
      // The header repeats at the top of the continuation page.
      const split = comparePdfWords(table, ['Holder Shares\nA 1\n', 'Holder Shares\nHolder Shares\nB 2\nAfter.\n']);
      expect(split).toMatchObject({ passed: true, knownGenerated: { repeatedTableHeaders: [{ page: 2, table: 0 }] } });
      // A body row with the header's words, omitted on the continuation page, is still missing.
      expect(comparePdfWords(table, ['Holder Shares\nA 1\n', 'Holder Shares\nB 2\nAfter.\n'])).toMatchObject({ passed: false, missing: [{ words: 'Holder Shares' }] });
      // The header repeated where the table does not continue is an extra.
      expect(comparePdfWords(table, ['Holder Shares\nA 1\nHolder Shares\nB 2\n', 'Holder Shares\nAfter.\n']).unexplainedExtra.map((span) => span.words)).toEqual(['Holder Shares']);
      // A body row equal to the header, lost just before the page break, is not hidden by the continuation header.
      const equal: SourceProjection = { body: [{ text: 'TITLE' }, cell('Header', 0), cell('Header', 1), cell('Beta', 2), { text: 'END' }], footers: [null] };
      expect(comparePdfWords(equal, ['TITLE\nHeader\nHeader\n', 'Header\nBeta\nEND\n'])).toMatchObject({ passed: true, knownGenerated: { repeatedTableHeaders: [{ page: 2, table: 0 }] } });
      expect(comparePdfWords(equal, ['TITLE\nHeader\n', 'Header\nBeta\nEND\n'])).toMatchObject({ passed: false, unverifiedTableHeaders: [{ page: 2, words: 'Header' }] });
      // Tables with identical headers: the continuation is matched to the table that actually continues.
      const same: SourceProjection = { body: [cell('Holder', 0), cell('A', 1), cell('Holder', 0, 1), cell('B', 1, 1), cell('C', 2, 1)], footers: [null] };
      expect(comparePdfWords(same, ['Holder\nA\nHolder\nB\n', 'Holder\nC\n'])).toMatchObject({ passed: true, knownGenerated: { repeatedTableHeaders: [{ page: 2, table: 1 }] } });

      // One header a prefix of another ("H" and "H X"): the continuation removes the whole longer header, so its
      // second word cannot stand in for a body word lost before the break.
      const prefix: SourceProjection = {
        body: [{ text: 'TITLE' }, cell('H', 0), cell('a', 1), cell('foo', 1), { text: 'BETWEEN' }, cell('H', 0, 1), cell('X', 0, 1), cell('r0', 1, 1), cell('X', 1, 1), cell('r1', 2, 1), cell('X', 2, 1), { text: 'END' }],
        footers: [null],
      };
      expect(comparePdfWords(prefix, ['TITLE H a foo BETWEEN H X r0 X\n', 'H X r1 X END\n'])).toMatchObject({ passed: true, knownGenerated: { repeatedTableHeaders: [{ page: 2, table: 1 }] } });
      expect(comparePdfWords(prefix, ['TITLE H a foo BETWEEN H X r0\n', 'H X r1 X END\n'])).toMatchObject({ passed: false, missing: [{ words: 'X' }] });
      // No pages at all cannot satisfy any section.
      expect(comparePdfWords({ body: [], footers: [null] }, [])).toMatchObject({ passed: false, footerMismatches: [{ reason: 'the PDF has no pages' }] });

      // A section with no words (an empty table) still owns its page: the page cannot borrow a neighbour's footer.
      const blank: SourceProjection = {
        body: [{ text: 'FIRST', section: 0 }, { ...cell('', 0), section: 1 }, { ...cell('', 1), section: 1 }, { text: 'LAST', section: 2 }],
        footers: [['A'], ['B'], null],
      };
      expect(comparePdfWords(blank, ['A\nFIRST\n', 'B\n', 'B\nLAST\n']).passed).toBe(true);
      expect(comparePdfWords(blank, ['A\nFIRST\n', 'A\n', 'B\nLAST\n']).footerMismatches).toEqual([{ page: 2, section: 1, expected: 'B', found: 'A' }]);
      expect(comparePdfWords(blank, ['A\nFIRST\n', '', 'B\nLAST\n']).footerMismatches).toEqual([{ page: 2, section: 1, expected: 'B', found: '' }]);
      // With no page for the empty section, or two wordless pages that could belong to either section, nothing is certified.
      expect(comparePdfWords(blank, ['A\nFIRST\n', 'B\nLAST\n']).footerMismatches).toMatchObject([{ page: 2, reason: 'no page for section 1' }]);
      expect(comparePdfWords(blank, ['A\nFIRST\n', 'A\n', 'B\n', 'B\nLAST\n']).footerMismatches).toMatchObject([{ page: 2, section: null, expected: 'A | B', reason: expect.stringMatching(/section 0 or 1/) }]);
      expect(comparePdfWords({ ...blank, body: blank.body.slice(0, 3) }, ['A\nFIRST\n', 'B\n']).footerMismatches).toMatchObject([{ reason: '1 section(s) have no page' }]);

      // List labels follow the grammar's numbering definition.
      expect([listMarker(true, 0, 3), listMarker(true, 1, 2), listMarker(true, 1, 27), listMarker(true, 2, 4), listMarker(true, 2, 14), listMarker(false, 0, 1), listMarker(false, 2, 9)])
        .toEqual(['3.', '(b)', '(aa)', '(iv)', '(xiv)', '•', '▪']);
      // A second table with the same header that starts a page is that table's own header.
      const two: SourceProjection = { body: [cell('Holder', 0), cell('Shares', 0), cell('A', 1), cell('1', 1), cell('Holder', 0, 1), cell('Shares', 0, 1), cell('C', 1, 1), cell('3', 1, 1)], footers: [null] };
      expect(comparePdfWords(two, ['Holder Shares\nA 1\n', 'Holder Shares\nC 3\n'])).toMatchObject({ passed: true, knownGenerated: { repeatedTableHeaders: [] } });
    },
  );
  test.openspec('[SDX-MDOC-CREATE-12] texts too different to align fail rather than pass')(
    'Scenario: texts too different to align fail rather than pass',
    async () => {
      const words = Array.from({ length: 1200 }, (_, index) => `w${index}`);
      const other = Array.from({ length: 1200 }, (_, index) => `x${index}`);
      const result = comparePdfWords({ body: [{ text: words.join(' ') }], footers: [null] }, [other.join(' ')]);
      expect(result.alignment).toBe('over-budget');
      expect(result.passed).toBe(false);
      expect(result.missing[0]!.words.split(' ')).toHaveLength(1200);
    },
  );

  test.openspec('[SDX-MDOC-CREATE-13] a failed verification leaves a mismatch report and publishes nothing')(
    'Scenario: a failed verification leaves a mismatch report and publishes nothing',
    async () => {
      const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sdx-create-report-')));
      /** Fake renderer whose text layer is whatever the test says. */
      const pdfText = (text: string): PdfRenderTools => ({
        resolve: (name) => `/fake/${name}`,
        async run(command, args) {
          if (command.endsWith('soffice')) {
            const outdir = args[args.indexOf('--outdir') + 1]!;
            await mkdir(outdir, { recursive: true });
            await writeFile(path.join(outdir, 'input.pdf'), '%PDF-fake');
            return { code: 0, stdout: '', stderr: '' };
          }
          return { code: 0, stdout: text, stderr: '' };
        },
      });
      try {
        const source = path.join(dir, 'consent.mdoc');
        await writeFile(source, '# CONSENT\n\nThe Board approves the plan.\n\nThe officers may act.');
        const out = path.join(dir, 'out');
        const first = await runCreateCommand([source, out], { renderTools: pdfText('CONSENT\nThe Board approves the plan.\nThe officers may act.\n\f') });
        expect(first.pdf).toMatchObject({ status: 'passed', words: { passed: true, expectedWords: 10 } });
        expect(first.pdf).not.toHaveProperty('pageTexts');
        expect(first.summary).toContain('pdf words ok (10 source words)');
        const certificatePath = path.join(out, 'consent.verification.json');
        const certificate = await readFile(certificatePath, 'utf8');
        expect(JSON.parse(certificate).pdf.words.passed).toBe(true);
        const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(out)).filter((name) => !name.endsWith('.failed-verification.json')).sort().map(async (name) => [name, (await readFile(path.join(out, name))).toString('base64')] as const)));
        const before = await snapshot();

        // The PDF passes the old first/last-paragraph check but drops a middle word.
        const dropped = pdfText('CONSENT\nThe Board approves plan.\nThe officers may act.\n\f');
        const error = await runCreateCommand([source, out, '--replace'], { renderTools: dropped }).then(() => undefined, (caught: Error & { code?: string; reportPath?: string }) => caught);
        const report = path.join(out, 'consent.failed-verification.json');
        expect(error).toMatchObject({ code: 'CREATION_PDF_WORDS_MISMATCH', reportPath: report });
        expect(error!.message).toContain(`Mismatch report: ${report}`);
        expect(error!.message).toContain('Nothing was published');
        const written = JSON.parse(await readFile(report, 'utf8'));
        expect(written).toMatchObject({ kind: 'markdoc-create-failure', code: 'CREATION_PDF_WORDS_MISMATCH', published: false, source: 'consent.mdoc' });
        expect(written.details.words.missing).toEqual([{ words: 'the', before: 'CONSENT The Board approves', after: 'plan. The officers may' }]);
        expect(written.details).not.toHaveProperty('pageTexts');
        // The successful certificate and every published output are untouched.
        expect(await snapshot()).toEqual(before);
        expect(await readFile(certificatePath, 'utf8')).toBe(certificate);
        expect((await readdir(out)).filter((name) => name.startsWith('.'))).toEqual([]);

        // The next failed build replaces the report.
        const extraWord = pdfText('CONSENT\nThe Board approves the whole plan.\nThe officers may act.\n\f');
        await expect(runCreateCommand([source, out, '--replace'], { renderTools: extraWord })).rejects.toMatchObject({ code: 'CREATION_PDF_WORDS_MISMATCH' });
        const replaced = JSON.parse(await readFile(report, 'utf8'));
        expect(replaced.details.words).toMatchObject({ missing: [], unexplainedExtra: [{ words: 'whole' }] });
        expect(await snapshot()).toEqual(before);

        // While another run holds the stem lock, nothing is written: not even the report.
        const reportBytes = await readFile(report, 'utf8');
        await writeFile(path.join(out, '.consent.create.lock'), '1\n');
        await expect(runCreateCommand([source, out, '--replace'], { renderTools: dropped })).rejects.toMatchObject({ code: 'CREATION_LOCKED' });
        await expect(runCreateCommand([source, out, '--replace', '--no-pdf'])).rejects.toMatchObject({ code: 'CREATION_LOCKED' });
        expect(await readFile(report, 'utf8')).toBe(reportBytes);
        await rm(path.join(out, '.consent.create.lock'));
        expect(await snapshot()).toEqual(before);

        // A verification failure in a new directory leaves only the report.
        const fresh = path.join(dir, 'fresh');
        await expect(runCreateCommand([source, fresh], { renderTools: dropped })).rejects.toMatchObject({ code: 'CREATION_PDF_WORDS_MISMATCH' });
        expect(await readdir(fresh)).toEqual(['consent.failed-verification.json']);

        // The next successful build removes the stale report.
        await runCreateCommand([source, out, '--replace', '--no-pdf']);
        expect((await readdir(out)).sort()).toEqual(['consent.docx', 'consent.txt', 'consent.verification.json']);

        // A report path occupied by a directory: the failure is still reported, naming why no report was written.
        await mkdir(path.join(out, 'consent.failed-verification.json'));
        const blocked = await runCreateCommand([source, out, '--replace'], { renderTools: dropped }).then(() => undefined, (caught: Error & { reportPath?: string | null }) => caught);
        expect(blocked).toMatchObject({ code: 'CREATION_PDF_WORDS_MISMATCH', reportPath: null });
        expect(blocked!.message).toMatch(/could not be written \(.*not a file\)/);
        expect((await readdir(out)).filter((name) => name.startsWith('.'))).toEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

});

const realTools = defaultPdfRenderTools();
const describeWithLibreOffice = realTools.resolve('soffice') && realTools.resolve('pdftotext') ? describe : describe.skip;

describeWithLibreOffice('Traceability: PDF word check with a real LibreOffice', () => {
  test.openspec('[SDX-MDOC-CREATE-12] a real LibreOffice PDF of every construct matches the source word for word')(
    'Scenario: a real LibreOffice PDF of every construct matches the source word for word',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-pdf-words-'));
      try {
        const source = path.join(dir, 'full.mdoc');
        await writeFile(source, FULL_SOURCE);
        const result = await runCreateCommand([source, path.join(dir, 'out'), '--require-pdf']);
        expect(result.pdf).toMatchObject({ status: 'passed', words: { passed: true, alignment: 'complete', missing: [], unexplainedExtra: [] } });
        const words = (result.pdf as { words: { knownGenerated: { footerRegions: string[]; listMarkers: number } } }).words;
        expect(words.knownGenerated).toMatchObject({ footerRegions: ['Confidential Draft 1', 'Signature Page'], listMarkers: 2 });

        // Table cells that wrap onto several lines still read in document order.
        const wrapped = path.join(dir, 'wrapped.mdoc');
        await writeFile(wrapped, [
          '---', 'footer: Draft', 'page-numbers: true', '---', '', '# TABLE', '',
          '{% table widths="30,70" %}', '* Name', '* Description', '---',
          '* Holder One With A Rather Long Name That Wraps',
          '* This description is long enough that it will certainly wrap across several lines inside its narrow cell of the table.',
          '---', '* Two', '* Short.', '{% /table %}', '', 'After the table.',
        ].join('\n'));
        const table = await runCreateCommand([wrapped, path.join(dir, 'out'), '--require-pdf']);
        expect(table.pdf).toMatchObject({ status: 'passed', words: { passed: true, missing: [], unexplainedExtra: [], footerMismatches: [], knownGenerated: { footerRegions: ['Draft 1'] } } });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
  test.openspec('[SDX-MDOC-CREATE-12] real multi-page PDFs: repeated table headers, section footers and numeric footers')(
    'Scenario: real multi-page PDFs: repeated table headers, section footers and numeric footers',
    async () => {
      const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sdx-create-pdf-pages-')));
      try {
        const build = async (name: string, lines: string[]) => {
          const file = path.join(dir, `${name}.mdoc`);
          await writeFile(file, lines.join('\n'));
          return runCreateCommand([file, path.join(dir, 'out'), '--require-pdf']);
        };
        const rows = Array.from({ length: 65 }, (_, index) => [`* Holder ${index + 1}`, `* Description ${index + 1} ordinary terms apply.`, '---']).flat().slice(0, -1);
        const longTable = await build('long-table', ['---', 'footer: Draft', 'page-numbers: true', '---', '', '# TABLE', '', '{% table widths="30,70" %}', '* Holder', '* Description', '---', ...rows, '{% /table %}', '', 'After the table.']);
        expect(longTable.pdf).toMatchObject({ status: 'passed', pageCount: 2, words: { passed: true, footerMismatches: [], knownGenerated: { footerRegions: ['Draft 1', 'Draft 2'], repeatedTableHeaders: [{ page: 2, table: 0 }] } } });

        const numeric = await build('numeric', ['---', 'footer: 123', 'page-numbers: true', '---', '', '# TITLE', '', 'Body final.']);
        expect(numeric.pdf).toMatchObject({ status: 'passed', words: { passed: true, knownGenerated: { footerRegions: ['123 1'] } } });

        const sections = await build('sections', [
          '---', 'footer: First Footer', 'page-numbers: true', '---', '', '# SECTIONS', '', 'First body.', '', '{% page-break /%}', '', 'Still first section.', '',
          '{% section /%}', '', 'Inherited footer.', '', '{% section footer="Last Footer" /%}', '', 'Last body.', '', '{% section page-numbers=false /%}', '', 'No footer here.',
        ]);
        const identical = await build('identical', [
          '# TABLES', '', '{% table %}', '* Holder', '* Description', '---', '* First', '* Short.', '{% /table %}', '',
          'Between the tables.', '', '{% table widths="30,70" %}', '* Holder', '* Description', '---', ...rows, '{% /table %}',
        ]);
        expect(identical.pdf).toMatchObject({ status: 'passed', pageCount: 2, words: { passed: true, knownGenerated: { repeatedTableHeaders: [{ page: 2, table: 1 }] } } });

        const prefixRows = Array.from({ length: 65 }, (_, index) => ['---', `* r${index}`, '* X']).flat();
        const prefixTables = await build('prefix', ['# TITLE', '', '{% table %}', '* H', '* ', '---', '* a', '* foo', '{% /table %}', '', 'BETWEEN', '', '{% table %}', '* H', '* X', ...prefixRows, '{% /table %}', '', 'END']);
        expect(prefixTables.pdf).toMatchObject({ status: 'passed', pageCount: 2, words: { passed: true, unverifiedTableHeaders: [], knownGenerated: { repeatedTableHeaders: [{ page: 2, table: 1 }] } } });

        const blankSection = await build('blank-section', ['---', 'footer: A', '---', '', 'FIRST', '', '{% section footer="B" /%}', '', '{% table %}', '* ', '* ', '---', '* ', '* ', '{% /table %}', '', '{% section /%}', '', 'LAST']);
        expect(blankSection.pdf).toMatchObject({ status: 'passed', pageCount: 3, words: { passed: true, footerMismatches: [], knownGenerated: { footerRegions: ['A', 'B', 'B'] } } });

        expect(sections.pdf).toMatchObject({ status: 'passed', words: { passed: true, knownGenerated: { footerRegions: ['First Footer 1', 'First Footer 2', 'First Footer 3', 'Last Footer', ''] } } });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
