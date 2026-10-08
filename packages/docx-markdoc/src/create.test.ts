import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { OOXML, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
import { createDocumentFromMarkdoc, firstParagraphMismatch } from './create/create.js';
import { lowerCreationMarkdoc } from './create/lower.js';
import { importDocxToMarkdoc } from './import.js';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RendererTools } from '@usejunior/docx-render-verifier';
import { runCreateCommand } from './create/cli-create.js';

const TEST_FEATURE = 'add-markdoc-document-creation';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1162 template-free document creation',
  severity: 'critical',
});
const W = OOXML.W_NS;

async function part(buffer: Buffer, path: string): Promise<Document> {
  const file = (await JSZip.loadAsync(buffer)).file(path);
  expect(file, path).toBeTruthy();
  return parseXml(await file!.async('string'));
}

const wAttr = (element: Element | null | undefined, name: string): string | null =>
  element ? element.getAttributeNS(W, name) || element.getAttribute(`w:${name}`) : null;

function bodyParagraphs(document: Document): Element[] {
  const body = document.getElementsByTagNameNS(W, 'body').item(0)!;
  return Array.from(body.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'p');
}

function styleOf(paragraph: Element): string | null {
  return wAttr(paragraph.getElementsByTagNameNS(W, 'pStyle').item(0), 'val');
}

function runs(paragraph: Element): Array<{ text: string; bold: boolean; italic: boolean; highlight: string | null }> {
  return Array.from(paragraph.getElementsByTagNameNS(W, 'r')).map((run) => ({
    text: Array.from(run.childNodes).map((node) => {
      const el = node as Element;
      if (el.localName === 't') return el.textContent ?? '';
      if (el.localName === 'tab') return '\t';
      if (el.localName === 'br') return '\n';
      return '';
    }).join(''),
    bold: run.getElementsByTagNameNS(W, 'b').length > 0,
    italic: run.getElementsByTagNameNS(W, 'i').length > 0,
    highlight: wAttr(run.getElementsByTagNameNS(W, 'highlight').item(0), 'val'),
  }));
}

async function expectCode(source: string, code: string, text?: RegExp): Promise<void> {
  const error = await createDocumentFromMarkdoc(source).then(() => null, (caught: unknown) => caught as { code?: string; message?: string });
  expect(error?.code, source).toBe(code);
  if (text) expect(error?.message, source).toMatch(text);
}

describe('Traceability: Markdoc document creation without a template', () => {
  test.openspec('[SDX-MDOC-CREATE-01] block grammar lowers to named styles over house defaults')(
    'Scenario: block grammar lowers to named styles over house defaults',
    async () => {
      const source = [
        '# ACME WIDGETS INC.', '', '## Approval', '', '### Detail', '',
        'Body with **bold** and *italic* text.', '', '> Quoted operative text.', '',
        '{% center %}Centred line{% /center %}', '', '{% legend %}End of page.{% /legend %}',
      ].join('\n');
      const { docx } = await createDocumentFromMarkdoc(source);
      const styles = await part(docx, 'word/styles.xml');
      const rFonts = styles.getElementsByTagNameNS(W, 'rPrDefault').item(0)!.getElementsByTagNameNS(W, 'rFonts').item(0)!;
      for (const channel of ['ascii', 'hAnsi', 'eastAsia', 'cs']) expect(wAttr(rFonts, channel), channel).toBe('Times New Roman');
      expect(wAttr(styles.getElementsByTagNameNS(W, 'rPrDefault').item(0)!.getElementsByTagNameNS(W, 'sz').item(0), 'val')).toBe('22');
      const spacing = styles.getElementsByTagNameNS(W, 'pPrDefault').item(0)!.getElementsByTagNameNS(W, 'spacing').item(0);
      expect([wAttr(spacing, 'after'), wAttr(spacing, 'line'), wAttr(spacing, 'lineRule')]).toEqual(['160', '276', 'auto']);
      const headingName = Array.from(styles.getElementsByTagNameNS(W, 'style')).find((style) => wAttr(style, 'styleId') === 'Heading1')!;
      expect(wAttr(headingName.getElementsByTagNameNS(W, 'name').item(0), 'val')).toBe('heading 1');

      const paragraphs = bodyParagraphs(await part(docx, 'word/document.xml'));
      expect(paragraphs.map(styleOf)).toEqual(['Title', 'Heading1', 'Heading2', 'BodyText', 'Quote', 'Centered', 'Legend']);
      expect(runs(paragraphs[3]!).map((run) => [run.text, run.bold, run.italic])).toEqual([
        ['Body with ', false, false], ['bold', true, false], [' and ', false, false], ['italic', false, true], [' text.', false, false],
      ]);
      for (const run of Array.from((await part(docx, 'word/document.xml')).getElementsByTagNameNS(W, 'r'))) {
        expect(run.getElementsByTagNameNS(W, 'rFonts')).toHaveLength(0);
        expect(run.getElementsByTagNameNS(W, 'sz')).toHaveLength(0);
      }
      // The legend keeps the paragraph before it on the same page.
      expect(paragraphs[5]!.getElementsByTagNameNS(W, 'keepNext')).toHaveLength(1);
    },
  );

  test.openspec('[SDX-MDOC-CREATE-02] bracketed fill-ins are highlighted with nesting')(
    'Scenario: bracketed fill-ins are highlighted with nesting',
    async () => {
      const source = [
        'Pay [Amount [in words]] to **[Name] Inc.** by [Date].', '',
        'Statute {% literal %}[sic]{% /literal %} stays plain.', '',
        '{% legend %}[Remainder of page intentionally left blank.]{% /legend %}',
      ].join('\n');
      const { docx } = await createDocumentFromMarkdoc(source);
      const paragraphs = bodyParagraphs(await part(docx, 'word/document.xml'));
      expect(runs(paragraphs[0]!).map((run) => [run.text, run.bold, run.highlight])).toEqual([
        ['Pay ', false, null], ['[Amount [in words]]', false, 'yellow'], [' to ', false, null],
        ['[Name]', true, 'yellow'], [' Inc.', true, null], [' by ', false, null], ['[Date]', false, 'yellow'], ['.', false, null],
      ]);
      expect(runs(paragraphs[1]!).every((run) => run.highlight === null)).toBe(true);
      // The legend is italic through its style, never highlighted.
      expect(styleOf(paragraphs[2]!)).toBe('Legend');
      expect(runs(paragraphs[2]!).every((run) => run.highlight === null)).toBe(true);
      await expectCode('First line.\n\nA stray ] bracket.', 'UNBALANCED_FILL_IN', /line 3/);
      await expectCode('An [open bracket.', 'UNBALANCED_FILL_IN', /line 1/);
    },
  );

  test.openspec('[SDX-MDOC-CREATE-03] unsupported and legacy syntax fails closed')(
    'Scenario: unsupported and legacy syntax fails closed',
    async () => {
      await expectCode('See [the site](https://example.com).', 'UNSUPPORTED_CREATION_SYNTAX', /link/);
      await expectCode('![logo](logo.png)', 'UNSUPPORTED_CREATION_SYNTAX', /image/);
      await expectCode('Run `code` here.', 'UNSUPPORTED_CREATION_SYNTAX', /code/);
      await expectCode('{% unknown /%}', 'UNSUPPORTED_CREATION_TAG');
      await expectCode('{% signer name="A" title="B" /%}', 'UNSUPPORTED_CREATION_ATTRIBUTE');
      await expectCode('---\ndocument_id: x\n---\n\nBody', 'UNSUPPORTED_CREATION_FRONTMATTER');
      await expectCode('#### Too deep', 'UNSUPPORTED_HEADING_LEVEL');
      await expectCode('Body\n\n---\n\nMore', 'UNSUPPORTED_CREATION_SYNTAX', /hr/);
      await expectCode('```\ncode\n```', 'UNSUPPORTED_CREATION_SYNTAX', /fence/);
      await expectCode('Body\n\n<center>Old</center>', 'LEGACY_MARKUP', /\{% center %\}.*line 3/);
      await expectCode('<signer>Jane Roe | Date: __</signer>', 'LEGACY_MARKUP', /\{% signer/);
      await expectCode('Body\n\n<!-- pagebreak -->', 'LEGACY_MARKUP', /\{% page-break \/%\}/);
      await expectCode('Body\n\n{% page-break /%}', 'DANGLING_PAGE_BREAK');
    },
  );

  test.openspec('[SDX-MDOC-CREATE-04] signer blocks align dates without spacer paragraphs')(
    'Scenario: signer blocks align dates without spacer paragraphs',
    async () => {
      const source = [
        'IN WITNESS WHEREOF, the undersigned have signed.', '',
        '{% signer name="Jane Roe, Director" date="Date: ________" /%}', '',
        '{% signer name="[Director Name], Director" date="Date: ________" /%}',
      ].join('\n');
      const { docx } = await createDocumentFromMarkdoc(source);
      const paragraphs = bodyParagraphs(await part(docx, 'word/document.xml'));
      expect(paragraphs).toHaveLength(3);
      expect(paragraphs.every((paragraph) => runs(paragraph).map((run) => run.text).join('').trim().length > 0)).toBe(true);
      expect(paragraphs[0]!.getElementsByTagNameNS(W, 'keepNext')).toHaveLength(1);
      expect(runs(paragraphs[1]!).map((run) => run.text)).toEqual(['_'.repeat(30), '\n', 'Jane Roe, Director', '\t', 'Date: ________']);
      expect(runs(paragraphs[2]!).map((run) => [run.text, run.highlight])).toContainEqual(['[Director Name]', 'yellow']);
      expect(wAttr(paragraphs[1]!.getElementsByTagNameNS(W, 'spacing').item(0), 'before')).toBe('840');
      expect(paragraphs[2]!.getElementsByTagNameNS(W, 'spacing')).toHaveLength(0);
      const signature = Array.from((await part(docx, 'word/styles.xml')).getElementsByTagNameNS(W, 'style')).find((style) => wAttr(style, 'styleId') === 'Signature')!;
      expect(wAttr(signature.getElementsByTagNameNS(W, 'spacing').item(0), 'before')).toBe('600');
      expect(signature.getElementsByTagNameNS(W, 'keepLines')).toHaveLength(1);
      const tab = signature.getElementsByTagNameNS(W, 'tab').item(0);
      expect([wAttr(tab, 'val'), wAttr(tab, 'pos')]).toEqual(['left', '6120']);
    },
  );

  test.openspec('[SDX-MDOC-CREATE-05] sections carry linked or unlinked footers and page numbers')(
    'Scenario: sections carry linked or unlinked footers and page numbers',
    async () => {
      const source = [
        '---', 'page-numbers: true', '---', '', 'Resolutions.', '',
        '{% section footer="[Signature Page to Consent]" /%}', '', 'Signature page.', '',
        '{% section /%}', '', 'Exhibit.',
      ].join('\n');
      const { docx, readback } = await createDocumentFromMarkdoc(source);
      const document = await part(docx, 'word/document.xml');
      const paragraphs = bodyParagraphs(document);
      expect(paragraphs.map((paragraph) => runs(paragraph).map((run) => run.text).join(''))).toEqual(['Resolutions.', 'Signature page.', 'Exhibit.']);
      expect(paragraphs[0]!.getElementsByTagNameNS(W, 'sectPr')).toHaveLength(1);
      expect(paragraphs[1]!.getElementsByTagNameNS(W, 'sectPr')).toHaveLength(1);
      expect(readback.footers).toEqual([['<PAGE>'], ['[Signature Page to Consent]'], null]);
      const sectPrs = Array.from(document.getElementsByTagNameNS(W, 'sectPr'));
      expect(sectPrs.map((sectPr) => sectPr.getElementsByTagNameNS(W, 'footerReference').length)).toEqual([1, 1, 0]);
      const footer2 = await part(docx, 'word/footer2.xml');
      const footerRuns = runs(footer2.getElementsByTagNameNS(W, 'p').item(0)!);
      expect(footerRuns).toEqual([{ text: '[Signature Page to Consent]', bold: false, italic: true, highlight: null }]);
      await expectCode('{% section /%}\n\nBody', 'EMPTY_CREATION_SECTION');
      await expectCode('Body\n\n{% section /%}', 'EMPTY_CREATION_SECTION');
    },
  );

  test.openspec('[SDX-MDOC-CREATE-06] ordered lists use legal multilevel numbering')(
    'Scenario: ordered lists use legal multilevel numbering',
    async () => {
      const source = [
        '1. First resolution', '   1. Lettered', '      1. Roman', '', '## Break', '',
        '3. Third resolution', '', '- A bullet',
      ].join('\n');
      const { docx } = await createDocumentFromMarkdoc(source);
      const paragraphs = bodyParagraphs(await part(docx, 'word/document.xml'));
      const listed = paragraphs.filter((paragraph) => paragraph.getElementsByTagNameNS(W, 'numPr').length > 0);
      expect(listed.map((paragraph) => runs(paragraph).map((run) => run.text).join(''))).toEqual(['First resolution', 'Lettered', 'Roman', 'Third resolution', 'A bullet']);
      expect(listed.map((paragraph) => wAttr(paragraph.getElementsByTagNameNS(W, 'ilvl').item(0), 'val'))).toEqual(['0', '1', '2', '0', '0']);
      const numbering = await part(docx, 'word/numbering.xml');
      const abstracts = Array.from(numbering.getElementsByTagNameNS(W, 'abstractNum'));
      expect(abstracts).toHaveLength(3);
      const levels = (abstract: Element) => Array.from(abstract.getElementsByTagNameNS(W, 'lvl')).map((lvl) => [
        wAttr(lvl.getElementsByTagNameNS(W, 'start').item(0), 'val'),
        wAttr(lvl.getElementsByTagNameNS(W, 'numFmt').item(0), 'val'),
        wAttr(lvl.getElementsByTagNameNS(W, 'lvlText').item(0), 'val'),
      ]);
      expect(levels(abstracts[0]!)).toEqual([['1', 'decimal', '%1.'], ['1', 'lowerLetter', '(%2)'], ['1', 'lowerRoman', '(%3)']]);
      expect(levels(abstracts[1]!)[0]).toEqual(['3', 'decimal', '%1.']);
      expect(levels(abstracts[2]!)[0]![1]).toBe('bullet');
      await expectCode('1. A\n   - b', 'MIXED_LIST_NESTING');
    },
  );

  test.openspec('[SDX-MDOC-CREATE-07] tables lower with a repeated bold header row')(
    'Scenario: tables lower with a repeated bold header row',
    async () => {
      const source = ['{% table widths="30,70" %}', '* Holder', '* Shares', '---', '* [Holder One]', '* 1,000', '---', '* Holder Two', '* 2,500', '{% /table %}', '', 'After the table.'].join('\n');
      const { docx, readback } = await createDocumentFromMarkdoc(source);
      const document = await part(docx, 'word/document.xml');
      const grid = Array.from(document.getElementsByTagNameNS(W, 'gridCol')).map((col) => wAttr(col, 'w'));
      expect(grid).toEqual(['2808', '6552']);
      const rows = Array.from(document.getElementsByTagNameNS(W, 'tr'));
      expect(rows[0]!.getElementsByTagNameNS(W, 'tblHeader')).toHaveLength(1);
      expect(rows[1]!.getElementsByTagNameNS(W, 'tblHeader')).toHaveLength(0);
      expect(runs(rows[0]!.getElementsByTagNameNS(W, 'p').item(0)!)[0]!.bold).toBe(true);
      expect(runs(rows[1]!.getElementsByTagNameNS(W, 'p').item(0)!)[0]!.highlight).toBe('yellow');
      expect(document.getElementsByTagNameNS(W, 'insideH').item(0)).toBeTruthy();
      expect(readback.paragraphs).toEqual(['Holder', 'Shares', '[Holder One]', '1,000', 'Holder Two', '2,500', 'After the table.']);
      const after = bodyParagraphs(document)[0]!;
      expect(wAttr(after.getElementsByTagNameNS(W, 'spacing').item(0), 'before')).toBe('160');
      await expectCode('{% table %}\n* A\n* B\n---\n* only one\n{% /table %}', 'RAGGED_CREATION_TABLE');
      await expectCode('{% table widths="30" %}\n* A\n* B\n{% /table %}', 'INVALID_TABLE_WIDTHS');
    },
  );

  test.openspec('[SDX-MDOC-CREATE-08] read-back, footer and determinism checks have negative controls')(
    'Scenario: read-back, footer and determinism checks have negative controls',
    async () => {
      const source = [
        '---', 'title: Consent', 'page-numbers: true', '---', '', '# TITLE', '',
        'Body [Fill].\\', 'Second line.', '', '1. Item', '', '{% table %}', '* A', '* B', '{% /table %}', '',
        '{% section footer="Footer text" /%}', '', '{% signer name="Jane Roe" date="Date: __" /%}',
      ].join('\n');
      const first = await createDocumentFromMarkdoc(source, { profileSource: '{}' });
      const second = await createDocumentFromMarkdoc(source, { profileSource: '{}' });
      expect(Buffer.compare(first.docx, second.docx)).toBe(0);
      const { checks } = first.certificate;
      expect(first.certificate.passed).toBe(true);
      expect(checks.readback).toMatchObject({ passed: true, negativeControlDetected: true });
      expect(checks.footers).toMatchObject({ passed: true, negativeControlDetected: true, sections: 2 });
      expect(checks.determinism.passed).toBe(true);
      expect(checks.package).toEqual({ passed: true, issues: [] });
      // The empty break paragraph after the section-ending table is read back but has nothing to anchor.
      expect(checks.brownfield).toMatchObject({ passed: true, anchoredParagraphs: 6 });
      expect(first.certificate.docxSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(first.certificate.profileSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(first.readback.paragraphs).toEqual(['TITLE', 'Body [Fill].\nSecond line.', 'Item', 'A', 'B', '', `${'_'.repeat(30)}\nJane Roe\tDate: __`]);
      expect(first.text.split('\n').slice(2).join('\n')).toBe(`${first.readback.paragraphs.join('\n\n')}\n`);
      expect(firstParagraphMismatch(['a', 'b'], ['a', 'b'])).toBe(-1);
      expect(firstParagraphMismatch(['a', 'b'], ['a', 'bx'])).toBe(1);
      expect(firstParagraphMismatch(['a'], ['a', ''])).toBe(1);
      // The table ends the first section, so docx-core keeps its dedicated break paragraph and the projection says so.
      expect(lowerCreationMarkdoc(source).spec.sections[0]!.breakPlacement).toBe('ownParagraph');
    },
  );

  test.openspec('[SDX-MDOC-CREATE-09] a created document is a brownfield source')(
    'Scenario: a created document is a brownfield source',
    async () => {
      const created = await createDocumentFromMarkdoc('# CONSENT\n\nThe Board approves the plan.\n\nThe officers may act.');
      expect(created.certificate.checks.brownfield).toMatchObject({ passed: true, anchoredParagraphs: 3 });
      const imported = await importDocxToMarkdoc(created.docx);
      const match = /\{% para id="([^"]+)" fingerprint="([^"]+)" style="([^"]+)" %\}\nThe Board approves the plan\.\n\{% \/para %\}/.exec(imported.markdoc);
      expect(match).toBeTruthy();
      const [block, id, fingerprint, style] = match!;
      const revised = imported.markdoc.replace(block, [
        `{% change id="${id}" fingerprint="${fingerprint}" style="${style}" edit="approve-amended-plan" format="inherit-source-paragraph" %}`,
        '{% before %}', 'The Board approves the plan.', '{% /before %}',
        '{% after %}', 'The Board approves the amended plan.', '{% /after %}', '{% /change %}',
      ].join('\n'));
      const compiled = await compileMarkdoc(imported.anchoredSource, revised, { date: new Date('2026-10-07T00:00:00Z') });
      const tracked = await part(compiled.tracked, 'word/document.xml');
      const insertions = Array.from(tracked.getElementsByTagNameNS(W, 'ins'));
      expect(insertions.map((ins) => ins.textContent)).toEqual(['amended ']);
      expect(tracked.getElementsByTagNameNS(W, 'del')).toHaveLength(0);
    },
  );

  test.openspec('[SDX-MDOC-CREATE-10] the CLI writes docx, text mirror and certificate, and the PDF check is honest')(
    'Scenario: the CLI writes docx, text mirror and certificate, and the PDF check is honest',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sdx-create-cli-'));
      const missingTools: RendererTools = { resolve: () => null, run: async () => ({ code: 1, stdout: '', stderr: 'unused' }) };
      try {
        const source = path.join(dir, 'consent.mdoc');
        await writeFile(source, '# CONSENT\n\nThe Board approves [the plan].');
        const out = path.join(dir, 'out');
        const first = await runCreateCommand([source, out], { renderTools: missingTools });
        expect(first.pdf).toMatchObject({ status: 'not_run' });
        expect(first.summary).toContain('pdf not_run');
        expect((await readdir(out)).sort()).toEqual(['consent.docx', 'consent.txt', 'consent.verification.json']);
        const mirror = await readFile(path.join(out, 'consent.txt'), 'utf8');
        expect(mirror).toBe(first.created.text);
        expect(mirror).toContain('CONSENT\n\nThe Board approves [the plan].');
        const certificate = JSON.parse(await readFile(path.join(out, 'consent.verification.json'), 'utf8'));
        expect(certificate).toMatchObject({ passed: true, pdf: { status: 'not_run' } });
        const before = await readFile(path.join(out, 'consent.docx'));

        await expect(runCreateCommand([source, out], { renderTools: missingTools })).rejects.toMatchObject({ code: 'CREATION_OUTPUT_EXISTS' });
        expect(Buffer.compare(await readFile(path.join(out, 'consent.docx')), before)).toBe(0);
        await expect(runCreateCommand([source, path.join(dir, 'strict'), '--require-pdf'], { renderTools: missingTools }))
          .rejects.toMatchObject({ code: 'CREATION_PDF_FAILED' });
        expect(await readdir(path.join(dir, 'strict'))).toEqual([]);

        await writeFile(source, '# CONSENT\n\nThe Board approves [the amended plan].');
        const rebuilt = await runCreateCommand([source, out, '--replace', '--no-pdf']);
        expect(rebuilt.pdf).toEqual({ status: 'skipped' });
        expect(await readFile(path.join(out, 'consent.txt'), 'utf8')).toContain('[the amended plan]');
        expect((await readdir(out)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
        await expect(runCreateCommand([source, out, '--no-pdf', '--require-pdf'])).rejects.toThrow(/mutually exclusive/);
        await expect(runCreateCommand([source, path.dirname(source), '--replace', '--no-pdf'])).resolves.toBeTruthy();
        // A source named notes.txt would be overwritten by its own text mirror.
        const notes = path.join(dir, 'notes.txt');
        await writeFile(notes, 'Body.');
        await expect(runCreateCommand([notes, dir, '--replace', '--no-pdf'])).rejects.toMatchObject({ code: 'CREATION_PATH_COLLISION' });
        expect(await readFile(notes, 'utf8')).toBe('Body.');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
