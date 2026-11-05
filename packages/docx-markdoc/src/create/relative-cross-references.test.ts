import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { parseXml, type InlineSpec, type ParagraphSpec } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { requiredPdfText, runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import { projectSourceText } from './oracle.js';

const TEST_FEATURE = 'add-relative-cross-references';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1258 relative cross-references in created documents',
  severity: 'critical',
});
const conforming = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = path.resolve(__dirname, '../../../../scripts/oracle/word/evidence/issue-1258-word-16.114.json');

type CreateCase = {
  name: string;
  source: string;
  references: Array<{ instruction: string; cached: string; word: string }>;
  afterInsertingSection?: Array<{ insertedBeforeParagraph: string; references: Array<{ instruction: string; word: string }> }>;
};
const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as { create: CreateCase[] };
const LEGAL = evidence.create.find((entry) => entry.name === 'legal headings')!;
const LISTS = evidence.create.find((entry) => entry.name === 'plain lists')!;

/** Each REF field's instruction and cached result, body first and then the footnotes. */
async function cachedFields(docx: Buffer): Promise<Array<{ instruction: string; result: string }>> {
  const zip = await JSZip.loadAsync(docx);
  const out: Array<{ instruction: string; result: string }> = [];
  for (const part of ['word/document.xml', 'word/footnotes.xml']) {
    const xml = await zip.file(part)?.async('string');
    if (!xml) continue;
    let open: { instruction: string; result: string; inResult: boolean } | null = null;
    for (const run of Array.from(parseXml(xml).getElementsByTagNameNS(W, 'r'))) {
      const type = run.getElementsByTagNameNS(W, 'fldChar').item(0)?.getAttributeNS(W, 'fldCharType');
      if (type === 'begin') { open = { instruction: '', result: '', inResult: false }; continue; }
      if (!open) continue;
      if (type === 'separate') { open.inResult = true; continue; }
      if (type === 'end') { if (open.instruction.includes('REF')) out.push({ instruction: open.instruction, result: open.result }); open = null; continue; }
      for (const node of Array.from(run.getElementsByTagNameNS(W, 'instrText'))) open.instruction += node.textContent ?? '';
      if (open.inResult) for (const node of Array.from(run.getElementsByTagNameNS(W, 't'))) open.result += node.textContent ?? '';
    }
  }
  return out;
}

async function failure(source: string): Promise<{ code?: string; line?: number }> {
  const error = await createDocumentFromMarkdoc(source).then(() => undefined, (caught: { code?: string; details?: { line?: number } }) => caught);
  expect(error, source).toBeDefined();
  return { code: error!.code, ...(error!.details?.line === undefined ? {} : { line: error!.details.line }) };
}

async function verificationFailure(promise: Promise<unknown>): Promise<CreationCertificate> {
  const error = await promise.then(() => undefined, (caught: { code?: string; details?: unknown }) => caught);
  expect(error).toMatchObject({ code: 'CREATION_VERIFICATION_FAILED' });
  return (error as { details: CreationCertificate }).details;
}

describe('Traceability: relative cross-references in created documents', () => {
  conforming.openspec('[SDX-MDOC-XREFREL-01] number="relative" cross-references show the numbers Word shows from where they sit')(
    'Scenario: number="relative" cross-references show the numbers Word shows from where they sit',
    async () => {
      for (const entry of [LEGAL, LISTS]) {
        const created = await createDocumentFromMarkdoc(entry.source);
        expect(created.certificate.passed).toBe(true);
        expect(await cachedFields(created.docx)).toEqual(entry.references.map(({ instruction, cached }) => ({ instruction, result: cached })));
        // Word, updating every field of the created document, shows the same numbers.
        expect(entry.references.every((reference) => reference.word === reference.cached)).toBe(true);
        expect(created.certificate.checks.crossReferences).toMatchObject({
          passed: true,
          references: { expected: entry.references.length, actual: entry.references.length, text: 0, relative: entry.references.length },
          mismatches: [],
          negativeControls: { switchChanged: true, retargeted: true, moved: true, textExtent: 'not applicable', relativeContext: true },
        });
      }
      const legal = (await createDocumentFromMarkdoc(LEGAL.source)).text;
      // From another Article, the same Section, a sibling clause, the target itself, a plain paragraph, a table
      // cell, a footnote, and a preface list whose list last numbered the target.
      for (const line of [
        'Terms apply, except as Section 2.02(b)(ii) says.',
        'See (b) below.',
        'First, under (b)(ii).',
        'One, unlike (ii) and Section 2.02.',
        'Two, as (ii) itself.',
        'Per (b)(ii)',
        '[1] As Section 2.02(b) provides.',
        'Close per Section 2.02(b)(ii) and ARTICLE II.',
        'Notices under Section 2.02(b), (b).',
      ]) expect(legal).toContain(line);
      const lists = (await createDocumentFromMarkdoc(LISTS.source)).text;
      for (const line of ['Before any list: 2(b).', 'Two a, see (b).', 'Two b i, see (ii) and 2.', 'Between: (b).', 'Three a: 2(b)(ii).', '[1] Note: 2(b).']) {
        expect(lists).toContain(line);
      }
    },
  );

  conforming.openspec('[SDX-MDOC-XREFREL-02] relative cross-references follow a Section inserted in Word as create numbers it')(
    'Scenario: relative cross-references follow a Section inserted in Word as create numbers it',
    async () => {
      const [beforeAdjustment, beforeClauses] = LEGAL.afterInsertingSection!;
      const inserted = [
        LEGAL.source.replace('### Adjustment {% #adjustment %}', '### Inserted Section.\n\n### Adjustment {% #adjustment %}'),
        LEGAL.source.replace('See {% xref to="adjustment-b" number="relative" /%} below.\n', 'See {% xref to="adjustment-b" number="relative" /%} below.\n\n### Inserted Section.\n'),
      ];
      for (const [index, word] of [beforeAdjustment!, beforeClauses!].entries()) {
        const created = await createDocumentFromMarkdoc(inserted[index]!);
        expect(created.certificate.passed).toBe(true);
        expect(await cachedFields(created.docx)).toEqual(word.references.map(({ instruction, word: result }) => ({ instruction, result })));
      }
      // The Section inserted between a reference and its target's clauses moves them out of its Section.
      expect(beforeClauses!.references[3]).toEqual({ instruction: ' REF adjustment_b \\r \\h ', word: 'Section 2.03(b)' });
      expect(beforeAdjustment!.references[3]).toEqual({ instruction: ' REF adjustment_b \\r \\h ', word: '(b)' });
    },
  );

  test.openspec('[SDX-MDOC-XREFREL-03] relative cross-references Word and LibreOffice would number differently fail closed with a code and a line')(
    'Scenario: relative cross-references Word and LibreOffice would number differently fail closed with a code and a line',
    async () => {
      const lists = '# T\n\n1. One.\n2. Two.\n   1. Two a. {% #two-a %}\n\nText.\n\n1. Again one.\n2. Again two.\n';
      expect(await failure(`${lists}\nSee {% xref to="two-a" number="relative" /%}.\n`)).toEqual({ code: 'XREF_RELATIVE_ACROSS_LISTS', line: 12 });
      // A reference before the target's list, after another list: Word shows the full number, LibreOffice not.
      expect(await failure('# T\n\n1. First.\n\nSee {% xref to="later" number="relative" /%}.\n\n4. Later one.\n5. Later two. {% #later %}\n')).toEqual({ code: 'XREF_RELATIVE_ACROSS_LISTS', line: 5 });
      // Before every list, after the target's own list, in a continuing list or in a footnote: created.
      for (const source of [
        '# T\n\nSee {% xref to="two-a" number="relative" /%}.\n\n1. One.\n2. Two.\n   1. Two a. {% #two-a %}\n',
        '# T\n\n1. One.\n2. Two.\n   1. Two a. {% #two-a %}\n\n3. Three: {% xref to="two-a" number="relative" /%}.\n',
        `${lists}\nNoted.{% fnref id="n" /%}\n\n{% footnote id="n" %}\nSee {% xref to="two-a" number="relative" /%}.\n{% /footnote %}\n`,
      ]) expect((await createDocumentFromMarkdoc(source)).certificate.passed, source).toBe(true);

      const legal = '---\nheading-numbers: legal\n---\n\n# T\n\n## Sale\n\n### Price {% #price %}\n\n1. Paid. {% #paid %}\n\n## Misc\n\n1. Clause under the Article. {% #article-clause %}\n';
      expect(await failure(`${legal}\nSee {% xref to="price" number="relative" /%}.\n`)).toEqual({ code: 'XREF_RELATIVE_AFTER_ARTICLE_CLAUSES', line: 17 });
      expect(await failure(`${legal}2. Per {% xref to="paid" number="relative" /%}.\n`)).toEqual({ code: 'XREF_RELATIVE_AFTER_ARTICLE_CLAUSES', line: 16 });
      expect(await failure(`${legal}\n## Last\n\nSee {% xref to="article-clause" number="relative" /%}.\n`)).toEqual({ code: 'XREF_FULL_NUMBER_UNDER_ARTICLE', line: 19 });
      // After the next heading the position is that heading again.
      expect((await createDocumentFromMarkdoc(`${legal}\n## Last\n\nSee {% xref to="paid" number="relative" /%}.\n`)).certificate.passed).toBe(true);

      const item = '# T\n\n1. One {% #one %}\n\n';
      expect(await failure(`${item}See {% xref to="one" number="relative" format="section" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure(`${item}See {% xref to="one" show="text" number="relative" /%}.\n`)).toEqual({ code: 'INVALID_CROSS_REFERENCE', line: 5 });
      expect(await failure('# T\n\n- One {% #one %}\n\nSee {% xref to="one" number="relative" /%}.\n')).toEqual({ code: 'XREF_TARGET_NOT_NUMBERED', line: 5 });
    },
  );

  test.openspec('[SDX-MDOC-XREFREL-04] verification checks each relative cross-reference against the number the oracle reads from where it sits')(
    'Scenario: verification checks each relative cross-reference against the number the oracle reads from where it sits',
    async () => {
      const source = '# T\n\n1. One.\n2. Two. {% #two %}\n   1. Two a, see {% xref to="two-b" number="relative" /%}.\n   2. Two b. {% #two-b %}\n';
      // The field written as a full-context reference, projected consistently: the read-back passes, the round
      // trip and the cross-reference check do not.
      const full = await verificationFailure(createDocumentFromMarkdoc(source, {
        transformLowering(lowering) {
          const paragraph = lowering.spec.sections[0]!.blocks.find((block) => block.kind === 'paragraph' && block.runs.some((run) => run.kind === 'crossReference')) as ParagraphSpec;
          paragraph.runs = paragraph.runs.map((run): InlineSpec => (run.kind === 'crossReference' ? { ...run, number: 'fullContext' } : run));
          lowering.projection.paragraphs = lowering.projection.paragraphs.map((text) => text.replace('see (b)', 'see 2(b)'));
          return lowering;
        },
      }));
      expect(full.checks.readback.passed).toBe(true);
      expect(full.checks.roundTrip.passed).toBe(false);
      expect(full.checks.crossReferences?.mismatches).toEqual([{ reference: 1, expected: ' REF two_b \\r \\h ', actual: ' REF two_b \\w \\h ' }]);

      // The relative-context control expects the full number instead; a source whose every relative reference
      // shows its full number has nothing to change, so the control is not applicable.
      const allFull = await createDocumentFromMarkdoc('# T\n\nSee {% xref to="two" number="relative" /%}.\n\n1. One.\n2. Two. {% #two %}\n');
      expect(allFull.certificate.checks.crossReferences?.negativeControls).toEqual({ switchChanged: true, retargeted: 'not applicable', moved: true, textExtent: 'not applicable', relativeContext: 'not applicable' });
      expect((await createDocumentFromMarkdoc(source)).certificate.checks.crossReferences?.negativeControls.relativeContext).toBe(true);
    },
  );

  test.openspec('[SDX-MDOC-XREFREL-05] the CLI summary counts relative cross-references and the PDF checks expect LibreOffice numbers')(
    'Scenario: the CLI summary counts relative cross-references and the PDF checks expect LibreOffice numbers',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-xref-relative-summary-'));
      try {
        const file = path.join(dir, 'mixed.mdoc');
        await writeFile(file, '# T\n\n1. One {% #one %}\n   1. One a, see {% xref to="one-b" number="relative" /%}.\n   2. One b. {% #one-b %}\n\nSee {% xref to="one" /%} and {% xref to="one" show="text" /%}.\n');
        expect((await runCreateCommand([file, path.join(dir, 'mixed'), '--no-pdf'])).summary)
          .toContain('cross-references ok (3 references: 1 number, 1 relative, 1 text; negative controls ok)');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      // LibreOffice keeps the period of "2." before "(" in a relative number that keeps level 0, and only there.
      const libreOffice = projectSourceText(LISTS.source, { reader: 'libreoffice' }).body.map((entry) => entry.text.trim());
      expect(libreOffice).toEqual(expect.arrayContaining(['Before any list: 2.(b).', 'Two a, see (b).', 'Two b i, see (ii) and 2.', 'Three a: 2.(b)(ii).']));
      const created = await createDocumentFromMarkdoc(LISTS.source);
      expect(requiredPdfText(created)).toContain('Three a: 2.(b)(ii).');
    },
  );
});

const realTools = defaultPdfRenderTools();
const describeWithLibreOffice = realTools.resolve('soffice') && realTools.resolve('pdftotext') ? describe : describe.skip;

describeWithLibreOffice('Traceability: relative cross-references in a real LibreOffice PDF', () => {
  test.openspec('[SDX-MDOC-XREFREL-06] a real LibreOffice PDF of relative cross-references passes the PDF checks')(
    'Scenario: a real LibreOffice PDF of relative cross-references passes the PDF checks',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-xref-relative-'));
      try {
        for (const [name, source] of [['legal', LEGAL.source], ['lists', LISTS.source]] as const) {
          const file = path.join(dir, `${name}.mdoc`);
          await writeFile(file, source);
          const result = await runCreateCommand([file, path.join(dir, name), '--require-pdf']);
          expect(result.pdf).toMatchObject({ status: 'passed', words: { passed: true } });
          const certificate = JSON.parse(await readFile(path.join(dir, name, `${name}.verification.json`), 'utf8')) as { pdf: { status: string } };
          expect(certificate.pdf.status).toBe('passed');
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
