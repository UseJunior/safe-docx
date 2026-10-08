import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPdfRenderTools, type PdfRenderTools } from '../pdf/tools.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import type { CreationLowering } from './lower.js';
import { PAGE_NUMBER_FIELD, comparePdfWords, compareParagraphs, projectSourceText, type SourceProjection } from './oracle.js';

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
        body: [{ text: 'CONSENT' }, { text: 'Confidential terms apply.' }, { text: 'The the Board approves.' }],
        footers: [['Confidential', PAGE_NUMBER_FIELD]],
      };
      // Footer and page number at the end of each page, list numbers inline: all known generated.
      const clean = comparePdfWords(source, ['CONSENT\nConfidential terms apply.\nConfidential\n1\n', '1. The the Board approves.\nConfidential\n2\n']);
      expect(clean).toMatchObject({ passed: true, alignment: 'complete', missing: [], unexplainedExtra: [], knownGenerated: { footerOccurrences: 2, pageNumbers: ['1', '2'], listNumbers: ['1.'] } });

      // A body word that also appears in the footer is still missing when the body drops it.
      const footerWord = comparePdfWords(source, ['CONSENT\nterms apply.\nConfidential\n1\n', 'The the Board approves.\nConfidential\n2\n']);
      expect(footerWord).toMatchObject({ passed: false, missing: [{ words: 'Confidential', before: 'CONSENT', after: 'terms apply. The the' }], unexplainedExtra: [] });

      // A repeated word ("The the") dropped once is missing, though the same word survives next to it.
      const repeated = comparePdfWords(source, ['CONSENT\nConfidential terms apply.\nConfidential\n1\n', 'The Board approves.\nConfidential\n2\n']);
      expect(repeated.passed).toBe(false);
      expect(repeated.missing.map((span) => span.words)).toEqual(['the']);

      // Extra text that is not a declared footer, a page number or a list number fails.
      const extra = comparePdfWords(source, ['CONSENT\nConfidential terms apply.\nUnexpected words\nConfidential\n1\n', 'The the Board approves.\nConfidential\n2\n']);
      expect(extra).toMatchObject({ passed: false, missing: [], unexplainedExtra: [{ words: 'Unexpected words', before: 'CONSENT Confidential terms apply.', after: 'The the Board approves.' }] });

      // A footer duplicated mid-page is not the page's footer: it is an unexplained extra.
      const duplicated = comparePdfWords(source, ['CONSENT\nConfidential\nConfidential terms apply.\nConfidential\n1\n', 'The the Board approves.\nConfidential\n2\n']);
      expect(duplicated.passed).toBe(false);
      expect(duplicated.unexplainedExtra.map((span) => span.words)).toEqual(['Confidential']);

      // A page number is generated only when the source declares page numbers; without one, the trailing
      // "7" is not peeled, so the footer before it is no longer at the end of the page either.
      const noNumbers = comparePdfWords({ ...source, footers: [['Confidential']] }, ['CONSENT\nConfidential terms apply.\nConfidential\n7\n', 'The the Board approves.\nConfidential\n']);
      expect(noNumbers.unexplainedExtra.map((span) => span.words)).toEqual(['Confidential 7']);
      expect(noNumbers.knownGenerated).toEqual({ footerOccurrences: 1, pageNumbers: [], listNumbers: [] });

      // pdftotext -raw puts LibreOffice's footer first on the page; a body page that ends in a bare
      // number keeps it, because the page number is taken only next to the footer.
      const headFooter = comparePdfWords({ body: [{ text: 'Approved in Section 2' }], footers: [['Confidential', PAGE_NUMBER_FIELD]] }, ['Confidential\n1\nApproved in Section 2\n']);
      expect(headFooter).toMatchObject({ passed: true, knownGenerated: { footerOccurrences: 1, pageNumbers: ['1'] } });

      // Page-edge footer removal cannot hide body text equal to the footer: when the body's last
      // paragraph is the footer text and the body copy is dropped, only the footer copy is removed.
      const edge: SourceProjection = { body: [{ text: 'Terms.' }, { text: 'Confidential' }], footers: [['Confidential', PAGE_NUMBER_FIELD]] };
      expect(comparePdfWords(edge, ['Confidential\n1\nTerms.\nConfidential\n']).passed).toBe(true);
      expect(comparePdfWords(edge, ['Terms.\nConfidential\nConfidential\n1\n']).passed).toBe(true);
      for (const page of ['Confidential\n1\nTerms.\n', 'Terms.\nConfidential\n1\n']) {
        expect(comparePdfWords(edge, [page]), page).toMatchObject({ passed: false, missing: [{ words: 'Confidential' }] });
      }
      // A footer at both edges is removed once; the second copy is still an extra.
      expect(comparePdfWords(edge, ['Confidential\n1\nTerms.\nConfidential\nConfidential\n']).unexplainedExtra.map((span) => span.words)).toEqual(['Confidential']);

      // Ligatures fold under NFKC; nothing else is normalized.
      expect(comparePdfWords({ body: [{ text: 'final' }], footers: [null] }, ['ﬁnal\n']).passed).toBe(true);
      expect(comparePdfWords({ body: [{ text: 'Final' }], footers: [null] }, ['final\n']).passed).toBe(false);
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
        const words = (result.pdf as { words: { knownGenerated: { footerOccurrences: number; pageNumbers: string[]; listNumbers: string[] } } }).words;
        expect(words.knownGenerated.footerOccurrences).toBe(2);
        expect(words.knownGenerated.pageNumbers).toEqual(['1']);
        expect(words.knownGenerated.listNumbers).toEqual(['1.', '(a)']);

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
        expect(table.pdf).toMatchObject({ status: 'passed', words: { passed: true, missing: [], unexplainedExtra: [], knownGenerated: { footerOccurrences: 1, pageNumbers: ['1'] } } });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
