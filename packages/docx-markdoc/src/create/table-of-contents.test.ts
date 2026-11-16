import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { OOXML, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPdfRenderTools } from '../pdf/tools.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc, tableOfContentsCheck } from './create.js';
import { comparePdfWords, projectSourceText } from './oracle.js';
import { readCreatedDocx } from './readback.js';

const TEST_FEATURE = 'add-created-run-in-numbering-and-toc';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1426 table of contents and roman page numbers in created documents',
  severity: 'critical',
});

const W = OOXML.W_NS;

/** A synthetic agreement: a roman front-matter section with the contents, then a run-in body restarting at page 1. */
const SOURCE = [
  '---',
  'title: Services Agreement',
  'page-numbers: true',
  'page-number-format: lower-roman',
  '---',
  '',
  '# SERVICES AGREEMENT',
  '',
  '{% center %}TABLE OF CONTENTS{% /center %}',
  '',
  '{% toc /%}',
  '',
  '{% section page-numbers=true page-number-start=1 /%}',
  '',
  '{% run-in-paragraph level="article" heading="Services" /%}',
  '',
  '{% run-in-paragraph level="section" heading="Engagement" %}',
  'The Provider shall perform the Services.',
  '{% /run-in-paragraph %}',
  '',
  'The parties also agree to the {% tc level=2 %}Schedule of Fees{% /tc %} attached to this Agreement.',
  '',
  '{% run-in-paragraph level="article" heading="Term" /%}',
  '',
].join('\n');

async function documentXml(docx: Buffer): Promise<Document> {
  return parseXml(await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string'));
}

async function failure(source: string): Promise<{ code?: string; line?: number } | undefined> {
  return createDocumentFromMarkdoc(source).then(() => undefined, (error: { code?: string; details?: { line?: number } }) => ({ code: error.code, line: error.details?.line }));
}

describe('Traceability: table of contents and roman page numbers in created documents', () => {
  test.openspec('[SDX-MDOC-TOC-01] a toc tag writes a table of contents with its entries before fields are updated')(
    'Scenario: a toc tag writes a table of contents with its entries before fields are updated',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      expect(created.certificate.passed).toBe(true);
      expect(created.certificate.checks.tableOfContents).toMatchObject({ passed: true, entries: 4, tcEntries: 4, negativeControlDetected: true });
      expect(created.readback.tableOfContents?.entries).toEqual([
        { text: '1. Services', style: 'TOC1' },
        { text: '1.01 Engagement', style: 'TOC2' },
        { text: 'Schedule of Fees', style: 'TOC2' },
        { text: '2. Term', style: 'TOC1' },
      ]);
      expect(created.readback.tableOfContents?.instruction).toBe(' TOC \\f \\l "1-3" \\n ');
      // The tc content shows where it sits; the TC fields show nothing.
      expect(created.readback.paragraphs).toContain('The parties also agree to the Schedule of Fees attached to this Agreement.');
      expect(created.readback.paragraphs).toContain('Services.');
      const instructions = Array.from((await documentXml(created.docx)).getElementsByTagNameNS(W, 'instrText')).map((node) => node.textContent);
      expect(instructions.filter((instruction) => instruction?.trim().startsWith('TC'))).toEqual([
        ' TC "1. Services" \\l 1 ',
        ' TC "1.01 Engagement" \\l 2 ',
        ' TC "Schedule of Fees" \\l 2 ',
        ' TC "2. Term" \\l 1 ',
      ]);
      expect(created.certificate.checks.roundTrip.passed).toBe(true);
    },
  );

  test.openspec('[SDX-MDOC-TOC-02] numbered and unnumbered headings list in the table of contents')(
    'Scenario: numbered and unnumbered headings list in the table of contents',
    async () => {
      const legal = await createDocumentFromMarkdoc('---\nheading-numbers: legal\n---\n\n# T\n\n{% toc /%}\n\n## Definitions\n\n### Defined Terms {% #terms %}\n\nSee {% xref to="terms" show="text" /%}.\n');
      expect(legal.readback.tableOfContents?.entries.map((entry) => entry.text)).toEqual(['ARTICLE I Definitions', 'Section 1.01 Defined Terms']);
      // The heading's TC entry sits after its bookmark: a text reference still shows only the heading's text.
      expect(legal.readback.paragraphs.at(-1)).toBe('See Defined Terms.');
      const plain = await createDocumentFromMarkdoc('# T\n\n{% toc /%}\n\n## Definitions\n\n### Defined Terms\n\nText.\n');
      expect(plain.readback.tableOfContents?.entries).toEqual([{ text: 'Definitions', style: 'TOC1' }, { text: 'Defined Terms', style: 'TOC2' }]);
      expect(plain.certificate.passed).toBe(true);
    },
  );

  test.openspec('[SDX-MDOC-TOC-03] a stale or malformed table of contents fails closed')(
    'Scenario: a stale or malformed table of contents fails closed',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      const zip = await JSZip.loadAsync(created.docx);
      const xml = await zip.file('word/document.xml')!.async('string');
      zip.file('word/document.xml', xml.replace('>1.01 Engagement<', '>1.01 Appointment<'));
      const stale = tableOfContentsCheck(await readCreatedDocx(await zip.generateAsync({ type: 'nodebuffer' })))!;
      expect(stale.passed).toBe(false);
      expect(stale.detail).toContain('entry 2');
      expect(await failure('# T\n\n{% toc /%}\n\nText.\n')).toEqual({ code: 'TOC_WITHOUT_ENTRIES', line: 3 });
      expect(await failure('# T\n\n{% toc /%}\n\n{% toc /%}\n\n## A\n')).toEqual({ code: 'DUPLICATE_TOC', line: 5 });
      expect((await failure('# T\n\nSee {% tc %}A{% /tc %}.\n'))?.code).toBe('INVALID_TOC_ENTRY');
      expect(await failure('# T\n\n{% toc /%}\n\n## The "Best" Terms\n')).toEqual({ code: 'TOC_ENTRY_TEXT_UNSUPPORTED', line: 5 });
    },
  );

  test.openspec('[SDX-MDOC-TOC-04] a roman front-matter section and a body restarting at 1')(
    'Scenario: a roman front-matter section and a body restarting at 1',
    async () => {
      const created = await createDocumentFromMarkdoc(SOURCE);
      expect(created.readback.pageNumbering).toEqual([{ format: 'lowerRoman' }, { start: 1 }]);
      expect(created.certificate.checks.pageNumbering).toMatchObject({ passed: true, negativeControlDetected: true });
      const upper = await createDocumentFromMarkdoc('---\npage-numbers: true\npage-number-format: upper-roman\n---\n\nFront.\n\n{% section /%}\n\nBody inherits the roman footer.\n');
      // A section that inherits the roman footer numbers in roman too.
      expect(upper.readback.pageNumbering).toEqual([{ format: 'upperRoman' }, { format: 'upperRoman' }]);
      expect((await failure('Body.\n\n{% section page-number-start=0 /%}\n\nMore.\n'))?.code).toBe('INVALID_SECTION');
      // A page break before the table of contents stays on its first entry.
      const broken = await createDocumentFromMarkdoc('# T\n\n{% page-break /%}\n\n{% toc /%}\n\n## A\n\nText.\n');
      expect(broken.lowering.spec.sections[0]!.blocks.find((block) => block.kind === 'paragraph' && block.tableOfContents?.opens)).toMatchObject({ pageBreakBefore: true });
    },
  );
});

const realTools = defaultPdfRenderTools();
const describeWithLibreOffice = realTools.resolve('soffice') && realTools.resolve('pdftotext') ? describe : describe.skip;

describeWithLibreOffice('Traceability: table of contents in a real LibreOffice PDF', () => {
  test.openspec('[SDX-MDOC-TOC-01] a toc tag writes a table of contents with its entries before fields are updated')(
    'Scenario: a real LibreOffice PDF of a run-in agreement with a table of contents and roman pages passes the PDF checks',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-toc-'));
      try {
        const file = path.join(dir, 'agreement.mdoc');
        await writeFile(file, SOURCE);
        const result = await runCreateCommand([file, path.join(dir, 'out'), '--require-pdf']);
        expect(result.pdf).toMatchObject({ status: 'passed', words: { passed: true } });
        // The printed page numbers must be the sections' own: "i" then a restart at "1". A wrong number in
        // either section's numerals fails, as does a body that numbers on from the front matter.
        const pages = execFileSync(realTools.resolve('pdftotext')!, ['-raw', path.join(dir, 'out', 'agreement.pdf'), '-'], { encoding: 'utf8' }).split('\f').filter((page) => page.trim());
        const expected = projectSourceText(SOURCE, { reader: 'libreoffice' });
        expect(comparePdfWords(expected, pages).footerMismatches).toEqual([]);
        const renumbered = (from: string, to: string) => pages.map((page, index) => (index === 1 ? page.replace(new RegExp(`^${from}$`, 'mu'), to) : page));
        expect(pages[1]).toMatch(/^1$/mu);
        expect(comparePdfWords(expected, renumbered('1', '9999')).footerMismatches.length).toBeGreaterThan(0);
        expect(comparePdfWords(expected, renumbered('1', '2')).footerMismatches.length).toBeGreaterThan(0);
        expect(comparePdfWords(expected, pages.map((page, index) => (index === 0 ? page.replace(/^i$/mu, 'mmm') : page))).footerMismatches.length).toBeGreaterThan(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
