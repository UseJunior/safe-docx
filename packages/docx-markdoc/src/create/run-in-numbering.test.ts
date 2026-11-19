import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { OOXML, computeParagraphListLabels, parseNumberingXml, parseStylesXml, parseXml, type NumberingSpec } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { createDocumentFromMarkdoc, crossReferenceCheck, type CreationCertificate } from './create.js';
import { lowerCreationMarkdoc } from './lower.js';
import { comparePdfWords, projectSourceText } from './oracle.js';
import { readCreatedDocx } from './readback.js';

const TEST_FEATURE = 'add-created-run-in-numbering-and-toc';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1417 run-in legal numbering in created documents',
  severity: 'critical',
});

const W = OOXML.W_NS;

/** A synthetic agreement in the run-in house style. */
const SOURCE = [
  '# INVESTMENT MANAGEMENT AGREEMENT',
  '',
  '{% run-in-paragraph level="article" heading="Services" #services /%}',
  '',
  '{% run-in-paragraph level="section" heading="Engagement" #engagement %}',
  'The Manager is appointed to manage the Account under {% xref to="scope" format="section" /%}.',
  '{% /run-in-paragraph %}',
  '',
  '{% run-in-paragraph level="clause" heading="Scope" #scope %}',
  'The Manager shall manage the assets in {% xref to="first-item" format="section" /%}.',
  '{% /run-in-paragraph %}',
  '',
  '{% run-in-paragraph level="subclause" #first-item %}',
  'the first item of the Account;',
  '{% /run-in-paragraph %}',
  '',
  '{% run-in-paragraph level="article" heading="Fees:" /%}',
  '',
  '{% run-in-paragraph level="section" heading="Management Fee" %}',
  'Under Article {% xref to="services" /%}, clause {% xref to="scope" number="paragraph" /%} and {% xref to="engagement" number="paragraph" /%}, the Client shall pay {% xref to="scope" /%}.',
  '{% /run-in-paragraph %}',
  '',
].join('\n');

async function parts(docx: Buffer): Promise<{ document: Document; numbering: Document; styles: Document }> {
  const zip = await JSZip.loadAsync(docx);
  const read = async (name: string) => parseXml(await zip.file(name)!.async('string'));
  return { document: await read('word/document.xml'), numbering: await read('word/numbering.xml'), styles: await read('word/styles.xml') };
}

function textOf(paragraph: Element): string {
  return Array.from(paragraph.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join('');
}

async function failure(source: string): Promise<{ code?: string; line?: number } | undefined> {
  return createDocumentFromMarkdoc(source).then(() => undefined, (error: { code?: string; details?: { line?: number } }) => ({ code: error.code, line: error.details?.line }));
}

function runInDefinition(numbering: readonly NumberingSpec[] | undefined): NumberingSpec {
  return numbering!.find((definition) => definition.numId.startsWith('run-in-'))!;
}

describe('Traceability: run-in legal numbering in created documents', () => {
  test.openspec('[SDX-MDOC-RUNIN-01] run-in paragraphs are numbered by a real multilevel list with their heading inline')(
    'Scenario: run-in paragraphs are numbered by a real multilevel list with their heading inline',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      expect(created.certificate.passed).toBe(true);
      const definition = runInDefinition(created.lowering.spec.numbering);
      expect(definition.levels.map(({ numFmt, lvlText, suff }) => ({ numFmt, lvlText, suff }))).toEqual([
        { numFmt: 'decimal', lvlText: '%1.', suff: 'space' },
        { numFmt: 'decimalZero', lvlText: '%1.%2', suff: 'space' },
        { numFmt: 'lowerLetter', lvlText: '(%3)', suff: 'space' },
        { numFmt: 'lowerRoman', lvlText: '(%4)', suff: 'space' },
      ]);
      // docx-core's read side labels the paragraphs from the DOCX's own numbering, as Word does.
      const { document, numbering, styles } = await parts(created.docx);
      const paragraphs = Array.from(document.getElementsByTagNameNS(W, 'p'));
      const labels = computeParagraphListLabels(paragraphs, parseNumberingXml(numbering), parseStylesXml(styles));
      expect(paragraphs.flatMap((paragraph) => (labels.get(paragraph)?.label ? [`${labels.get(paragraph)!.label} ${textOf(paragraph)}`] : []))).toEqual([
        '1. Services.',
        '1.01 Engagement. The Manager is appointed to manage the Account under Section 1.01(a).',
        '(a) Scope. The Manager shall manage the assets in Section 1.01(a)(i).',
        '(i) the first item of the Account;',
        '2. Fees:',
        '2.01 Management Fee. Under Article 1, clause (a) and 1.01, the Client shall pay 1.01(a).',
      ]);
      // Each paragraph carries its own numPr; the heading is bold for an article and underlined below it.
      const numbered = paragraphs.filter((paragraph) => paragraph.getElementsByTagNameNS(W, 'numPr').length > 0);
      expect(numbered).toHaveLength(6);
      const firstRun = (paragraph: Element) => paragraph.getElementsByTagNameNS(W, 'r').item(0)!;
      expect(firstRun(numbered[0]!).getElementsByTagNameNS(W, 'b')).toHaveLength(1);
      expect(firstRun(numbered[1]!).getElementsByTagNameNS(W, 'u')).toHaveLength(1);
      expect(textOf(firstRun(numbered[1]!))).toBe('Engagement');
      // The source oracle labels the same paragraphs from the source alone.
      expect(projectSourceText(SOURCE).body.filter((entry) => entry.marker).map((entry) => entry.marker)).toEqual(['1.', '1.01', '(a)', '(i)', '2.', '2.01']);
      // A source without the tag declares no run-in definition.
      expect(lowerCreationMarkdoc('# T\n\n1. One.\n').spec.numbering!.some((entry) => entry.numId.startsWith('run-in-'))).toBe(false);
    },
  );

  test.openspec('[SDX-MDOC-RUNIN-02] cross-references to run-in paragraphs show the full number Word shows')(
    'Scenario: cross-references to run-in paragraphs show the full number Word shows',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      expect(created.certificate.checks.crossReferences?.passed).toBe(true);
      expect(created.readback.crossReferences?.map(({ text, instruction }) => `${instruction.trim()} = ${text}`)).toEqual([
        'REF scope \\w \\h = 1.01(a)',
        'REF first_item \\w \\h = 1.01(a)(i)',
        'REF services \\w \\h = 1',
        'REF scope \\n \\h = (a)',
        'REF engagement \\n \\h = 1.01',
        'REF scope \\w \\h = 1.01(a)',
      ]);

      // Numbering that starts the sections at 2 makes every number differ from the source: the build fails.
      const shifted = await createDocumentFromMarkdoc(SOURCE, {
        transformLowering(lowering) {
          runInDefinition(lowering.spec.numbering).levels[1]!.start = 2;
          return lowering;
        },
      }).then(() => undefined, (error: { code?: string; details?: CreationCertificate }) => error);
      expect(shifted?.code).toBe('CREATION_VERIFICATION_FAILED');
      expect(shifted?.details?.checks.crossReferences?.passed).toBe(false);

      // A stale cached REF result (the number before a renumbering) fails the cross-reference check.
      const zip = await JSZip.loadAsync(created.docx);
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).toContain('>1.01(a)(i)<');
      zip.file('word/document.xml', xml.replace('>1.01(a)(i)<', '>1.02(a)(i)<'));
      const stale = await readCreatedDocx(await zip.generateAsync({ type: 'nodebuffer' }));
      const check = crossReferenceCheck(projectSourceText(SOURCE), stale)!;
      expect(check.passed).toBe(false);
      expect(JSON.stringify(check.mismatches)).toContain('1.02(a)(i)');
      expect(crossReferenceCheck(projectSourceText(SOURCE), created.readback)!.passed).toBe(true);

      // LibreOffice can break a line right before the "(" inside a reference number ("1.01(a)" then "(i)."):
      // the PDF check rejoins those tokens only into the source word they spell.
      const wrapped = '# T\n\n{% run-in-paragraph level="article" heading="A" /%}\n\n{% run-in-paragraph level="section" heading="B" /%}\n\n{% run-in-paragraph level="clause" heading="C" /%}\n\n{% run-in-paragraph level="subclause" #sub /%}\n\nSee {% xref to="sub" /%}.\n';
      const expected = projectSourceText(wrapped, { reader: 'libreoffice' });
      const page = (reference: string) => `T\n1. A.\n1.01 B.\n(a) C.\n(i)\nSee ${reference}\n`;
      expect(comparePdfWords(expected, [page('1.01(a)(i).')]).passed).toBe(true);
      expect(comparePdfWords(expected, [page('1.01(a)\n(i).')]).passed).toBe(true);
      expect(comparePdfWords(expected, [page('1.01(a)\n(ii).')]).passed).toBe(false);
    },
  );

  test.openspec('[SDX-MDOC-RUNIN-03] run-in sources that readers would number differently fail closed')(
    'Scenario: run-in sources that readers would number differently fail closed',
    async () => {
      const article = '{% run-in-paragraph level="article" heading="A" /%}\n\n';
      const section = '{% run-in-paragraph level="section" heading="S" /%}\n\n';
      expect(await failure(`# T\n\n${section}`)).toEqual({ code: 'RUN_IN_SKIPS_LEVEL', line: 3 });
      expect(await failure(`# T\n\n${article}{% run-in-paragraph level="clause" heading="C" /%}\n`)).toEqual({ code: 'RUN_IN_SKIPS_LEVEL', line: 5 });
      expect(await failure(`# T\n\n${article}${section}{% run-in-paragraph level="subclause" heading="C" /%}\n`)).toEqual({ code: 'RUN_IN_SKIPS_LEVEL', line: 7 });
      // A new article restarts its levels: a clause right after it needs a section again.
      expect(await failure(`# T\n\n${article}${section}${article}{% run-in-paragraph level="clause" heading="C" /%}\n`)).toEqual({ code: 'RUN_IN_SKIPS_LEVEL', line: 9 });
      expect(await failure(`---\nheading-numbers: legal\n---\n\n# T\n\n${article}`)).toEqual({ code: 'RUN_IN_WITH_HEADING_NUMBERS', line: 7 });
      expect((await failure(`# T\n\n${article}{% run-in-paragraph level="section" /%}\n`))?.code).toBe('INVALID_RUN_IN_PARAGRAPH');
      expect((await failure('# T\n\n{% run-in-paragraph level="chapter" heading="A" /%}\n'))?.code).toBe('INVALID_RUN_IN_PARAGRAPH');
      expect((await failure(`# T\n\n${article}{% run-in-paragraph level="section" heading="S" %}\nOne.\n\nTwo.\n{% /run-in-paragraph %}\n`))?.code).toBe('INVALID_RUN_IN_PARAGRAPH');
      const target = `# T\n\n{% run-in-paragraph level="article" heading="A" #a /%}\n\n`;
      expect(await failure(`${target}See {% xref to="a" show="text" /%}.\n`)).toEqual({ code: 'XREF_RUN_IN_FORM_UNSUPPORTED', line: 5 });
      expect(await failure(`${target}See {% xref to="a" number="relative" /%}.\n`)).toEqual({ code: 'XREF_RUN_IN_FORM_UNSUPPORTED', line: 5 });
    },
  );
});
